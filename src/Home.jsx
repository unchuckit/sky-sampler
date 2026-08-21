import { useEffect, useState } from 'react'
import {
  isIdealWindow,
  nextIdealWindowLabel,
  MAX_STATION_RADIUS_KM,
  CONFIDENCE_BANDS,
  ATTRIBUTION,
} from './constants'
import { ORIENTATION_STATE } from './useOrientation'
import { formatTime } from './time'
import { DemoSettingsRow } from './DemoPill'
import Toggle from './Toggle'
import KawasanSelect, { findDistrict } from './KawasanSelect'
import { COORDINATE_SOURCE } from './useLocations'

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

function IconButton({ label, onClick, children }) {
  return (
    <button onClick={onClick} aria-label={label} className="rounded p-1.5 text-text-secondary">
      {children}
    </button>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  )
}

/**
 * One sampling area, with its current reading and its own management controls.
 *
 * Area management lives on the card rather than behind a separate screen: the
 * thing you want to change is right next to the reading that prompted you to
 * change it. Collapsed by default — only the three-dot button shows — so the
 * card reads as a reading first and a settings surface second. Expansion state
 * is owned by the parent so only one card is ever open at a time.
 */
function AreaCard({ station, area, districts, sampleCount, expanded, onToggleExpand, onReplace, onDelete }) {
  const [pendingKawasan, setPendingKawasan] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!expanded) setPendingKawasan('')
  }, [expanded])

  async function applyReplace() {
    const district = findDistrict(districts, pendingKawasan)
    if (!district) return
    if (
      sampleCount > 0 &&
      !window.confirm(
        `Replace ${area?.label ?? 'this area'} with ${district.kecamatan}? ` +
          `Its ${sampleCount} logged sample${sampleCount === 1 ? '' : 's'} keep the station and AQI ` +
          'recorded at capture time.',
      )
    ) {
      return
    }
    setBusy(true)
    await onReplace(area, district)
    setBusy(false)
    onToggleExpand()
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {expanded ? (
            <>
              <label className="text-xs text-text-secondary" htmlFor={`kawasan-${station.id}`}>
                Replace with another area
              </label>
              <div className="mt-1.5">
                <KawasanSelect
                  id={`kawasan-${station.id}`}
                  districts={districts}
                  value={pendingKawasan}
                  onChange={setPendingKawasan}
                  placeholder="Select"
                />
              </div>
            </>
          ) : (
            <span className="block truncate text-sm text-text-secondary">{station.label}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {expanded && (
            <IconButton
              label={`${sampleCount > 0 ? 'Retire' : 'Remove'} ${station.label}`}
              onClick={() => onDelete(area, sampleCount)}
            >
              <TrashIcon />
            </IconButton>
          )}
          <IconButton label={`Options for ${station.label}`} onClick={onToggleExpand}>
            <MoreIcon />
          </IconButton>
        </div>
      </div>

      {station.snapshotUnusable ? (
        <div className="mt-1 text-sm text-text-secondary">No current reading</div>
      ) : (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono-data text-3xl font-bold">
              {typeof station.aqi === 'number' ? station.aqi : '—'}
            </span>
            <AqiPill zone={station.zone} aqi={station.aqi} />
          </div>

          {typeof station.aqi === 'number' && (
            <div className="mt-0.5 text-xs text-text-secondary">
              {station.stationName ?? 'Unknown station'}
              {station.pm25 != null && <span className="font-mono-data"> · {station.pm25} µg/m³</span>}
            </div>
          )}
          {typeof station.aqi === 'number' && station.stationSelection?.distanceKm != null && (
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
        </>
      )}

      {expanded && (
        <div className="mt-3 flex items-center gap-3">
          <button
            disabled={!pendingKawasan || busy}
            onClick={applyReplace}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? 'Replacing…' : 'Replace'}
          </button>
          <button onClick={onToggleExpand} className="text-sm text-text-secondary">
            Cancel
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
          <Toggle
            checked={notifications.enabled}
            label="AQI alerts"
            onChange={() => {
              if (notifications.permission !== 'granted') {
                notifications.requestPermission()
              }
              notifications.toggleEnabled()
            }}
          />
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
          <Toggle
            checked={display.maskSubLocations}
            label="Hide sub-locations"
            onChange={() => display.toggle('maskSubLocations')}
          />
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
  locationsApi,
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
  const [addingArea, setAddingArea] = useState(false)
  const [newKawasan, setNewKawasan] = useState('')
  const [expandedAreaId, setExpandedAreaId] = useState(null)

  // Resolving a kawasan uses its centroid, which is then discarded — no
  // coordinates are returned from here or written anywhere.
  function resolveKawasan(district) {
    const result = aqi.checkCoverage(district.lat, district.lng)
    const band = result?.selection?.confidenceBand ?? null
    return {
      stationUid: result?.chosen?.uid ?? null,
      stationName: result?.chosen?.name ?? null,
      distanceKm: result?.selection?.distanceKm ?? null,
      // A centroid's own error is easily a kilometre, so it can never claim high.
      confidenceBand: band === 'high' ? 'moderate' : band,
      tier: result?.chosen?.tier ?? null,
      coordinateSource: COORDINATE_SOURCE.DISTRICT_CENTROID,
    }
  }

  function handleAddArea() {
    const district = findDistrict(stationsApi?.districts ?? [], newKawasan)
    if (!district) return
    locationsApi.addLocation({ label: district.kecamatan, ...resolveKawasan(district) })
    setAddingArea(false)
    setNewKawasan('')
  }

  // Replacing repoints the area. Logged samples are unaffected: each one stored
  // its own station, AQI and location label at capture time.
  function handleReplaceArea(area, district) {
    if (!area) return
    locationsApi.renameLocation(area.id, district.kecamatan)
    locationsApi.rebindLocation(area.id, resolveKawasan(district))
  }

  function handleDeleteArea(area, sampleCount) {
    if (!area) return
    const message =
      sampleCount > 0
        ? `Retire ${area.label}? Its ${sampleCount} logged sample${sampleCount === 1 ? '' : 's'} stay in the log.`
        : `Remove ${area.label}?`
    if (window.confirm(message)) {
      // Retire rather than delete when samples exist — a logged sample must
      // never be orphaned from the place it was taken.
      locationsApi.removeLocation(area.id, { hasSamples: sampleCount > 0 })
    }
  }

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const goodStation = aqi.stations.find((s) => typeof s.aqi === 'number' && s.aqi <= 50)
  // One clock drives both the display and the window state. The demo's zone
  // times all sit inside the window, so this computes to in-window on stage
  // without demo mode asserting anything — every special case is a place where
  // the demo stops behaving like the app.
  const displayNow = isDemo && demo.demoNow ? demo.demoNow : now
  const ideal = isIdealWindow(displayNow)
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
          </div>
          <div className="text-right">
            <div className="font-mono-data text-xs text-text-secondary">
              {formatTime(displayNow)}
            </div>
            <div className={`text-xs ${ideal ? 'text-zone-good' : 'text-text-secondary'}`}>
              {ideal ? 'Ideal capture window' : nextIdealWindowLabel(displayNow)}
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2">
          {aqi.stations.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-secondary">
              No sampling areas yet. Add one to see live readings.
            </div>
          ) : (
            aqi.stations.map((station) => (
              <AreaCard
                key={station.id}
                station={station}
                area={locationsApi.getLocationById(station.id)}
                districts={stationsApi?.districts ?? []}
                sampleCount={log.samples.filter((s) => s.locationId === station.id).length}
                expanded={expandedAreaId === station.id}
                onToggleExpand={() =>
                  setExpandedAreaId((id) => (id === station.id ? null : station.id))
                }
                onReplace={handleReplaceArea}
                onDelete={handleDeleteArea}
              />
            ))
          )}

          {locationsApi.activeLocations.length < 3 &&
            (addingArea ? (
              <div className="rounded-lg border border-accent/40 bg-surface p-3">
                <label className="text-xs text-text-secondary" htmlFor="add-kawasan">
                  Add a kawasan
                </label>
                <div className="mt-1.5">
                  <KawasanSelect
                    id="add-kawasan"
                    districts={stationsApi?.districts ?? []}
                    value={newKawasan}
                    onChange={setNewKawasan}
                  />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    disabled={!newKawasan}
                    onClick={handleAddArea}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  >
                    Add area
                  </button>
                  <button
                    onClick={() => {
                      setAddingArea(false)
                      setNewKawasan('')
                    }}
                    className="text-sm text-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
                <button onClick={onOpenLocations} className="mt-3 block text-xs text-accent">
                  More options — use my location, rename, restore retired
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingArea(true)}
                className="rounded-lg border border-dashed border-border py-3 text-sm text-text-secondary"
              >
                + Add area
              </button>
            ))}
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
          <div className="mt-2 flex gap-3 overflow-x-auto pb-1 pr-4">
            {recent.map((s) => (
              <button
                key={s.id}
                onClick={onOpenLog}
                className="flex shrink-0 flex-col items-start gap-1.5 rounded-lg border border-border bg-surface p-2 text-left"
              >
                <div className="h-14 w-14 rounded" style={{ backgroundColor: s.averagedHex }} />
                <div className="font-mono-data text-xs">{s.aqi ?? '—'}</div>
                <div className="max-w-[9rem] whitespace-normal break-words rounded-full bg-border px-2 py-0.5 text-[10px] text-text-secondary">
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
