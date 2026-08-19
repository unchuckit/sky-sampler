import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  angularDistance,
  cameraElevationFromBeta,
  computeSkyGeometry,
  isGeometryCompliant,
  geometryWarnings,
  solarPosition,
} from '../../src/sunGeometry.js'
import { pm25ToAqi } from '../../src/aqi.js'
import { geometryAdjustedHex, GEOMETRY_CORRECTION_MODEL } from '../../src/geometryCorrection.js'
import { isAtInstrumentCeiling, computeNeighbourDeviations } from '../../src/stationSelection.js'

describe('angular distance', () => {
  test('same direction is 0°', () => {
    assert.equal(Math.round(angularDistance(180, 45, 180, 45)), 0)
  })

  test('opposite azimuth at the horizon is 180°', () => {
    assert.equal(Math.round(angularDistance(0, 0, 180, 0)), 180)
  })

  test('90° apart in azimuth at the horizon is 90°', () => {
    assert.equal(Math.round(angularDistance(0, 0, 90, 0)), 90)
  })

  test('zenith to horizon is 90° regardless of azimuth', () => {
    for (const az of [0, 90, 180, 270]) {
      assert.equal(Math.round(angularDistance(0, 90, az, 0)), 90)
    }
  })

  test('is symmetric', () => {
    const a = angularDistance(37, 22, 200, 61)
    const b = angularDistance(200, 61, 37, 22)
    assert.ok(Math.abs(a - b) < 1e-9)
  })

  test('never returns NaN at the antipode (acos clamping)', () => {
    assert.ok(!Number.isNaN(angularDistance(0, 90, 0, -90)))
    assert.equal(Math.round(angularDistance(0, 90, 0, -90)), 180)
  })
})

describe('camera elevation from beta', () => {
  test('flat on its back points at the zenith', () => {
    assert.equal(cameraElevationFromBeta(0), 90)
  })

  test('upright points at the horizon', () => {
    assert.equal(cameraElevationFromBeta(90), 0)
  })

  test('past vertical comes back down, not further up', () => {
    assert.equal(cameraElevationFromBeta(120), -30)
    assert.equal(cameraElevationFromBeta(-120), -30)
  })

  test('sign of beta does not matter', () => {
    assert.equal(cameraElevationFromBeta(45), cameraElevationFromBeta(-45))
  })

  test('non-numeric beta yields null', () => {
    assert.equal(cameraElevationFromBeta(null), null)
    assert.equal(cameraElevationFromBeta(NaN), null)
  })
})

describe('solar position', () => {
  test('sun is high near local noon in Jakarta', () => {
    // Jakarta is UTC+7, so 05:00Z is roughly local noon.
    const sun = solarPosition(new Date('2026-08-19T05:00:00Z'), -6.2, 106.8)
    assert.ok(sun.elevation > 50, `expected a high sun, got ${sun.elevation}`)
  })

  test('sun is below the horizon at local midnight', () => {
    const sun = solarPosition(new Date('2026-08-19T17:00:00Z'), -6.2, 106.8)
    assert.ok(sun.elevation < 0, `expected sun below horizon, got ${sun.elevation}`)
  })

  test('azimuth is reported on the compass convention, 0–360', () => {
    const sun = solarPosition(new Date('2026-08-19T05:00:00Z'), -6.2, 106.8)
    assert.ok(sun.azimuth >= 0 && sun.azimuth < 360)
  })
})

