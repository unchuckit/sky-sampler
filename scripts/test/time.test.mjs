import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { toJakartaIso, parseJakartaTimestamp, JAKARTA_UTC_OFFSET } from '../../src/time.js'
import { readingAgeHours } from '../../src/stationSelection.js'

describe('Jakarta timestamp handling', () => {
  test('a bare date-time is pinned to +07:00', () => {
    assert.equal(toJakartaIso('2026-08-20T00:30:00'), '2026-08-20T00:30:00+07:00')
  })

  test('a space-separated date-time is normalised too', () => {
    assert.equal(toJakartaIso('2026-08-20 11:00:00'), '2026-08-20T11:00:00+07:00')
  })

  test('a timestamp that already carries an offset is left alone', () => {
    for (const already of ['2026-08-20T00:30:00+07:00', '2026-08-19T17:30:00Z']) {
      assert.equal(toJakartaIso(already), already)
    }
  })

  test('parsing resolves to the correct absolute instant', () => {
    // 00:30 Jakarta is 17:30 UTC the previous day.
    assert.equal(parseJakartaTimestamp('2026-08-20T00:30:00').toISOString(), '2026-08-19T17:30:00.000Z')
  })

  test('rubbish input yields null rather than an Invalid Date', () => {
    assert.equal(parseJakartaTimestamp(null), null)
    assert.equal(parseJakartaTimestamp(''), null)
    assert.equal(parseJakartaTimestamp('not a date'), null)
  })

  test('offset constant is Jakarta, not the machine running the test', () => {
    assert.equal(JAKARTA_UTC_OFFSET, '+07:00')
  })
})

describe('freshness gate is independent of the reader timezone', () => {
  // The bug this guards: source timestamps carry no offset, so parsing them as
  // the reader's local time skews every age by the reader's UTC offset. In CI
  // (UTC) that skew is 7 hours, which is more than the entire 3-hour gate.
  const stamp = '2026-08-20T10:30:00' // Jakarta local
  const nowUtc = new Date('2026-08-20T04:00:00Z') // == 11:00 Jakarta, so 30 min later

  test('a 30-minute-old reading reads as 30 minutes old', () => {
    const age = readingAgeHours({ lastSeen: stamp }, nowUtc)
    assert.ok(Math.abs(age - 0.5) < 1e-9, `expected 0.5h, got ${age}`)
  })

  test('the naive interpretation would have been off by the Jakarta offset', () => {
    const naiveAge = (nowUtc.getTime() - new Date(stamp + 'Z').getTime()) / 3600000
    assert.ok(Math.abs(naiveAge - 0.5) > 6, 'expected the naive reading to be badly skewed')
  })

  test('an already-offset timestamp gives the same answer', () => {
    const a = readingAgeHours({ lastSeen: stamp }, nowUtc)
    const b = readingAgeHours({ lastSeen: stamp + '+07:00' }, nowUtc)
    assert.equal(a, b)
  })

  test('a missing timestamp is still treated as infinitely stale', () => {
    assert.equal(readingAgeHours({ lastSeen: null }, nowUtc), Infinity)
  })
})
