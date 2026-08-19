import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  selectStation,
  computeNeighbourDeviations,
  haversineKm,
  scoreFor,
} from '../../src/stationSelection.js'
import { TIERS, REJECTION_REASONS, PROVENANCE } from '../../src/constants.js'

const LOCATION = { id: 'test', label: 'Test', lat: -6.3, lng: 106.8 }
const NOW = new Date('2026-08-06T12:00:00Z')

// 1 degree of latitude ≈ 111.195 km, so a pure-latitude offset gives an exact
// known great-circle distance without having to fight longitude convergence.
const KM_PER_DEG_LAT = 111.19492664455873

function stationAtKm(km, props = {}) {
  return {
    uid: props.uid ?? Math.floor(Math.random() * 1e6),
    name: props.name ?? `station-${km}km`,
    lat: LOCATION.lat + km / KM_PER_DEG_LAT,
    lng: LOCATION.lng,
    aqi: props.aqi ?? 80,
    tier: props.tier ?? TIERS.B,
    suspect: props.suspect ?? false,
    neighbourDeviation: props.neighbourDeviation ?? null,
    // Default to a fresh reading so freshness only matters where a test says so.
    lastSeen: props.lastSeen ?? new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    ...props,
  }
}

describe('haversine sanity', () => {
  test('pure latitude offset yields the expected distance', () => {
    const d = haversineKm(LOCATION.lat, LOCATION.lng, LOCATION.lat + 1 / KM_PER_DEG_LAT, LOCATION.lng)
    assert.ok(Math.abs(d - 1) < 0.001, `expected ~1km, got ${d}`)
  })
})

describe('scoring formula', () => {
  test('is multiplicative across distance, tier and suspect', () => {
    assert.equal(scoreFor(8, TIERS.A, false), 8)
    assert.equal(scoreFor(7.5, TIERS.C, false), 15)
    assert.equal(scoreFor(3, TIERS.B, true), 7.8000000000000007) // 3 × 1.3 × 2.0
    assert.equal(scoreFor(4, TIERS.C, false), 8)
  })
})

