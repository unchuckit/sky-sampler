// Provisional geometry correction for sampled sky colour.
//
// READ THIS BEFORE TRUSTING THE OUTPUT.
//
// This normalises a sample toward a reference geometry (90° scattering angle,
// zenith) so samples shot at different sun angles can be compared. It is
// PROVISIONAL. It is derived from textbook scattering physics, not fitted to
// this project's data — deliberately, because with four historical samples and
// no Aspirational-zone data, any coefficient fitted to the current log would be
// fitted to noise.
//
// It is stored additively, never replacing `averagedHexLinear`. If this model
// turns out to be wrong, the original measurements survive and everything can be
// recomputed. A destructive correction could not be undone.
//
// MODEL: Rayleigh + Henyey-Greenstein aerosol, single-scattering approximation.
//
// Two physical effects are modelled:
//
//   1. Scattering phase. Rayleigh scattering by air molecules follows
//      (3/4)(1 + cos²θ), which is strongest toward 0° and 180° and weakest at
//      90°. Aerosol scattering is strongly forward-peaked and is approximated
//      with the Henyey-Greenstein phase function at g = 0.7, a standard value
//      for atmospheric haze. Near the sun the aerosol term dominates and adds
//      broadband (white) light, which is what washes the blue out.
//
//   2. Air mass. Looking toward the horizon means a longer path through the
//      atmosphere, which scatters out more short-wavelength light and adds more
//      multiply-scattered white light. Approximated as sec(zenith angle),
//      capped to avoid the divergence at the true horizon.
//
// ASSUMPTIONS AND LIMITS — all significant:
//   - Single-scattering only. Real skies are multiply scattered, which this
//     underestimates, particularly in hazy conditions, which is exactly when
//     Jakarta samples are taken.
//   - Fixed aerosol asymmetry (g = 0.7) and a fixed Rayleigh/aerosol mixing
//     ratio. Both actually vary with the aerosol load — that is, with AQI, the
//     very thing being measured.
//   - Ignores ground albedo, cloud, and the solar-elevation dependence of the
//     illuminating spectrum.
//   - Operates on sRGB primaries as a proxy for wavelength, which is a coarse
//     stand-in for a spectral calculation.
//
// The correction is intentionally conservative — it is scaled to move colour
// only modestly — because an over-confident correction on an unvalidated model
// is worse than a visible, honest uncertainty.

import { hexToRgb, rgbToHex } from './colour.js'
import { srgbToLinear, linearToSrgb } from './colour.js'

export const GEOMETRY_CORRECTION_MODEL = 'rayleigh-hg-g0.7-singlescatter-v1'

// Reference geometry the correction normalises toward: 90° from the sun at the
// zenith — the classic cyanometer observing condition.
const REFERENCE_SCATTERING_ANGLE = 90
const REFERENCE_ELEVATION = 90

const HG_ASYMMETRY = 0.7 // aerosol forward-scattering asymmetry, standard haze value
const AEROSOL_FRACTION = 0.5 // assumed molecular/aerosol mixing at Jakarta loads
const MAX_AIR_MASS = 5 // cap sec(z) so near-horizon does not diverge
const CORRECTION_STRENGTH = 0.35 // conservative scaling; see note above

const DEG = Math.PI / 180

/** Rayleigh phase function, normalised to 1 at 90°. */
function rayleighPhase(thetaDeg) {
  const c = Math.cos(thetaDeg * DEG)
  return (0.75 * (1 + c * c)) / 0.75
}

/** Henyey-Greenstein phase function, normalised to its value at 90°. */
function hgPhase(thetaDeg, g = HG_ASYMMETRY) {
  const c = Math.cos(thetaDeg * DEG)
  const denom = Math.pow(1 + g * g - 2 * g * c, 1.5)
  const at90 = Math.pow(1 + g * g, 1.5)
  return (1 - g * g) / denom / ((1 - g * g) / at90)
}

function airMass(elevationDeg) {
  const z = Math.max(0, Math.min(89, 90 - elevationDeg))
  return Math.min(MAX_AIR_MASS, 1 / Math.cos(z * DEG))
}

/**
 * Whiteness factor: how much broadband (colour-desaturating) light the geometry
 * adds relative to the reference. > 1 means the sample is washed out and should
 * be corrected toward more saturation.
 */
function whitenessFactor(scatteringAngle, cameraElevation) {
  const aerosolNow = hgPhase(scatteringAngle)
  const aerosolRef = hgPhase(REFERENCE_SCATTERING_ANGLE)
  const rayleighNow = rayleighPhase(scatteringAngle)
  const rayleighRef = rayleighPhase(REFERENCE_SCATTERING_ANGLE)

  const phaseNow = AEROSOL_FRACTION * aerosolNow + (1 - AEROSOL_FRACTION) * rayleighNow
  const phaseRef = AEROSOL_FRACTION * aerosolRef + (1 - AEROSOL_FRACTION) * rayleighRef

  const pathRatio = airMass(cameraElevation) / airMass(REFERENCE_ELEVATION)

  return (phaseNow / phaseRef) * pathRatio
}

/**
 * Correct a sampled hex toward the reference geometry.
 *
 * Works in linear light (the only place where "adding white light" is a linear
 * operation), removes the excess broadband component, then re-encodes.
 *
 * @returns {string|null} corrected hex, or null when geometry is unavailable.
 */
export function geometryAdjustedHex(hex, geometry) {
  if (!hex || !geometry?.sensorAvailable) return null
  const { scatteringAngle, cameraElevation } = geometry
  if (scatteringAngle == null || cameraElevation == null) return null

  const w = whitenessFactor(scatteringAngle, cameraElevation)
  // No meaningful difference from the reference — return the input unchanged
  // rather than manufacturing a correction out of rounding noise.
  if (Math.abs(w - 1) < 1e-6) return hex

  const [r, g, b] = hexToRgb(hex).map((c) => srgbToLinear(c / 255))

  // The desaturating component is achromatic, so it is approximated by the
  // channel minimum — the part of the signal common to all three channels.
  const achromatic = Math.min(r, g, b)
  const excess = achromatic * (1 - 1 / w) * CORRECTION_STRENGTH

  const corrected = [r, g, b].map((c) => Math.max(0, Math.min(1, c - excess)))

  return rgbToHex(
    linearToSrgb(corrected[0]) * 255,
    linearToSrgb(corrected[1]) * 255,
    linearToSrgb(corrected[2]) * 255,
  )
}
