import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { DEMO_STATION_ROWS } from '../../src/demoStations.js'
import { DEMO_LOCATIONS, DEMO_SAMPLES } from '../../src/demoData.js'
import { buildDemoStationSet } from '../../src/demoStationSet.js'
import { selectStation, haversineKm } from '../../src/stationSelection.js'
import { buildDistricts, tierForStationName } from '../../src/stations.js'
import { pm25ToAqi } from '../../src/aqi.js'
import { sampleFlags, areaNotes, recencyNote } from '../../src/sampleFlags.js'
import { isGeometryCompliant, geometryWarnings } from '../../src/sunGeometry.js'
import {
  DEMO_ZONES,
  DEMO_ZONE_ORDER,
  DEMO_ZONE_TIMES,
  demoClockFor,
  demoGeometryFor,
  getSampleZone,
  isIdealWindow,
  MAX_READING_AGE_HOURS,
  MAX_STATION_RADIUS_KM,
  RECENCY_PENALTY_AFTER_HOURS,
  SAMPLE_GOAL,
  TIERS,
} from '../../src/constants.js'

// A fixed "today" so the suite does not depend on the day it runs on.
//
// Built from LOCAL components on purpose. demoClockFor sets hours via
// setHours, which is local, so a base pinned to an explicit offset — say
// '2026-08-20T00:00:00+07:00' — is the previous day's evening anywhere west of
// Jakarta, and setHours then lands the clock on the wrong date entirely. That
// is the same timezone ambiguity src/time.js exists to stop, and it passes in
// Jakarta while failing in UTC, which is what CI runs.
const TODAY = new Date(2026, 7, 20)
const clockFor = (zoneKey) => demoClockFor(zoneKey, TODAY)

function setFor(zoneKey) {
  return buildDemoStationSet(zoneKey, DEMO_ZONES[zoneKey].aqi, clockFor(zoneKey))
}

describe('demo clock', () => {
  test('every zone has a time and every time is inside the sampling window', () => {
    for (const zoneKey of DEMO_ZONE_ORDER) {
      const clock = clockFor(zoneKey)
      assert.ok(clock, `${zoneKey} has no clock`)
      assert.equal(
        isIdealWindow(clock),
        true,
        `${zoneKey} at ${clock.getHours()}:${clock.getMinutes()} falls outside 10:00-14:00`,
      )
    }
  })

  // The point of the corrected times: the in-window state now falls out of the
  // normal calculation, so demo mode asserts nothing of its own.
  test('no zone sits on the 14:00 boundary, where the window turns exclusive', () => {
    for (const zoneKey of DEMO_ZONE_ORDER) {
      const { hour, minute } = DEMO_ZONE_TIMES[zoneKey]
      assert.ok(hour < 14, `${zoneKey} is at or past 14:00`)
      assert.ok(hour > 10 || minute > 0, `${zoneKey} is at or before 10:00`)
    }
  })

  test('advancing zones advances the clock, so the four read as one day', () => {
    const times = DEMO_ZONE_ORDER.map((k) => clockFor(k).getTime())
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] > times[i - 1], `${DEMO_ZONE_ORDER[i]} does not follow its predecessor`)
    }
  })

  test('the date is always the day it is run, never hardcoded', () => {
    const clock = demoClockFor('aspirational')
    const now = new Date()
    assert.equal(clock.getFullYear(), now.getFullYear())
    assert.equal(clock.getMonth(), now.getMonth())
    assert.equal(clock.getDate(), now.getDate())
  })
})

describe('frozen demo station set', () => {
  test('carries a realistic number of real stations', () => {
    assert.ok(DEMO_STATION_ROWS.length >= 90, `only ${DEMO_STATION_ROWS.length} stations`)
  })

  test('every row has a real name, id and Jakarta-area coordinates', () => {
    for (const row of DEMO_STATION_ROWS) {
      assert.match(row.id, /^[0-9a-f-]{36}$/, `${row.name} has a fabricated-looking id`)
      assert.ok(row.name.length > 3)
      assert.ok(row.lat > -7 && row.lat < -5.5, `${row.name} lat out of range`)
      assert.ok(row.lng > 106 && row.lng < 107.5, `${row.name} lng out of range`)
      assert.ok(row.lagMinutes >= 0)
    }
  })

  test('both tiers are represented, derived from the real name prefixes', () => {
    const tiers = DEMO_STATION_ROWS.map((r) => tierForStationName(r.name))
    assert.ok(tiers.includes(TIERS.A), 'no Tier A station')
    assert.ok(tiers.includes(TIERS.B), 'no Tier B station')
  })

  // The real reporting pattern is what makes the recency term meaningful.
  // A demo that flattened it would never exercise the penalty.
  test('LCS units keep their real lag behind the DKI units', () => {
    const lcs = DEMO_STATION_ROWS.filter((r) => r.name.startsWith('LCS-'))
    const other = DEMO_STATION_ROWS.filter((r) => !r.name.startsWith('LCS-'))
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    assert.ok(
      mean(lcs.map((r) => r.lagMinutes)) > mean(other.map((r) => r.lagMinutes)) + 30,
      'LCS lag is not meaningfully behind the rest — the pattern was flattened',
    )
  })
})

