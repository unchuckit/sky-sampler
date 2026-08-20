// Pure station-selection logic. Deliberately free of React and of any network
// access so it can be unit-tested directly (see scripts/test/station-selection.test.mjs)
// and reused by the build-time survey scripts.

import {
  MAX_STATION_RADIUS_KM,
  MAX_READING_AGE_HOURS,
  TIER_MULTIPLIERS,
  SUSPECT_MULTIPLIER,
  CLEAN_MULTIPLIER,
  NEIGHBOUR_RADIUS_KM,
  MIN_NEIGHBOURS_FOR_DEVIATION,
  SUSPECT_DEVIATION_THRESHOLD_PM25,
  INSTRUMENT_CEILINGS,
  REJECTION_REASONS,
  TIERS,
  confidenceBandFor,
} from './constants.js'
import { parseJakartaTimestamp } from './time.js'

const EARTH_RADIUS_KM = 6371

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * A reading sitting exactly on a known instrument ceiling is far more likely to
 * be pinned at its range limit than to be a measurement. This fires independently
 * of neighbour deviation, because a whole neighbourhood of pinned sensors would
 * agree with each other and defeat the median check.
 */
export function isAtInstrumentCeiling(pm25) {
  return typeof pm25 === 'number' && INSTRUMENT_CEILINGS.includes(pm25)
}

/**
 * For each station, compare its RAW PM2.5 against the median of its neighbours
 * within NEIGHBOUR_RADIUS_KM.
 *
 * The comparison is deliberately on the physical measurement rather than on
 * AQI — see SUSPECT_DEVIATION_THRESHOLD_PM25 in constants.js for why comparing
 * in AQI space produces false positives.
 *
 * Fewer than MIN_NEIGHBOURS_FOR_DEVIATION neighbours means the comparison is
 * meaningless: deviation is null and the station is never flagged on that basis.
 * Deviation from a single neighbour tells you nothing.
 *
 * Returns a new array; does not mutate the input.
 */
export function computeNeighbourDeviations(stations) {
  return stations.map((station) => {
    const ceilingPinned = isAtInstrumentCeiling(station.pm25)
    if (typeof station.pm25 !== 'number') {
      return { ...station, neighbourDeviation: null, suspect: ceilingPinned, ceilingPinned }
    }
    const neighbourValues = stations
      .filter((other) => {
        if (other.uid === station.uid) return false
        if (typeof other.pm25 !== 'number') return false
        return haversineKm(station.lat, station.lng, other.lat, other.lng) <= NEIGHBOUR_RADIUS_KM
      })
      .map((other) => other.pm25)

    if (neighbourValues.length < MIN_NEIGHBOURS_FOR_DEVIATION) {
      return { ...station, neighbourDeviation: null, suspect: ceilingPinned, ceilingPinned }
    }
    // Reported in µg/m³, matching the threshold's units.
    const deviation = Math.abs(station.pm25 - median(neighbourValues))
    return {
      ...station,
      neighbourDeviation: deviation,
      suspect: deviation > SUSPECT_DEVIATION_THRESHOLD_PM25 || ceilingPinned,
      ceilingPinned,
    }
  })
}

export function readingAgeHours(station, now = new Date()) {
  const raw = station.lastSeen ?? station.apiTimestamp
  if (!raw) return Infinity // no timestamp = cannot prove freshness = treat as stale
  // Source timestamps are Jakarta-local with no offset; parsing them as the
  // reader's local time would skew the age by the reader's UTC offset.
  const t = raw instanceof Date ? raw : parseJakartaTimestamp(raw)
  if (!t || Number.isNaN(t.getTime())) return Infinity
  return (now.getTime() - t.getTime()) / (1000 * 60 * 60)
}

export function scoreFor(distanceKm, tier, suspect) {
  const tierMultiplier = TIER_MULTIPLIERS[tier] ?? TIER_MULTIPLIERS[TIERS.C]
  const suspectMultiplier = suspect ? SUSPECT_MULTIPLIER : CLEAN_MULTIPLIER
  return distanceKm * tierMultiplier * suspectMultiplier
}

/**
 * Choose the station that best represents `location`, or none at all.
 *
 * Hard gates run first and are absolute — radius, then freshness. If nothing
 * passes, the answer is "no coverage", never "reach further out". Scoring only
 * ever runs among candidates that already passed both gates.
 *
 * @returns {{ chosen: object|null, selection: object }}
 */
export function selectStation(location, stations, now = new Date()) {
  const rejected = []
  const candidates = []
  let outOfRadiusCount = 0

  for (const station of stations) {
    const distanceKm = haversineKm(location.lat, location.lng, station.lat, station.lng)

    if (distanceKm > MAX_STATION_RADIUS_KM) {
      // Counted, not listed. With ~97 stations in the metro area most are simply
      // far away, and recording all of them on every sample would bloat
      // localStorage without telling anyone anything. The near-misses are what
      // matter for auditing a decision, and they are kept below.
      outOfRadiusCount++
      if (distanceKm <= MAX_STATION_RADIUS_KM * NEAR_MISS_FACTOR) {
        rejected.push({
          uid: station.uid,
          name: station.name,
          reason: REJECTION_REASONS.OUT_OF_RADIUS,
          distanceKm: round1(distanceKm),
        })
      }
      continue
    }
    if (readingAgeHours(station, now) > MAX_READING_AGE_HOURS) {
      rejected.push({
        uid: station.uid,
        name: station.name,
        reason: REJECTION_REASONS.STALE,
        distanceKm: round1(distanceKm),
      })
      continue
    }
    candidates.push({ station, distanceKm, score: scoreFor(distanceKm, station.tier, station.suspect) })
  }

  if (candidates.length === 0) {
    return {
      chosen: null,
      selection: {
        chosenUid: null,
        chosenName: null,
        tier: null,
        distanceKm: null,
        confidenceBand: null,
        neighbourDeviation: null,
        suspect: null,
        rejected: trimRejected(rejected),
        outOfRadiusCount,
      },
    }
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    // Tie-break on the more recent reading.
    return readingAgeHours(a.station, now) - readingAgeHours(b.station, now)
  })

  const [winner, ...losers] = candidates
  for (const loser of losers) {
    rejected.push({
      uid: loser.station.uid,
      name: loser.station.name,
      reason: REJECTION_REASONS.LOWER_SCORE,
      distanceKm: round1(loser.distanceKm),
      score: round2(loser.score),
    })
  }

  return {
    chosen: winner.station,
    selection: {
      chosenUid: winner.station.uid,
      chosenName: winner.station.name,
      tier: winner.station.tier,
      distanceKm: round1(winner.distanceKm),
      confidenceBand: confidenceBandFor(winner.distanceKm),
      neighbourDeviation:
        winner.station.neighbourDeviation == null ? null : round1(winner.station.neighbourDeviation),
      suspect: Boolean(winner.station.suspect),
      ceilingPinned: Boolean(winner.station.ceilingPinned),
      rejected: trimRejected(rejected),
      outOfRadiusCount,
    },
  }
}

// Only stations within this multiple of the radius gate are worth naming as
// near-misses; anything further is covered by outOfRadiusCount.
const NEAR_MISS_FACTOR = 1.5
const MAX_REJECTED_STORED = 8

function trimRejected(rejected) {
  // Keep the closest runners-up — those are the ones someone auditing a
  // decision would actually want to see.
  return [...rejected]
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    .slice(0, MAX_REJECTED_STORED)
}

function round1(n) {
  return Math.round(n * 10) / 10
}
function round2(n) {
  return Math.round(n * 100) / 100
}
