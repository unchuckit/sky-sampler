#!/usr/bin/env node
// Backfills logged AQI values against OpenAQ PM2.5 measurements for review —
// it never overwrites the log itself. Scoped to Depok samples per the original
// request (the four pre-existing samples are all "Depok — Backyard"); samples
// tagged to other locations are reported as out of scope, not silently skipped.
//
// Usage:
//   OPENAQ_API_KEY=xxxx node scripts/backfill-aqi.js log.txt --near "-6.40,106.79"
//
// The --near coordinate is passed at run time and never committed.
//
// Get a free key at https://explore.openaq.org/register

import { readFileSync, writeFileSync } from 'node:fs'

const API_KEY = process.env.OPENAQ_API_KEY
// Coordinates are supplied at run time, never committed. This repo is public,
// and a sampling location baked into a script is a home address in git history
// forever. Pass --near "<lat>,<lng>" for the area you are backfilling.
const NEAR = (() => {
  const i = process.argv.indexOf('--near')
  if (i === -1 || !process.argv[i + 1]) return null
  const [lat, lng] = process.argv[i + 1].split(',').map(Number)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return { lat, lng }
})()
const SEARCH_RADIUS_M = 25000
const WINDOW_HOURS = 1

// --- EPA PM2.5 (24-hr) → US AQI breakpoint table -----------------------------
// Explicit, not a magic formula. Source: US EPA "Technical Assistance Document
// for the Reporting of Daily Air Quality" (AQI breakpoints, PM2.5 in µg/m³).
const PM25_BREAKPOINTS = [
  { cLow: 0.0, cHigh: 12.0, aqiLow: 0, aqiHigh: 50 },
  { cLow: 12.1, cHigh: 35.4, aqiLow: 51, aqiHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, aqiLow: 101, aqiHigh: 150 },
  { cLow: 55.5, cHigh: 150.4, aqiLow: 151, aqiHigh: 200 },
  { cLow: 150.5, cHigh: 250.4, aqiLow: 201, aqiHigh: 300 },
  { cLow: 250.5, cHigh: 350.4, aqiLow: 301, aqiHigh: 400 },
  { cLow: 350.5, cHigh: 500.4, aqiLow: 401, aqiHigh: 500 },
]

function pm25ToAqi(pm25) {
  const bp = PM25_BREAKPOINTS.find((b) => pm25 >= b.cLow && pm25 <= b.cHigh)
  if (!bp) return null // above 500.4 µg/m³ — outside the defined table entirely
  const { cLow, cHigh, aqiLow, aqiHigh } = bp
  return Math.round(((aqiHigh - aqiLow) / (cHigh - cLow)) * (pm25 - cLow) + aqiLow)
}

// --- Log parsing (accepts the app's .txt export, or a raw JSON sample array) -
function parseLog(raw) {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed)
    return Array.isArray(data) ? data : [data]
  }

  // Plain-text export format:
  // ---
  // Date: 8/4/2026
  // Time: 12:15 PM
  // Location: Depok — Backyard
  // AQI: 72 (Moderate)
  // Averaged hex: #91a7bf
  // ...
  const blocks = trimmed.split(/^---$/m).map((b) => b.trim()).filter(Boolean)
  return blocks.map((block) => {
    const get = (label) => block.match(new RegExp(`^${label}: (.+)$`, 'm'))?.[1]?.trim()
    const date = get('Date')
    const time = get('Time')
    const location = get('Location') || ''
    const aqiMatch = get('AQI')?.match(/^(\d+|n\/a)/)
    return {
      timestamp: date && time ? new Date(`${date} ${time}`) : null,
      location,
      aqi: aqiMatch && aqiMatch[1] !== 'n/a' ? Number(aqiMatch[1]) : null,
      averagedHex: get('Averaged hex'),
    }
  })
}

function isDepokSample(sample) {
  return /depok/i.test(sample.location || sample.locationId || '')
}

// --- OpenAQ v3 --------------------------------------------------------------
async function openaqFetch(path) {
  const res = await fetch(`https://api.openaq.org/v3${path}`, {
    headers: { 'X-API-Key': API_KEY },
  })
  if (res.status === 401) {
    throw new Error(
      'UNAUTHORIZED: OpenAQ rejected the request — OPENAQ_API_KEY is missing or invalid. ' +
        'Get a free key at https://explore.openaq.org/register and set OPENAQ_API_KEY.',
    )
  }
  if (!res.ok) throw new Error(`OpenAQ request failed: ${res.status} ${res.statusText}`)
  return res.json()
}

async function findDepokPm25Sensor() {
  const data = await openaqFetch(
    `/locations?coordinates=${NEAR.lat},${NEAR.lng}&radius=${SEARCH_RADIUS_M}&limit=10`,
  )
  const locations = data.results ?? []
  for (const loc of locations) {
    const pm25Sensor = (loc.sensors ?? []).find((s) => s.parameter?.name === 'pm25')
    if (pm25Sensor) return { location: loc, sensorId: pm25Sensor.id }
  }
  return null
}

