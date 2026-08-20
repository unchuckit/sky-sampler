import { useCallback, useMemo } from 'react'
import { PROVENANCE, TIERS, getAqiZone, MAX_STATION_RADIUS_KM } from './constants'
import { selectStation } from './stationSelection'
import { pm25ToAqi } from './aqi'

// AQI per sampling area, derived from the station snapshot.
//
// No network calls happen here at all any more — useStations loads a static
// same-origin file, and this hook does the selection maths over it. AQICN is
// gone entirely: its free tier surfaced one live station in the metro area, so
// two of three sampling areas resolved to no coverage.
//
// Demo mode is intercepted at this boundary, so no component below needs to
// know whether it is looking at real or mocked data.

// Deterministic ±5 variation per area so the panel doesn't read as three
// identical numbers, while staying inside the same SAMPLE_ZONES bucket.
const DEMO_OFFSETS = [0, -4, 4, -2]

function buildDemoStations(zoneConfig, locations, demoNow) {
  const nowIso = (demoNow ?? new Date()).toISOString()
  return locations.map((location, i) => {
    const aqi = zoneConfig.aqi + (DEMO_OFFSETS[i % DEMO_OFFSETS.length] ?? 0)
    const distanceKm = location.distanceKm ?? Math.round((1.2 + i * 0.9) * 10) / 10
    const tier = location.tier ?? TIERS.A
    const band = location.confidenceBand ?? (distanceKm < 5 ? 'high' : distanceKm < 10 ? 'moderate' : 'low')
    // Back out a plausible raw PM2.5 for the AQI so the displayed µg/m³ and the
    // displayed AQI agree with each other on stage.
    const pm25 = approximatePm25ForAqi(aqi)
    return {
      id: location.id,
      label: location.label,
      aqi,
      pm25,
      zone: getAqiZone(aqi),
      stationName: location.stationName ?? `${location.label} (demo)`,
      stationUid: location.stationUid ?? null,
      apiTimestamp: nowIso,
      tier,
      manual: false,
      error: null,
      noCoverage: false,
      stationSelection: {
        chosenUid: location.stationUid ?? null,
        chosenName: location.stationName ?? `${location.label} (demo)`,
        tier,
        distanceKm,
        confidenceBand: band,
        neighbourDeviation: null,
        suspect: false,
        ceilingPinned: false,
        rejected: [],
        outOfRadiusCount: 0,
      },
    }
  })
}

// Inverse of the EPA breakpoint table, to one decimal — demo only.
function approximatePm25ForAqi(aqi) {
  for (let pm = 0; pm <= 500; pm += 0.1) {
    if (pm25ToAqi(Number(pm.toFixed(1))) >= aqi) return Number(pm.toFixed(1))
  }
  return null
}

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
 * @param stationsApi the useStations() result
 * @param demo { active, zoneConfig } — when active, no real data is consulted
 */
export function useAQI(locations, stationsApi, demo) {
  const isDemo = Boolean(demo?.active)

  const stations = useMemo(() => {
    if (isDemo) return buildDemoStations(demo.zoneConfig, locations, demo.demoNow)

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
      const { chosen, selection } = selectStation(pseudoLocation, [station])

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
  }, [isDemo, demo, locations, stationsApi.stations, stationsApi.snapshotUnusable, stationsApi.error])

  /**
   * Resolve an arbitrary coordinate to a station, for the Locations screen's
   * add-time coverage check. The caller discards the coordinates immediately
   * afterwards; nothing here retains them.
   */
  const checkCoverage = useCallback(
    (lat, lng) => {
      if (isDemo) {
        return {
          chosen: { name: 'Demo station', tier: TIERS.A, uid: 'demo' },
          selection: {
            chosenUid: 'demo',
            chosenName: 'Demo station',
            tier: TIERS.A,
            distanceKm: 1.4,
            confidenceBand: 'high',
            rejected: [],
          },
        }
      }
      if (stationsApi.snapshotUnusable || !stationsApi.stations.length) {
        return { chosen: null, selection: null }
      }
      return selectStation({ lat, lng }, stationsApi.stations)
    },
    [isDemo, stationsApi.stations, stationsApi.snapshotUnusable],
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
