// Light to dark — the printed cyanometer disc's 16 swatches.
export const REFERENCE_SWATCHES = [
  '#f5f9fc', '#e2eff6', '#cfe4f1', '#bcd9ec',
  '#a9cfe6', '#95c4e1', '#82b9dc', '#6fafd6',
  '#5ca4d1', '#4999cb', '#378fc5', '#307cab',
  '#2e77a5', '#2c739f', '#296a92', '#27658c',
]

// AQI live-reading pill zones (station display).
export const AQI_ZONES = [
  { key: 'good', label: 'Good', min: 0, max: 50, color: '#3fb950' },
  { key: 'moderate', label: 'Moderate', min: 51, max: 100, color: '#d4a72c' },
  { key: 'sensitive', label: 'Unhealthy for Sensitive Groups', min: 101, max: 150, color: '#d97b29' },
  { key: 'unhealthy', label: 'Unhealthy', min: 151, max: 200, color: '#d9463f' },
  { key: 'hazardous', label: 'Very Unhealthy / Hazardous', min: 201, max: Infinity, color: '#8b3f9c' },
]

export function getAqiZone(aqi) {
  return AQI_ZONES.find((zone) => aqi >= zone.min && aqi <= zone.max) || AQI_ZONES[AQI_ZONES.length - 1]
}

// Sample-goal coverage zones — the four bands the 8-sample collection targets.
export const SAMPLE_ZONES = [
  { key: 'aspirational', label: 'Aspirational', range: 'AQI <30', swatches: [12, 13, 14, 15], test: (aqi) => aqi < 30 },
  { key: 'good-day', label: 'Good Day', range: 'AQI 30–70', swatches: [8, 9, 10, 11], test: (aqi) => aqi >= 30 && aqi < 70 },
  { key: 'typical', label: 'Typical Jakarta', range: 'AQI 70–100', swatches: [4, 5, 6, 7], test: (aqi) => aqi >= 70 && aqi < 100 },
  { key: 'heavy-haze', label: 'Heavy Haze', range: 'AQI 100–200+', swatches: [0, 1, 2, 3], test: (aqi) => aqi >= 100 },
]

export function getSampleZone(aqi) {
  return SAMPLE_ZONES.find((zone) => zone.test(aqi)) || null
}

export const SAMPLE_GOAL = 8

// Sampling areas are USER-MANAGED and carry no coordinates.
//
// A sampling area is a place a person stands and photographs the sky from. A
// station is a monitoring instrument the app attaches to that area by proximity.
// They are not the same thing and nobody stands inside a monitoring station.
//
// Areas are created from a GPS reading or a district centroid, and the
// coordinates are used to resolve the nearest qualifying station and then
// DISCARDED. What persists is the station attachment and how far away it is —
// enough to reconstruct every provenance decision, and nothing more. See
// useLocations.js.
//
// There are deliberately no defaults: shipping hardcoded home coordinates would
// bake them into git history permanently, which is exactly what this project
// needs to avoid before the repository goes public.
export const LOCATIONS = []

export function getLocationById(id) {
  return LOCATIONS.find((loc) => loc.id === id) || null
}

// AQI provenance — how confident we are that a sample's stored AQI actually
// reflects the station/location it claims.
export const PROVENANCE = {
  VERIFIED: 'verified', // fetched live from the bound station at capture/edit time
  UNVERIFIED: 'unverified', // pre-migration sample, or location was edited after capture
  BACKFILLED: 'backfilled', // AQI replaced via scripts/backfill-aqi.js after manual review
  NO_COVERAGE: 'no-coverage', // no station passed the radius/freshness gates; aqi is null
}

export const MAX_LOCATION_CHANGES = 3

// ---------------------------------------------------------------------------
// Station quality tiering
// ---------------------------------------------------------------------------
// Tier records how much a sensor can be trusted at all — separate from the
// confidence band, which records how well its reading describes a given spot.
export const TIERS = {
  A: 'A', // reference-grade: government / official instruments
  B: 'B', // validated low-cost network: centrally maintained + calibrated
  C: 'C', // uncalibrated or community
}