describe('stress tests — station selection', () => {
  test('Tier A at 8.0km beats Tier C at 7.5km (8.0 vs 15.0)', () => {
    const a = stationAtKm(8.0, { uid: 1, name: 'A-8km', tier: TIERS.A })
    const c = stationAtKm(7.5, { uid: 2, name: 'C-7.5km', tier: TIERS.C })
    const { chosen } = selectStation(LOCATION, [a, c], NOW)
    assert.equal(chosen.uid, 1)
  })

  test('Tier A at 20km loses to Tier C at 2km — A fails the 15km gate', () => {
    const a = stationAtKm(20, { uid: 1, name: 'A-20km', tier: TIERS.A })
    const c = stationAtKm(2, { uid: 2, name: 'C-2km', tier: TIERS.C })
    const { chosen, selection } = selectStation(LOCATION, [a, c], NOW)
    assert.equal(chosen.uid, 2)
    const aReject = selection.rejected.find((r) => r.uid === 1)
    assert.equal(aReject.reason, REJECTION_REASONS.OUT_OF_RADIUS)
  })

  test('Tier A at 14km loses to Tier C at 2km (14.0 vs 4.0)', () => {
    const a = stationAtKm(14, { uid: 1, name: 'A-14km', tier: TIERS.A })
    const c = stationAtKm(2, { uid: 2, name: 'C-2km', tier: TIERS.C })
    const { chosen, selection } = selectStation(LOCATION, [a, c], NOW)
    assert.equal(chosen.uid, 2)
    // A was a legitimate candidate here — it lost on score, not on a gate.
    assert.equal(selection.rejected.find((r) => r.uid === 1).reason, REJECTION_REASONS.LOWER_SCORE)
  })

  test('Tier A at 3km loses to Tier C at 0.5km (3.0 vs 1.0) — proximity dominates', () => {
    const a = stationAtKm(3, { uid: 1, name: 'A-3km', tier: TIERS.A })
    const c = stationAtKm(0.5, { uid: 2, name: 'C-0.5km', tier: TIERS.C })
    const { chosen } = selectStation(LOCATION, [a, c], NOW)
    assert.equal(chosen.uid, 2)
  })

  test('suspect Tier B at 3km narrowly beats clean Tier C at 4km (7.8 vs 8.0)', () => {
    const b = stationAtKm(3, { uid: 1, name: 'B-3km-suspect', tier: TIERS.B, suspect: true })
    const c = stationAtKm(4, { uid: 2, name: 'C-4km-clean', tier: TIERS.C, suspect: false })
    const { chosen } = selectStation(LOCATION, [b, c], NOW)
    assert.equal(chosen.uid, 1)
  })

  test('two equal-distance Tier B stations tie-break to the fresher reading', () => {
    const stale = stationAtKm(5, {
      uid: 1,
      name: 'B-older',
      lastSeen: new Date(NOW.getTime() - 90 * 60 * 1000).toISOString(),
    })
    const fresh = stationAtKm(5, {
      uid: 2,
      name: 'B-fresher',
      lastSeen: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
    })
    const { chosen } = selectStation(LOCATION, [stale, fresh], NOW)
    assert.equal(chosen.uid, 2)
  })

  test('nearest station at 16km yields no AQI and a no-coverage record', () => {
    const far = stationAtKm(16, { uid: 1, name: 'too-far', tier: TIERS.A })
    const { chosen, selection } = selectStation(LOCATION, [far], NOW)
    assert.equal(chosen, null)
    assert.equal(selection.chosenUid, null)
    assert.equal(selection.confidenceBand, null)
    assert.equal(selection.rejected[0].reason, REJECTION_REASONS.OUT_OF_RADIUS)
  })

  test('a 2km station with a 5-hour-old reading is skipped for the next passing candidate', () => {
    const stale = stationAtKm(2, {
      uid: 1,
      name: 'near-but-stale',
      tier: TIERS.A,
      lastSeen: new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    })
    const fresh = stationAtKm(6, { uid: 2, name: 'further-but-fresh', tier: TIERS.B })
    const { chosen, selection } = selectStation(LOCATION, [stale, fresh], NOW)
    assert.equal(chosen.uid, 2)
    assert.equal(selection.rejected.find((r) => r.uid === 1).reason, REJECTION_REASONS.STALE)
  })

  test('all candidates stale yields no AQI', () => {
    const old = (uid, km) =>
      stationAtKm(km, {
        uid,
        name: `stale-${uid}`,
        lastSeen: new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString(),
      })
    const { chosen, selection } = selectStation(LOCATION, [old(1, 2), old(2, 5)], NOW)
    assert.equal(chosen, null)
    assert.ok(selection.rejected.every((r) => r.reason === REJECTION_REASONS.STALE))
  })

  test('a station with no timestamp is treated as stale, never as fresh', () => {
    const undated = stationAtKm(1, { uid: 1, name: 'no-timestamp', lastSeen: null })
    const { chosen } = selectStation(LOCATION, [undated], NOW)
    assert.equal(chosen, null)
  })
})

describe('confidence bands', () => {
  const cases = [
    [1, 'high'],
    [4.9, 'high'],
    [5.1, 'moderate'],
    [9.9, 'moderate'],
    [10.1, 'low'],
    [14.9, 'low'],
  ]
  for (const [km, expected] of cases) {
    test(`${km}km → ${expected}`, () => {
      const s = stationAtKm(km, { uid: 1, tier: TIERS.A })
      const { selection } = selectStation(LOCATION, [s], NOW)
      assert.equal(selection.confidenceBand, expected)
    })
  }

  test('band is independent of tier — a Tier A station at 12km is still low confidence', () => {
    const s = stationAtKm(12, { uid: 1, tier: TIERS.A })
    const { selection } = selectStation(LOCATION, [s], NOW)
    assert.equal(selection.tier, TIERS.A)
    assert.equal(selection.confidenceBand, 'low')
  })
})

