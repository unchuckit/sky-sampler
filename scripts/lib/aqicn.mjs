// Shared AQICN access for scripts/survey-coverage.mjs.
//
// AQICN is no longer the app's data source — the app reads a snapshot of Udara
// Jakarta instead. This module survives because survey-coverage is standalone
// research tooling: AQICN is still the only source with nationwide Indonesian
// coverage to survey against, even though its Jakarta density is too thin to
// build on.
//
// Discovery uses the map/bounds endpoint rather than the search endpoint. The
// search endpoint matches on *station name*, which is the flaw that made the
// earlier V2 discovery script unreliable: a station called "Ciputat - Nafas"
// contains no instance of the string "jakarta", so a keyword sweep could never
// return it regardless of where it physically sits.
//
// bounds is queried in TILES rather than as one big box, because a single
// large-area request returns a capped subset — a whole-globe call returns ~879
// stations and demonstrably omits stations that a tighter box does return.
// Tiling keeps each request's area small enough to stay under that cap.

/**
 * The AQICN token is no longer stored in the app — it was removed with the rest
 * of the AQICN integration. The survey script is research tooling, so it takes
 * the token from the environment or argv instead of baking one into the repo.
 */
export function requireToken(fromArgv) {
  const token = fromArgv || process.env.AQICN_TOKEN
  if (!token) {
    throw new Error(
      'No AQICN token. This script is research tooling and needs one:\n' +
        '  AQICN_TOKEN=xxxx npm run survey\n' +
        'Get a free token at https://aqicn.org/data-platform/token/',
    )
  }
  return token
}

async function getJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
}

/** One bounds request. Coordinates are bottom-left first, then top-right. */
export async function fetchBounds(token, lat1, lng1, lat2, lng2) {
  const url = `https://api.waqi.info/map/bounds/?latlng=${lat1},${lng1},${lat2},${lng2}&token=${token}`
  const data = await getJson(url)
  if (data.status !== 'ok') return []
  return data.data ?? []
}

/**
 * Sweep a box as an n×n grid of tiles, de-duplicating by uid.
 * Returns { stations, tileCount } — stations are raw AQICN map records.
 */
export async function sweepBox(token, box, tiles = 6, { onProgress } = {}) {
  const { lat1, lng1, lat2, lng2 } = box
  const seen = new Map()
  let done = 0
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const a = lat1 + ((lat2 - lat1) * i) / tiles
      const b = lng1 + ((lng2 - lng1) * j) / tiles
      const c = lat1 + ((lat2 - lat1) * (i + 1)) / tiles
      const d = lng1 + ((lng2 - lng1) * (j + 1)) / tiles
      let results = []
      try {
        results = await fetchBounds(token, a, b, c, d)
      } catch {
        // A failed tile is a gap in coverage of the sweep, not a fatal error —
        // record nothing and continue rather than aborting the whole survey.
      }
      for (const s of results) seen.set(s.uid, s)
      done++
      onProgress?.(done, tiles * tiles, seen.size)
    }
  }
  return { stations: [...seen.values()], tileCount: tiles * tiles }
}

/** Per-station feed, used to read `attributions` (not present in bounds results). */
export async function fetchStationFeed(token, uid) {
  const data = await getJson(`https://api.waqi.info/feed/@${uid}/?token=${token}`)
  if (data.status !== 'ok') return null
  return data.data
}

export function hasLiveAqi(aqi) {
  if (typeof aqi === 'number') return true
  if (typeof aqi === 'string' && aqi !== '-' && aqi.trim() !== '') return !Number.isNaN(Number(aqi))
  return false
}

export function numericAqi(aqi) {
  return hasLiveAqi(aqi) ? Number(aqi) : null
}


// Tiering for the survey only. The app assigns tier from the Udara Jakarta
// station-name prefix instead (see src/useStations.js) — this table is the
// AQICN-attribution equivalent and is kept here rather than in app constants
// because nothing in the app uses it any more.
const NETWORK_TIERS = [
  { match: 'bmkg', tier: 'A', network: 'BMKG' },
  { match: 'badan meteorologi', tier: 'A', network: 'BMKG' },
  { match: 'kementerian lingkungan hidup', tier: 'A', network: 'KLHK' },
  { match: 'klhk', tier: 'A', network: 'KLHK' },
  { match: 'bbspjppi', tier: 'A', network: 'BBSPJPPI' },
  { match: 'department of state', tier: 'A', network: 'US Dept. of State' },
  { match: 'embassy', tier: 'A', network: 'US Dept. of State' },
  { match: 'consulate', tier: 'A', network: 'US Dept. of State' },
  { match: 'nafas', tier: 'B', network: 'Nafas' },
  { match: 'clarity', tier: 'B', network: 'Clarity' },
  { match: 'purpleair', tier: 'C', network: 'PurpleAir' },
  { match: 'sensor.community', tier: 'C', network: 'Sensor.Community' },
]

const AGGREGATORS = ['world air quality index', 'waqi.info']

export function tierForAttributions(attributionNames = []) {
  for (const raw of attributionNames) {
    const name = String(raw || '').toLowerCase()
    if (AGGREGATORS.some((a) => name.includes(a))) continue
    const hit = NETWORK_TIERS.find((e) => name.includes(e.match))
    if (hit) return { tier: hit.tier, network: hit.network }
  }
  const firstReal = attributionNames.find(
    (raw) => !AGGREGATORS.some((a) => String(raw || '').toLowerCase().includes(a)),
  )
  return { tier: 'C', network: firstReal || 'Unknown' }
}
