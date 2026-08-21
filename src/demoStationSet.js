import { DEMO_STATION_ROWS } from './demoStations.js'
import { aqiToPm25, pm25ToAqi } from './aqi.js'
import { computeNeighbourDeviations } from './stationSelection.js'
import { tierForStationName } from './stations.js'

// Turns the frozen station rows into a live-shaped station set for one demo
// zone at one demo instant.
//
// THE RULE THIS FILE ENFORCES: demo mode fabricates two things, the AQI
// readings and the clock. Everything else — station names, coordinates, tier
// prefixes, distance maths, the radius gate, the freshness gate, tier scoring,
// confidence bands — is the real thing running on real data. A demo that faked
// the station match would be demonstrating nothing, since the station match is
// the part worth showing.
//
// Pure and React-free so the guarantees above can be tested directly rather
// than inferred from a rendered screen. See scripts/test/demo-mode.test.mjs.

// Spread of synthesized readings around the zone's nominal AQI. Wide enough
// that the area cards do not read as three copies of one number, narrow enough
// that every station stays inside its zone's SAMPLE_ZONES bucket — the tightest
// is Good Day at 30–70 against a nominal 45.
export const AQI_SPREAD = 5

/**
 * THE ONE FABRICATED FACT IN THE STATION SET, and it is deliberate.
 *
 * Every real station reports within 2 hours, so nothing in the frozen set ever
 * lands in the 3-6h band where recency is penalised — meaning the "Updated N
 * hours ago" line, and the soft-penalty behaviour it represents, could never be
 * shown on stage. This ages exactly one station into that band so the
 * behaviour is demonstrable.
 *
 * It lives here rather than in demoStations.js on purpose: that file is
 * generated from a real fetch and must stay a faithful copy of what the source
 * actually said. Fabrication belongs in hand-written code where it can be
 * labelled, not baked into data that reads as real.
 *
 * DKI3 Jagakarsa, one of the three curated demo areas, so the line appears on a
 * card the presenter is already talking about.
 */
export const DEMO_LAG_OVERRIDE_MINUTES = {
  '61246172-d1ec-4e25-8c96-ddf74f967dc5': 4 * 60, // DKI3 Jagakarsa — inside the 6h wall, past the 3h penalty
}

/**
 * FNV-1a. Any stable hash would do; what matters is that it is a pure function
 * of the station and the zone, so a re-render — or advancing to a zone and back
 * — produces the identical reading rather than jittering on screen mid-talk.
 */
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A reading for one station in one zone.
 *
 * Note the direction: zone AQI → µg/m³, and the caller then converts back with
 * the same EPA function live mode uses. Assigning an AQI directly would let the
 * µg/m³ and the AQI on screen drift apart from each other.
 */
export function syntheticPm25(uid, zoneKey, zoneAqi) {
  const offset = (hash(`${uid}|${zoneKey}`) % (AQI_SPREAD * 2 + 1)) - AQI_SPREAD
  return aqiToPm25(Math.max(0, zoneAqi + offset))
}

/**
 * Build the station set for a zone.
 *
 * Each station's reading time replays its own real lag behind the source's
 * update time — DKI units at or near it, LCS units about two hours back. That
 * pattern is why recency is scored at all: LCS units land in the 2-3h band
 * where the penalty starts to bite, so preserving it lets the recency term do
 * real work on stage instead of every station looking equally current.
 *
 * @param {string} zoneKey
 * @param {number} zoneAqi nominal AQI for the zone
 * @param {Date} demoNow the zone's clock
 */
export function buildDemoStationSet(zoneKey, zoneAqi, demoNow) {
  if (!zoneKey || zoneAqi == null || !demoNow) return []
  const projected = DEMO_STATION_ROWS.map((row) => {
    const pm25 = syntheticPm25(row.id, zoneKey, zoneAqi)
    return {
      uid: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      kecamatan: row.kecamatan,
      kota: row.kota,
      pm25,
      aqi: pm25ToAqi(pm25),
      // From the real name prefix, by the same function live mode uses.
      tier: tierForStationName(row.name),
      network: 'Udara Jakarta',
      lastSeen: new Date(
        demoNow.getTime() - (DEMO_LAG_OVERRIDE_MINUTES[row.id] ?? row.lagMinutes) * 60_000,
      ).toISOString(),
    }
  })
  return computeNeighbourDeviations(projected)
}