describe('neighbour-median deviation', () => {
  test('fewer than 3 neighbours within 10km → deviation null, never flagged', () => {
    // Target plus exactly two neighbours inside 10km.
    const stations = [
      { uid: 1, name: 'target', lat: -6.3, lng: 106.8, pm25: 200 },
      { uid: 2, name: 'n1', lat: -6.31, lng: 106.8, pm25: 20 },
      { uid: 3, name: 'n2', lat: -6.32, lng: 106.8, pm25: 20 },
    ]
    const [target] = computeNeighbourDeviations(stations)
    assert.equal(target.neighbourDeviation, null)
    assert.equal(target.suspect, false)
  })

  // Deviation is measured in raw PM2.5 (µg/m³), not AQI — see
  // SUSPECT_DEVIATION_THRESHOLD_PM25 for why comparing in AQI space produces
  // false positives on this network.
  test('3+ neighbours and a gap over 30 µg/m³ → flagged suspect', () => {
    const stations = [
      { uid: 1, name: 'target', lat: -6.3, lng: 106.8, pm25: 200 },
      { uid: 2, name: 'n1', lat: -6.31, lng: 106.8, pm25: 20 },
      { uid: 3, name: 'n2', lat: -6.32, lng: 106.8, pm25: 25 },
      { uid: 4, name: 'n3', lat: -6.33, lng: 106.8, pm25: 15 },
    ]
    const [target] = computeNeighbourDeviations(stations)
    assert.equal(target.neighbourDeviation, 180) // |200 - median(20,25,15)=20|
    assert.equal(target.suspect, true)
  })

  test('a gap that is large in AQI space but small in PM2.5 space is NOT flagged', () => {
    // This is the real-data case: LCS-06 Taman Telur deviated 41.5 in AQI space
    // (over the old threshold) but only 17.1 µg/m³ physically. Flagging it
    // changed which station Kemang resolved to.
    const stations = [
      { uid: 1, name: 'target', lat: -6.3, lng: 106.8, pm25: 49.5 },
      { uid: 2, name: 'n1', lat: -6.31, lng: 106.8, pm25: 32.4 },
      { uid: 3, name: 'n2', lat: -6.32, lng: 106.8, pm25: 31.0 },
      { uid: 4, name: 'n3', lat: -6.33, lng: 106.8, pm25: 33.5 },
    ]
    const [target] = computeNeighbourDeviations(stations)
    assert.ok(target.neighbourDeviation < 30)
    assert.equal(target.suspect, false)
  })

  test('3+ neighbours in close agreement → not flagged', () => {
    const stations = [
      { uid: 1, name: 'target', lat: -6.3, lng: 106.8, pm25: 32 },
      { uid: 2, name: 'n1', lat: -6.31, lng: 106.8, pm25: 30 },
      { uid: 3, name: 'n2', lat: -6.32, lng: 106.8, pm25: 28 },
      { uid: 4, name: 'n3', lat: -6.33, lng: 106.8, pm25: 35 },
    ]
    const [target] = computeNeighbourDeviations(stations)
    assert.equal(target.suspect, false)
    assert.equal(target.neighbourDeviation, 2)
  })

  test('neighbours beyond 10km do not count toward the minimum', () => {
    const far = 12 / KM_PER_DEG_LAT
    const stations = [
      { uid: 1, name: 'target', lat: -6.3, lng: 106.8, pm25: 200 },
      { uid: 2, name: 'far1', lat: -6.3 + far, lng: 106.8, pm25: 20 },
      { uid: 3, name: 'far2', lat: -6.3 + far * 1.1, lng: 106.8, pm25: 20 },
      { uid: 4, name: 'far3', lat: -6.3 + far * 1.2, lng: 106.8, pm25: 20 },
    ]
    const [target] = computeNeighbourDeviations(stations)
    assert.equal(target.neighbourDeviation, null)
    assert.equal(target.suspect, false)
  })

  test('suspect stations are penalised but never removed from candidacy', () => {
    // Only one station available, and it is suspect — it must still be chosen
    // rather than silently discarded, or a real local spike would be hidden.
    const only = stationAtKm(1, { uid: 1, tier: TIERS.B, suspect: true })
    const { chosen, selection } = selectStation(LOCATION, [only], NOW)
    assert.equal(chosen.uid, 1)
    assert.equal(selection.suspect, true)
  })
})

describe('provenance constant', () => {
  test('no-coverage provenance value exists for the gated path', () => {
    assert.equal(PROVENANCE.NO_COVERAGE, 'no-coverage')
  })
})
