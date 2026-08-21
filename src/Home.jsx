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
import KawasanSelect, { findDistrict, districtKey, USE_MY_LOCATION } from './KawasanSelect'
import { COORDINATE_SOURCE, getCurrentPosition } from './useLocations'
import { haversineKm } from './stationSelection'

function bandLabel(key) {
  return CONFIDENCE_BANDS.find((b) => b.key === key)?.label ?? 'Unknown confidence'
}

/**
 * A district-centroid distance is measured from the centroid, not from wherever
 * the person actually stands, so it is prefixed to read as an estimate.
 *
 * Without this, a kecamatan with a single station puts the centroid exactly on
 * that station and the card reads a bare "0km" — which claims the person is
 * standing inside the instrument. Same treatment as the Locations screen.
 */
function distanceLabel(distanceKm, source) {
  if (distanceKm == null) return null
  return source === COORDINATE_SOURCE.DISTRICT_CENTROID ? `~${distanceKm}km` : `${distanceKm}km`
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
 * Choose an area, either by picking a kawasan or by detecting one.
 *
 * Shared by "add" and "replace" so the two cannot drift apart — they are the
 * same decision with a different verb on the button.
 *
 * COORDINATES NEVER REACH STATE. "Use my location" resolves the fix to a
 * station and a kawasan name inside one async function and drops the lat/lng on
 * the way out, so there is nothing coordinate-shaped for a later render, a
 * serialiser, or a bug to leak.
 */
function AreaPicker({ id, districts, heading, submitLabel, onSubmit, onCancel, resolveAt, kawasanAt }) {
  const [key, setKey] = useState('')
  const [detected, setDetected] = useState(null) // a GPS-resolved attachment, if any
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleChange(value) {
    setError(null)
    if (value !== USE_MY_LOCATION) {
      // A hand-picked kawasan resolves from its centroid at submit time.
      setKey(value)
      setDetected(null)
      return
    }

    setLocating(true)
    try {
      const { lat, lng } = await getCurrentPosition()
      const kawasan = kawasanAt(lat, lng)
      // Resolved from the actual fix rather than from the kawasan centroid:
      // the centroid is only an approximation of where someone stands, and
      // using it would throw away the precision GPS just gave us.
      const attachment = resolveAt(lat, lng, COORDINATE_SOURCE.GPS)
      if (!attachment.stationUid) {
        setError(`No monitoring station within ${MAX_STATION_RADIUS_KM}km of you.`)
        setKey('')
        setDetected(null)
      } else {
        setKey(kawasan ? districtKey(kawasan) : '')
        setDetected({ label: kawasan?.kecamatan ?? 'My location', ...attachment })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLocating(false)
    }
  }

  async function submit() {
    setBusy(true)
    try {
      if (detected) {
        await onSubmit(detected)
        return
      }
      const d = findDistrict(districts, key)
      if (!d) return
      await onSubmit({ label: d.kecamatan, ...resolveAt(d.lat, d.lng, COORDINATE_SOURCE.DISTRICT_CENTROID) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <label className="text-xs text-text-secondary" htmlFor={id}>
        {heading}
      </label>
      <div className="mt-1.5">
        <KawasanSelect
          id={id}
          districts={districts}
          value={key}
          onChange={handleChange}
          locating={locating}
        />
      </div>

      {detected && (
        <p className="mt-1.5 text-[11px] text-text-secondary">
          Found you in {detected.label} — {detected.stationName}
          {detected.distanceKm != null ? ` · ${detected.distanceKm}km` : ''}
        </p>
      )}
      {error && <p className="mt-1.5 text-[11px] text-zone-moderate">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button
          disabled={(!key && !detected) || busy || locating}
          onClick={submit}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button onClick={onCancel} className="text-sm text-text-secondary">
          Cancel
        </button>
      </div>
    </>
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
function AreaCard({
  station,
  area,
  districts,
  sampleCount,
  expanded,
  onToggleExpand,
  onReplace,
  onDelete,
  resolveAt,
  kawasanAt,
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!expanded) setConfirmingDelete(false)
  }, [expanded])

  const retiring = sampleCount > 0

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {expanded ? (
            <AreaPicker
              id={`kawasan-${station.id}`}
              districts={districts}
              heading="Replace with another area"
              submitLabel="Replace"
              resolveAt={resolveAt}
              kawasanAt={kawasanAt}
              onSubmit={async (next) => {
                await onReplace(area, next)
                onToggleExpand()
              }}
              onCancel={onToggleExpand}
            />
          ) : (
            <span className="block truncate text-sm text-text-secondary">{station.label}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {expanded && (
            <IconButton
              label={`${retiring ? 'Retire' : 'Remove'} ${station.label}`}
              onClick={() => setConfirmingDelete((v) => !v)}
            >
              <TrashIcon />
            </IconButton>
          )}
          <IconButton label={`Options for ${station.label}`} onClick={onToggleExpand}>
            <MoreIcon />
          </IconButton>
        </div>
      </div>

      {/* Confirmation in the page rather than window.confirm. A native dialog is
          suppressible — browsers offer "prevent additional dialogs", and some
          embedded and standalone-PWA contexts refuse it outright — and when it
          is suppressed it returns false, so the button silently does nothing and
          reads as broken. */}
      {expanded && confirmingDelete && (
        <div className="mt-2 rounded-lg border border-border bg-bg p-2.5">
          <p className="text-xs">
            {retiring
              ? `Retire ${station.label}? Its ${sampleCount} logged sample${sampleCount === 1 ? '' : 's'} stay in the log.`
              : `Remove ${station.label}?`}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => {
                setConfirmingDelete(false)
                onDelete(area, sampleCount)
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold"
            >
              {retiring ? 'Retire' : 'Remove'}
            </button>
            <button onClick={() => setConfirmingDelete(false)} className="text-xs text-text-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

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
              {distanceLabel(station.stationSelection.distanceKm, area?.coordinateSource)} · Tier{' '}
              {station.stationSelection.tier} · {bandLabel(station.stationSelection.confidenceBand)}
            </div>
          )}
          {station.noCoverage && (
            <div className="mt-1 text-xs text-zone-moderate">
              No monitoring station within {MAX_STATION_RADIUS_KM}km. Samples here log without AQI.
            </div>
          )}
        </>
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
  const [expandedAreaId, setExpandedAreaId] = useState(null)

  /**
   * Resolve a coordinate to a station attachment, then forget the coordinate.
   * Nothing coordinate-shaped is returned from here or written anywhere.
   */
  function resolveAt(lat, lng, source) {
    const result = aqi.checkCoverage(lat, lng)
    const band = result?.selection?.confidenceBand ?? null
    return {
      stationUid: result?.chosen?.uid ?? null,
      stationName: result?.chosen?.name ?? null,
      distanceKm: result?.selection?.distanceKm ?? null,
      // A centroid's own error is easily a kilometre, so a centroid-derived
      // area can never claim high confidence. A real GPS fix can.
      confidenceBand:
        source === COORDINATE_SOURCE.DISTRICT_CENTROID && band === 'high' ? 'moderate' : band,
      tier: result?.chosen?.tier ?? null,
      coordinateSource: source,
    }
  }

  /**
   * Which kawasan a coordinate sits in, judged by the nearest station.
   *
   * Station-nearest rather than centroid-nearest on purpose: a station is a
   * real point with a known kecamatan, while a centroid is an average that can
   * sit closer to a neighbouring district than to its own edge. This is a label
   * for the area, not the basis of the reading — the reading comes from the GPS
   * fix through the normal selection path.
   */
  function kawasanAt(lat, lng) {
    let best = null
    for (const s of stationsApi?.stations ?? []) {
      if (!s.kecamatan) continue
      const km = haversineKm(lat, lng, s.lat, s.lng)
      if (!best || km < best.km) best = { km, kecamatan: s.kecamatan, kota: s.kota ?? 'Unknown' }
    }
    return best
  }

  function handleAddArea(next) {
    locationsApi.addLocation(next)
    setAddingArea(false)
  }

  // Replacing repoints the area. Logged samples are unaffected: each one stored
  // its own station, AQI and location label at capture time, so this needs no
  // confirmation — nothing is lost and replacing back undoes it.
  function handleReplaceArea(area, next) {
    if (!area) return
    const { label, ...attachment } = next
    locationsApi.renameLocation(area.id, label)
    locationsApi.rebindLocation(area.id, attachment)
  }

  // The confirmation happens on the card, in the page. By the time this runs
  // the person has already confirmed.
  function handleDeleteArea(area, sampleCount) {
    if (!area) return
    // Retire rather than delete when samples exist — a logged sample must never
    // be orphaned from the place it was taken.
    locationsApi.removeLocation(area.id, { hasSamples: sampleCount > 0 })
    setExpandedAreaId(null)
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
                resolveAt={resolveAt}
                kawasanAt={kawasanAt}
              />
            ))
          )}

          {locationsApi.activeLocations.length < 3 &&
            (addingArea ? (
              <div className="rounded-lg border border-accent/40 bg-surface p-3">
                <AreaPicker
                  id="add-kawasan"
                  districts={stationsApi?.districts ?? []}
                  heading="Add an area"
                  submitLabel="Add area"
                  resolveAt={resolveAt}
                  kawasanAt={kawasanAt}
                  onSubmit={handleAddArea}
                  onCancel={() => setAddingArea(false)}
                />
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
          // Uniform card width, with a long area name clipped rather than
          // allowed to stretch the row. The strip is a glance at recent colour,
          // so an even rhythm matters more here than the full name — which is
          // one tap away in the log.
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 pr-4">
            {recent.map((s) => (
              <button
                key={s.id}
                onClick={onOpenLog}
                title={s.location}
                className="flex w-28 shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 text-left"
              >
                <div className="h-14 w-full rounded" style={{ backgroundColor: s.averagedHex }} />
                <div className="font-mono-data text-xs">{s.aqi ?? '—'}</div>
                <div className="w-full truncate rounded-full bg-border px-2 py-0.5 text-[10px] text-text-secondary">
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
