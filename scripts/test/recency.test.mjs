import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { selectStation, scoreFor, recencyMultiplierFor } from '../../src/stationSelection.js'
import {
  TIERS,
  REJECTION_REASONS,
  MAX_READING_AGE_HOURS,
  RECENCY_PENALTY_AFTER_HOURS,
  SNAPSHOT_UNUSABLE_HOURS,
} from '../../src/constants.js'

const LOCATION = { lat: -6.3, lng: 106.8 }
const NOW = new Date('2026-08-21T12:00:00Z')
const KM_PER_DEG_LAT = 111.19492664455873

function stationAt(km, ageHours, props = {}) {
  return {
    uid: props.uid ?? `${km}km-${ageHours}h`,
    name: props.name ?? `${km}km @ ${ageHours}h`,
    lat: LOCATION.lat + km / KM_PER_DEG_LAT,
    lng: LOCATION.lng,
    aqi: 80,
    pm25: 25,
    tier: props.tier ?? TIERS.A,
    suspect: props.suspect ?? false,
    neighbourDeviation: null,
    lastSeen: new Date(NOW.getTime() - ageHours * 3_600_000).toISOString(),
    ...props,
  }
}

const pick = (stations) => selectStation(LOCATION, stations, NOW)

describe('the shared age threshold', () => {
  test('one constant backs both the reading gate and the snapshot gate', () => {
    assert.equal(SNAPSHOT_UNUSABLE_HOURS, MAX_READING_AGE_HOURS)
    assert.equal(MAX_READING_AGE_HOURS, 6)
  })

  test('the penalty threshold sits inside the wall, not on it', () => {
    assert.ok(RECENCY_PENALTY_AFTER_HOURS < MAX_READING_AGE_HOURS)
    assert.equal(RECENCY_PENALTY_AFTER_HOURS, 3)
  })
})

describe('recency multiplier', () => {
  test('is 1.0 under the penalty threshold and 2.0 above it', () => {
    assert.equal(recencyMultiplierFor(0), 1.0)
    assert.equal(recencyMultiplierFor(2.9), 1.0)
    assert.equal(recencyMultiplierFor(3), 2.0)
    assert.equal(recencyMultiplierFor(5.9), 2.0)
  })

  // The whole point of the design. A 0 would make the stalest station score
  // lowest, and lower score wins.
  test('never returns 0, at any age, however old', () => {
    for (const h of [0, 3, 6, 9, 24, 1000, Infinity]) {
      assert.notEqual(recencyMultiplierFor(h), 0, `age ${h}h produced a zero multiplier`)
      assert.ok(recencyMultiplierFor(h) >= 1, `age ${h}h produced a below-1 multiplier`)
    }
  })

  test('folds into the score as a fourth multiplicative term', () => {
    assert.equal(scoreFor(2, TIERS.A, false, 1), 2) // 2 × 1.0 × 1.0 × 1.0
    assert.equal(scoreFor(2, TIERS.A, false, 4), 4) // 2 × 1.0 × 1.0 × 2.0
    assert.equal(scoreFor(2, TIERS.B, false, 4), 5.2) // 2 × 1.3 × 1.0 × 2.0
    assert.equal(scoreFor(2, TIERS.A, true, 4), 8) // 2 × 1.0 × 2.0 × 2.0
  })

  test('omitting the age keeps the pre-recency behaviour', () => {
    assert.equal(scoreFor(8, TIERS.A, false), 8)
    assert.equal(scoreFor(3, TIERS.B, true), scoreFor(3, TIERS.B, true, 0))
  })
})

describe('exclusion is a filter, never a multiplier of zero', () => {
  // The regression test the spec asked for by name. A × 0 implementation makes
  // this station score 0 — the lowest possible — and win outright.
  test('a 9h-old station 0.5km away, Tier A, is never selected', () => {
    const stale = stationAt(0.5, 9, { uid: 'stale-and-near' })
    const fresh = stationAt(12, 0.5, { uid: 'fresh-and-far' })

    const both = pick([stale, fresh])
    assert.equal(both.chosen.uid, 'fresh-and-far', 'the stale station won on a low score')

    // And with nothing else in range at all, it must still not be chosen.
    const alone = pick([stale])
    assert.equal(alone.chosen, null)
    assert.equal(alone.selection.chosenUid, null)
    assert.equal(
      alone.selection.rejected.find((r) => r.uid === 'stale-and-near')?.reason,
      REJECTION_REASONS.STALE,
    )
  })

  test('exactly on the wall is kept, past it is dropped', () => {
    assert.ok(pick([stationAt(1, MAX_READING_AGE_HOURS - 0.01)]).chosen)
    assert.equal(pick([stationAt(1, MAX_READING_AGE_HOURS + 0.01)]).chosen, null)
  })

  test('a station with no timestamp is infinitely stale, not infinitely good', () => {
    assert.equal(pick([stationAt(0.5, 0, { lastSeen: null })]).chosen, null)
  })
})

describe('stress tests — recency against distance', () => {
  test('close-but-stale beats far-but-fresh (4.0 vs 14.0)', () => {
    const a = stationAt(2, 4, { uid: 'A' }) // 2 × 1 × 1 × 2 = 4.0
    const b = stationAt(14, 1, { uid: 'B' }) // 14 × 1 × 1 × 1 = 14.0
    assert.equal(pick([a, b]).chosen.uid, 'A')
  })

  test('at similar distance, freshness decides (20.0 vs 10.5)', () => {
    const a = stationAt(10, 4, { uid: 'A' }) // 10 × 2 = 20.0
    const b = stationAt(10.5, 1, { uid: 'B' }) // 10.5 × 1 = 10.5
    assert.equal(pick([a, b]).chosen.uid, 'B')
  })

  test('identical distance and tier — the fresher one wins on recency alone', () => {
    const a = stationAt(3, 2, { uid: 'fresh' })
    const b = stationAt(3, 5, { uid: 'stale' })
    assert.equal(pick([a, b]).chosen.uid, 'fresh')
  })

  test('nearest is 9h old and nothing fresher is in range — no AQI, the floor holds', () => {
    const result = pick([stationAt(1, 9), stationAt(20, 0.5)])
    assert.equal(result.chosen, null)
    assert.equal(result.selection.chosenUid, null)
  })

  // The failure this change exists to remove.
  test("Kemang's LCS-06 stays selected either side of the old 3h cliff", () => {
    const chosenAt = (ageHours) => {
      const lcs = stationAt(1.2, ageHours, { uid: 'LCS-06', tier: TIERS.B })
      // The station it used to silently fall back to when it dropped out.
      const fallback = stationAt(6.8, 0.5, { uid: 'fallback', tier: TIERS.A })
      return pick([lcs, fallback]).chosen?.uid
    }

    // Across the whole drift range that used to flip it in and out.
    for (const age of [2.0, 2.5, 2.9, 3.0, 3.1, 3.5, 4.0]) {
      assert.equal(chosenAt(age), 'LCS-06', `LCS-06 was dropped at ${age}h`)
    }
  })

  test('the selection record carries the chosen reading’s age', () => {
    const { selection } = pick([stationAt(2, 4.25)])
    assert.equal(selection.readingAgeHours, 4.3)
  })
})
