import { useCallback, useMemo } from 'react'
import { PROVENANCE, getAqiZone, MAX_STATION_RADIUS_KM } from './constants'
import { selectStation } from './stationSelection'

// AQI per sampling area, derived from the station snapshot.
//
// No network calls happen here at all — useStations loads a static same-origin
// file, and this hook does the selection maths over it. AQICN is gone entirely:
// its free tier surfaced one live station in the metro area, so two of three
// sampling areas resolved to no coverage.
//
// There is no demo branch in this file any more, and that is the point. Demo
// mode swaps the station source (useDemoStations) and the clock, and everything
// below runs unchanged — the same gates, the same scoring, the same bands. A
// demo that shortcut this would be demonstrating a code path that does not
// exist in the shipped app.

function emptyStation(location) {
  return {
    id: location.id,
    label: location.label,
    aqi: null,
    pm25: null,
    zone: null,
    stationName: null,
    stationUid: null,
    apiTimestamp: null,
    tier: null,
    manual: false,
    error: null,
    noCoverage: false,
    stationSelection: null,
  }
}

/**
 * @param locations user-managed sampling areas
 * @param stationsApi useStations() live, useDemoStations() on stage — same shape
 * @param demo the useDemoMode() result; supplies the clock the gates run against
 */
export function useAQI(locations, stationsApi, demo) {
  const isDemo = Boolean(demo?.active)
  // The freshness gate has to be measured against the same clock the readings
  // were stamped with, or every demo station reads as hours stale.
  const now = isDemo && demo.demoNow ? demo.demoNow : null

  const stations = useMemo(() => {
    // The snapshot is too old to stand behind. Rather than serving a
    // many-hours-old reading as though it were current, every area reports no
    // coverage and samples save with provenance 'no-coverage'.
    if (stationsApi.snapshotUnusable || stationsApi.error) {
      return locations.map((l) => ({
        ...emptyStation(l),
        noCoverage: true,
        error: stationsApi.error ?? null,
        snapshotUnusable: stationsApi.snapshotUnusable,
      }))
    }

    return locations.map((location) => {
      // An area created before a station was resolved, or one whose stored
      // attachment is missing, cannot be evaluated — areas carry no coordinates
      // by design, so there is nothing to measure from.
      if (!location.stationUid) {
        return { ...emptyStation(location), noCoverage: true }
      }

      const station = stationsApi.stations.find((s) => s.uid === location.stationUid)
      if (!station) {
        // The attached station has dropped out of the snapshot entirely.
        return { ...emptyStation(location), noCoverage: true }
      }

      // Re-run the gates against the stored attachment. Distance is already
      // known and fixed (areas hold no coordinates), so this is really the
      // freshness gate plus the scoring metadata.
      const pseudoLocation = { lat: station.lat, lng: station.lng }
      const { chosen, selection } = selectStation(pseudoLocation, [station], now ?? new Date())

      if (!chosen) {
        return {
          ...emptyStation(location),
          noCoverage: true,
          stationSelection: {
            ...selection,
            distanceKm: location.distanceKm ?? null,
            confidenceBand: location.confidenceBand ?? null,
          },
        }
      }

      return {
        id: location.id,
        label: location.label,
        aqi: chosen.aqi,
        pm25: chosen.pm25,
        zone: getAqiZone(chosen.aqi),
        stationName: chosen.name,
        stationUid: chosen.uid,
        apiTimestamp: chosen.lastSeen,
        tier: chosen.tier,
        network: chosen.network,
        manual: false,
        error: null,
        noCoverage: false,
        stationSelection: {
          ...selection,
          // The stored distance is the real one — measured from the area's GPS
          // reading at the moment it was created, before the coordinates were
          // discarded. The re-derived value above is station-to-itself.
          distanceKm: location.distanceKm ?? selection.distanceKm,
          confidenceBand: location.confidenceBand ?? selection.confidenceBand,
        },
      }
    })
  }, [locations, now, stationsApi.stations, stationsApi.snapshotUnusable, stationsApi.error])

  /**
   * Resolve an arbitrary coordinate to a station, for the add-area coverage
   * check. The caller discards the coordinates immediately afterwards; nothing
   * here retains them.
   *
   * Demo mode runs this identically, against the frozen station set. It used to
   * short-circuit to a fabricated "Demo station at 1.4km", which meant adding an
   * area on stage exercised none of the provenance work and produced a card that
   * did not match the curated set. The station match is the thing worth
   * demonstrating, so it is the thing that runs.
   */
  const checkCoverage = useCallback(
    (lat, lng) => {
      if (stationsApi.snapshotUnusable || !stationsApi.stations.length) {
        return { chosen: null, selection: null }
      }
      return selectStation({ lat, lng }, stationsApi.stations, now ?? new Date())
    },
    [now, stationsApi.stations, stationsApi.snapshotUnusable],
  )

  const validStations = stations.filter((s) => typeof s.aqi === 'number')
  const lowestStation =
    validStations.length > 0
      ? validStations.reduce((min, s) => (s.aqi < min.aqi ? s : min), validStations[0])
      : null

  const getStationForLocation = useCallback(
    (locationId) => stations.find((s) => s.id === locationId) ?? null,
    [stations],
  )

  return {
    stations,
    loading: isDemo ? false : stationsApi.loading,
    lowestStation,
    getStationForLocation,
    checkCoverage,
    isDemo,
    maxRadiusKm: MAX_STATION_RADIUS_KM,
    provenanceForNoCoverage: PROVENANCE.NO_COVERAGE,
  }
}