describe('demo readings are synthesized honestly', () => {
  for (const zoneKey of DEMO_ZONE_ORDER) {
    test(`${zoneKey}: every station lands in that zone's own bucket`, () => {
      const stations = setFor(zoneKey)
      const expected = getSampleZone(DEMO_ZONES[zoneKey].aqi).key
      for (const s of stations) {
        assert.equal(
          getSampleZone(s.aqi)?.key,
          expected,
          `${s.name} at AQI ${s.aqi} escaped the ${zoneKey} bucket`,
        )
      }
    })

    test(`${zoneKey}: the displayed AQI is derived from the µg/m³, not assigned`, () => {
      for (const s of setFor(zoneKey)) {
        assert.equal(s.aqi, pm25ToAqi(s.pm25), `${s.name} AQI and PM2.5 disagree`)
      }
    })
  }

  test('readings are deterministic — rebuilding gives identical values', () => {
    const a = setFor('typical-jakarta')
    const b = setFor('typical-jakarta')
    assert.deepEqual(
      a.map((s) => [s.uid, s.pm25]),
      b.map((s) => [s.uid, s.pm25]),
    )
  })

  test('readings actually vary between stations rather than repeating one number', () => {
    const distinct = new Set(setFor('good-day').map((s) => s.aqi))
    assert.ok(distinct.size > 3, `only ${distinct.size} distinct AQI values across the network`)
  })

  test('the same station reads differently in different zones', () => {
    const one = setFor('aspirational')[0]
    const two = setFor('heavy-haze').find((s) => s.uid === one.uid)
    assert.notEqual(one.aqi, two.aqi)
  })

  // No real station reports late enough to land in the penalised band, so one
  // is aged deliberately — otherwise the recency line could never be shown on
  // stage. See DEMO_LAG_OVERRIDE_MINUTES.
  test('exactly one area is stale enough to render the recency note', () => {
    const stations = setFor('typical-jakarta')
    const clock = clockFor('typical-jakarta')
    const ageOf = (s) => (clock.getTime() - new Date(s.lastSeen).getTime()) / 3_600_000

    const penalised = stations.filter(
      (s) => ageOf(s) >= RECENCY_PENALTY_AFTER_HOURS && ageOf(s) <= MAX_READING_AGE_HOURS,
    )
    assert.equal(penalised.length, 1, `expected one penalised station, got ${penalised.length}`)
    assert.match(penalised[0].name, /Jagakarsa/)
    assert.equal(recencyNote(Math.round(ageOf(penalised[0]) * 10) / 10), 'Updated 4 hours ago')
  })

  // Mirrors the area-card path exactly: an area holds a resolved station uid and
  // re-runs the gates against that station alone (it carries no coordinates to
  // re-search from). Under the old hard gate a 4h reading vanished here and the
  // card went blank; now it is kept and annotated.
  test('the aged area still resolves, and renders the recency note', () => {
    const stations = setFor('typical-jakarta')
    const area = DEMO_LOCATIONS.find((a) => a.label === 'Jagakarsa')
    const station = stations.find((s) => s.uid === area.stationUid)

    const { chosen, selection } = selectStation(
      { lat: station.lat, lng: station.lng },
      [station],
      clockFor('typical-jakarta'),
    )
    assert.ok(chosen, 'the aged station was excluded — the hard gate is back')
    assert.equal(chosen.uid, area.stationUid)
    assert.equal(selection.readingAgeHours, 4)
    assert.deepEqual(areaNotes({ ...selection, confidenceBand: area.confidenceBand }), [
      'Updated 4 hours ago',
    ])
  })

  // The flip side, and the reason the penalty is worth having: staleness costs
  // enough that a modestly-further fresh station wins outright.
  test('the penalty is heavy enough to lose to a fresher neighbour nearby', () => {
    const stations = setFor('typical-jakarta')
    const aged = stations.find((s) => s.name === 'DKI3 Jagakarsa')
    // A point 0.89km from the aged station and 1.36km from a fresh one:
    // 0.89 x 2.0 = 1.78 against 1.36 x 1.0 = 1.36.
    const { chosen } = selectStation(
      { lat: aged.lat + 0.008, lng: aged.lng },
      stations,
      clockFor('typical-jakarta'),
    )
    assert.equal(chosen.name, 'DKI_PM25_32 Waduk Jagakarsa')
  })

  test('every station passes the freshness gate against its own zone clock', () => {
    for (const zoneKey of DEMO_ZONE_ORDER) {
      const clock = clockFor(zoneKey)
      for (const s of setFor(zoneKey)) {
        const ageHours = (clock.getTime() - new Date(s.lastSeen).getTime()) / 3_600_000
        assert.ok(
          ageHours <= MAX_READING_AGE_HOURS,
          `${s.name} is ${ageHours.toFixed(1)}h stale in ${zoneKey}`,
        )
      }
    }
  })
})

