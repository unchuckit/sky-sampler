// Colour averaging. Pure, React-free, unit-tested by
// scripts/test/colour.test.mjs.
//
// Why this module exists: sRGB values are gamma-encoded, so they are not
// proportional to light. Mid-grey 128 carries roughly 22% of the light of 255,
// not 50%. Averaging the encoded values returns the average of the *encoding*
// rather than the average of the *light*, which biases every sample in the
// same direction. The fix is to linearise, average in linear light, then
// re-encode.

// sRGB transfer function constants, written out rather than approximated with
// a ^2.2 shortcut — the piecewise linear segment near black matters here
// because sky samples can include genuinely dark pixels.
const SRGB_LINEAR_CUTOFF = 0.04045
const SRGB_LINEAR_SLOPE = 12.92
const SRGB_ALPHA = 0.055
const SRGB_GAMMA = 2.4
const LINEAR_SRGB_CUTOFF = 0.0031308

/** sRGB channel (0–1, gamma-encoded) → linear light (0–1). */
export function srgbToLinear(c) {
  return c <= SRGB_LINEAR_CUTOFF
    ? c / SRGB_LINEAR_SLOPE
    : Math.pow((c + SRGB_ALPHA) / (1 + SRGB_ALPHA), SRGB_GAMMA)
}

/** Linear light (0–1) → sRGB channel (0–1, gamma-encoded). */
export function linearToSrgb(c) {
  return c <= LINEAR_SRGB_CUTOFF
    ? c * SRGB_LINEAR_SLOPE
    : (1 + SRGB_ALPHA) * Math.pow(c, 1 / SRGB_GAMMA) - SRGB_ALPHA
}

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * The original (biased) average: channel-wise mean of gamma-encoded values.
 * Kept so historical values stay reproducible and comparable — not because it
 * is correct.
 */
export function averageHexNaive(hexes) {
  if (!hexes || hexes.length === 0) return null
  const sum = hexes.reduce(
    (acc, hex) => {
      const [r, g, b] = hexToRgb(hex)
      return { r: acc.r + r, g: acc.g + g, b: acc.b + b }
    },
    { r: 0, g: 0, b: 0 },
  )
  const n = hexes.length
  return rgbToHex(sum.r / n, sum.g / n, sum.b / n)
}

/**
 * Correct average: linearise each channel, average in linear light, re-encode.
 */
export function averageHexLinear(hexes) {
  if (!hexes || hexes.length === 0) return null
  const sum = hexes.reduce(
    (acc, hex) => {
      const [r, g, b] = hexToRgb(hex)
      return {
        r: acc.r + srgbToLinear(r / 255),
        g: acc.g + srgbToLinear(g / 255),
        b: acc.b + srgbToLinear(b / 255),
      }
    },
    { r: 0, g: 0, b: 0 },
  )
  const n = hexes.length
  return rgbToHex(
    linearToSrgb(sum.r / n) * 255,
    linearToSrgb(sum.g / n) * 255,
    linearToSrgb(sum.b / n) * 255,
  )
}

/** Per-channel signed delta (linear minus naive), for verification output. */
export function hexDelta(naiveHex, linearHex) {
  if (!naiveHex || !linearHex) return null
  const [nr, ng, nb] = hexToRgb(naiveHex)
  const [lr, lg, lb] = hexToRgb(linearHex)
  return { r: lr - nr, g: lg - ng, b: lb - nb }
}
