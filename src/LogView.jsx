import { useRef, useState } from 'react'
import {
  REFERENCE_SWATCHES,
  MAX_LOCATION_CHANGES,
  MAX_STATION_RADIUS_KM,
  PROVENANCE,
  CONFIDENCE_BANDS,
  getAqiZone,
} from './constants'

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
    `Date: ${date.toLocaleDateString()}`,
    `Time: ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    `Location: ${locationLine}`,
    `AQI: ${sample.aqi ?? 'n/a'} (${zone})`,
    `PM2.5 raw: ${sample.pm25 != null ? `${sample.pm25} ug/m3` : 'n/a'}`,
    `Station: ${sample.stationName ?? 'n/a'}${sel?.distanceKm != null ? ` (${sel.distanceKm}km, Tier ${sel.tier}, ${sel.confidenceBand ?? 'n/a'})` : ''}`,
    `Provenance: ${sample.provenance ?? 'n/a'}`,
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

function LocationEditor({ sample, aqiStations, locations, onUpdateLocation, onClose }) {
  const [showHistory, setShowHistory] = useState(false)
  const changeCount = sample.locationChanges?.length ?? 0
  const locked = changeCount >= MAX_LOCATION_CHANGES

  // Only locations currently backed by a confirmed live AQI reading are
  // selectable — this is the coverage check, not a free-text field.
  const availableLocations = locations.filter((loc) => {
    const station = aqiStations?.find((s) => s.id === loc.id)
    return typeof station?.aqi === 'number'
  })

  return (
    <div className="mt-2 rounded-lg border border-border bg-bg p-3">
      {locked ? (
        <p className="text-xs text-zone-unhealthy">Location locked — 3 changes used.</p>
      ) : availableLocations.length === 0 ? (
        <p className="text-xs text-text-secondary">No AQI station within range — pick from the list.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {availableLocations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => {
                onUpdateLocation(loc.id)
                onClose()
              }}
              disabled={loc.id === sample.locationId}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                loc.id === sample.locationId
                  ? 'border-accent bg-accent text-black'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {loc.label}
            </button>
          ))}
        </div>
      )}

      {changeCount > 0 && (
        <div className="mt-2">
          <button className="text-xs text-accent" onClick={() => setShowHistory((v) => !v)}>
            {changeCount} of {MAX_LOCATION_CHANGES} location changes used
            {showHistory ? ' ↑' : ' ↓'}
          </button>
          {showHistory && (
            <ul className="mt-1.5 space-y-1">
              {sample.locationChanges.map((c, i) => (
                <li key={i} className="font-mono-data text-[11px] text-text-secondary">
                  {c.from} → {c.to} · {new Date(c.changedAt).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button className="mt-2 text-xs text-text-secondary" onClick={onClose}>
        Cancel
      </button>
    </div>
  )
}

function bandLabel(key) {
  return CONFIDENCE_BANDS.find((b) => b.key === key)?.label ?? 'Unknown confidence'
}

function SwipeRow({ sample, aqiStations, locations, display, onDelete, onUpdateLocation }) {
  const [dragX, setDragX] = useState(0)
  const [editingLocation, setEditingLocation] = useState(false)
  const startRef = useRef(null)
  const baseRef = useRef(0)
  const draggingRef = useRef(false)

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    startRef.current = e.clientX
    baseRef.current = dragX
    draggingRef.current = true
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return
    e.preventDefault()
    const delta = e.clientX - startRef.current
    setDragX(Math.max(-88, Math.min(0, baseRef.current + delta)))
  }
  function onPointerUp() {
    draggingRef.current = false
    setDragX((x) => (x < -44 ? -88 : 0))
  }

  const date = new Date(sample.createdAt)
  const zone = typeof sample.aqi === 'number' ? getAqiZone(sample.aqi) : null
  const isUnverified = sample.provenance === PROVENANCE.UNVERIFIED
  const isNoCoverage = sample.provenance === PROVENANCE.NO_COVERAGE
  const selection = sample.stationSelection ?? null
  const changeCount = sample.locationChanges?.length ?? 0

  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      <div className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-zone-unhealthy">
        <button
          onClick={() => {
            if (window.confirm('Delete this sample? This cannot be undone.')) {
              onDelete(sample.id)
            } else {
              setDragX(0)
            }
          }}
          className="px-4 text-sm font-medium text-white"
        >
          Delete
        </button>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ transform: `translateX(${dragX}px)`, touchAction: 'pan-y' }}
        className="relative select-none bg-surface p-3 transition-transform"
      >
        <div className="flex gap-3">
          <div className="h-16 w-16 shrink-0 rounded" style={{ backgroundColor: sample.averagedHex }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-data text-base">{sample.averagedHex}</span>
              <div className="flex items-center gap-1.5">
                {isUnverified && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-secondary">
                    Unverified AQI source
                  </span>
                )}
                {zone && (
                  <span className="rounded-full px-2 py-0.5 text-[10px] text-black" style={{ backgroundColor: zone.color }}>
                    {zone.label}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-0.5 font-mono-data text-sm text-text-secondary">
              {sample.aqi == null ? 'No AQI' : `AQI ${sample.aqi}`}
              {sample.pm25 != null ? ` · ${sample.pm25} µg/m³` : ''}
              {sample.stationName ? ` · ${sample.stationName}` : sample.aqi != null ? ' · manual entry' : ''}
            </div>
            {/* Distance, tier and band together: how far the reading came from,
                how much the sensor can be trusted, and how well it describes
                this spot. All three are separate facts. */}
            {selection?.distanceKm != null && (
              <div className="mt-0.5 font-mono-data text-[11px] text-text-secondary">
                {selection.distanceKm}km · Tier {selection.tier} · {bandLabel(selection.confidenceBand)}
                {selection.suspect ? ' · suspect' : ''}
              </div>
            )}
            {isNoCoverage && (
              <div className="mt-0.5 text-[11px] text-zone-moderate">
                No monitoring station within {MAX_STATION_RADIUS_KM}km. Sample saved without AQI.
              </div>
            )}
            <div className="mt-0.5 truncate text-xs text-text-secondary">
              {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            {/* Sun geometry: how far from the sun, and how high. Both change the
                sampled colour more than a 50-point AQI move does. */}
            {sample.skyGeometry?.sensorAvailable && (
              <div className="mt-0.5 flex items-center gap-1.5 font-mono-data text-[11px] text-text-secondary">
                <span>
                  {sample.skyGeometry.scatteringAngle != null
                    ? `${sample.skyGeometry.scatteringAngle}° from sun`
                    : 'sun angle unknown'}
                  {' · '}
                  {sample.skyGeometry.cameraElevation}° elevation
                </span>
                <span className={sample.geometryCompliant ? 'text-zone-good' : 'text-text-secondary'}>
                  {sample.geometryCompliant ? '✓' : '○'}
                </span>
              </div>
            )}
            <button
              onClick={() => setEditingLocation((v) => !v)}
              className="mt-0.5 text-left text-xs underline decoration-dotted text-text-secondary"
            >
              {sample.location}
              {/* Sub-location is masked by default so the real log can go on a
                  projector without exposing free-text place names. */}
              {!display?.maskSubLocations && sample.subLocation ? ` — ${sample.subLocation}` : ''}
              {changeCount > 0 ? ` (${changeCount} of ${MAX_LOCATION_CHANGES} changes)` : ''}
            </button>
            {sample.tapSamples?.length > 0 && (
              <div className="mt-1.5 flex gap-1">
                {sample.tapSamples.map((hex, i) => (
                  <span key={i} className="h-4 w-4 rounded-sm border border-border" style={{ backgroundColor: hex }} />
                ))}
              </div>
            )}
            {sample.averagedHexGeometryAdjusted &&
              sample.averagedHexGeometryAdjusted !== sample.averagedHexLinear && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    className="h-3 w-3 rounded-sm border border-border"
                    style={{ backgroundColor: sample.averagedHexGeometryAdjusted }}
                  />
                  <span className="font-mono-data text-[10px] text-text-secondary">
                    {sample.averagedHexGeometryAdjusted} geometry-adjusted (provisional)
                  </span>
                </div>
              )}
            {sample.notes && <p className="mt-1.5 text-xs text-text-secondary">{sample.notes}</p>}
          </div>
        </div>
        {editingLocation && (
          <LocationEditor
            sample={sample}
            aqiStations={aqiStations}
            locations={locations}
            onUpdateLocation={(newLocationId) => onUpdateLocation(sample, newLocationId)}
            onClose={() => setEditingLocation(false)}
          />
        )}
      </div>
    </div>
  )
}

export default function LogView({ log, aqiStations, locations, display, attribution, onBack }) {
  const [onlyCompliant, setOnlyCompliant] = useState(false)
  const { samples, deleteSample, updateSample, stats } = log

  // Non-compliant samples stay valid data — the filter hides them from
  // side-by-side comparison, it does not discard them.
  const visibleSamples = onlyCompliant ? samples.filter((s) => s.geometryCompliant) : samples

  const dotsBySwatch = REFERENCE_SWATCHES.map(() => [])
  samples.forEach((s) => {
    if (s.averagedHex) dotsBySwatch[nearestSwatchIndex(s.averagedHex)].push(s)
  })

  // Changing a sample's location never rewrites its AQI — that reading was
  // taken at capture time against a specific station. It just re-labels the
  // location and marks the sample unverified, plus appends to the audit trail.
  function handleUpdateLocation(sample, newLocationId) {
    if ((sample.locationChanges?.length ?? 0) >= MAX_LOCATION_CHANGES) return
    const newLocation = locations.find((l) => l.id === newLocationId)
    if (!newLocation) return
    updateSample(sample.id, (s) => ({
      ...s,
      locationId: newLocationId,
      location: newLocation.label,
      provenance: PROVENANCE.UNVERIFIED,
      locationChanges: [
        ...(s.locationChanges ?? []),
        { from: s.locationId, to: newLocationId, changedAt: new Date().toISOString() },
      ],
    }))
  }

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
            {stats.zoneCoverage.map((zone) => (
              <span
                key={zone.key}
                className={`rounded-full border px-2 py-1 text-xs ${
                  zone.covered ? 'border-zone-good text-zone-good' : 'border-border text-text-secondary'
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
                aqiStations={aqiStations}
                locations={locations}
                display={display}
                onDelete={deleteSample}
                onUpdateLocation={handleUpdateLocation}
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
