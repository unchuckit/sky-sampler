import { useCallback, useEffect, useMemo, useState } from 'react'

// Sampling areas — places a person stands and photographs the sky from.
//
// THE PRIVACY MODEL, because it is the reason this file looks the way it does:
// an area is created from a GPS reading or a district centroid, those
// coordinates are used ONCE to resolve the nearest qualifying station, and then
// they are thrown away. What persists is the station attachment and the distance
// to it — enough to reconstruct every provenance decision, and nothing more.
//
// No latitude or longitude is ever written to localStorage, to an export, or to
// the URL. An area reads as "Pondok Indah · Lebak Bulus · 2.1km · High".
//
// distanceKm is rounded to one decimal on purpose. A ring of known radius around
// a known station already narrows a position; a second decimal tightens that
// ring for no analytical gain, since the confidence bands are kilometres wide.

// Deliberately a different key from the sample log: a corrupted or half-written
// location list must never be able to take the samples down with it.
const STORAGE_KEY = 'sky-sampler-locations'

export const COORDINATE_SOURCE = {
  GPS: 'gps',
  DISTRICT_CENTROID: 'district-centroid',
}

/**
 * Strip anything coordinate-shaped on the way in.
 *
 * V2.1 stored lat/lng on every area. Those records are migrated on load: the
 * coordinates are dropped, and the area is marked as needing a re-check so its
 * station attachment can be re-resolved deliberately rather than silently.
 */
function sanitise(area) {
  const { lat, lng, guidance, ...rest } = area
  const hadCoordinates = typeof lat === 'number' || typeof lng === 'number'
  return {
    ...rest,
    active: area.active !== false,
    coordinateSource: area.coordinateSource ?? (hadCoordinates ? COORDINATE_SOURCE.GPS : null),
    // A migrated area has no station attachment yet — it was resolved live from
    // coordinates in the old model.
    needsRecheck: area.needsRecheck ?? (hadCoordinates && !area.stationUid),
    stationUid: area.stationUid ?? null,
    stationName: area.stationName ?? null,
    distanceKm: area.distanceKm ?? null,
    confidenceBand: area.confidenceBand ?? null,
    tier: area.tier ?? null,
  }
}

function loadLocations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitise)
  } catch {
    return []
  }
}

function persist(locations) {
  try {
    // Belt and braces: even if a coordinate were somehow set on an object in
    // memory, it does not reach storage.
    const safe = locations.map(({ lat, lng, ...rest }) => rest)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
  } catch (err) {
    console.error('Failed to save sampling areas:', err)
  }
}

function slugify(label) {
  return (
    String(label)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `area-${Date.now()}`
  )
}

export function useLocations({ enabled = true } = {}) {
  const [locations, setLocations] = useState(() => (enabled ? loadLocations() : []))

  useEffect(() => {
    if (!enabled) return // demo mode must never write to the real store
    persist(locations)
  }, [locations, enabled])

  /**
   * Create an area from an already-resolved station attachment.
   * The caller resolves coordinates → station and does not pass coordinates here.
   */
  const addLocation = useCallback(
    ({ label, stationUid, stationName, distanceKm, confidenceBand, tier, coordinateSource }) => {
      const base = slugify(label)
      const area = {
        label: String(label).trim(),
        stationUid: stationUid ?? null,
        stationName: stationName ?? null,
        distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
        confidenceBand: confidenceBand ?? null,
        tier: tier ?? null,
        coordinateSource: coordinateSource ?? null,
        needsRecheck: false,
        active: true,
      }
      setLocations((prev) => {
        let id = base
        let n = 2
        while (prev.some((l) => l.id === id)) id = `${base}-${n++}`
        return [...prev, { id, ...area }]
      })
    },
    [],
  )

  const renameLocation = useCallback((id, label) => {
    setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, label: String(label).trim() } : l)))
  }, [])

  /** Re-resolve an area's station from a fresh reading, then discard it again. */
  const rebindLocation = useCallback((id, { stationUid, stationName, distanceKm, confidenceBand, tier, coordinateSource }) => {
    setLocations((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              stationUid: stationUid ?? null,
              stationName: stationName ?? null,
              distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
              confidenceBand: confidenceBand ?? null,
              tier: tier ?? null,
              coordinateSource: coordinateSource ?? l.coordinateSource,
              needsRecheck: false,
            }
          : l,
      ),
    )
  }, [])

  /**
   * Retire rather than delete when samples exist. A logged sample must never be
   * orphaned from the place it was taken — the area stays on record, just
   * inactive and out of the capture picker.
   */
  const removeLocation = useCallback((id, { hasSamples }) => {
    setLocations((prev) =>
      hasSamples
        ? prev.map((l) => (l.id === id ? { ...l, active: false } : l))
        : prev.filter((l) => l.id !== id),
    )
  }, [])

  const reactivateLocation = useCallback((id) => {
    setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, active: true } : l)))
  }, [])

  const replaceAll = useCallback((next) => setLocations(next.map(sanitise)), [])

  const activeLocations = useMemo(() => locations.filter((l) => l.active), [locations])
  const getLocationById = useCallback((id) => locations.find((l) => l.id === id) ?? null, [locations])

  return {
    locations,
    activeLocations,
    addLocation,
    renameLocation,
    rebindLocation,
    removeLocation,
    reactivateLocation,
    replaceAll,
    getLocationById,
  }
}

/**
 * One-shot GPS reading. Used to resolve a station, then discarded by the caller.
 * Never stored, never logged.
 */
export function getCurrentPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not available on this device'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const messages = {
          1: 'Location access denied',
          2: 'Location unavailable',
          3: 'Location timed out',
        }
        reject(new Error(messages[err.code] ?? 'Could not get location'))
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
}
