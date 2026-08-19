import { useEffect, useState } from 'react'
import {
  isIdealWindow,
  nextIdealWindowLabel,
  MAX_STATION_RADIUS_KM,
  CONFIDENCE_BANDS,
  ATTRIBUTION,
} from './constants'
import { ORIENTATION_STATE } from './useOrientation'
import { DemoSettingsRow } from './DemoPill'

function bandLabel(key) {
  return CONFIDENCE_BANDS.find((b) => b.key === key)?.label ?? 'Unknown confidence'
}

function AqiPill({ zone, aqi }) {
  if (!zone) {
    return (
      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary">
        no data
      </span>
    )
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium text-black"
      style={{ backgroundColor: zone.color }}
    >
      {zone.label}
    </span>
  )
}

function StationCard({ station, onManualEntry }) {
  const [manualInput, setManualInput] = useState('')
  const showManualEntry = (station.error || station.noCoverage) && !station.manual

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-text-secondary">{station.label}</span>
        <AqiPill zone={station.zone} aqi={station.aqi} />
      </div>
      <div className="mt-1 font-mono-data text-3xl font-bold">
        {typeof station.aqi === 'number' ? station.aqi : '—'}
      </div>
      {typeof station.aqi === 'number' && (
        <div className="mt-0.5 text-xs text-text-secondary">
          {station.manual ? 'Entered manually' : station.stationName ?? 'Unknown station'}
          {station.pm25 != null && (
            <span className="font-mono-data"> · {station.pm25} µg/m³</span>
          )}
        </div>
      )}
      {typeof station.aqi === 'number' && !station.manual && station.stationSelection?.distanceKm != null && (
        <div className="mt-0.5 font-mono-data text-[11px] text-text-secondary">
          {station.stationSelection.distanceKm}km · Tier {station.stationSelection.tier} ·{' '}
          {bandLabel(station.stationSelection.confidenceBand)}
        </div>
      )}
      {station.noCoverage && (
        <div className="mt-1 text-xs text-zone-moderate">
          No monitoring station within {MAX_STATION_RADIUS_KM}km. Samples here log without AQI.
        </div>
      )}
      {showManualEntry && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-text-secondary">AQI unavailable —</span>
          <input
            type="number"
            inputMode="numeric"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="enter AQI"
            className="w-20 rounded border border-border bg-bg px-2 py-1 font-mono-data text-xs text-text"
          />
          <button
            className="text-xs text-accent"
            onClick={() => {
              const n = Number(manualInput)
              if (!Number.isNaN(n) && manualInput !== '') onManualEntry(station.id, n)
            }}
          >
            set
          </button>
        </div>
      )}
    </div>
  )
}

