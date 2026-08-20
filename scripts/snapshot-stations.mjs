#!/usr/bin/env node
// Takes a snapshot of Udara Jakarta station data and writes it to
// public/data/stations.json, which Vite copies into the build unmodified.
//
// Why a snapshot rather than a live fetch or a proxy:
//   - udara.jakarta.go.id sends no Access-Control-Allow-Origin header, so a
//     browser cannot fetch it directly.
//   - A server-side proxy would need Cloud Functions, which need the Blaze
//     plan; this project is on Spark, which blocks outbound non-Google requests.
//   - Serving the file from our own origin removes CORS entirely, creates no
//     public endpoint to abuse, and sends a fixed number of requests per day to
//     a government server regardless of how many people use the app.
//
// The cost is freshness, which is handled honestly downstream: the app gates on
// each station's own `dominantMetricTime` (an absolute timestamp, so unaffected
// by snapshot delay) and separately surfaces the age of the snapshot itself.
//
// Usage: node scripts/snapshot-stations.mjs [--out path] [--dry-run]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { toJakartaIso } from '../src/time.js'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://udara.jakarta.go.id/'
const DEFAULT_OUT = fileURLToPath(new URL('../public/data/stations.json', import.meta.url))

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const OUT_PATH = outIndex !== -1 ? args[outIndex + 1] : DEFAULT_OUT
const DRY_RUN = args.includes('--dry-run')

// Indonesia's bounding box, used to reject coordinates that parsed but are
// obviously not stations — a defence against the page's structure changing
// under us in a way that still happens to yield numbers.
const INDONESIA_BBOX = { latMin: -11.5, latMax: 6.5, lngMin: 94.5, lngMax: 141.5 }

const MIN_STATIONS = 20 // a healthy fetch returns ~97; far below that means something broke
const MAX_RAW_VALUE = 1000 // µg/m³ — beyond this the reading is not a measurement

class SnapshotError extends Error {}

/**
 * Pull a global assignment out of the page HTML.
 *
 * Deliberately regex-locate-then-JSON.parse. The page is someone else's HTML
 * and could be changed or compromised at any time; `eval` or `new Function`
 * would execute whatever it contained with our credentials in CI. JSON.parse
 * cannot execute anything.
 */
function extractJsonAssignment(html, varName, { open, close }) {
  const marker = `${varName}`
  const at = html.indexOf(marker)
  if (at === -1) throw new SnapshotError(`${varName} not found in page HTML`)

  const eq = html.indexOf('=', at + marker.length)
  if (eq === -1) throw new SnapshotError(`${varName} found but has no assignment`)

  const start = html.indexOf(open, eq)
  if (start === -1) throw new SnapshotError(`${varName} assignment has no opening "${open}"`)

  // Brace/bracket matching that respects string literals and escapes, so a
  // "]" inside a station name cannot truncate the payload.
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        const raw = html.slice(start, i + 1)
        try {
          return JSON.parse(raw)
        } catch (err) {
          throw new SnapshotError(`${varName} did not parse as JSON: ${err.message}`)
        }
      }
    }
  }
  throw new SnapshotError(`${varName} assignment is unterminated`)
}

