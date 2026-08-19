// Sun geometry: where the camera was pointing relative to the sun.
//
// Why this matters more than it sounds: the scattering angle — the angle
// between the sun and the direction the camera points — moves the sampled hex
// more than a 50-point AQI change does. Sky at ~90° from the sun is deepest and
// most saturated; sky near the sun is washed out. Two samples at identical AQI,
// one shot 30° from the sun and one at 90°, will not match. Without recording
// this, that difference is indistinguishable from a real air-quality difference.
//
// Elevation matters for the same reason: horizon sky is always paler than
// zenith because the light has travelled through more atmosphere. Traditional
// cyanometers are zenith instruments precisely for this reason.
//
// Pure and React-free so it can be unit-tested directly.

// suncalc v2 is ESM with named exports and no default export.
import { getPosition } from 'suncalc'

// Compliance band — where sky colour is most stable and most comparable
// between samples. Non-compliant samples are still valid data; they are just
// not directly comparable to compliant ones.
export const COMPLIANT_SCATTERING_MIN = 60
export const COMPLIANT_SCATTERING_MAX = 120
export const COMPLIANT_ELEVATION_MIN = 45

// Warning thresholds — softer than the compliance band, because these interrupt
// someone mid-capture and should only fire when the sample really will be
// unrepresentative.
export const WARN_SCATTERING_BELOW = 40
export const WARN_ELEVATION_BELOW = 30

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

/**
 * Solar azimuth (0 = north, clockwise) and elevation, in degrees.
 *
 * SunCalc returns azimuth measured from SOUTH going clockwise, in radians, so
 * it needs converting to the compass convention the device sensors report in.
 *
 * These values are intermediates only. They are never stored — see the module
 * note in useCaptureGeometry: retaining solar azimuth and elevation alongside an
 * exact timestamp is precisely what allows a position to be back-solved.
 */
export function solarPosition(date, lat, lng) {
  const pos = getPosition(date, lat, lng)
  const azimuthFromNorth = (pos.azimuth * DEG + 180 + 360) % 360
  return {
    azimuth: azimuthFromNorth,
    elevation: pos.altitude * DEG,
  }
}

/**
 * Angular distance between two directions given as (azimuth, elevation) pairs,
 * in degrees. This is the great-circle distance on the celestial sphere.
 */
export function angularDistance(az1, el1, az2, el2) {
  const a1 = az1 * RAD
  const e1 = el1 * RAD
  const a2 = az2 * RAD
  const e2 = el2 * RAD
  const cosAngle =
    Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(a1 - a2)
  // Clamp for floating-point drift just outside [-1, 1], which would make acos NaN.
  return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * DEG
}

/**
 * Camera elevation from the device's `beta` (front-to-back tilt).
 *
 * beta is 0 when the phone is flat on its back with the screen up, and 90 when
 * it is upright. A phone held to photograph the zenith is flat on its back, so
 * the camera (on the rear) points straight up at beta 0. Elevation is therefore
 * 90 - |beta|, clamped: pitching past vertical starts pointing at the ground
 * again, which is not a higher elevation.
 */
export function cameraElevationFromBeta(beta) {
  if (typeof beta !== 'number' || Number.isNaN(beta)) return null
  return Math.max(-90, Math.min(90, 90 - Math.abs(beta)))
}

/**
 * Full geometry for one capture.
 *
 * Returns whole-degree values only. Rounding is not cosmetic: solar azimuth and
 * elevation at a precise timestamp can be back-solved into a location, which is
 * how celestial navigation works. At whole-degree precision the recoverable
 * position is on the order of a hundred kilometres — useless to anyone, and
 * costing nothing analytically, since the compliance band is sixty degrees wide.
 */
export function computeSkyGeometry({ heading, beta, lat, lng, date = new Date() }) {
  const sensorAvailable =
    typeof heading === 'number' && !Number.isNaN(heading) &&
    typeof beta === 'number' && !Number.isNaN(beta)

  if (!sensorAvailable) {
    return {
      compassHeading: null,
      cameraElevation: null,
      scatteringAngle: null,
      sensorAvailable: false,
    }
  }

  const cameraElevation = cameraElevationFromBeta(beta)

  let scatteringAngle = null
  if (typeof lat === 'number' && typeof lng === 'number') {
    const sun = solarPosition(date, lat, lng)
    scatteringAngle = angularDistance(heading, cameraElevation, sun.azimuth, sun.elevation)
  }

  return {
    compassHeading: Math.round(((heading % 360) + 360) % 360),
    cameraElevation: Math.round(cameraElevation),
    scatteringAngle: scatteringAngle == null ? null : Math.round(scatteringAngle),
    sensorAvailable: true,
  }
}

export function isGeometryCompliant(geometry) {
  if (!geometry?.sensorAvailable) return false
  const { scatteringAngle, cameraElevation } = geometry
  if (scatteringAngle == null || cameraElevation == null) return false
  return (
    scatteringAngle >= COMPLIANT_SCATTERING_MIN &&
    scatteringAngle <= COMPLIANT_SCATTERING_MAX &&
    cameraElevation > COMPLIANT_ELEVATION_MIN
  )
}

/**
 * Capture-time warnings. Returns an array so both can fire at once. These warn
 * and record; they never block the save — the person decides.
 */
export function geometryWarnings(geometry) {
  const warnings = []
  if (!geometry?.sensorAvailable) return warnings
  if (geometry.scatteringAngle != null && geometry.scatteringAngle < WARN_SCATTERING_BELOW) {
    warnings.push({
      key: 'near-sun',
      text: 'Pointing near the sun — this reads paler than the sky’s true colour.',
    })
  }
  if (geometry.cameraElevation != null && geometry.cameraElevation < WARN_ELEVATION_BELOW) {
    warnings.push({
      key: 'low-angle',
      text: 'Low angle — horizon sky reads paler. Aim higher for a comparable sample.',
    })
  }
  return warnings
}
