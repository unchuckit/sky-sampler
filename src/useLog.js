import { useCallback, useEffect, useMemo, useState } from 'react'
import { SAMPLE_GOAL, SAMPLE_ZONES, PROVENANCE, getSampleZone } from './constants'
import { averageHexLinear } from './colour'

const STORAGE_KEY = 'sky-sampler-log'

// One-time migrations, applied on load.
//
// 1. Samples logged before AQI provenance tracking have no `provenance` field.
//    Tag them unverified — their AQI numbers are untouched, but the station
//    they actually came from is no longer confirmable.
//
// 2. Samples logged before the colour pipeline was linearised have only the
//    naive (gamma-space) average. Where the 5 raw tap values survive we can
//    recompute correctly — `tapSamples` stores 6-digit hex, which *is* the
//    8-bit RGB, so nothing was lost. `averagedHex` is never overwritten; the
//    corrected value lands alongside it in `averagedHexLinear`. Samples with
//    no retained taps keep the old maths permanently and are marked
//    `linearCorrectable: false` so that stays visible rather than implied.
function migrateSamples(samples) {
  let changed = false
  const migrated = samples.map((s) => {
    const needsProvenance = !s.provenance || !Array.isArray(s.locationChanges)
    const needsColour = s.averagedHexLinear === undefined
    if (!needsProvenance && !needsColour) return s
    changed = true

    const taps = Array.isArray(s.tapSamples) ? s.tapSamples : []
    const correctable = taps.length > 0

    return {
      ...s,
      provenance: s.provenance ?? PROVENANCE.UNVERIFIED,
      locationChanges: Array.isArray(s.locationChanges) ? s.locationChanges : [],
      averagedHexLinear: correctable ? averageHexLinear(taps) : null,
      linearCorrectable: correctable,
    }
  })
  return { migrated, changed }
}

function loadSamples() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const { migrated, changed } = migrateSamples(parsed)
    if (changed) persistSamples(migrated)
    return migrated
  } catch (err) {
    return []
  }
}

function persistSamples(samples) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
  } catch (err) {
    console.error('Failed to save log to localStorage:', err)
  }
}

export function computeLogStats(samples) {
  const count = samples.length
  const aqis = samples.map((s) => s.aqi).filter((n) => typeof n === 'number')
  const aqiRange = aqis.length ? { min: Math.min(...aqis), max: Math.max(...aqis) } : null

  const zoneCoverage = SAMPLE_ZONES.map((zone) => ({
    ...zone,
    covered: samples.some((s) => getSampleZone(s.aqi)?.key === zone.key),
  }))

  return {
    count,
    goal: SAMPLE_GOAL,
    progress: Math.min(count / SAMPLE_GOAL, 1),
    aqiRange,
    zoneCoverage,
  }
}

export function useLog({ enabled = true } = {}) {
  const [samples, setSamples] = useState(() => (enabled ? loadSamples() : []))

  useEffect(() => {
    // Demo mode must never write to the real log.
    if (!enabled) return
    persistSamples(samples)
  }, [samples, enabled])

  const addSample = useCallback((sample) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      locationChanges: [],
      ...sample,
    }
    setSamples((prev) => [entry, ...prev])
    return entry
  }, [])

  const deleteSample = useCallback((id) => {
    setSamples((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const updateSample = useCallback((id, updater) => {
    setSamples((prev) => prev.map((s) => (s.id === id ? updater(s) : s)))
  }, [])

  const stats = useMemo(() => computeLogStats(samples), [samples])

  return { samples, addSample, deleteSample, updateSample, stats }
}