// Tier is now assigned from the station name prefix, which is native to the
// Udara Jakarta data — see tierForStationName in useStations.js. Their FAQ
// states the distinction: SPKU units are officially calibrated government
// instruments suitable as a policy basis; LCS (Low-Cost Sensor) units extend
// coverage but have different accuracy and are not a policy basis alone.
//
//   LCS-*  → Tier B
//   others → Tier A  (DKI, DKJ, BAM, pm25_)
//
// Tier C is unused with this source. The constant and its multiplier stay in
// place so a future source with community sensors slots in without a rewrite.

// ---------------------------------------------------------------------------
// Station selection: hard gates, then scoring
// ---------------------------------------------------------------------------
// The gates come first and are absolute. The original bug attached a Sleman
// reading — 450km away — to a Depok sample. The failure was not picking badly
// among candidates; it was having no floor on what counted as a candidate.
// Never widen this radius to make a location "work".
export const MAX_STATION_RADIUS_KM = 15

// 3 hours, not 2. LCS stations report systematically later than DKI stations —
// in live fetches the DKI units are stamped at the page update time while LCS
// units sit around 2 hours behind. Kemang's nearest station is LCS-06 Taman
// Telur at exactly 2 hours stale, so a 2-hour gate would leave it permanently on
// the boundary, intermittently failing and silently falling back to a further
// station. That is the same class of silent-provenance failure this project has
// already been through once.
//
// If the snapshot workflow is switched to hourly (the private-repo path in
// .github/workflows/snapshot.yml), widen this to 4: an LCS reading can already
// be 2h old when the snapshot is taken, plus up to another hour before the next
// one lands, which sits exactly on a 3-hour gate.
export const MAX_READING_AGE_HOURS = 3

// Multiplicative, not additive: tier uncertainty compounds with distance. A
// Tier C sensor 500m away is still describing your air; a Tier C sensor 12km
// away stacks two separate uncertainties. Tunable — see README.
export const TIER_MULTIPLIERS = { [TIERS.A]: 1.0, [TIERS.B]: 1.3, [TIERS.C]: 2.0 }
export const SUSPECT_MULTIPLIER = 2.0
export const CLEAN_MULTIPLIER = 1.0

// Neighbour-median deviation. This was inert in V2.1, which only ever had one
// live station to compare; with ~97 simultaneous readings it does real work.
// Suspect stations are penalised, never removed: in genuinely patchy air
// a real local spike looks exactly like a bad sensor, and dropping it would
// hide a true reading.
export const NEIGHBOUR_RADIUS_KM = 10
export const MIN_NEIGHBOURS_FOR_DEVIATION = 3

// Deviation is measured in RAW PM2.5 (µg/m³), not in AQI.
//
// This matters more than it looks. The EPA breakpoint curve is piecewise linear
// with an 8× slope difference between segments — 4.17 AQI per µg/m³ in the
// 0–12 band against 0.52 in the 55.5–150.4 band. Comparing in AQI space
// therefore exaggerates disagreement wherever neighbouring stations straddle a
// breakpoint, which in Jakarta they do constantly, since typical readings sit
// right around the 12.1 and 35.5 boundaries.
//
// Measured against real data: an AQI-space threshold of 40 flagged 31% of the
// network as suspect, and that over-firing changed which station Kemang and
// Depok resolved to. In PM2.5 space the same stations deviate unremarkably
// (LCS-06 Taman Telur: 17.1 µg/m³, below the 75th percentile, against 41.5 in
// AQI space).
//
// 30 µg/m³ is roughly the full width of the EPA "Moderate" band (12.1–35.4), so
// a station over it is disagreeing with its neighbours by a whole air-quality
// category in physical terms. Against the live network that flags ~8%.
export const SUSPECT_DEVIATION_THRESHOLD_PM25 = 30