async function findMeasurementNear(sensorId, timestamp) {
  const from = new Date(timestamp.getTime() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const to = new Date(timestamp.getTime() + WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const data = await openaqFetch(
    `/sensors/${sensorId}/measurements?datetime_from=${from}&datetime_to=${to}&limit=100`,
  )
  const results = data.results ?? []
  if (results.length === 0) return null
  const avgPm25 = results.reduce((sum, r) => sum + r.value, 0) / results.length
  return { avgPm25, count: results.length }
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: node scripts/backfill-aqi.js <exported-log.txt|log.json>')
    process.exit(1)
  }
  if (!NEAR) {
    console.error(
      'No location given. Pass the area you are backfilling:\n' +
        '  OPENAQ_API_KEY=xxxx node scripts/backfill-aqi.js log.txt --near "-6.40,106.79"\n' +
        'Coordinates are deliberately not stored in this repo.',
    )
    process.exit(1)
  }
  if (!API_KEY) {
    console.error(
      'No OPENAQ_API_KEY set. This script cannot query OpenAQ without one — ' +
        'get a free key at https://explore.openaq.org/register and re-run with ' +
        'OPENAQ_API_KEY=xxxx node scripts/backfill-aqi.js ' +
        inputPath,
    )
    process.exit(1)
  }

  const raw = readFileSync(inputPath, 'utf8')
  const samples = parseLog(raw)
  console.log(`Parsed ${samples.length} sample(s) from ${inputPath}.\n`)

  const depokSamples = samples.filter(isDepokSample)
  const outOfScope = samples.length - depokSamples.length
  if (outOfScope > 0) {
    console.log(`${outOfScope} sample(s) are not tagged Depok — out of scope for this script, skipping them.\n`)
  }

  let sensor
  try {
    sensor = await findDepokPm25Sensor()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  if (!sensor) {
    console.log(
      `OpenAQ has no PM2.5 station within ${SEARCH_RADIUS_M / 1000}km of Depok ` +
        `(${NEAR.lat}, ${NEAR.lng}). Cannot backfill — not falling back to a distant station.`,
    )
    writeFileSync('backfilled.json', JSON.stringify({ generatedAt: new Date().toISOString(), coverage: 'none', results: [] }, null, 2))
    return
  }
  console.log(`Using OpenAQ station "${sensor.location.name}" (sensor ${sensor.sensorId}) for PM2.5.\n`)

  const rows = []
  for (const sample of depokSamples) {
    if (!sample.timestamp || Number.isNaN(sample.timestamp.getTime())) {
      rows.push({ sample, status: 'skipped: no parseable timestamp' })
      continue
    }
    let measurement
    try {
      measurement = await findMeasurementNear(sensor.sensorId, sample.timestamp)
    } catch (err) {
      rows.push({ sample, status: `error: ${err.message}` })
      continue
    }
    if (!measurement) {
      rows.push({
        sample,
        status: `no PM2.5 measurement within ±${WINDOW_HOURS}h of ${sample.timestamp.toISOString()}`,
      })
      continue
    }
    const backfilledAqi = pm25ToAqi(measurement.avgPm25)
    rows.push({
      sample,
      status: 'ok',
      avgPm25: measurement.avgPm25,
      measurementCount: measurement.count,
      backfilledAqi,
      delta: sample.aqi != null && backfilledAqi != null ? backfilledAqi - sample.aqi : null,
    })
  }

  console.log('Timestamp                 Logged AQI  Backfilled AQI  Delta  Status')
  console.log('-'.repeat(90))
  for (const row of rows) {
    const ts = row.sample.timestamp ? row.sample.timestamp.toISOString() : 'unknown'
    const logged = row.sample.aqi ?? 'n/a'
    const backfilled = row.backfilledAqi ?? '—'
    const delta = row.delta != null ? (row.delta > 0 ? `+${row.delta}` : `${row.delta}`) : '—'
    console.log(
      `${ts.padEnd(26)} ${String(logged).padEnd(11)} ${String(backfilled).padEnd(15)} ${delta.padEnd(6)} ${row.status}`,
    )
  }

  writeFileSync(
    'backfilled.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        station: sensor.location.name,
        results: rows.map((r) => ({
          timestamp: r.sample.timestamp ? r.sample.timestamp.toISOString() : null,
          loggedAqi: r.sample.aqi ?? null,
          averagedHex: r.sample.averagedHex ?? null,
          backfilledAqi: r.backfilledAqi ?? null,
          avgPm25: r.avgPm25 ?? null,
          delta: r.delta ?? null,
          status: r.status,
        })),
      },
      null,
      2,
    ),
  )
  console.log('\nWrote backfilled.json for manual review. The log itself was not modified.')
}

main().catch((err) => {
  console.error('backfill-aqi failed:', err.message)
  process.exit(1)
})
