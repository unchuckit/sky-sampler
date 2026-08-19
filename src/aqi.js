// US EPA PM2.5 → AQI conversion. Pure, React-free, importable by both the app
// and the Node scripts.
//
// Why this exists rather than using Udara Jakarta's own `ispu` field: the two
// do not correspond, because they measure over different windows. ISPU is
// computed on a long averaging window (conventionally 24h); `dominantRawValue`
// is near-instantaneous. A sample paired with a photograph of the sky at one
// moment needs the short-window value, so we compute AQI ourselves from the raw
// µg/m³ and never display `ispu`.
//
// Observed live example — Bundaran HI reported ispu 95 against a raw value that
// converts to roughly AQI 152 under these breakpoints. Using ispu would have
// mislabelled the zone.

// US EPA "Technical Assistance Document for the Reporting of Daily Air Quality"
// — PM2.5 breakpoints, concentration in µg/m³. Written out in full rather than
// approximated.
export const PM25_BREAKPOINTS = [
  { cLow: 0.0, cHigh: 12.0, aqiLow: 0, aqiHigh: 50 },
  { cLow: 12.1, cHigh: 35.4, aqiLow: 51, aqiHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, aqiLow: 101, aqiHigh: 150 },
  { cLow: 55.5, cHigh: 150.4, aqiLow: 151, aqiHigh: 200 },
  { cLow: 150.5, cHigh: 250.4, aqiLow: 201, aqiHigh: 300 },
  { cLow: 250.5, cHigh: 350.4, aqiLow: 301, aqiHigh: 400 },
  { cLow: 350.5, cHigh: 500.4, aqiLow: 401, aqiHigh: 500 },
]

/**
 * @param {number} pm25 concentration in µg/m³
 * @returns {number|null} US EPA AQI, or null if outside the defined table
 */
export function pm25ToAqi(pm25) {
  if (typeof pm25 !== 'number' || Number.isNaN(pm25) || pm25 < 0) return null
  const bp = PM25_BREAKPOINTS.find((b) => pm25 >= b.cLow && pm25 <= b.cHigh)
  if (!bp) return null // above 500.4 µg/m³ — beyond the table, not extrapolated
  const { cLow, cHigh, aqiLow, aqiHigh } = bp
  return Math.round(((aqiHigh - aqiLow) / (cHigh - cLow)) * (pm25 - cLow) + aqiLow)
}
