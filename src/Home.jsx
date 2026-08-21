import { useEffect, useState } from 'react'
import {
  isIdealWindow,
  nextIdealWindowLabel,
  MAX_STATION_RADIUS_KM,
  CONFIDENCE_BANDS,
  ATTRIBUTION,
  tierLabel,
} from './constants'
import { ORIENTATION_STATE } from './useOrientation'
import { formatTime } from './time'
import { DemoSettingsRow } from './DemoPill'
import Toggle from './Toggle'
import KawasanSelect, { findDistrict, districtKey, USE_MY_LOCATION } from './KawasanSelect'
import { COORDINATE_SOURCE, getCurrentPosition } from './useLocations'
import { haversineKm } from './stationSelection'
import { areaNotes } from './sampleFlags'

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

/**
 * The middot between facts on a card line.
 *
 * Rendered in the monospaced face on purpose. Its neighbours are monospaced —
 * distances and readings — and a proportional space either side of the dot is
 * visibly narrower than a monospaced one, which made the gaps down a single
 * line come out uneven.
 */
function Sep() {
  return <span className="font-mono-data">{' · '}</span>
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
function AreaPicker({
  id,
  districts,
  heading,
  ariaLabel,
  submitLabel,
  takenLabels = [],
  onSubmit,
  onCancel,
  resolveAt,
  kawasanAt,
}) {
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
      } else if (kawasan && takenLabels.includes(kawasan.kecamatan)) {
        // The dropdown greys out areas already in the list; detection has to
        // honour the same rule or it becomes a way around it.
        setError(`${kawasan.kecamatan} is already one of your areas.`)
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
      {heading && (
        <label className="text-xs text-text-secondary" htmlFor={id}>
          {heading}
        </label>
      )}
      <div className={heading ? 'mt-1.5' : ''}>
        <KawasanSelect
          id={id}
          districts={districts}
          value={key}
          onChange={handleChange}
          locating={locating}
          takenLabels={takenLabels}
          ariaLabel={ariaLabel}
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
 * One sampling area: its current reading, its detail, and its controls.
 *
 * TWO SEPARATE GESTURES, because they are two separate intents.
 *   Tapping the card    — "tell me more about this reading" → station detail
 *   Tapping the 3-dot   — "change this area" → the manage overlay
 *
 * Folding both into one control meant the only way to read a station's UID was
 * to open the screen for replacing it, which is a strange place to put
 * reference information.
 *
 * Area management lives on the card rather than behind a separate screen: the
 * thing you want to change is right next to the reading that prompted you to
 * change it. The manage overlay is owned by the parent so only one card is ever
 * open at a time; detail is per-card, since reading two at once is reasonable.
 */
function AreaCard({
  station,
  area,
  districts,
  sampleCount,
  takenLabels,
  expanded,
  onToggleExpand,
  onReplace,
  onDelete,
  resolveAt,
  kawasanAt,
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    if (!expanded) {
      setConfirmingDelete(false)
      return
    }
    // Managing collapses the detail, so the overlay always covers a card in the
    // same compact state. Otherwise opening the menu on a tall card would leave
    // the panel floating against a mostly-empty blackout.
    setDetailOpen(false)
  }, [expanded])

  const retiring = sampleCount > 0
  const selection = station.stationSelection ?? null
  const notes = areaNotes(selection)

  // The reading, without its controls — those are rendered once, above
  // everything, so the three-dot stays put whatever the card is doing. This is
  // rendered twice: once for real, and once dimmed behind the manage overlay.
  const reading = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{station.label}</span>
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

          {/* Line 2: who is reporting, how far away, and anything worth noting.
              The raw µg/m³ is gone from this view — the AQI directly above is
              computed from it, so showing both was showing one number twice.
              The machine prefix is stripped; it lives in the detail behind a
              tap on the card.
              Caveats ride on this line instead of claiming one of their own, so
              a flagged card is exactly as tall as a clean one and every card in
              the column keeps the same height. Confidence, tier and recency are
              still checked independently — they just join the line rather than
              add to it. The separators stay in the line's own grey; only the
              caveat itself takes the warning colour, so the eye lands on the
              words and not the punctuation. */}
          {typeof station.aqi === 'number' && (
            <div className="mt-0.5 text-xs text-text-secondary">
              {selection?.distanceKm != null && (
                <span className="font-mono-data">
                  Stationed {distanceLabel(selection.distanceKm, area?.coordinateSource)} away
                </span>
              )}
              {notes.map((note) => (
                <span key={note}>
                  <Sep />
                  <span className="text-zone-moderate">{note}</span>
                </span>
              ))}
            </div>
          )}

          {station.noCoverage && (
            <div className="mt-1 text-xs text-zone-moderate">
              No monitoring station within {MAX_STATION_RADIUS_KM}km. Samples here log without AQI.
            </div>
          )}
        </>
      )}
    </>
  )

  // Everything the two-line card leaves out. Behind a tap on the card itself.
  const detail = typeof station.aqi === 'number' && (
    <dl className="mt-3 border-t border-border pt-2 font-mono-data text-[11px] text-text-secondary">
      <div className="flex justify-between gap-3 py-0.5">
        <dt>Station</dt>
        <dd className="text-right">{station.stationName}</dd>
      </div>
      <div className="flex justify-between gap-3 py-0.5">
        <dt>UID</dt>
        <dd className="min-w-0 break-all text-right">{station.stationUid ?? '—'}</dd>
      </div>
      <div className="flex justify-between gap-3 py-0.5">
        <dt>Distance</dt>
        <dd>{distanceLabel(selection?.distanceKm, area?.coordinateSource) ?? '—'}</dd>
      </div>
      <div className="flex justify-between gap-3 py-0.5">
        <dt>Sensor grade</dt>
        <dd>{tierLabel(selection?.tier)}</dd>
      </div>
      <div className="flex justify-between gap-3 py-0.5">
        <dt>Confidence</dt>
        <dd>{bandLabel(selection?.confidenceBand)}</dd>
      </div>
      <div className="flex justify-between gap-3 py-0.5">
        <dt>PM2.5 raw</dt>
        <dd>{station.pm25 != null ? `${station.pm25} µg/m³` : '—'}</dd>
      </div>
      <div className="flex justify-between gap-3 py-0.5">
        <dt>Reading age</dt>
        <dd>{selection?.readingAgeHours != null ? `${selection.readingAgeHours}h` : '—'}</dd>
      </div>
    </dl>
  )

  return (
    /* One height across all three states — reading, manage, confirm — so
       tapping the three-dot or the trash never makes the card jump or shifts
       the cards below it.
       28 (112px) is the tallest measured state, now that caveats ride on line 2
       and every collapsed card is 105. Manage is 112 and the confirm 110.
       min-height rather than a fixed height, so nothing is clipped if a panel
       grows — an error in the picker, or line 2 wrapping on a narrow screen
       when an area carries several caveats at once. */
    <div className="relative min-h-28 overflow-hidden rounded-lg border border-border bg-surface p-3">
      {/* Controls sit above every layer, so the three-dot never disappears
          under the overlay it opened. Trash to its left, and only while
          managing — it is a destructive action and should not be one stray tap
          away on a card someone is only reading. */}
      <div className="absolute right-2 top-2 z-30 flex items-center gap-0.5">
        {expanded && !confirmingDelete && (
          <IconButton
            label={`${retiring ? 'Retire' : 'Remove'} ${station.label}`}
            onClick={() => setConfirmingDelete(true)}
          >
            <TrashIcon />
          </IconButton>
        )}
        <IconButton label={`Options for ${station.label}`} onClick={onToggleExpand}>
          <MoreIcon />
        </IconButton>
      </div>

      {!expanded && (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setDetailOpen((v) => !v)
            }
          }}
        >
          {/* Only the reading needs to clear the controls — it sits beside
              them. The detail list below is past them, so it runs the full
              width of the card and its rule lines up with the left edge. */}
          <div className="pr-16">{reading}</div>
          {detailOpen && detail}
        </div>
      )}

      {expanded && (
        <>
          {/* The card, blacked out to 95%. Absolutely positioned so the panel in
              flow below sets the card's height — otherwise an overlay tall
              enough for a dropdown would be clipped by a two-line card. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 p-3 opacity-5">
            {reading}
          </div>

          <div className="relative pr-16">
            {confirmingDelete ? (
              <>
                <p className="text-sm font-medium">
                  {retiring ? `Retire ${station.label}?` : `Remove ${station.label}?`}
                </p>
                {retiring && (
                  <p className="mt-1 text-xs text-text-secondary">
                    Past logged samples will not be deleted.
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => {
                      setConfirmingDelete(false)
                      onDelete(area, sampleCount)
                    }}
                    className="rounded-lg bg-zone-unhealthy px-4 py-2 text-sm font-semibold text-white"
                  >
                    {retiring ? 'Retire' : 'Remove'}
                  </button>
                  {/* Backing out of a delete returns the card to rest, not to
                      the menu it came through. "Cancel" here means "I did not
                      want to do that", and dropping someone back onto the
                      replace panel answers a question they were not asking. */}
                  <button
                    onClick={() => {
                      setConfirmingDelete(false)
                      onToggleExpand()
                    }}
                    className="text-sm text-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* No visible heading. The overlay sits inside the card you
                    just tapped, bounded by its border, with its neighbours
                    untouched — position already answers "which area is this?",
                    so a heading repeating the name bought 21px of height and
                    little else. The name is kept as the select's accessible
                    name, so nothing is lost to a screen reader, which cannot
                    use position as the cue.
                    No reassurance about logged samples here either: replacing
                    deletes nothing, it repoints the area, and every logged
                    sample keeps the station and AQI it recorded at capture
                    time. That line belongs on the confirmation, where
                    something is actually removed. */}
                <div>
                  <AreaPicker
                    id={`kawasan-${station.id}`}
                    districts={districts}
                    takenLabels={takenLabels}
                    ariaLabel={`Replace ${station.label}`}
                    submitLabel="Replace"
                    resolveAt={resolveAt}
                    kawasanAt={kawasanAt}
                    onSubmit={async (next) => {
                      await onReplace(area, next)
                      onToggleExpand()
                    }}
                    onCancel={onToggleExpand}
                  />
                </div>

              </>
            )}
          </div>
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

  // Areas already in the list. Passed to every picker so the same kawasan
  // cannot be added twice — a second card for one place would show a duplicate
  // reading and split its samples across two identities for no reason.
  const takenLabels = locationsApi.activeLocations.map((l) => l.label)

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
                takenLabels={takenLabels}
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
                  takenLabels={takenLabels}
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
                {/* The capsule hugs its text rather than the card. `self-start`
                    is what does it — a flex column stretches its children by
                    default, which is why it was spanning the full width. It
                    still truncates at the card edge, so the cards stay one
                    size. */}
                <div className="max-w-full self-start truncate rounded-full bg-border px-2 py-0.5 text-[10px] text-text-secondary">
                  {s.location}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-bg p-4">
        {!hasLocations ? (
          // Opens the same in-card picker as "+ Add area" above. It used to
          // route to the Locations screen, which meant the very first thing a
          // new person saw was a different add flow from the one they would use
          // ever after — and one still carrying the suppressible window.confirm
          // that made its trash button look broken.
          <button
            onClick={() => setAddingArea(true)}
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
