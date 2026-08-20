import { useMemo } from 'react'
import { DEMO_STATION_ROWS, DEMO_SNAPSHOT_META } from './demoStations'
import { buildDemoStationSet } from './demoStationSet'
import { buildDistricts } from './stations'

// Demo mode's station source: the same shape useStations returns, built from a
// frozen real snapshot instead of a fetch.
//
// This file is only the React wrapper — the substance is in demoStationSet.js,
// which is pure so its guarantees can be tested rather than assumed.
//
// Zero network: DEMO_STATION_ROWS is a bundled module, not a request.

/**
 * @param demo the useDemoMode() result — needs `zoneKey`, `zoneConfig`, `demoNow`
 */
export function useDemoStations(demo) {
  const zoneKey = demo?.zoneKey ?? null
  const zoneAqi = demo?.zoneConfig?.aqi ?? null
  const demoNow = demo?.demoNow ?? null

  const stations = useMemo(
    () => buildDemoStationSet(zoneKey, zoneAqi, demoNow),
    [zoneKey, zoneAqi, demoNow],
  )

  const districts = useMemo(() => buildDistricts(DEMO_STATION_ROWS), [])

  return useMemo(
    () => ({
      stations,
      allStations: stations,
      districts,
      loading: false,
      error: null,
      reload: () => {},
      snapshot: null,
      // The readings are generated at the demo clock's instant, so the set is
      // current by construction. There is no real staleness to report.
      snapshotAgeMinutes: 0,
      snapshotUnusable: false,
      updateTime: demoNow ? demoNow.toISOString() : null,
      cityMeteo: null,
      // The stations are genuinely theirs, so the credit is genuinely owed.
      attribution: DEMO_SNAPSHOT_META.source,
    }),
    [stations, districts, demoNow],
  )
}
