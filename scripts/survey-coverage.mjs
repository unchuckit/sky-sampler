#!/usr/bin/env node
// Surveys Indonesian urban areas for sensor coverage dense enough to support a
// locally-specific cyanometer. Standalone — touches no app code.
//
// Ranking is by GRID-CELL SPREAD, not station count. Ten sensors clustered in
// one subdistrict is not coverage; four spread across a city is. A city earns a
// cyanometer when a person in any district can get a reading from their own
// area.
//
// Usage: AQICN_TOKEN=xxxx node scripts/survey-coverage.mjs
//    or: node scripts/survey-coverage.mjs <token>

import { writeFileSync } from 'node:fs'
import {
  sweepBox,
  fetchStationFeed,
  requireToken,
  hasLiveAqi,
  numericAqi,
  tierForAttributions,
} from './lib/aqicn.mjs'
import { median } from '../src/stationSelection.js'

const TOKEN = requireToken(process.argv[2])
const GRID = 4 // 4×4 spread analysis per metro
const SWEEP_TILES = 4

// Metro bounding boxes: { lat1, lng1 } bottom-left → { lat2, lng2 } top-right.
const CITIES = [
  { name: 'Jabodetabek', box: { lat1: -6.95, lng1: 106.35, lat2: -5.95, lng2: 107.15 }, note: 'baseline — current cyanometer target' },
  { name: 'Bandung', box: { lat1: -7.05, lng1: 107.45, lat2: -6.75, lng2: 107.75 } },
  { name: 'Surabaya', box: { lat1: -7.42, lng1: 112.60, lat2: -7.15, lng2: 112.90 } },
  { name: 'Yogyakarta', box: { lat1: -7.95, lng1: 110.25, lat2: -7.65, lng2: 110.52 } },
  { name: 'Semarang', box: { lat1: -7.12, lng1: 110.30, lat2: -6.90, lng2: 110.55 } },
  { name: 'Denpasar', box: { lat1: -8.80, lng1: 115.10, lat2: -8.55, lng2: 115.32 } },
  { name: 'Makassar', box: { lat1: -5.25, lng1: 119.35, lat2: -5.05, lng2: 119.58 } },
  { name: 'Malang', box: { lat1: -8.30, lng1: 112.35, lat2: -7.80, lng2: 112.90 } },
  { name: 'Medan', box: { lat1: 3.45, lng1: 98.55, lat2: 3.78, lng2: 98.82 } },
  { name: 'Palembang', box: { lat1: -3.10, lng1: 104.60, lat2: -2.85, lng2: 104.90 } },
  { name: 'Banyuwangi', box: { lat1: -8.35, lng1: 114.15, lat2: -8.05, lng2: 114.45 } },
  { name: 'Balikpapan', box: { lat1: -1.35, lng1: 116.75, lat2: -1.10, lng2: 117.00 } },
  { name: 'Pekanbaru', box: { lat1: 0.35, lng1: 101.30, lat2: 0.60, lng2: 101.60 } },
]

// Subdistricts where dense low-cost coverage is known to sit in agricultural
// rather than urban land. The pollution signature there is seasonal biomass
// burning, not traffic haze — still a strong cyanometer candidate, but for a
// different artifact with different zone thresholds and a different seasonal
// argument. Kept as a separate category rather than merged into the ranking.
const AGRICULTURAL_MARKERS = [
  'pagak',
  'sumberejo',
  'tlogorejo',
  'krebet',
  'bakalan',
  'sumberpucung',
  'kepanjen',
]

function isAgricultural(stationName) {
  const n = String(stationName).toLowerCase()
  return AGRICULTURAL_MARKERS.some((m) => n.includes(m))
}

function gridCellsCovered(box, stations) {
  const cells = new Set()
  for (const s of stations) {
    const i = Math.min(GRID - 1, Math.floor(((s.lat - box.lat1) / (box.lat2 - box.lat1)) * GRID))
    const j = Math.min(GRID - 1, Math.floor(((s.lng - box.lng1) / (box.lng2 - box.lng1)) * GRID))
    if (i >= 0 && j >= 0) cells.add(`${i},${j}`)
  }
  return cells.size
}

