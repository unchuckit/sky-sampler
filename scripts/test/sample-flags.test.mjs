import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { sampleFlags, FLAG_KEYS } from '../../src/sampleFlags.js'
import { PROVENANCE, TIERS } from '../../src/constants.js'

// A sample with nothing wrong with it: verified, Tier A, high confidence, in
// the comparable geometry band. This is what most of the log looks like, and
// the whole point of the exception rule is that it says nothing.
function cleanSample(overrides = {}) {
  return {
    aqi: 26,
    pm25: 6.2,
    provenance: PROVENANCE.VERIFIED,
    geometryCompliant: true,
    confidenceBand: 'high',
    stationSelection: {
      tier: TIERS.A,
      confidenceBand: 'high',
      suspect: false,
      distanceKm: 0.7,
    },
    ...overrides,
  }
}

const keysOf = (sample) => sampleFlags(sample).map((f) => f.key)
const labelsOf = (sample) => sampleFlags(sample).map((f) => f.label)

describe('exception flags — silence means fine', () => {
  test('a clean sample raises nothing at all', () => {
    assert.deepEqual(sampleFlags(cleanSample()), [])
  })

  test('a null sample raises nothing rather than throwing', () => {
    assert.deepEqual(sampleFlags(null), [])
    assert.deepEqual(sampleFlags(undefined), [])
  })

  test('high confidence is never announced — it is the normal case', () => {
    assert.equal(keysOf(cleanSample({ confidenceBand: 'high' })).includes(FLAG_KEYS.CONFIDENCE), false)
  })

  test('Tier A is never announced', () => {
    const s = cleanSample()
    s.stationSelection.tier = TIERS.A
    assert.equal(keysOf(s).includes(FLAG_KEYS.LOW_COST_SENSOR), false)
  })
})

describe('exception flags — each condition fires', () => {
  test('moderate confidence', () => {
    const s = cleanSample()
    s.stationSelection.confidenceBand = 'moderate'
    assert.deepEqual(labelsOf(s), ['Moderate confidence'])
  })

  test('low confidence', () => {
    const s = cleanSample()
    s.stationSelection.confidenceBand = 'low'
    assert.deepEqual(labelsOf(s), ['Low confidence'])
  })

  test('confidence falls back to the sample-level band when there is no selection', () => {
    const s = cleanSample({ stationSelection: null, confidenceBand: 'low' })
    assert.deepEqual(labelsOf(s), ['Low confidence'])
  })

  test('Tier B reads as "Low-cost sensor", not as a tier letter', () => {
    const s = cleanSample()
    s.stationSelection.tier = TIERS.B
    assert.deepEqual(labelsOf(s), ['Low-cost sensor'])
  })

  test('off-angle geometry', () => {
    assert.deepEqual(labelsOf(cleanSample({ geometryCompliant: false })), ['Off-angle'])
  })

  test('unverified provenance', () => {
    assert.deepEqual(labelsOf(cleanSample({ provenance: PROVENANCE.UNVERIFIED })), ['Unverified AQI'])
  })

  test('backfilled provenance is also not verified, so it flags', () => {
    assert.deepEqual(labelsOf(cleanSample({ provenance: PROVENANCE.BACKFILLED })), ['Unverified AQI'])
  })

  test('a suspect station reading', () => {
    const s = cleanSample()
    s.stationSelection.suspect = true
    assert.deepEqual(labelsOf(s), ['Sensor reading suspect'])
  })

  test('a missing AQI', () => {
    const s = cleanSample({ aqi: null, provenance: PROVENANCE.NO_COVERAGE, stationSelection: null })
    assert.deepEqual(labelsOf(s), ['No AQI'])
  })
})

describe('exception flags — combinations and edge cases', () => {
  test('several flags on one sample all appear, worst first', () => {
    const s = cleanSample({ provenance: PROVENANCE.UNVERIFIED, geometryCompliant: false })
    s.stationSelection.tier = TIERS.B
    s.stationSelection.confidenceBand = 'low'
    s.stationSelection.suspect = true
    assert.deepEqual(labelsOf(s), [
      'Unverified AQI',
      'Sensor reading suspect',
      'Low confidence',
      'Low-cost sensor',
      'Off-angle',
    ])
  })

  // "No AQI · Unverified AQI" says one thing twice. A no-coverage sample has a
  // non-verified provenance by definition, and the missing AQI already explains
  // why, so the narrower flag is suppressed.
  test('a no-coverage sample says "No AQI" once, not twice', () => {
    const s = cleanSample({ aqi: null, provenance: PROVENANCE.NO_COVERAGE, stationSelection: null })
    assert.deepEqual(labelsOf(s), ['No AQI'])
    assert.equal(keysOf(s).includes(FLAG_KEYS.UNVERIFIED), false)
  })

  // Geometry capture postdates the earliest samples. Those never claimed to be
  // compliant, so flagging them would flag history rather than a problem.
  test('a pre-geometry sample with no compliance field is not flagged off-angle', () => {
    const s = cleanSample()
    delete s.geometryCompliant
    assert.equal(keysOf(s).includes(FLAG_KEYS.OFF_ANGLE), false)
  })

  test('a sample with no provenance field at all is not flagged unverified', () => {
    const s = cleanSample()
    delete s.provenance
    assert.deepEqual(sampleFlags(s), [])
  })
})
