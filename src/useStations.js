import { useCallback, useEffect, useMemo, useState } from 'react'
import { TIERS, SNAPSHOT_STALE_MINUTES, SNAPSHOT_UNUSABLE_HOURS } from './constants'
import { pm25ToAqi } from './aqi'
import { computeNeighbourDeviations } from './stationSelection'

const SNAPSHOT_URL = '/data/stations.json'

// Udara Jakarta distinguishes station types in the name prefix, and their own
// FAQ states the difference: SPKU units are officially calibrated government
// instruments suitable as a policy basis; LCS (Low-Cost Sensor) units extend
// coverage but have different accuracy and are not a policy basis on their own.
export function tierForStationName(name) {
  return String(name ?? '').startsWith('LCS-') ? TIERS.B : TIERS.A
}

/**
 * Map a snapshot row into the shape stationSelection expects.
 *
 * AQI is computed from `dominantRawValue` via US EPA breakpoints. The payload's
 * own `ispu` field is not used anywhere — it is a long-window average and does
 * not correspond to the instantaneous value a photograph needs. It is already
 * stripped in the snapshot script; this is the second line of defence.
 */
function projectStation(raw) {
  const pm25 = typeof raw.dominantRawValue === 'number' ? raw.dominantRawValue : null
  return {
    uid: raw.id,
    name: raw.name,
    lat: raw.lat,
    lng: raw.lng,
    kecamatan: raw.kecamatan ?? null,
    kota: raw.kota ?? null,
    pm25,
    aqi: pm25 == null ? null : pm25ToAqi(pm25),
    tier: tierForStationName(raw.name),
    network: 'Udara Jakarta',
    lastSeen: raw.dominantMetricTime ?? null,
  }
}

export function useStations({ enabled = true } = {}) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const res = await fetch(SNAPSHOT_URL, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`snapshot returned HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data?.stations)) throw new Error('snapshot is malformed')
      setSnapshot(data)
      setError(null)
    } catch (err) {
      setSnapshot(null)
      setError('Air quality data unavailable')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    load()
  }, [load])

  // Drives the snapshot-age display without needing a reload.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const stations = useMemo(() => {
    if (!snapshot) return []
    const projected = snapshot.stations.map(projectStation).filter((s) => s.aqi != null)
    // Neighbour-median deviation was inert in V2.1 with a single station. With
    // ~97 simultaneous readings it does real work, so it runs here once and the
    // result is reused for every location's selection.
    return computeNeighbourDeviations(projected)
  }, [snapshot])

  // Two independent clocks, and both matter.
  //
  //   Station reading age — each station's own `dominantMetricTime`, an absolute
  //   timestamp, handled by the freshness gate in stationSelection. Unaffected by
  //   snapshot delay.
  //
  //   Snapshot age — how long ago the whole file was taken. This is the safety
  //   net for the workflow failing silently for hours, which the per-station gate
  //   cannot detect on its own.
  const snapshotAgeMinutes = useMemo(() => {
    if (!snapshot?.fetchedAt) return null
    const t = new Date(snapshot.fetchedAt).getTime()
    if (Number.isNaN(t)) return null
    return Math.max(0, Math.round((now - t) / 60000))
  }, [snapshot, now])

  const snapshotUnusable =
    snapshotAgeMinutes != null && snapshotAgeMinutes > SNAPSHOT_UNUSABLE_HOURS * 60

  const showSnapshotAge =
    snapshotAgeMinutes != null && snapshotAgeMinutes >= SNAPSHOT_STALE_MINUTES && !snapshotUnusable

  const snapshotAgeLabel = useMemo(() => {
    if (snapshotAgeMinutes == null) return null
    if (snapshotAgeMinutes < 90) return null
    const hours = Math.round(snapshotAgeMinutes / 60)
    return `Air quality data from ${hours} hour${hours === 1 ? '' : 's'} ago`
  }, [snapshotAgeMinutes])

  // Districts for the "pick a district" path, deduplicated across the snapshot
  // and grouped by kota so the list is scannable.
  const districts = useMemo(() => {
    if (!snapshot) return []
    const byKey = new Map()
    for (const s of snapshot.stations) {
      if (!s.kecamatan) continue
      const key = `${s.kota ?? ''}|${s.kecamatan}`
      if (!byKey.has(key)) {
        byKey.set(key, { kecamatan: s.kecamatan, kota: s.kota ?? 'Unknown', lats: [], lngs: [] })
      }
      const d = byKey.get(key)
      if (typeof s.lat === 'number' && typeof s.lng === 'number') {
        d.lats.push(s.lat)
        d.lngs.push(s.lng)
      }
    }
    return [...byKey.values()]
      .map((d) => ({
        kecamatan: d.kecamatan,
        kota: d.kota,
        // Centroid of the district's own stations — an approximation, and
        // labelled as such wherever it is used.
        lat: d.lats.length ? d.lats.reduce((a, b) => a + b, 0) / d.lats.length : null,
        lng: d.lngs.length ? d.lngs.reduce((a, b) => a + b, 0) / d.lngs.length : null,
      }))
      .filter((d) => d.lat != null)
      .sort((a, b) => a.kota.localeCompare(b.kota) || a.kecamatan.localeCompare(b.kecamatan))
  }, [snapshot])

  return {
    stations: snapshotUnusable ? [] : stations,
    allStations: stations,
    districts,
    loading,
    error,
    reload: load,
    snapshot,
    snapshotAgeMinutes,
    snapshotAgeLabel,
    showSnapshotAge,
    snapshotUnusable,
    updateTime: snapshot?.updateTime ?? null,
    cityMeteo: snapshot?.cityMeteo ?? null,
    attribution: snapshot?.source ?? 'Udara Jakarta — Dinas Lingkungan Hidup DKI Jakarta',
  }
}
