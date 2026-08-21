import { useState } from 'react'
import { PROVENANCE, MAX_STATION_RADIUS_KM, CONFIDENCE_BANDS, getAqiZone, tierLabel } from './constants'
import { formatDate, formatTime } from './time'

function bandLabel(key) {
  return CONFIDENCE_BANDS.find((b) => b.key === key)?.label ?? 'Unknown confidence'
}

export default function SaveEntry({ draft, aqiStations, locations, demo, snapshotAgeMinutes, onSave, onCancel }) {
  const [locationId, setLocationId] = useState(draft.locationId)
  const [subLocation, setSubLocation] = useState(draft.subLocation || '')
  const [editingLocation, setEditingLocation] = useState(false)
  const [editingSubLocation, setEditingSubLocation] = useState(false)
  const [manualAqiInput, setManualAqiInput] = useState('')
  const [notes, setNotes] = useState('')
  const [showAllFrames, setShowAllFrames] = useState(false)

  // A capture during a demo stamps with the demo clock, not the wall clock, so
  // a live capture in the Aspirational zone reads 10:45 AM regardless of when
  // the talk is actually happening.
  const now = demo?.active && demo.demoNow ? demo.demoNow : new Date()
  const location = locations.find((l) => l.id === locationId)
  const hasFrames = draft.frames && draft.frames.length > 0
  const selectedFrame = hasFrames ? draft.frames[draft.selectedFrameIndex] : null

  // The AQI object always comes from whichever location is currently selected —
  // never a shared "last fetched" value. If the location was changed here (as
  // opposed to at capture time), re-derive from the live per-location reading
  // rather than carrying over the AQI captured for the old location.
  const locationChanged = locationId !== draft.locationId
  const liveAqiForLocation = aqiStations?.find((s) => s.id === locationId) ?? null
  const boundAqi = locationChanged
    ? liveAqiForLocation
    : {
        aqi: draft.aqi,
        pm25: draft.pm25,
        stationName: draft.stationName,
        stationUid: draft.stationUid,
        apiTimestamp: draft.apiTimestamp,
        manual: draft.aqiProvenance === PROVENANCE.UNVERIFIED && draft.stationName == null,
      }

  const effectiveAqi = manualAqiInput !== '' ? Number(manualAqiInput) : boundAqi?.aqi ?? null
  const zone = typeof effectiveAqi === 'number' ? getAqiZone(effectiveAqi) : null

  // Two different reasons an AQI can be missing, and they are not the same thing:
  //   - no station passed the 15km / 2h gates → a real coverage finding, and the
  //     sample saves anyway with aqi: null and provenance 'no-coverage'
  //   - the fetch failed, or the location has no station object at all → the
  //     user is asked to pick another location or enter a number
  const stationForLocation = locationChanged ? liveAqiForLocation : null
  const isNoCoverage =
    effectiveAqi == null &&
    (draft.aqiProvenance === PROVENANCE.NO_COVERAGE || stationForLocation?.noCoverage === true)
  const blockedForMissingAqi = effectiveAqi == null && !isNoCoverage
  const activeSelection = locationChanged
    ? liveAqiForLocation?.stationSelection ?? null
    : draft.stationSelection ?? null

  function handleSave() {
    if (blockedForMissingAqi) return
    const usedManualEntry = manualAqiInput !== ''
    const selection = locationChanged
      ? liveAqiForLocation?.stationSelection ?? null
      : draft.stationSelection ?? null

    onSave({
      location: location?.label ?? 'Unknown',
      locationId,
      subLocation,
      createdAt: now.toISOString(),
      // How old the AQI snapshot was at the moment of capture. Never shown,
      // but kept for provenance — see constants.js.
      snapshotAgeMinutes: snapshotAgeMinutes ?? null,
      aqi: effectiveAqi,
      stationName: usedManualEntry ? null : boundAqi?.stationName ?? null,
      stationUid: usedManualEntry ? null : boundAqi?.stationUid ?? null,
      apiTimestamp: usedManualEntry ? null : boundAqi?.apiTimestamp ?? null,
      provenance: isNoCoverage
        ? PROVENANCE.NO_COVERAGE
        : usedManualEntry || boundAqi?.manual
          ? PROVENANCE.UNVERIFIED
          : PROVENANCE.VERIFIED,
      stationSelection: usedManualEntry ? null : selection,
      confidenceBand: usedManualEntry ? null : selection?.confidenceBand ?? null,
      locationChanges: [],
      pm25: usedManualEntry ? null : boundAqi?.pm25 ?? null,
      averagedHex: draft.averagedHex,
      averagedHexLinear: draft.averagedHexLinear ?? null,
      // Provisional and additive. averagedHexLinear stays the source of truth.
      averagedHexGeometryAdjusted: draft.averagedHexGeometryAdjusted ?? null,
      geometryCorrectionModel: draft.geometryCorrectionModel ?? null,
      linearCorrectable: draft.linearCorrectable ?? false,
      // Whole-degree derived values only — the GPS fix that produced them was
      // discarded in CaptureFlow and never reaches storage.
      skyGeometry: draft.skyGeometry ?? null,
      geometryCompliant: draft.geometryCompliant ?? false,
      geometryWarningsFired: draft.geometryWarningsFired ?? [],
      tapSamples: draft.tapSamples,
      frames: draft.frames,
      selectedFrameIndex: draft.selectedFrameIndex,
      frameSelectionType: draft.frameSelectionType,
      notes,
      mode: draft.mode,
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <button onClick={onCancel} className="text-sm text-text-secondary">
          Back
        </button>
        <span className="text-sm font-medium">Save entry</span>
        <span className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="flex flex-col items-center gap-2">
          <div className="h-28 w-28 rounded-lg border border-border" style={{ backgroundColor: draft.averagedHex }} />
          <span className="font-mono-data text-xl">{draft.averagedHex}</span>
        </div>

        {draft.tapSamples?.length > 0 && (
          <div>
            <div className="text-xs text-text-secondary">5 tap samples</div>
            <div className="mt-1 flex gap-1.5">
              {draft.tapSamples.map((hex, i) => (
                <span key={i} className="h-8 w-8 rounded border border-border" style={{ backgroundColor: hex }} />
              ))}
            </div>
          </div>
        )}

        {hasFrames && (
          <div>
            <div className="text-xs text-text-secondary">Frame used</div>
            <div className="mt-1 flex items-center gap-3">
              <img src={selectedFrame.dataUrl} alt="Selected frame" className="h-16 w-16 rounded object-cover" />
              <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">
                {draft.frameSelectionType}
              </span>
            </div>
          </div>
        )}

        {hasFrames && (
          <div>
            <button
              className="text-xs text-accent"
              onClick={() => setShowAllFrames((v) => !v)}
            >
              {showAllFrames ? 'Hide all frames ↑' : 'Show all frames ↓'}
            </button>
            {showAllFrames && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {draft.frames.map((f, i) => (
                  <div key={i} className="overflow-hidden rounded border border-border">
                    <img src={f.dataUrl} alt={`Frame ${i + 1}`} className="h-14 w-full object-cover" />
                    <div className="flex items-center justify-center gap-1 bg-surface py-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: f.centreHex }} />
                      <span className="font-mono-data text-[10px]">{f.centreHex}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-text-secondary">Date</div>
            <div className="font-mono-data text-sm">{formatDate(now)}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Time</div>
            <div className="font-mono-data text-sm">{formatTime(now)}</div>
          </div>
        </div>

        <div>
          <div className="text-xs text-text-secondary">Location</div>
          {editingLocation ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => {
                    setLocationId(loc.id)
                    setEditingLocation(false)
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    locationId === loc.id ? 'border-accent bg-accent text-black' : 'border-border bg-surface'
                  }`}
                >
                  {loc.label}
                </button>
              ))}
            </div>
          ) : (
            <button onClick={() => setEditingLocation(true)} className="mt-1 text-sm underline decoration-dotted">
              {location?.label ?? 'Unknown'}
            </button>
          )}
        </div>

        <div>
          <div className="text-xs text-text-secondary">Sub-location</div>
          {editingSubLocation ? (
            <input
              autoFocus
              type="text"
              value={subLocation}
              onChange={(e) => setSubLocation(e.target.value)}
              onBlur={() => setEditingSubLocation(false)}
              placeholder="Specific spot e.g. rooftop, corner of Jl X"
              className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm"
            />
          ) : (
            <button onClick={() => setEditingSubLocation(true)} className="mt-1 block text-sm underline decoration-dotted">
              {subLocation || 'Add sub-location'}
            </button>
          )}
        </div>

        <div>
          <div className="text-xs text-text-secondary">AQI at capture</div>
          {typeof effectiveAqi === 'number' ? (
            <div className="mt-1">
              <div className="flex items-center gap-2">
                <span className="font-mono-data text-lg">{effectiveAqi}</span>
                {zone && (
                  <span className="rounded-full px-2 py-0.5 text-xs text-black" style={{ backgroundColor: zone.color }}>
                    {zone.label}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-text-secondary">
                {manualAqiInput !== ''
                  ? 'Entered manually'
                  : boundAqi?.manual
                    ? 'Entered manually'
                    : `${boundAqi?.stationName ?? 'Unknown station'}`}
              </div>
              {manualAqiInput === '' && activeSelection?.distanceKm != null && (
                <div className="mt-0.5 font-mono-data text-xs text-text-secondary">
                  {activeSelection.distanceKm}km · {tierLabel(activeSelection.tier)} ·{' '}
                  {bandLabel(activeSelection.confidenceBand)}
                </div>
              )}
            </div>
          ) : isNoCoverage ? (
            <div className="mt-1">
              <p className="text-sm text-zone-moderate">
                No monitoring station within {MAX_STATION_RADIUS_KM}km. Sample saved without AQI.
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Enter a number if you have one from another source.
              </p>
              <input
                type="number"
                inputMode="numeric"
                placeholder="enter AQI"
                value={manualAqiInput}
                onChange={(e) => setManualAqiInput(e.target.value)}
                className="mt-2 w-24 rounded border border-border bg-surface px-2 py-1 font-mono-data text-sm"
              />
            </div>
          ) : (
            <div className="mt-1">
              <p className="text-sm text-text-secondary">
                No AQI reading for this location — pick another or enter AQI manually.
              </p>
              <input
                type="number"
                inputMode="numeric"
                placeholder="enter AQI"
                value={manualAqiInput}
                onChange={(e) => setManualAqiInput(e.target.value)}
                className="mt-2 w-24 rounded border border-border bg-surface px-2 py-1 font-mono-data text-sm"
              />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-text-secondary" htmlFor="notes">
            Sky conditions
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any clouds? Haze visible? Unusual light?"
            rows={3}
            className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="border-t border-border p-4">
        <button
          disabled={blockedForMissingAqi}
          onClick={handleSave}
          className="w-full rounded-lg bg-accent py-4 text-base font-semibold text-black disabled:opacity-40"
        >
          Save to log
        </button>
      </div>
    </div>
  )
}
