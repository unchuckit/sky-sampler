import { useEffect, useMemo, useState } from 'react'
import { MAX_STATION_RADIUS_KM, CONFIDENCE_BANDS, tierLabel } from './constants'
import { COORDINATE_SOURCE, getCurrentPosition } from './useLocations'

function bandLabel(key) {
  return CONFIDENCE_BANDS.find((b) => b.key === key)?.label ?? null
}

/**
 * A district-centroid distance is measured from the centroid, not from wherever
 * the person actually stands, so it is prefixed to read as an estimate. Without
 * this a centroid that happens to sit on a station shows a bare "0km", which
 * implies standing inside the instrument.
 */
function distanceLabel(distanceKm, source) {
  if (distanceKm == null) return '—'
  return source === COORDINATE_SOURCE.DISTRICT_CENTROID ? `~${distanceKm}km` : `${distanceKm}km`
}

// A district centroid is the mean of that district's own stations, so its error
// is easily a kilometre or more. Claiming high confidence off that would
// overstate what is actually known about where the person stands.
function capBandForSource(band, source) {
  if (source !== COORDINATE_SOURCE.DISTRICT_CENTROID) return band
  return band === 'high' ? 'moderate' : band
}

function AttachmentLine({ area }) {
  if (!area.stationUid) {
    return (
      <span className="text-xs text-zone-moderate">
        No monitoring station within {MAX_STATION_RADIUS_KM}km. Samples from here log without AQI.
      </span>
    )
  }
  return (
    <span className="font-mono-data text-xs text-text-secondary">
      {area.stationName} · {distanceLabel(area.distanceKm, area.coordinateSource)} · {tierLabel(area.tier)} ·{' '}
      {bandLabel(area.confidenceBand)}
    </span>
  )
}

