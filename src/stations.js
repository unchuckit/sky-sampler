// Facts about Udara Jakarta's station naming and grouping.
//
// Pure and React-free, and imported with explicit extensions, so both the app
// and the Node test suite can use it — the same reason stationSelection.js and
// constants.js are shaped this way.

import { TIERS } from './constants.js'

// Udara Jakarta distinguishes station types in the name prefix, and their own
// FAQ states the difference: SPKU units are officially calibrated government
// instruments suitable as a policy basis; LCS (Low-Cost Sensor) units extend
// coverage but have different accuracy and are not a policy basis on their own.
export function tierForStationName(name) {
  return String(name ?? '').startsWith('LCS-') ? TIERS.B : TIERS.A
}

// Every station name in this source is "<machine id> <human name>" —
// "DKI_PM25_38 Taman Ismail Marzuki", "LCS-06 Taman Telur". The identifier is
// worth keeping, since it is how a reading is traced back to an instrument, but
// it is not what a person reads. Display splits them apart rather than printing
// both jammed together.
//
// Anchored to the known network prefixes on purpose: a name in an unfamiliar
// format passes through whole rather than losing its first word to a guess.
const STATION_ID_PREFIX = /^(?:DKI|DKJ|LCS|BAM|pm25)[\w-]*\s+/i

export function stationDisplayName(name) {
  const raw = String(name ?? '').trim()
  if (!raw) return '—'
  const stripped = raw.replace(STATION_ID_PREFIX, '').trim()
  return stripped || raw
}

/**
 * Districts for the "pick a district" path, deduplicated across a set of raw
 * station rows and grouped by kota so the list is scannable.
 *
 * Shared with demo mode, which builds its district list from the frozen station
 * set by this same function — so every option a presenter can pick on stage
 * resolves through the real path, exactly as it would live.
 */
export function buildDistricts(rows) {
  const byKey = new Map()
  for (const s of rows) {
    if (!s.kecamatan) continue
    const key = `${s.kota ?? ''}|${s.kecamatan}`
    if (!byKey.has(key)) {
      byKey.set(key, { kecamatan: s.kecamatan, kota: s.kota ?? 'Unknown', lats: [], lngs: [] })
    }
    const d = byKey.get(key)
    if (typeof s.lat === 'number' && typeof s.lng === 'number') {
      d.lats.push(s.lat)
      d.lngs.push(s.lng)
    }
  }
  return [...byKey.values()]
    .map((d) => ({
      kecamatan: d.kecamatan,
      kota: d.kota,
      // Centroid of the district's own stations — an approximation, and
      // labelled as such wherever it is used.
      lat: d.lats.length ? d.lats.reduce((a, b) => a + b, 0) / d.lats.length : null,
      lng: d.lngs.length ? d.lngs.reduce((a, b) => a + b, 0) / d.lngs.length : null,
    }))
    .filter((d) => d.lat != null)
    .sort((a, b) => a.kota.localeCompare(b.kota) || a.kecamatan.localeCompare(b.kecamatan))
}
