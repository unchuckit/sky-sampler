import { PROVENANCE, TIERS } from './constants.js'

// Which samples deserve a second look.
//
// THE GOVERNING RULE: show exceptions, not confirmations. A card that announces
// "Tier A · High confidence ✓" is announcing the normal case, and when every
// card says it, the cards where something is genuinely off stop standing out.
// Silence means fine.
//
// Nothing here removes information — every field these flags derive from is
// still shown in the expanded card and still written to the export. This only
// decides what is worth interrupting a scroll for.
//
// Pure and React-free so the conditions can be tested directly rather than
// inferred from rendered markup.

export const FLAG_KEYS = {
  NO_AQI: 'no-aqi',
  UNVERIFIED: 'unverified',
  SUSPECT: 'suspect',
  CONFIDENCE: 'confidence',
  LOW_COST_SENSOR: 'low-cost-sensor',
  OFF_ANGLE: 'off-angle',
}

const CONFIDENCE_LABELS = {
  moderate: 'Moderate confidence',
  low: 'Low confidence',
}

/**
 * @param {object} sample a stored log sample
 * @returns {Array<{key: string, label: string}>} empty when nothing is off
 */
export function sampleFlags(sample) {
  if (!sample) return []
  const flags = []
  const selection = sample.stationSelection ?? null
  const hasAqi = typeof sample.aqi === 'number'

  // Ordered most-consequential first, so a card carrying several reads as its
  // worst problem rather than its most cosmetic one.
  if (!hasAqi) {
    flags.push({ key: FLAG_KEYS.NO_AQI, label: 'No AQI' })
  }

  // Only meaningful when there is an AQI to doubt. A no-coverage sample has
  // provenance 'no-coverage', which is not 'verified' — but "No AQI ·
  // Unverified AQI" says one thing twice, and the first already covers it.
  if (hasAqi && sample.provenance && sample.provenance !== PROVENANCE.VERIFIED) {
    flags.push({ key: FLAG_KEYS.UNVERIFIED, label: 'Unverified AQI' })
  }

  if (selection?.suspect) {
    flags.push({ key: FLAG_KEYS.SUSPECT, label: 'Sensor reading suspect' })
  }

  const band = selection?.confidenceBand ?? sample.confidenceBand ?? null
  if (band && CONFIDENCE_LABELS[band]) {
    flags.push({ key: FLAG_KEYS.CONFIDENCE, label: CONFIDENCE_LABELS[band] })
  }

  // "Low-cost sensor" rather than "Tier B": the tier letter is our own jargon,
  // and the thing worth knowing is what kind of instrument produced the number.
  if (selection?.tier === TIERS.B) {
    flags.push({ key: FLAG_KEYS.LOW_COST_SENSOR, label: 'Low-cost sensor' })
  }

  // Explicitly `=== false`, not falsy: a sample predating geometry capture has
  // the field undefined, and it never claimed to be compliant in the first
  // place. Flagging those would flag history rather than a problem.
  if (sample.geometryCompliant === false) {
    flags.push({ key: FLAG_KEYS.OFF_ANGLE, label: 'Off-angle' })
  }

  return flags
}
