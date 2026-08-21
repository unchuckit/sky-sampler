import { useRef, useState } from 'react'
import {
  REFERENCE_SWATCHES,
  MAX_LOCATION_CHANGES,
  MAX_STATION_RADIUS_KM,
  PROVENANCE,
  CONFIDENCE_BANDS,
  getAqiZone,
  tierLabel,
} from './constants'
import { formatDate, formatTime, formatDateTime } from './time'
import { sampleFlags } from './sampleFlags'
import { stationDisplayName } from './stations'

const STRIP_ZONES = [
  { label: 'Heavy Haze', range: [0, 3] },
  { label: 'Typical Jakarta', range: [4, 7] },
  { label: 'Good Day', range: [8, 11] },
  { label: 'Aspirational', range: [12, 15] },
]

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function nearestSwatchIndex(hex) {
  const [r, g, b] = hexToRgb(hex)
  let bestIdx = 0
  let bestDist = Infinity
  REFERENCE_SWATCHES.forEach((swatch, i) => {
    const [sr, sg, sb] = hexToRgb(swatch)
    const dist = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
    }
  })
  return bestIdx
}

function formatEntry(sample, { maskSubLocations = false } = {}) {
  const date = new Date(sample.createdAt)
  const zone = typeof sample.aqi === 'number' ? getAqiZone(sample.aqi).label : 'unknown'
  const locationLine =
    !maskSubLocations && sample.subLocation ? `${sample.location} — ${sample.subLocation}` : sample.location
  const g = sample.skyGeometry
  const sel = sample.stationSelection
  const tapLine = sample.tapSamples?.length ? sample.tapSamples.join(', ') : 'n/a'
  const frameLine = sample.frameSelectionType
    ? `${sample.frameSelectionType} (centre hex: ${sample.frames?.[sample.selectedFrameIndex]?.centreHex ?? 'n/a'})`
    : 'n/a'
  const allFramesLine = sample.frames?.length ? sample.frames.map((f) => f.centreHex).join(', ') : 'n/a'

  return [
    '---',
    `Date: ${formatDate(date)}`,
    `Time: ${formatTime(date)}`,
    `Location: ${locationLine}`,
    `AQI: ${sample.aqi ?? 'n/a'} (${zone})`,
    `PM2.5 raw: ${sample.pm25 != null ? `${sample.pm25} ug/m3` : 'n/a'}`,
    `Station: ${sample.stationName ?? 'n/a'}${sel?.distanceKm != null ? ` (${sel.distanceKm}km, Tier ${sel.tier}, ${sel.confidenceBand ?? 'n/a'})` : ''}`,
    `Provenance: ${sample.provenance ?? 'n/a'}`,
    `Snapshot age at capture: ${sample.snapshotAgeMinutes != null ? `${sample.snapshotAgeMinutes} min` : 'n/a'}`,
    `Averaged hex: ${sample.averagedHex}`,
    `Averaged hex (linear): ${sample.averagedHexLinear ?? 'n/a'}`,
    `Averaged hex (geometry-adjusted, provisional): ${sample.averagedHexGeometryAdjusted ?? 'n/a'}`,
    `Geometry model: ${sample.geometryCorrectionModel ?? 'n/a'}`,
    `Sky geometry: ${
      g?.sensorAvailable
        ? `${g.scatteringAngle ?? 'n/a'} deg from sun, ${g.cameraElevation} deg elevation, heading ${g.compassHeading} deg`
        : 'not recorded'
    }`,
    `Geometry compliant: ${sample.geometryCompliant ? 'yes' : 'no'}`,
    `5 tap samples: ${tapLine}`,
    `Frame used: ${frameLine}`,
    `All 3 frame centre colours: ${allFramesLine}`,
    `Notes: ${sample.notes || 'n/a'}`,
    '',
  ].join('\n')
}