function LocationRow({ area, sampleCount, closerStation, onRename, onRemove, onReactivate, onRecheck }) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(area.label)
  const [rechecking, setRechecking] = useState(false)

  return (
    <div className={`rounded-lg border border-border bg-surface p-3 ${area.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft.trim()) onRename(area.id, draft.trim())
                setRenaming(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="w-full rounded border border-border bg-bg px-2 py-1 text-sm"
            />
          ) : (
            <button
              onClick={() => {
                setDraft(area.label)
                setRenaming(true)
              }}
              className="block text-left text-sm underline decoration-dotted"
            >
              {area.label}
            </button>
          )}

          <div className="mt-1">
            <AttachmentLine area={area} />
          </div>

          {area.coordinateSource === COORDINATE_SOURCE.DISTRICT_CENTROID && (
            <div className="mt-1 text-[11px] text-text-secondary">
              Approximate location — distance to station is estimated.
            </div>
          )}

          {area.needsRecheck && (
            <div className="mt-1.5">
              <p className="text-[11px] text-zone-moderate">
                This area predates station attachment. Re-check to bind it.
              </p>
            </div>
          )}

          {closerStation && !area.needsRecheck && (
            <div className="mt-1.5">
              <p className="text-[11px] text-zone-moderate">A closer station is now available.</p>
            </div>
          )}

          {(area.needsRecheck || closerStation) && (
            <button
              disabled={rechecking}
              onClick={async () => {
                setRechecking(true)
                await onRecheck(area)
                setRechecking(false)
              }}
              className="mt-1 text-xs text-accent disabled:opacity-50"
            >
              {rechecking ? 'Checking…' : 'Re-check this location'}
            </button>
          )}

          <div className="mt-1 font-mono-data text-[10px] text-text-secondary">
            {sampleCount > 0 ? `${sampleCount} sample${sampleCount === 1 ? '' : 's'}` : 'No samples yet'}
          </div>

          {!area.active && (
            <div className="mt-1 text-[10px] text-text-secondary">
              Retired — kept so its logged samples stay attached.
            </div>
          )}
        </div>

        {area.active ? (
          <button onClick={() => onRemove(area, sampleCount)} className="shrink-0 text-xs text-zone-unhealthy">
            {sampleCount > 0 ? 'Retire' : 'Remove'}
          </button>
        ) : (
          <button onClick={() => onReactivate(area.id)} className="shrink-0 text-xs text-accent">
            Restore
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Adding an area.
 *
 * Manual coordinate entry is deliberately absent. Nobody knows their own
 * latitude, and mistyping it silently produces a wrong station attachment —
 * exactly the class of failure this project has already been through once.
 */
function AddAreaForm({ onAdd, checkCoverage, districts, onClose }) {
  const [mode, setMode] = useState('gps')
  const [label, setLabel] = useState('')
  const [districtKey, setDistrictKey] = useState('')
  const [resolved, setResolved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const districtsByKota = useMemo(() => {
    const groups = new Map()
    for (const d of districts) {
      if (!groups.has(d.kota)) groups.set(d.kota, [])
      groups.get(d.kota).push(d)
    }
    return [...groups.entries()]
  }, [districts])

  // Resolve coordinates → station, then drop the coordinates. They are never
  // returned from here and never reach state that gets persisted.
  async function resolveFrom(lat, lng, source) {
    const result = checkCoverage(lat, lng)
    if (!result?.chosen) {
      setResolved({ source, chosen: null })
      return
    }
    setResolved({
      source,
      chosen: result.chosen,
      stationUid: result.chosen.uid,
      stationName: result.chosen.name,
      tier: result.chosen.tier,
      distanceKm: result.selection.distanceKm,
      confidenceBand: capBandForSource(result.selection.confidenceBand, source),
    })
  }

  async function useMyLocation() {
    setBusy(true)
    setError(null)
    try {
      const { lat, lng } = await getCurrentPosition()
      await resolveFrom(lat, lng, COORDINATE_SOURCE.GPS)
    } catch (err) {
      setError(err.message)
      setResolved(null)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (mode !== 'district' || !districtKey) return
    const d = districts.find((x) => `${x.kota}|${x.kecamatan}` === districtKey)
    if (!d) return
    if (!label.trim()) setLabel(d.kecamatan)
    resolveFrom(d.lat, d.lng, COORDINATE_SOURCE.DISTRICT_CENTROID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtKey, mode])

  const canSubmit = Boolean(label.trim() && resolved)

  return (
    <div className="rounded-lg border border-accent/40 bg-surface p-3">
      <div className="flex gap-2">
        {[
          ['gps', 'Use my location'],
          ['district', 'Pick a district'],
        ].map(([key, text]) => (
          <button
            key={key}
            onClick={() => {
              setMode(key)
              setResolved(null)
              setError(null)
            }}
            className={`rounded-full border px-3 py-1 text-xs ${
              mode === key ? 'border-accent bg-accent text-black' : 'border-border text-text'
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {mode === 'gps' ? (
        <button
          onClick={useMyLocation}
          disabled={busy}
          className="mt-3 w-full rounded-lg border border-border py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Getting location…' : 'Use my location'}
        </button>
      ) : (
        <>
          <select
            value={districtKey}
            onChange={(e) => setDistrictKey(e.target.value)}
            className="mt-3 w-full rounded border border-border bg-bg px-3 py-2 text-sm"
          >
            <option value="">Select a district…</option>
            {districtsByKota.map(([kota, list]) => (
              <optgroup key={kota} label={kota}>
                {list.map((d) => (
                  <option key={`${d.kota}|${d.kecamatan}`} value={`${d.kota}|${d.kecamatan}`}>
                    {d.kecamatan}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {districts.length === 0 && (
            <p className="mt-2 text-xs text-text-secondary">
              No districts here have monitoring coverage. Turn on location access to add this place.
            </p>
          )}
        </>
      )}

      {error && (
        <p className="mt-2 text-xs text-zone-moderate">
          {error}. Pick a district instead, or turn on location access and try again.
        </p>
      )}

      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name this area e.g. Pondok Indah"
        className="mt-3 w-full rounded border border-border bg-bg px-3 py-2 text-sm"
      />

      {resolved && (
        <div className="mt-2">
          {resolved.chosen ? (
            <span className="font-mono-data text-xs text-text-secondary">
              {resolved.stationName} · {distanceLabel(resolved.distanceKm, resolved.source)} ·{' '}
              {tierLabel(resolved.tier)} · {bandLabel(resolved.confidenceBand)}
            </span>
          ) : (
            <span className="text-xs text-zone-moderate">
              No monitoring station within {MAX_STATION_RADIUS_KM}km. Samples from here will log without AQI.
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-3">
        <button
          disabled={!canSubmit}
          onClick={() => {
            onAdd({
              label: label.trim(),
              stationUid: resolved.stationUid ?? null,
              stationName: resolved.stationName ?? null,
              distanceKm: resolved.distanceKm ?? null,
              confidenceBand: resolved.confidenceBand ?? null,
              tier: resolved.tier ?? null,
              coordinateSource: resolved.source,
            })
            onClose()
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          Add area
        </button>
        <button onClick={onClose} className="text-sm text-text-secondary">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function LocationsView({ locationsApi, aqi, stationsApi, log, onBack }) {
  const { locations, addLocation, renameLocation, rebindLocation, removeLocation, reactivateLocation } =
    locationsApi
  const [adding, setAdding] = useState(false)

  function sampleCountFor(id) {
    return log.samples.filter((s) => s.locationId === id).length
  }

  function handleRemove(area, sampleCount) {
    const message =
      sampleCount > 0
        ? `Retire ${area.label}? Past logged samples will not be deleted.`
        : `Remove ${area.label}?`
    if (window.confirm(message)) removeLocation(area.id, { hasSamples: sampleCount > 0 })
  }

  // Re-check takes a fresh reading, recomputes, and discards again. Deliberate
  // rather than silent: the app holds no coordinates, so it cannot re-evaluate
  // an area on its own, and a sample's provenance should not change without the
  // person asking for it.
  async function handleRecheck(area) {
    try {
      const { lat, lng } = await getCurrentPosition()
      const result = aqi.checkCoverage(lat, lng)
      rebindLocation(area.id, {
        stationUid: result?.chosen?.uid ?? null,
        stationName: result?.chosen?.name ?? null,
        distanceKm: result?.selection?.distanceKm ?? null,
        confidenceBand: capBandForSource(result?.selection?.confidenceBand ?? null, COORDINATE_SOURCE.GPS),
        tier: result?.chosen?.tier ?? null,
        coordinateSource: COORDINATE_SOURCE.GPS,
      })
    } catch {
      // Denied or unavailable — the area is left exactly as it was.
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <button onClick={onBack} className="text-sm text-text-secondary">
          Back
        </button>
        <span className="text-sm font-medium">Sampling areas</span>
        <button onClick={() => setAdding((v) => !v)} className="text-sm text-accent">
          {adding ? 'Close' : 'Add'}
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-28">
        {adding && (
          <AddAreaForm
            onAdd={addLocation}
            checkCoverage={aqi.checkCoverage}
            districts={stationsApi.districts ?? []}
            onClose={() => setAdding(false)}
          />
        )}

        {locations.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No sampling areas yet — add one to start. Tap Add, then use your location.
          </p>
        ) : (
          locations.map((area) => (
            <LocationRow
              key={area.id}
              area={area}
              sampleCount={sampleCountFor(area.id)}
              closerStation={false}
              onRename={renameLocation}
              onRemove={handleRemove}
              onReactivate={reactivateLocation}
              onRecheck={handleRecheck}
            />
          ))
        )}

        <p className="pt-2 text-xs text-text-secondary">
          Areas are matched to the nearest live station within {MAX_STATION_RADIUS_KM}km. Your coordinates
          are used to find that station and then discarded — they are never stored.
        </p>
      </div>
    </div>
  )
}
