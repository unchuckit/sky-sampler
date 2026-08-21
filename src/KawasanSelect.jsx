import { useMemo } from 'react'

/**
 * Kawasan (kecamatan) picker, grouped by kota.
 *
 * The list is derived at runtime from whatever kecamatan appear in the current
 * station snapshot, so it only ever offers places that actually have monitoring
 * coverage — you cannot pick somewhere that would produce an area with no AQI
 * provenance. It also stays current as DKI adds or retires stations, with no
 * code change.
 *
 * "Use my location" sits in the same dropdown rather than beside it. Picking a
 * kawasan and detecting one are the same decision — which area is this? — so
 * they belong in the same control, and it keeps the choice to a single tap on a
 * phone held one-handed outdoors.
 */

export const USE_MY_LOCATION = '__use-my-location__'

export default function KawasanSelect({
  districts,
  value,
  onChange,
  id,
  placeholder = 'Select new area',
  locating = false,
  takenLabels = [],
  // For the replace panel, which drops its visible heading to save height —
  // position tells a sighted person which card they are editing, but a screen
  // reader needs the name said out loud.
  ariaLabel,
}) {
  const takenSet = useMemo(() => new Set(takenLabels), [takenLabels])

  const byKota = useMemo(() => {
    const groups = new Map()
    for (const d of districts) {
      if (!groups.has(d.kota)) groups.set(d.kota, [])
      groups.get(d.kota).push(d)
    }
    return [...groups.entries()]
  }, [districts])

  if (!districts.length) {
    return (
      <p className="text-xs text-text-secondary">
        No kawasan available — air quality data has not loaded.
      </p>
    )
  }

  // The native arrow sits hard against the right edge and its inset is not
  // ours to control — it differs per browser and ignores padding on some. Drawn
  // by hand instead, so it keeps a deliberate margin from the border.
  return (
    <div className="relative">
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={locating}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded border border-border bg-bg py-2 pl-3 pr-10 text-sm disabled:opacity-60"
      >
        <option value="">{locating ? 'Finding your kawasan…' : placeholder}</option>
        <option value={USE_MY_LOCATION}>Use my location</option>
        {byKota.map(([kota, list]) => (
          <optgroup key={kota} label={kota}>
            {list.map((d) => {
              // An area already in the list is shown but not selectable —
              // greyed rather than hidden. Removing it outright would leave
              // someone hunting for a kawasan they can see on a card, with
              // nothing explaining where it went. The greying carries that on
              // its own; a trailing explanation only added noise to the row.
              const taken = takenSet.has(d.kecamatan)
              return (
                <option
                  key={districtKey(d)}
                  value={districtKey(d)}
                  disabled={taken}
                  className={taken ? 'text-text-secondary' : undefined}
                >
                  {d.kecamatan}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  )
}

export function districtKey(d) {
  return `${d.kota}|${d.kecamatan}`
}

export function findDistrict(districts, key) {
  return districts.find((d) => districtKey(d) === key) ?? null
}