describe('computeSkyGeometry', () => {
  const base = { lat: -6.2, lng: 106.8, date: new Date('2026-08-19T05:00:00Z') }

  test('missing sensors are reported, not guessed', () => {
    const g = computeSkyGeometry({ heading: null, beta: null, ...base })
    assert.equal(g.sensorAvailable, false)
    assert.equal(g.compassHeading, null)
    assert.equal(g.scatteringAngle, null)
  })

  test('all angular values are whole degrees', () => {
    const g = computeSkyGeometry({ heading: 123.456, beta: 12.34, ...base })
    for (const key of ['compassHeading', 'cameraElevation', 'scatteringAngle']) {
      assert.equal(g[key], Math.round(g[key]), `${key} is not a whole degree`)
    }
  })

  test('solar azimuth and elevation are never returned', () => {
    // Retaining these alongside an exact timestamp is what would let a position
    // be back-solved, so they must not appear on the stored object.
    const g = computeSkyGeometry({ heading: 180, beta: 10, ...base })
    assert.equal('solarAzimuth' in g, false)
    assert.equal('solarElevation' in g, false)
    assert.deepEqual(Object.keys(g).sort(), [
      'cameraElevation',
      'compassHeading',
      'scatteringAngle',
      'sensorAvailable',
    ])
  })

  test('heading is normalised into 0–360', () => {
    assert.equal(computeSkyGeometry({ heading: -90, beta: 0, ...base }).compassHeading, 270)
    assert.equal(computeSkyGeometry({ heading: 450, beta: 0, ...base }).compassHeading, 90)
  })

  test('without coordinates, heading and elevation still record but scattering does not', () => {
    const g = computeSkyGeometry({ heading: 180, beta: 20 })
    assert.equal(g.sensorAvailable, true)
    assert.equal(g.compassHeading, 180)
    assert.equal(g.cameraElevation, 70)
    assert.equal(g.scatteringAngle, null)
  })
})

describe('compliance and warnings', () => {
  const g = (scatteringAngle, cameraElevation) => ({
    scatteringAngle,
    cameraElevation,
    compassHeading: 180,
    sensorAvailable: true,
  })

  test('inside the band is compliant', () => {
    assert.equal(isGeometryCompliant(g(90, 80)), true)
    assert.equal(isGeometryCompliant(g(60, 46)), true)
    assert.equal(isGeometryCompliant(g(120, 90)), true)
  })

  test('outside the scattering band is not', () => {
    assert.equal(isGeometryCompliant(g(59, 80)), false)
    assert.equal(isGeometryCompliant(g(121, 80)), false)
  })

  test('too low an elevation is not compliant even at a good sun angle', () => {
    assert.equal(isGeometryCompliant(g(90, 45)), false)
    assert.equal(isGeometryCompliant(g(90, 44)), false)
  })

  test('no sensors is never compliant', () => {
    assert.equal(isGeometryCompliant({ sensorAvailable: false }), false)
    assert.equal(isGeometryCompliant(null), false)
  })

  test('near-sun fires below 40°', () => {
    assert.deepEqual(geometryWarnings(g(39, 80)).map((w) => w.key), ['near-sun'])
    assert.deepEqual(geometryWarnings(g(41, 80)).map((w) => w.key), [])
  })

  test('low-angle fires below 30° elevation', () => {
    assert.deepEqual(geometryWarnings(g(90, 29)).map((w) => w.key), ['low-angle'])
  })

  test('both can fire at once', () => {
    assert.deepEqual(geometryWarnings(g(20, 15)).map((w) => w.key), ['near-sun', 'low-angle'])
  })
})

describe('geometry correction is additive and conservative', () => {
  const compliantGeometry = {
    scatteringAngle: 90,
    cameraElevation: 90,
    compassHeading: 180,
    sensorAvailable: true,
  }

  test('at the reference geometry the colour is unchanged', () => {
    assert.equal(geometryAdjustedHex('#4698cb', compliantGeometry), '#4698cb')
  })

  test('returns null rather than a guess when geometry is missing', () => {
    assert.equal(geometryAdjustedHex('#4698cb', { sensorAvailable: false }), null)
    assert.equal(geometryAdjustedHex('#4698cb', null), null)
    assert.equal(geometryAdjustedHex(null, compliantGeometry), null)
  })

  test('a near-sun sample is corrected toward more saturation, not less', () => {
    const original = '#8fa5bd'
    const corrected = geometryAdjustedHex(original, {
      ...compliantGeometry,
      scatteringAngle: 20,
    })
    assert.notEqual(corrected, original)
    // Removing broadband white light should lower the channel minimum.
    const minOf = (hex) => Math.min(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))
    assert.ok(minOf(corrected) <= minOf(original))
  })

  test('the correction stays modest — it is provisional, not authoritative', () => {
    const original = '#8fa5bd'
    const corrected = geometryAdjustedHex(original, { ...compliantGeometry, scatteringAngle: 15 })
    const chan = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(chan(corrected, i) - chan(original, i)) < 60,
        'correction moved a channel further than a provisional model should',
      )
    }
  })

  test('the model is named so a stored value can be traced to it', () => {
    assert.equal(typeof GEOMETRY_CORRECTION_MODEL, 'string')
    assert.ok(GEOMETRY_CORRECTION_MODEL.length > 0)
  })
})