// On stage the phone points at a projector, never at the sky, so a capture
// reading real sensors would come out non-compliant for reasons unrelated to
// the talk. The geometry is fixed per zone instead — the third and last thing
// demo mode fabricates, after the readings and the clock.
describe('demo capture geometry', () => {
  test('every zone has geometry, and all four are in the comparable band', () => {
    for (const zoneKey of DEMO_ZONE_ORDER) {
      const geometry = demoGeometryFor(zoneKey)
      assert.ok(geometry, `${zoneKey} has no geometry`)
      assert.equal(geometry.sensorAvailable, true)
      assert.equal(
        isGeometryCompliant(geometry),
        true,
        `${zoneKey} at ${geometry.scatteringAngle}° / ${geometry.cameraElevation}° is out of band`,
      )
      assert.deepEqual(geometryWarnings(geometry), [], `${zoneKey} fires a capture warning`)
    }
  })

  test('the four zones differ, so four captures in a row do not look copy-pasted', () => {
    const seen = DEMO_ZONE_ORDER.map((z) => {
      const g = demoGeometryFor(z)
      return `${g.scatteringAngle}/${g.cameraElevation}`
    })
    assert.equal(new Set(seen).size, DEMO_ZONE_ORDER.length, `duplicates in ${seen.join(', ')}`)
  })

  test('an unknown zone yields null rather than a fabricated default', () => {
    assert.equal(demoGeometryFor('not-a-zone'), null)
    assert.equal(demoGeometryFor(undefined), null)
  })

  // Fabricating compliant geometry must not remove the off-angle case from the
  // demo entirely — it just stops a live capture stumbling into it by accident.
  test('the seeded log still carries a non-compliant sample to show', () => {
    assert.ok(
      DEMO_SAMPLES.some((s) => s.geometryCompliant === false),
      'no off-angle sample left to demonstrate',
    )
  })
})

describe('demo areas resolve through the real selection path', () => {
  test('every demo area points at a station that actually exists', () => {
    const byId = new Map(DEMO_STATION_ROWS.map((r) => [r.id, r]))
    for (const area of DEMO_LOCATIONS) {
      const row = byId.get(area.stationUid)
      assert.ok(row, `${area.label} points at unknown station ${area.stationUid}`)
      assert.equal(row.name, area.stationName, `${area.label} has a stale station name`)
    }
  })

  test('each area is reachable: a real point exists that resolves to exactly it', () => {
    const stations = setFor('typical-jakarta')
    const clock = clockFor('typical-jakarta')
    const R = 6371

    for (const area of DEMO_LOCATIONS) {
      const target = stations.find((s) => s.uid === area.stationUid)
      // Sweep bearings at the area's recorded distance. If any real point at
      // that radius resolves to this station, the fixture is one the live app
      // could genuinely produce rather than a number typed into a file.
      let found = null
      for (let brg = 0; brg < 360 && !found; brg += 5) {
        const dLat = ((area.distanceKm / R) * 180) / Math.PI * Math.cos((brg * Math.PI) / 180)
        const dLng =
          (((area.distanceKm / R) * 180) / Math.PI * Math.sin((brg * Math.PI) / 180)) /
          Math.cos((target.lat * Math.PI) / 180)
        const point = { lat: target.lat + dLat, lng: target.lng + dLng }
        const { chosen, selection } = selectStation(point, stations, clock)
        if (chosen?.uid === target.uid) found = selection
      }

      assert.ok(found, `${area.label}: no real point at ${area.distanceKm}km resolves to ${area.stationName}`)
      assert.equal(found.distanceKm, area.distanceKm, `${area.label} distance is not reproducible`)
      assert.equal(found.tier, area.tier, `${area.label} tier disagrees with the real station`)
      assert.equal(found.confidenceBand, area.confidenceBand, `${area.label} band disagrees`)
    }
  })

  test('the recorded tier matches what the real station name implies', () => {
    const byId = new Map(DEMO_STATION_ROWS.map((r) => [r.id, r]))
    for (const area of DEMO_LOCATIONS) {
      assert.equal(area.tier, tierForStationName(byId.get(area.stationUid).name), area.label)
    }
  })

  test('the curated set keeps a Tier A/B contrast to demonstrate', () => {
    const tiers = new Set(DEMO_LOCATIONS.map((a) => a.tier))
    assert.ok(tiers.has(TIERS.A) && tiers.has(TIERS.B), 'demo areas no longer show both tiers')
  })
})

