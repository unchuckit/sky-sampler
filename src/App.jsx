import { useCallback, useEffect, useMemo, useState } from 'react'
import Home from './Home'
import CaptureFlow from './CaptureFlow'
import SaveEntry from './SaveEntry'
import LogView from './LogView'
import LocationsView from './LocationsView'
import DemoPill from './DemoPill'
import { useAQI } from './useAQI'
import { useStations } from './useStations'
import { useDemoStations } from './useDemoStations'
import { useLog, computeLogStats } from './useLog'
import { useLocations } from './useLocations'
import { useNotifications } from './useNotifications'
import { useOrientation } from './useOrientation'
import { useDemoMode } from './useDemoMode'
import { useDisplaySettings } from './useDisplaySettings'
import { DEMO_SAMPLES, DEMO_LOCATIONS } from './demoData'

function Toast({ message }) {
  if (!message) return null
  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div className="rounded-full bg-surface px-4 py-2 text-sm shadow-lg border border-border">{message}</div>
    </div>
  )
}

export default function App() {
  const demo = useDemoMode()
  const isDemo = demo.active

  const [view, setView] = useState('home')
  const [captureDraft, setCaptureDraft] = useState(null)
  const [pendingLocationId, setPendingLocationId] = useState(null)
  const [toast, setToast] = useState(null)

  // Demo state lives in memory only and is rebuilt on every reset, so the flow
  // returns to a clean start without a reload. The seeded log is intentionally
  // NOT reset away — an empty log on a projector shows neither the cyanometer
  // strip nor the zone spread, which are the point.
  const [demoSamples, setDemoSamples] = useState(() => [...DEMO_SAMPLES])
  const [demoLocations, setDemoLocations] = useState(() => [...DEMO_LOCATIONS])

  useEffect(() => {
    if (!isDemo) return
    setDemoSamples([...DEMO_SAMPLES])
    setDemoLocations([...DEMO_LOCATIONS])
    setCaptureDraft(null)
    setPendingLocationId(null)
    setView('home')
  }, [demo.resetToken, isDemo])

  // Real hooks are disabled in demo mode so they cannot read or write real
  // storage while the presenter is on stage.
  const realLocationsApi = useLocations({ enabled: !isDemo })
  const realLog = useLog({ enabled: !isDemo })
  // Same shape either way, so nothing downstream branches on demo mode: the
  // demo swaps the station SOURCE, not the logic that runs over it.
  const realStationsApi = useStations({ enabled: !isDemo })
  const demoStationsApi = useDemoStations(demo)
  const stationsApi = isDemo ? demoStationsApi : realStationsApi
  const orientation = useOrientation()
  const display = useDisplaySettings()

  const demoLocationsApi = useMemo(
    () => ({
      locations: demoLocations,
      activeLocations: demoLocations.filter((l) => l.active),
      addLocation: (area) =>
        setDemoLocations((prev) => [
          ...prev,
          { id: `demo-${Date.now()}`, active: true, needsRecheck: false, ...area },
        ]),
      renameLocation: (id, label) =>
        setDemoLocations((prev) => prev.map((l) => (l.id === id ? { ...l, label } : l))),
      rebindLocation: (id, next) =>
        setDemoLocations((prev) => prev.map((l) => (l.id === id ? { ...l, ...next, needsRecheck: false } : l))),
      removeLocation: (id, { hasSamples }) =>
        setDemoLocations((prev) =>
          hasSamples ? prev.map((l) => (l.id === id ? { ...l, active: false } : l)) : prev.filter((l) => l.id !== id),
        ),
      reactivateLocation: (id) =>
        setDemoLocations((prev) => prev.map((l) => (l.id === id ? { ...l, active: true } : l))),
      getLocationById: (id) => demoLocations.find((l) => l.id === id) ?? null,
    }),
    [demoLocations],
  )

  const demoLogApi = useMemo(
    () => ({
      samples: demoSamples,
      stats: computeLogStats(demoSamples),
      addSample: (sample) => {
        const entry = {
          id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          locationChanges: [],
          ...sample,
        }
        setDemoSamples((prev) => [entry, ...prev])
        return entry
      },
      deleteSample: (id) => setDemoSamples((prev) => prev.filter((s) => s.id !== id)),
      updateSample: (id, updater) =>
        setDemoSamples((prev) => prev.map((s) => (s.id === id ? updater(s) : s))),
    }),
    [demoSamples],
  )

  const locationsApi = isDemo ? demoLocationsApi : realLocationsApi
  const log = isDemo ? demoLogApi : realLog

  const aqi = useAQI(locationsApi.activeLocations, stationsApi, demo)

  const handleOpenCapture = useCallback((locationId) => {
    setPendingLocationId(locationId ?? null)
    setView('capture')
  }, [])

  const notifications = useNotifications({ onOpenCapture: handleOpenCapture, isDemo })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('openCapture') === '1') {
      const location = locationsApi.getLocationById(params.get('location'))
      setPendingLocationId(location?.id ?? null)
      setView('capture')
      const url = new URL(window.location.href)
      url.searchParams.delete('openCapture')
      url.searchParams.delete('location')
      window.history.replaceState({}, '', url.pathname + url.search)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  function handleSave(entry) {
    log.addSample(entry)
    setCaptureDraft(null)
    setView('home')
    setToast('Sample saved to log')
  }

  return (
    <div className="mx-auto h-full max-w-md bg-bg">
      {view === 'home' && (
        <Home
          aqi={aqi}
          log={log}
          stationsApi={stationsApi}
          locationsApi={locationsApi}
          notifications={notifications}
          orientation={orientation}
          demo={demo}
          display={display}
          hasLocations={locationsApi.activeLocations.length > 0}
          onStartCapture={() => {
            setPendingLocationId(null)
            setView('capture')
          }}
          onOpenLog={() => setView('log')}
          onOpenLocations={() => setView('locations')}
        />
      )}

      {view === 'capture' && (
        <CaptureFlow
          key={demo.resetToken}
          aqiStations={aqi.stations}
          locations={locationsApi.activeLocations}
          orientation={orientation}
          initialLocationId={pendingLocationId}
          demo={demo}
          onCancel={() => setView('home')}
          onComplete={(draft) => {
            setCaptureDraft(draft)
            setView('save')
          }}
        />
      )}

      {view === 'save' && captureDraft && (
        <SaveEntry
          draft={captureDraft}
          aqiStations={aqi.stations}
          locations={locationsApi.activeLocations}
          demo={demo}
          snapshotAgeMinutes={isDemo ? 0 : stationsApi.snapshotAgeMinutes}
          onSave={handleSave}
          onCancel={() => setView('capture')}
        />
      )}

      {view === 'log' && (
        <LogView
          log={log}
          aqiStations={aqi.stations}
          locations={locationsApi.activeLocations}
          display={display}
          attribution={stationsApi.attribution}
          onBack={() => setView('home')}
        />
      )}

      {view === 'locations' && (
        <LocationsView
          locationsApi={locationsApi}
          aqi={aqi}
          stationsApi={stationsApi}
          log={log}
          onBack={() => setView('home')}
        />
      )}

      <Toast message={toast} />
      <DemoPill demo={demo} />
    </div>
  )
}
