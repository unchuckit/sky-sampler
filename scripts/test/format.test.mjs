import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { formatDate, formatTime, formatDateTime } from '../../src/time.js'
import { aqiToPm25, pm25ToAqi } from '../../src/aqi.js'
import { stationDisplayName } from '../../src/stations.js'

// Dates render in the reader's own timezone by design, so these build local
// Date objects rather than parsing an offset string.
const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm)

describe('date display', () => {
  // The whole reason this format exists: toLocaleDateString() renders this
  // date as "8/12/2026" under en-US, which reads as 8 December to an
  // Indonesian audience. A month in letters cannot be misread.
  test('12 August is unambiguous, not 8/12', () => {
    assert.equal(formatDate(local(2026, 8, 12)), '12 Aug 2026')
  })

  test('the day is not zero-padded, the time is', () => {
    assert.equal(formatDate(local(2026, 1, 5)), '5 Jan 2026')
    assert.equal(formatTime(local(2026, 1, 5, 9, 7)), '09:07')
  })

  test('time is 24-hour, matching WIB convention', () => {
    assert.equal(formatTime(local(2026, 8, 12, 15, 20)), '15:20')
    assert.equal(formatTime(local(2026, 8, 12, 0, 0)), '00:00')
    assert.equal(formatTime(local(2026, 8, 12, 23, 59)), '23:59')
  })

  test('combined form matches the specified shape', () => {
    assert.equal(formatDateTime(local(2026, 8, 12, 15, 20)), '12 Aug 2026, 15:20')
  })

  test('accepts an ISO string as well as a Date', () => {
    const iso = local(2026, 8, 12, 15, 20).toISOString()
    assert.equal(formatDateTime(iso), '12 Aug 2026, 15:20')
  })

  test('every month renders as three letters', () => {
    const months = Array.from({ length: 12 }, (_, i) => formatDate(local(2026, i + 1, 1)).split(' ')[1])
    assert.deepEqual(months, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
  })

  // A missing timestamp must not render as "Invalid Date" or "NaN" on a card.
  test('unusable input renders as an em dash, never as Invalid Date', () => {
    for (const bad of [null, undefined, '', 'not a date', new Date('nonsense')]) {
      assert.equal(formatDate(bad), '—')
      assert.equal(formatTime(bad), '—')
      assert.equal(formatDateTime(bad), '—')
    }
  })
})

describe('AQI ↔ PM2.5 inversion', () => {
  test('round-trips exactly across the whole practical range', () => {
    for (let aqi = 0; aqi <= 300; aqi++) {
      assert.equal(pm25ToAqi(aqiToPm25(aqi)), aqi, `AQI ${aqi} did not round-trip`)
    }
  })

  test('breakpoint anchors invert to the table values', () => {
    assert.equal(aqiToPm25(50), 12.0)
    assert.equal(aqiToPm25(51), 12.1)
    assert.equal(aqiToPm25(100), 35.4)
    assert.equal(aqiToPm25(150), 55.4)
  })

  test('rejects nonsense rather than extrapolating', () => {
    assert.equal(aqiToPm25(-1), null)
    assert.equal(aqiToPm25(501), null)
    assert.equal(aqiToPm25(NaN), null)
    assert.equal(aqiToPm25('90'), null)
  })
})

describe('station display names', () => {
  test('the machine identifier is split off the human name', () => {
    assert.equal(stationDisplayName('DKI_PM25_38 Taman Ismail Marzuki'), 'Taman Ismail Marzuki')
    assert.equal(stationDisplayName('DKI3 Jagakarsa'), 'Jagakarsa')
    assert.equal(stationDisplayName('LCS-06 Taman Telur'), 'Taman Telur')
    assert.equal(stationDisplayName('DKJ35 Rusunawa Pesakih'), 'Rusunawa Pesakih')
    assert.equal(stationDisplayName('BAM02 Kelapa Gading'), 'Kelapa Gading')
    assert.equal(stationDisplayName('pm25_kemayoran Kemayoran'), 'Kemayoran')
  })

  test('an identifier that is itself a place name still splits correctly', () => {
    assert.equal(stationDisplayName('DKI_PENJARINGAN Rusun Penjaringan'), 'Rusun Penjaringan')
  })

  test('the rest of the name is kept whole, brackets and all', () => {
    assert.equal(stationDisplayName('DKI_PM25_64 SMPN 88 Jakarta (ROOFTOP)'), 'SMPN 88 Jakarta (ROOFTOP)')
  })

  // Anchored to the known prefixes on purpose — an unfamiliar format keeps its
  // first word rather than losing it to a guess.
  test('an unrecognised format passes through untouched', () => {
    assert.equal(stationDisplayName('Taman Suropati'), 'Taman Suropati')
    assert.equal(stationDisplayName('Bundaran HI'), 'Bundaran HI')
  })

  test('empty input renders as an em dash', () => {
    assert.equal(stationDisplayName(null), '—')
    assert.equal(stationDisplayName(''), '—')
  })
})