describe('US EPA PM2.5 → AQI', () => {
  test('breakpoint anchors are exact', () => {
    assert.equal(pm25ToAqi(12.0), 50)
    assert.equal(pm25ToAqi(35.4), 100)
    assert.equal(pm25ToAqi(55.4), 150)
    assert.equal(pm25ToAqi(150.4), 200)
  })

  test('matches the values observed live from Udara Jakarta', () => {
    // These are the readings the ispu comparison was made against.
    assert.equal(pm25ToAqi(57.7), 152)
    assert.equal(pm25ToAqi(33.47), 96)
    assert.equal(pm25ToAqi(59.28), 153)
  })

  test('ispu and computed AQI genuinely disagree — the reason ispu is unused', () => {
    // Bundaran HI reported ispu 95 against a raw value of 57.7 µg/m³.
    const computed = pm25ToAqi(57.7)
    assert.ok(Math.abs(computed - 95) > 50, 'expected a large divergence from ispu')
  })

  test('rejects nonsense rather than extrapolating', () => {
    assert.equal(pm25ToAqi(-1), null)
    assert.equal(pm25ToAqi(600), null)
    assert.equal(pm25ToAqi(null), null)
    assert.equal(pm25ToAqi('35'), null)
  })
})

describe('instrument ceiling detection', () => {
  test('exact ceiling values are flagged', () => {
    assert.equal(isAtInstrumentCeiling(250), true)
    assert.equal(isAtInstrumentCeiling(500), true)
    assert.equal(isAtInstrumentCeiling(999), true)
  })

  test('values merely near a ceiling are not flagged', () => {
    assert.equal(isAtInstrumentCeiling(249.9), false)
    assert.equal(isAtInstrumentCeiling(250.1), false)
  })

  test('a ceiling-pinned station is suspect even when its neighbours agree', () => {
    // Three neighbours all pinned at the same ceiling would defeat a median
    // check, which is exactly why this guard is independent of it.
    const stations = [
      { uid: 1, name: 'pinned', lat: -6.2, lng: 106.8, aqi: 301, pm25: 250 },
      { uid: 2, name: 'n1', lat: -6.21, lng: 106.8, aqi: 301, pm25: 250 },
      { uid: 3, name: 'n2', lat: -6.22, lng: 106.8, aqi: 301, pm25: 250 },
      { uid: 4, name: 'n3', lat: -6.23, lng: 106.8, aqi: 301, pm25: 250 },
    ]
    const [target] = computeNeighbourDeviations(stations)
    assert.equal(target.neighbourDeviation, 0)
    assert.equal(target.suspect, true)
    assert.equal(target.ceilingPinned, true)
  })

  test('a normal station among normal neighbours is not flagged', () => {
    const stations = [
      { uid: 1, name: 'ok', lat: -6.2, lng: 106.8, aqi: 96, pm25: 33.47 },
      { uid: 2, name: 'n1', lat: -6.21, lng: 106.8, aqi: 97, pm25: 34.15 },
      { uid: 3, name: 'n2', lat: -6.22, lng: 106.8, aqi: 95, pm25: 33.0 },
      { uid: 4, name: 'n3', lat: -6.23, lng: 106.8, aqi: 99, pm25: 35.0 },
    ]
    const [target] = computeNeighbourDeviations(stations)
    assert.equal(target.suspect, false)
    assert.equal(target.ceilingPinned, false)
  })
})