function exportLog(samples, options) {
  // No coordinates appear anywhere in this file — samples never carried any.
  const header = [
    'Sky Sampler export',
    'AQI data: Udara Jakarta — Dinas Lingkungan Hidup DKI Jakarta',
    'AQI computed from raw PM2.5 using US EPA breakpoints.',
    '',
  ].join('\n')
  const text = header + samples.map((s) => formatEntry(s, options)).join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sky-sampler-log-${new Date().toISOString().slice(0, 10)}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function bandLabel(key) {
  return CONFIDENCE_BANDS.find((b) => b.key === key)?.label ?? 'Unknown confidence'
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

/**
 * How old the station's reading was at the moment the sample was captured.
 *
 * Computed from `apiTimestamp` (when the station reported) and `createdAt`
 * (when the photo was taken) rather than stored separately — both are already
 * on every record, so deriving keeps them from disagreeing and makes the field
 * work for samples logged before it existed.
 */
function readingAgeLabel(sample) {
  if (!sample?.apiTimestamp || !sample?.createdAt) return '—'
  const reported = new Date(sample.apiTimestamp).getTime()
  const captured = new Date(sample.createdAt).getTime()
  if (Number.isNaN(reported) || Number.isNaN(captured)) return '—'
  const hours = (captured - reported) / 3_600_000
  if (hours < 0) return '—'
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))} min old`
  return `${Math.round(hours)}h old`
}

/** One label/value row in the expanded card. */
function DetailRow({ label, children, mono = true }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-text-secondary">{label}</span>
      <span className={`min-w-0 text-right text-[11px] ${mono ? 'font-mono-data' : ''} break-words`}>
        {children}
      </span>
    </div>
  )
}

/**
 * Everything stored about a sample, including the fields the collapsed card
 * never shows. Nothing here is derived for display only — it is all read back
 * out of the record, so this doubles as a way to see exactly what was written.
 */
function SampleDetail({ sample, display }) {
  const selection = sample.stationSelection ?? null
  const g = sample.skyGeometry
  const changeCount = sample.locationChanges?.length ?? 0

  return (
    <div className="mt-3 border-t border-border pt-2">
      {sample.stationName ? (
        <>
          <DetailRow label="Station">{stationDisplayName(sample.stationName)}</DetailRow>
          {/* The UID is what actually binds the sample to an instrument; the
              name is a human label that could be edited upstream. */}
          <DetailRow label="Station UID">{sample.stationUid ?? '—'}</DetailRow>
        </>
      ) : (
        <DetailRow label="Station">{sample.aqi != null ? 'Manual entry' : '—'}</DetailRow>
      )}

      {selection?.distanceKm != null && (
        <DetailRow label="Distance">{selection.distanceKm}km</DetailRow>
      )}
      {selection?.tier && <DetailRow label="Sensor grade">{tierLabel(selection.tier)}</DetailRow>}
      {(selection?.confidenceBand || sample.confidenceBand) && (
        <DetailRow label="Confidence">
          {bandLabel(selection?.confidenceBand ?? sample.confidenceBand)}
        </DetailRow>
      )}
      {selection?.suspect != null && (
        <DetailRow label="Sensor check">
          {selection.suspect ? 'Suspect' : 'Normal'}
          {selection.neighbourDeviation != null
            ? ` · ${selection.neighbourDeviation} µg/m³ from neighbours`
            : ''}
        </DetailRow>
      )}

      {/* The defensible measurement. AQI is derived from this, which is why
          showing both on the collapsed card was showing one number twice. */}
      <DetailRow label="PM2.5 raw">{sample.pm25 != null ? `${sample.pm25} µg/m³` : '—'}</DetailRow>
      <DetailRow label="AQI">{sample.aqi ?? '—'}</DetailRow>
      <DetailRow label="Provenance">{sample.provenance ?? '—'}</DetailRow>
      <DetailRow label="Snapshot age at capture">
        {sample.snapshotAgeMinutes != null ? `${sample.snapshotAgeMinutes} min` : '—'}
      </DetailRow>
      {/* Derived from the two timestamps already on the record rather than
          stored a third time, so it cannot drift out of step with them — and so
          it works for samples logged before this field existed. Always shown:
          expanded is where full provenance lives whether or not it is
          noteworthy. */}
      <DetailRow label="AQI reading age">{readingAgeLabel(sample)}</DetailRow>
      {sample.apiTimestamp && (
        <DetailRow label="Station reading">{formatDateTime(sample.apiTimestamp)}</DetailRow>
      )}

      <DetailRow label="Sky geometry">
        {g?.sensorAvailable
          ? `${g.scatteringAngle != null ? `${g.scatteringAngle}°` : '—'} from sun · ${g.cameraElevation}° elevation · heading ${g.compassHeading}°`
          : 'Not recorded'}
      </DetailRow>
      <DetailRow label="Comparable">
        {sample.geometryCompliant ? 'Yes — in band' : 'No — outside band'}
      </DetailRow>

      <DetailRow label="Averaged hex">{sample.averagedHex}</DetailRow>
      {sample.averagedHexLinear && (
        <DetailRow label="Averaged (linear)">{sample.averagedHexLinear}</DetailRow>
      )}
      {sample.averagedHexGeometryAdjusted && (
        <DetailRow label="Geometry-adjusted">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border align-middle"
              style={{ backgroundColor: sample.averagedHexGeometryAdjusted }}
            />
            {sample.averagedHexGeometryAdjusted} · provisional
          </span>
        </DetailRow>
      )}

      {sample.tapSamples?.length > 0 && (
        <div className="flex items-baseline justify-between gap-3 py-1">
          <span className="shrink-0 text-[11px] text-text-secondary">Tap samples</span>
          <span className="flex gap-1">
            {sample.tapSamples.map((hex, i) => (
              <span
                key={i}
                title={hex}
                className="h-4 w-4 rounded-sm border border-border"
                style={{ backgroundColor: hex }}
              />
            ))}
          </span>
        </div>
      )}

      {sample.frameSelectionType && (
        <DetailRow label="Frame">{sample.frameSelectionType}</DetailRow>
      )}

      {/* Sub-location is masked by default so the real log can go on a
          projector without exposing free-text place names. */}
      {!display?.maskSubLocations && sample.subLocation && (
        <DetailRow label="Sub-location" mono={false}>
          {sample.subLocation}
        </DetailRow>
      )}

      {changeCount > 0 && (
        <div className="mt-1.5">
          <div className="text-[11px] text-text-secondary">
            {changeCount} of {MAX_LOCATION_CHANGES} location changes used
          </div>
          <ul className="mt-1 space-y-0.5">
            {sample.locationChanges.map((c, i) => (
              <li key={i} className="font-mono-data text-[10px] text-text-secondary">
                {c.from} → {c.to} · {formatDateTime(c.changedAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sample.provenance === PROVENANCE.NO_COVERAGE && (
        <p className="mt-1.5 text-[11px] text-zone-moderate">
          No monitoring station within {MAX_STATION_RADIUS_KM}km. Sample saved without AQI.
        </p>
      )}
    </div>
  )
}

// Distance in CSS pixels beyond which a pointer gesture is a swipe rather than
// a tap. Without this the expand-on-tap fires at the end of every swipe.
const TAP_SLOP = 6

function SwipeRow({
  sample,
  display,
  expanded,
  onToggleExpand,
  onDelete,
}) {
  const [dragX, setDragX] = useState(0)
  const startRef = useRef(null)
  const baseRef = useRef(0)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)

  function onPointerDown(e) {
    // Capture keeps the drag alive if the finger leaves the row, but it is an
    // enhancement, not a requirement: it throws NotFoundError whenever the
    // pointer is no longer active, and letting that escape would abort the
    // handler before the gesture even starts and leave the row unresponsive.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Drag still works, it just stops tracking outside the element.
    }
    startRef.current = { x: e.clientX, y: e.clientY }
    baseRef.current = dragX
    draggingRef.current = true
    movedRef.current = false
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y

    // Slop is measured in BOTH axes. Checking only the horizontal delta meant a
    // vertical scroll with a finger resting on a card registered as a tap —
    // dx stays near zero while the page moves — so scrolling the log kept
    // toggling whichever card you happened to start on.
    if (Math.hypot(dx, dy) > TAP_SLOP) movedRef.current = true

    // Only a horizontal intent drags the row. A vertical one is the page
    // scrolling, which touchAction: pan-y already allows.
    if (Math.abs(dx) <= TAP_SLOP) return
    e.preventDefault()
    setDragX(Math.max(-88, Math.min(0, baseRef.current + dx)))
  }
  function onPointerUp() {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (!movedRef.current) {
      // A tap, not a swipe. Snap any partial drag closed and toggle.
      setDragX(0)
      onToggleExpand()
      return
    }
    setDragX((x) => (x < -44 ? -88 : 0))
  }
  // Never a tap. The browser fires this when it takes the gesture over for a
  // native scroll, and routing it through onPointerUp meant a hijacked scroll
  // toggled the card exactly like a deliberate press.
  function onPointerCancel() {
    draggingRef.current = false
    movedRef.current = false
    setDragX((x) => (x < -44 ? -88 : 0))
  }

  const zone = typeof sample.aqi === 'number' ? getAqiZone(sample.aqi) : null
  const flags = sampleFlags(sample)

  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      {/* Rendered only while the row is actually swiped. Kept mounted at rest it
          sat behind the card and bled a red sliver along the bottom-right edge
          wherever the content's height rounded to a fraction of a pixel — which
          read as a stray orange outline on a card nobody had touched. */}
      {dragX < 0 && (
        <div className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-zone-unhealthy">
          <button
            aria-label="Delete this sample"
            onClick={() => {
              if (window.confirm('Delete this sample? This cannot be undone.')) {
                onDelete(sample.id)
              } else {
                setDragX(0)
              }
            }}
            className="p-4 text-white"
          >
            <TrashIcon />
          </button>
        </div>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleExpand()
          }
        }}
        style={{ transform: `translateX(${dragX}px)`, touchAction: 'pan-y' }}
        className="relative select-none bg-surface p-3 transition-transform"
      >
        <div className="flex gap-3">
          {/* The colour is the finding — this project exists to establish blue
              values, so the swatch and the hex lead and everything else defers. */}
          <div className="h-16 w-16 shrink-0 rounded" style={{ backgroundColor: sample.averagedHex }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono-data text-xl font-semibold">{sample.averagedHex}</span>
              {zone && (
                <span
                  className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] text-black"
                  style={{ backgroundColor: zone.color }}
                >
                  {zone.label}
                </span>
              )}
            </div>

            {/* Where, then what, then when. The AQI sits beside the area rather
                than after the timestamp: it is the reading the colour is being
                compared against, so it belongs next to the place it describes,
                and the date is the part you scan for last.
                Wraps rather than truncates. An AQI cut to "AQI 1…" is the same
                failure as an area name cut to "Mampang Pra…" — the line exists
                to carry those three facts, so it gets the height it needs. */}
            <div className="mt-1 font-mono-data text-[11px] text-text-secondary">
              {sample.location}
              {sample.aqi != null ? ` · AQI ${sample.aqi}` : ''}
              {` · ${formatDateTime(sample.createdAt)}`}
            </div>

            {/* Silence means fine. This line appears only when something is
                actually off — see sampleFlags.js. */}
            {flags.length > 0 && (
              <div className="mt-0.5 text-[11px] text-zone-moderate">
                {flags.map((f) => f.label).join(' · ')}
              </div>
            )}

            {/* The person's own observation, and the most human thing on the
                card — so it stays visible collapsed, clipped to one line, and
                opens out in place rather than being repeated below. */}
            {sample.notes && (
              <p className={`mt-0.5 text-xs text-text-secondary ${expanded ? '' : 'truncate'}`}>
                {sample.notes}
              </p>
            )}
          </div>
        </div>

        {expanded && <SampleDetail sample={sample} display={display} />}
      </div>
    </div>
  )
}

export default function LogView({ log, display, attribution, onBack }) {
  const [onlyCompliant, setOnlyCompliant] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const { samples, deleteSample, stats } = log

  // Non-compliant samples stay valid data — the filter hides them from
  // side-by-side comparison, it does not discard them.
  const visibleSamples = onlyCompliant ? samples.filter((s) => s.geometryCompliant) : samples

  const dotsBySwatch = REFERENCE_SWATCHES.map(() => [])
  samples.forEach((s) => {
    if (s.averagedHex) dotsBySwatch[nearestSwatchIndex(s.averagedHex)].push(s)
  })

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <button onClick={onBack} className="text-sm text-text-secondary">
          Back
        </button>
        <span className="text-sm font-medium">Log</span>
        <button
          onClick={() => exportLog(samples, { maskSubLocations: display?.maskSubLocations })}
          disabled={samples.length === 0}
          className="text-sm text-accent disabled:opacity-40"
        >
          Export
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-5">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text-secondary">Progress</span>
            <span className="font-mono-data text-sm">
              {stats.count} of {stats.goal} samples collected
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm text-text-secondary">AQI range covered</span>
            <span className="font-mono-data text-sm">
              {stats.aqiRange ? `${stats.aqiRange.min}–${stats.aqiRange.max}` : '—'}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {/* One border colour for every chip. Coverage is carried by the
                ✓/○ marker and by the text weight, not by a colour — the same
                reason the sample cards stopped announcing "Tier A · High". */}
            {stats.zoneCoverage.map((zone) => (
              <span
                key={zone.key}
                className={`rounded-full border border-border px-2 py-1 text-xs ${
                  zone.covered ? 'text-text' : 'text-text-secondary'
                }`}
              >
                {zone.covered ? '✓' : '○'} {zone.label}
              </span>
            ))}
          </div>

          <div className="mt-4 pt-3">
            <div className="relative flex h-8 w-full">
              {REFERENCE_SWATCHES.map((hex, i) => (
                <div key={i} className="relative flex-1">
                  {dotsBySwatch[i].length > 0 && (
                    <div className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 gap-0.5">
                      {dotsBySwatch[i].slice(0, 3).map((s) => (
                        <span key={s.id} className="h-1.5 w-1.5 rounded-full bg-accent" />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="absolute inset-0 flex overflow-hidden rounded">
                {REFERENCE_SWATCHES.map((hex, i) => (
                  <div key={i} className="flex-1" style={{ backgroundColor: hex }} />
                ))}
              </div>
            </div>
            <div className="mt-1 flex text-[9px] text-text-secondary">
              {STRIP_ZONES.map((z) => (
                <div key={z.label} className="flex-1 text-center">
                  {z.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setOnlyCompliant((v) => !v)}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              onlyCompliant ? 'border-accent bg-accent text-black' : 'border-border text-text-secondary'
            }`}
          >
            {onlyCompliant ? '✓ Comparable only' : 'Comparable only'}
          </button>
          <span className="font-mono-data text-xs text-text-secondary">
            {visibleSamples.length} of {samples.length}
          </span>
        </div>

        {samples.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No samples yet — wait for a good sky day and hit Sample the sky.
          </p>
        ) : visibleSamples.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No samples in the comparable band yet — 60–120° from the sun, above 45° elevation.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleSamples.map((sample) => (
              <SwipeRow
                key={sample.id}
                sample={sample}
                display={display}
                expanded={expandedId === sample.id}
                onToggleExpand={() =>
                  setExpandedId((id) => (id === sample.id ? null : sample.id))
                }
                onDelete={deleteSample}
              />
            ))}
          </div>
        )}

        {/* Persistent, not dismissible — Udara Jakarta's terms permit personal
            and non-commercial use with proper attribution. */}
        <p className="pt-4 text-[11px] text-text-secondary">
          {attribution ?? 'AQI data: Udara Jakarta — Dinas Lingkungan Hidup DKI Jakarta'}
        </p>
      </div>
    </div>
  )
}
