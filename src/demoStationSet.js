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
 * pattern is the reason MAX_READING_AGE_HOURS is 3 rather than 2, so preserving
 * it is what lets the freshness gate do real work on stage.
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
      lastSeen: new Date(demoNow.getTime() - row.lagMinutes * 60_000).toISOString(),
    }
  })
  return computeNeighbourDeviations(projected)
}