async function surveyCity(city) {
  const { stations: raw } = await sweepBox(TOKEN, city.box, SWEEP_TILES)

  const enriched = []
  for (const s of raw) {
    const feed = await fetchStationFeed(TOKEN, s.uid)
    const attributionNames = (feed?.attributions ?? []).map((a) => a.name)
    const { tier, network } = tierForAttributions(attributionNames)
    enriched.push({
      uid: s.uid,
      name: s.station?.name ?? `uid ${s.uid}`,
      lat: s.lat,
      lng: s.lon,
      aqi: numericAqi(s.aqi),
      live: hasLiveAqi(s.aqi),
      tier,
      network,
      agricultural: isAgricultural(s.station?.name ?? ''),
    })
  }

  const live = enriched.filter((s) => s.live)
  const tierBreakdown = { A: 0, B: 0, C: 0 }
  for (const s of live) tierBreakdown[s.tier]++

  const networks = {}
  for (const s of live) networks[s.network] = (networks[s.network] ?? 0) + 1
  const dominantNetwork =
    Object.entries(networks).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const agriculturalLive = live.filter((s) => s.agricultural)

  return {
    city: city.name,
    note: city.note ?? null,
    box: city.box,
    totalStations: enriched.length,
    liveStations: live.length,
    tierBreakdown,
    gridCellsCovered: gridCellsCovered(city.box, live),
    gridCellsTotal: GRID * GRID,
    medianAqi: live.length ? median(live.map((s) => s.aqi)) : null,
    dominantNetwork,
    agriculturalClusterCount: agriculturalLive.length,
    agriculturalDominant: live.length > 0 && agriculturalLive.length / live.length > 0.5,
    stations: enriched,
  }
}

async function main() {
  console.log('Sky Sampler — Indonesian coverage survey')
  console.log(`Ranking by ${GRID}×${GRID} grid-cell spread, not station count.\n`)

  const results = []
  for (const city of CITIES) {
    process.stdout.write(`  sweeping ${city.name.padEnd(14)}`)
    const r = await surveyCity(city)
    results.push(r)
    console.log(
      `${r.liveStations}/${r.totalStations} live, ${r.gridCellsCovered}/${r.gridCellsTotal} cells`,
    )
  }

  const urban = results.filter((r) => !r.agriculturalDominant)
  const agricultural = results.filter((r) => r.agriculturalDominant)

  const rank = (a, b) =>
    b.gridCellsCovered - a.gridCellsCovered || b.liveStations - a.liveStations
  urban.sort(rank)
  agricultural.sort(rank)

  const printTable = (rows, title) => {
    console.log(`\n${title}`)
    console.log('─'.repeat(94))
    console.log(
      'City'.padEnd(14) +
        'Cells'.padEnd(8) +
        'Live'.padEnd(7) +
        'Total'.padEnd(7) +
        'A/B/C'.padEnd(10) +
        'Med AQI'.padEnd(9) +
        'Dominant network',
    )
    console.log('─'.repeat(94))
    if (!rows.length) {
      console.log('  (none)')
      return
    }
    for (const r of rows) {
      console.log(
        r.city.padEnd(14) +
          `${r.gridCellsCovered}/${r.gridCellsTotal}`.padEnd(8) +
          String(r.liveStations).padEnd(7) +
          String(r.totalStations).padEnd(7) +
          `${r.tierBreakdown.A}/${r.tierBreakdown.B}/${r.tierBreakdown.C}`.padEnd(10) +
          String(r.medianAqi ?? '—').padEnd(9) +
          (r.dominantNetwork ?? '—'),
      )
    }
  }

  printTable(urban, 'URBAN / TRAFFIC-HAZE CANDIDATES (ranked by grid-cell coverage)')
  printTable(
    agricultural,
    'AGRICULTURAL-CLUSTER CANDIDATES (seasonal burning signature — separate artifact, different zone thresholds)',
  )

  const viable = urban.filter((r) => r.gridCellsCovered >= 4)
  console.log(
    `\n${viable.length} urban area(s) reach 4+ of ${GRID * GRID} grid cells — the rough floor for ` +
      'a cyanometer where any district can get a local reading.',
  )
  if (!viable.length) {
    console.log(
      'No surveyed city currently clears that bar on this AQICN token. That is a finding about\n' +
        'what this token can see, not proof the sensors are absent — see README.',
    )
  }

  writeFileSync(
    'coverage-survey.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        gridSize: GRID,
        sweepTiles: SWEEP_TILES,
        method: 'tiled map/bounds sweep, de-duplicated by uid',
        rankedUrban: urban.map(({ stations, ...rest }) => rest),
        agriculturalClusters: agricultural.map(({ stations, ...rest }) => rest),
        stationsByCity: Object.fromEntries(results.map((r) => [r.city, r.stations])),
      },
      null,
      2,
    ),
  )
  console.log('\nWrote coverage-survey.json')
}

main().catch((err) => {
  console.error('survey-coverage failed:', err.message)
  process.exit(1)
})