describe('adding an area during a demo', () => {
  test('every district on offer resolves to a station', () => {
    const stations = setFor('good-day')
    const clock = clockFor('good-day')
    const districts = buildDistricts(DEMO_STATION_ROWS)
    assert.ok(districts.length > 20, `only ${districts.length} districts on offer`)

    for (const d of districts) {
      const { chosen } = selectStation({ lat: d.lat, lng: d.lng }, stations, clock)
      assert.ok(chosen, `${d.kota} / ${d.kecamatan} resolves to no station`)
    }
  })

  test('a GPS point far outside the network honestly returns no coverage', () => {
    const stations = setFor('good-day')
    // Bandung — real place, well beyond the 15km gate from any Jakarta station.
    const { chosen, selection } = selectStation({ lat: -6.9175, lng: 107.6191 }, stations, clockFor('good-day'))
    assert.equal(chosen, null, 'the radius gate was bypassed in demo mode')
    assert.equal(selection.chosenUid, null)
    assert.ok(selection.outOfRadiusCount > 0)
  })

  test('the radius gate is the real one, not a demo-only value', () => {
    const stations = setFor('good-day')
    const target = stations[0]
    const { selection } = selectStation({ lat: target.lat, lng: target.lng }, stations, clockFor('good-day'))
    for (const s of stations) {
      const km = haversineKm(target.lat, target.lng, s.lat, s.lng)
      if (km > MAX_STATION_RADIUS_KM) {
        assert.notEqual(selection.chosenUid, s.uid, 'chose a station beyond the radius gate')
      }
    }
  })
})

describe('demo seeded log', () => {
  test('covers all four zones, one sample each', () => {
    const covered = DEMO_SAMPLES.map((s) => getSampleZone(s.aqi)?.key)
    assert.equal(DEMO_SAMPLES.length, DEMO_ZONE_ORDER.length)
    assert.equal(new Set(covered).size, DEMO_ZONE_ORDER.length, `zones covered: ${covered.join(', ')}`)
  })

  // The presenter captures one sample per zone during the talk. Each needs an
  // obvious empty slot to land in, and the full run should total the goal.
  test('leaves one open slot per zone, reaching the goal after a full run', () => {
    assert.equal(DEMO_SAMPLES.length + DEMO_ZONE_ORDER.length, SAMPLE_GOAL)
  })

  test('no seeded sample is stamped in the future relative to its zone clock', () => {
    for (const sample of DEMO_SAMPLES) {
      const zoneKey = DEMO_ZONE_ORDER.find((k) => getSampleZone(DEMO_ZONES[k].aqi)?.key === getSampleZone(sample.aqi)?.key)
      // Against the real current day, because that is the base demoData itself
      // stamps with. Comparing to the suite's fixed TODAY would drift out of
      // step the moment the date rolls over.
      assert.ok(
        new Date(sample.createdAt).getTime() <= demoClockFor(zoneKey).getTime(),
        `${sample.id} is stamped after its zone's clock`,
      )
    }
  })

  // The exception treatment has to be visible on stage, not theoretical.
  test('at least one seeded sample carries a flag, and at least one carries none', () => {
    const flagged = DEMO_SAMPLES.filter((s) => sampleFlags(s).length > 0)
    const clean = DEMO_SAMPLES.filter((s) => sampleFlags(s).length === 0)
    assert.ok(flagged.length > 0, 'no seeded sample shows the exception treatment')
    assert.ok(clean.length > 0, 'every seeded sample is flagged — the contrast is lost')
  })

  test('the flagged sample shows both a low-cost sensor and an off-angle capture', () => {
    const labels = new Set(DEMO_SAMPLES.flatMap((s) => sampleFlags(s).map((f) => f.label)))
    assert.ok(labels.has('Low-cost sensor'), 'no Tier B sample to demonstrate')
    assert.ok(labels.has('Off-angle'), 'no off-angle sample to demonstrate')
  })

  test('every seeded sample attaches to a real station in the frozen set', () => {
    const ids = new Set(DEMO_STATION_ROWS.map((r) => r.id))
    for (const s of DEMO_SAMPLES) {
      assert.ok(ids.has(s.stationUid), `${s.id} references unknown station ${s.stationUid}`)
    }
  })
})