function extractStringAssignment(html, varName) {
  const m = html.match(new RegExp(`${varName}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

function validateStations(stations) {
  if (!Array.isArray(stations)) throw new SnapshotError('__SPKU_DATA__ is not an array')
  if (stations.length === 0) throw new SnapshotError('__SPKU_DATA__ is empty')
  if (stations.length < MIN_STATIONS) {
    throw new SnapshotError(
      `only ${stations.length} stations returned (expected at least ${MIN_STATIONS}) — refusing to ship a truncated snapshot`,
    )
  }

  const usable = []
  const rejected = []

  for (const s of stations) {
    const problems = []
    if (typeof s?.id !== 'string' || !s.id) problems.push('missing id')
    if (typeof s?.name !== 'string' || !s.name) problems.push('missing name')
    if (typeof s?.lat !== 'number' || Number.isNaN(s.lat)) problems.push('lat not numeric')
    if (typeof s?.lng !== 'number' || Number.isNaN(s.lng)) problems.push('lng not numeric')

    if (problems.length === 0) {
      const { latMin, latMax, lngMin, lngMax } = INDONESIA_BBOX
      if (s.lat < latMin || s.lat > latMax || s.lng < lngMin || s.lng > lngMax) {
        problems.push(`coords outside Indonesia (${s.lat}, ${s.lng})`)
      }
    }

    // A station with no current reading is kept in the file — it is still a real
    // station and the app's freshness gate will reject it on its own terms. What
    // is rejected here is a reading that is present but nonsensical.
    if (s?.dominantRawValue != null) {
      const v = Number(s.dominantRawValue)
      if (Number.isNaN(v) || v < 0 || v > MAX_RAW_VALUE) {
        problems.push(`dominantRawValue out of range (${s.dominantRawValue})`)
      }
    }
    if (s?.dominantMetricTime != null) {
      if (Number.isNaN(new Date(s.dominantMetricTime).getTime())) {
        problems.push(`dominantMetricTime unparseable (${s.dominantMetricTime})`)
      }
    }

    if (problems.length) rejected.push({ name: s?.name ?? '(unnamed)', problems })
    else usable.push(s)
  }

  // Individual bad rows are tolerable and are dropped with a note. A payload
  // where most rows are bad means the structure changed, and shipping that
  // would be worse than shipping nothing.
  if (usable.length < MIN_STATIONS) {
    throw new SnapshotError(
      `only ${usable.length} of ${stations.length} stations passed validation — structure has likely changed`,
    )
  }

  const withReadings = usable.filter(
    (s) => typeof s.dominantRawValue === 'number' && s.dominantMetricTime,
  )
  if (withReadings.length === 0) {
    throw new SnapshotError('no station carries both a reading and a timestamp')
  }

  return { usable, rejected, withReadings: withReadings.length }
}

// Only the fields the app actually uses are kept. `ispu` is deliberately
// dropped at the boundary so it cannot be used downstream by accident.
function projectStation(s) {
  return {
    id: s.id,
    name: s.name,
    initial: s.initial ?? null,
    lat: s.lat,
    lng: s.lng,
    kecamatan: s.kecamatan ?? null,
    kecamatanID: s.kecamatanID ?? null,
    kota: s.kota ?? null,
    dominantMetric: s.dominantMetric ?? null,
    dominantRawValue: typeof s.dominantRawValue === 'number' ? s.dominantRawValue : null,
    // Pinned to +07:00 on the way in, so no reader has to guess.
    dominantMetricTime: toJakartaIso(s.dominantMetricTime),
  }
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}`)
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'sky-sampler-snapshot/1.0 (+https://sky-sampler.web.app)' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new SnapshotError(`source returned HTTP ${res.status}`)
  const html = await res.text()
  console.log(`  received ${html.length} bytes`)

  const rawStations = extractJsonAssignment(html, '__SPKU_DATA__', { open: '[', close: ']' })
  const { usable, rejected, withReadings } = validateStations(rawStations)

  console.log(`  parsed ${rawStations.length} stations, ${usable.length} passed validation`)
  console.log(`  ${withReadings} carry a usable reading`)
  if (rejected.length) {
    console.log(`  dropped ${rejected.length}:`)
    for (const r of rejected.slice(0, 10)) console.log(`    - ${r.name}: ${r.problems.join('; ')}`)
  }

  const updateTime = extractStringAssignment(html, '__SPKU_UPDATE_TIME__')
  if (!updateTime) throw new SnapshotError('__SPKU_UPDATE_TIME__ not found')
  console.log(`  source update time: ${updateTime}`)

  // City-level meteorology is a nice-to-have, so a failure here degrades to null
  // rather than failing the run.
  let cityMeteo = null
  try {
    const silam = extractJsonAssignment(html, '__SILAM_DATA__', { open: '{', close: '}' })
    const m = silam?.currentMeteo
    if (m) {
      cityMeteo = {
        relativeHumidity: m.relativeHumidity ?? null,
        blh: m.blh ?? null,
        skinTemperature: m.skinTemperature ?? null,
      }
    }
  } catch (err) {
    console.log(`  note: __SILAM_DATA__ unavailable (${err.message}) — continuing without it`)
  }

  const payload = {
    stations: usable.map(projectStation),
    updateTime: toJakartaIso(updateTime),
    updateTimeRaw: updateTime,
    cityMeteo,
    fetchedAt: new Date().toISOString(),
    source: 'Udara Jakarta — Dinas Lingkungan Hidup DKI Jakarta',
    sourceUrl: SOURCE_URL,
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing. Payload summary:')
    console.log(`  stations: ${payload.stations.length}`)
    console.log(`  updateTime: ${payload.updateTime}`)
    console.log(`  cityMeteo: ${JSON.stringify(payload.cityMeteo)}`)
    return
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })

  // Written only after every check has passed. If anything above threw, the
  // process exits non-zero with the previous good file untouched, so the
  // deployed site keeps serving known-good data instead of erroring live.
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${OUT_PATH}`)
}

main().catch((err) => {
  const isKnown = err instanceof SnapshotError
  console.error(`\nSnapshot failed${isKnown ? '' : ' unexpectedly'}: ${err.message}`)
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
      console.error(`Previous snapshot left in place (fetched ${prev.fetchedAt}). Nothing was overwritten.`)
    } catch {
      console.error('Previous snapshot left in place. Nothing was overwritten.')
    }
  }
  process.exit(1)
})