function SettingsPanel({ notifications, demo, display, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="mt-16 w-full max-w-sm rounded-lg border border-border bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="text-text-secondary" aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm">AQI alerts</div>
            <div className="text-xs text-text-secondary">
              Notify when AQI drops to 50 or below, 10:00–14:00
            </div>
          </div>
          <button
            role="switch"
            aria-checked={notifications.enabled}
            onClick={() => {
              if (notifications.permission !== 'granted') {
                notifications.requestPermission()
              }
              notifications.toggleEnabled()
            }}
            className={`h-6 w-11 shrink-0 rounded-full transition-colors ${
              notifications.enabled ? 'bg-accent' : 'bg-border'
            }`}
          >
            <span
              className={`block h-5 w-5 translate-y-0.5 rounded-full bg-text transition-transform ${
                notifications.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {notifications.permission === 'denied' && (
          <p className="mt-3 text-xs text-text-secondary">
            Notifications are blocked at the OS/browser level. Enable them in Settings to receive alerts.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <div className="text-sm">Hide sub-locations</div>
            <div className="text-xs text-text-secondary">
              Shows area and station only. Useful when the log is on a projector.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={display.maskSubLocations}
            onClick={() => display.toggle('maskSubLocations')}
            className={`h-6 w-11 shrink-0 rounded-full transition-colors ${
              display.maskSubLocations ? 'bg-accent' : 'bg-border'
            }`}
          >
            <span
              className={`block h-5 w-5 translate-y-0.5 rounded-full bg-text transition-transform ${
                display.maskSubLocations ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <DemoSettingsRow demo={demo} />
      </div>
    </div>
  )
}

export default function Home({
  aqi,
  log,
  stationsApi,
  notifications,
  orientation,
  demo,
  display,
  hasLocations,
  onStartCapture,
  onOpenLog,
  onOpenLocations,
}) {
  const isDemo = demo.active
  const sensorsReady = orientation.state === ORIENTATION_STATE.GRANTED
  const [now, setNow] = useState(new Date())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notifPromptDismissed, setNotifPromptDismissed] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const goodStation = aqi.stations.find((s) => typeof s.aqi === 'number' && s.aqi <= 50)
  const ideal = isIdealWindow(now)
  const recent = log.samples.slice(0, 5)

  const showNotifPrompt =
    !isDemo &&
    notifications.supported &&
    notifications.permission === 'default' &&
    !notifPromptDismissed

  return (
    <div className="flex min-h-full flex-col pb-28">
      <header className="flex items-center justify-between px-4 pt-6">
        <h1 className="text-lg font-semibold tracking-tight">Sky Sampler</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="rounded-full border border-border p-2 text-text-secondary"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {goodStation && (
        <div className="mx-4 mt-4 rounded-lg border border-zone-good/40 bg-zone-good/10 px-4 py-3 text-sm font-medium text-zone-good">
          Good sky day — sample now
        </div>
      )}

      {showNotifPrompt && (
        <div className="mx-4 mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <p>We'll alert you when Jakarta AQI drops below 50 during your capture window.</p>
          <div className="mt-2 flex gap-3">
            <button
              className="text-accent"
              onClick={async () => {
                await notifications.requestPermission()
                setNotifPromptDismissed(true)
              }}
            >
              Enable notifications
            </button>
            <button className="text-text-secondary" onClick={() => setNotifPromptDismissed(true)}>
              Not now
            </button>
          </div>
        </div>
      )}

      <section className="mt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-medium text-text-secondary">Live AQI</h2>
            <button className="text-xs text-accent" onClick={onOpenLocations}>
              Areas
            </button>
          </div>
          <div className="text-right">
            <div className="font-mono-data text-xs text-text-secondary">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className={`text-xs ${ideal ? 'text-zone-good' : 'text-text-secondary'}`}>
              {ideal ? 'Ideal capture window' : nextIdealWindowLabel(now)}
            </div>
          </div>
        </div>
        {!isDemo && stationsApi?.snapshotUnusable && (
          <div className="mt-2 rounded-lg border border-zone-moderate/40 bg-zone-moderate/10 px-3 py-2 text-xs text-zone-moderate">
            Air quality data is out of date. Samples will log without AQI.
          </div>
        )}
        {!isDemo && stationsApi?.showSnapshotAge && stationsApi.snapshotAgeLabel && (
          <div className="mt-2 text-xs text-text-secondary">{stationsApi.snapshotAgeLabel}</div>
        )}

        <div className="mt-2 grid grid-cols-1 gap-2">
          {aqi.stations.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-secondary">
              No sampling areas yet.{' '}
              <button className="text-accent underline" onClick={onOpenLocations}>
                Add one
              </button>{' '}
              to see live readings.
            </div>
          ) : (
            aqi.stations.map((station) => <StationCard key={station.id} station={station} />)
          )}
        </div>

        {/* Attribution is persistent and not dismissible — Udara Jakarta's terms
            permit non-commercial use with proper credit. */}
        <p className="mt-2 text-[11px] text-text-secondary">{ATTRIBUTION}</p>
      </section>

      <section className="mt-6 px-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-secondary">Sample progress</h2>
          <span className="font-mono-data text-sm">
            {log.stats.count} of {log.stats.goal}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${log.stats.progress * 100}%` }}
          />
        </div>
        <div className="mt-3 space-y-1.5">
          {log.stats.zoneCoverage.map((zone) => (
            <div key={zone.key} className="flex items-center justify-between rounded border border-border px-3 py-2">
              <div>
                <div className="text-sm">{zone.label}</div>
                <div className="text-xs text-text-secondary">{zone.range}</div>
              </div>
              <span className={`text-sm ${zone.covered ? 'text-zone-good' : 'text-text-secondary'}`}>
                {zone.covered ? '✓ covered' : 'needs sample'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 px-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-secondary">Recent samples</h2>
          {recent.length > 0 && (
            <button className="text-xs text-accent" onClick={onOpenLog}>
              View log
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            No samples yet — wait for a good sky day and hit Sample the sky.
          </p>
        ) : (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {recent.map((s) => (
              <button
                key={s.id}
                onClick={onOpenLog}
                className="flex w-28 shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 text-left"
              >
                <div className="h-14 w-full rounded" style={{ backgroundColor: s.averagedHex }} />
                <div className="font-mono-data text-xs">{s.aqi ?? '—'}</div>
                <div className="truncate rounded-full bg-border px-2 py-0.5 text-[10px] text-text-secondary">
                  {s.location}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-bg p-4">
        {!hasLocations ? (
          <button
            onClick={onOpenLocations}
            className="w-full rounded-lg border border-border py-4 text-base font-semibold text-text"
          >
            Add a sampling area
          </button>
        ) : (
          <>
            <button
              onClick={() => onStartCapture()}
              className="w-full rounded-lg bg-accent py-4 text-base font-semibold text-black active:opacity-80"
            >
              Sample the sky
            </button>
            {/* Capture needs compass and tilt; say so here rather than letting
                someone walk into a blocked flow. */}
            {!sensorsReady && (
              <p className="mt-2 text-center text-xs text-text-secondary">
                {orientation.state === ORIENTATION_STATE.UNSUPPORTED
                  ? 'Capture needs a phone — the log and export work here.'
                  : 'Capture needs motion access.'}
              </p>
            )}
          </>
        )}
      </div>

      {settingsOpen && (
        <SettingsPanel
          notifications={notifications}
          demo={demo}
          display={display}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
