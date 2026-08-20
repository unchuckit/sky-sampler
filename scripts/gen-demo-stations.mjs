#!/usr/bin/env node
// Regenerates src/demoStations.js from the current station snapshot.
//
// Demo mode fabricates exactly two things: the AQI readings and the clock.
// Station identity — names, coordinates, LCS-/DKI- prefixes that drive tier —
// is real, so that the station-matching logic the demo exists to show is
// actually the logic running. That means the station list has to come from a
// real fetch, which is what this script bakes in.
//
// What is deliberately NOT carried over:
//   - dominantRawValue, because the demo synthesizes a reading per zone
//   - dominantMetricTime as an absolute instant, because it would be months
//     stale against the demo clock and every station would fail the freshness
//     gate
//
// What IS carried over is each station's LAG: how far behind the snapshot's
// own update time its reading was. Replaying that lag against the demo clock
// reproduces the real reporting pattern — DKI units at or near the update
// time, LCS units about two hours behind — which is the whole reason
// MAX_READING_AGE_HOURS is 3 rather than 2. A demo that flattened the lag
// would never exercise the gate it is meant to demonstrate.
//
// Usage: node scripts/gen-demo-stations.mjs [--in path] [--out path]

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const IN_PATH = argValue('--in', fileURLToPath(new URL('../public/data/stations.json', import.meta.url)))
const OUT_PATH = argValue('--out', fileURLToPath(new URL('../src/demoStations.js', import.meta.url)))

const snapshot = JSON.parse(readFileSync(IN_PATH, 'utf8'))
const updateMs = new Date(snapshot.updateTime).getTime()
if (Number.isNaN(updateMs)) throw new Error(`snapshot updateTime is unparseable: ${snapshot.updateTime}`)

const rows = []
for (const s of snapshot.stations) {
  const readingMs = new Date(s.dominantMetricTime).getTime()
  if (Number.isNaN(readingMs)) continue // no usable lag to preserve
  rows.push({
    id: s.id,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    kecamatan: s.kecamatan ?? null,
    kota: s.kota ?? null,
    // Minutes this station's reading trailed the snapshot's update time.
    lagMinutes: Math.max(0, Math.round((updateMs - readingMs) / 60000)),
  })
}

if (rows.length < 20) {
  throw new Error(`only ${rows.length} stations survived — refusing to write a truncated demo set`)
}

const lags = rows.map((r) => r.lagMinutes).sort((a, b) => a - b)
const lcsCount = rows.filter((r) => r.name.startsWith('LCS-')).length

const body = rows
  .map(
    (r) =>
      `  { id: ${JSON.stringify(r.id)}, name: ${JSON.stringify(r.name)}, lat: ${r.lat}, lng: ${r.lng}, ` +
      `kecamatan: ${JSON.stringify(r.kecamatan)}, kota: ${JSON.stringify(r.kota)}, lagMinutes: ${r.lagMinutes} },`,
  )
  .join('\n')

const file = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/gen-demo-stations.mjs
//
// A frozen copy of the Udara Jakarta station list, bundled so demo mode can run
// the real station-selection path with zero network access. Station identity is
// real; only the readings and the clock are fabricated at runtime. See
// src/useDemoStations.js for how these rows become a snapshot.
//
// Source snapshot: ${snapshot.fetchedAt} (source update time ${snapshot.updateTime})
// ${rows.length} stations — ${lcsCount} LCS (Tier B), ${rows.length - lcsCount} other (Tier A)
// Reading lag behind the source update time: min ${lags[0]}min, median ${lags[Math.floor(lags.length / 2)]}min, max ${lags[lags.length - 1]}min

export const DEMO_SNAPSHOT_META = {
  fetchedAt: ${JSON.stringify(snapshot.fetchedAt)},
  sourceUpdateTime: ${JSON.stringify(snapshot.updateTime)},
  source: ${JSON.stringify(snapshot.source ?? 'Udara Jakarta — Dinas Lingkungan Hidup DKI Jakarta')},
}

/**
 * Real stations, minus their readings. \`lagMinutes\` is how far behind the
 * source's own update time each station's reading was, preserved per station so
 * the demo reproduces the real reporting pattern rather than an average of it.
 */
export const DEMO_STATION_ROWS = [
${body}
]
`

writeFileSync(OUT_PATH, file)
console.log(`Wrote ${OUT_PATH}`)
console.log(`  ${rows.length} stations (${lcsCount} LCS / ${rows.length - lcsCount} other)`)
console.log(`  lag min ${lags[0]}min, median ${lags[Math.floor(lags.length / 2)]}min, max ${lags[lags.length - 1]}min`)