// Confidence band describes how well the chosen station's reading represents
// *this location* — separate from tier, which is about whether the sensor can
// be trusted at all. A Tier A station 12km away is a trustworthy sensor giving
// a low-confidence reading for your spot. Both facts belong on the record.
export const CONFIDENCE_BANDS = [
  { key: 'high', label: 'High confidence', maxKm: 5, meaning: 'Same local airshed' },
  { key: 'moderate', label: 'Moderate confidence', maxKm: 10, meaning: 'Same metro, different microclimate' },
  { key: 'low', label: 'Low confidence', maxKm: 15, meaning: 'Directionally useful, not local' },
]

export function confidenceBandFor(distanceKm) {
  if (distanceKm == null) return null
  const band = CONFIDENCE_BANDS.find((b) => distanceKm < b.maxKm)
  return band ? band.key : null // beyond the last band = rejected upstream by the radius gate
}

export const REJECTION_REASONS = {
  OUT_OF_RADIUS: 'out-of-radius',
  STALE: 'stale',
  LOWER_SCORE: 'lower-score',
}

// Demo mode — deterministic, offline AQI values keyed by zone param (see useAQI.js
// and demoData.js). AQI values intentionally sit mid-band for their SAMPLE_ZONES
// bucket so getSampleZone() classifies them the same way real readings would.
export const DEMO_ZONES = {
  aspirational: { aqi: 22, label: 'Aspirational' },
  'good-day': { aqi: 45, label: 'Good Day' },
  'typical-jakarta': { aqi: 85, label: 'Typical Jakarta' },
  'heavy-haze': { aqi: 140, label: 'Heavy Haze' },
}

// Advance order for the DEMO pill. THIS MUST MATCH THE OBS HOTKEY ORDER so that
// "next" on the clicker and "next" on the phone stay in step — see README.
// It follows the disc: lightest sky to heaviest haze.
export const DEMO_ZONE_ORDER = ['aspirational', 'good-day', 'typical-jakarta', 'heavy-haze']

// One fixed time-of-day per zone, always applied to today's date. Advancing
// zones advances the clock, so the four zones read as one day's progression
// rather than four unrelated states. Never a hardcoded date — a stale date on
// a projector is exactly what this guards against — only the hour and minute
// are fixed.
export const DEMO_ZONE_TIMES = {
  aspirational: { hour: 10, minute: 45 },
  'good-day': { hour: 12, minute: 2 },
  'typical-jakarta': { hour: 13, minute: 18 },
  'heavy-haze': { hour: 14, minute: 0 },
}

export function demoClockFor(zoneKey, base = new Date()) {
  const t = DEMO_ZONE_TIMES[zoneKey]
  if (!t) return null
  const d = new Date(base)
  d.setHours(t.hour, t.minute, 0, 0)
  return d
}

export const IDEAL_WINDOW = { start: 10, end: 14 } // 10:00–14:00

export function isIdealWindow(date = new Date()) {
  const hour = date.getHours()
  return hour >= IDEAL_WINDOW.start && hour < IDEAL_WINDOW.end
}

export function nextIdealWindowLabel(date = new Date()) {
  const hour = date.getHours()
  if (hour < IDEAL_WINDOW.start) return `Next window today 10:00–14:00`
  return `Next window tomorrow 10:00–14:00`
}

// Snapshot staleness — the second clock, independent of per-station freshness.
// Routine staleness is never shown; only the far end matters. Past 6 hours,
// treat the data as unavailable rather than serving a many-hours-old reading
// as though it were current — area cards show "No current reading" instead of
// a number, and captures still save, with provenance 'no-coverage'.
export const SNAPSHOT_UNUSABLE_HOURS = 6

// Instrument ceilings. A station reporting exactly one of these is far more
// likely to be pinned at its range limit than to be measuring that value, so it
// is flagged suspect regardless of what its neighbours read.
export const INSTRUMENT_CEILINGS = [250, 500, 999]

export const ATTRIBUTION = 'AQI data: Udara Jakarta — Dinas Lingkungan Hidup DKI Jakarta'

// VERIFIED_STATIONS is deliberately NOT defined here any more.
//
// The station list is built at runtime from public/data/stations.json, so it
// stays current as DKI adds or retires stations with no code change. Hardcoding
// coordinates here would also bake them into git history permanently.
