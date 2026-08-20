import { useMemo } from 'react'

/**
 * Kawasan (kecamatan) picker, grouped by kota.
 *
 * The list is derived at runtime from whatever kecamatan appear in the current
 * station snapshot, so it only ever offers places that actually have monitoring
 * coverage — you cannot pick somewhere that would produce an area with no AQI
 * provenance. It also stays current as DKI adds or retires stations, with no
 * code change.
 */
export default function KawasanSelect({ districts, value, onChange, id, placeholder = 'Select a kawasan…' }) {
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

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-border bg-bg px-3 py-2 text-sm"
    >
      <option value="">{placeholder}</option>
      {byKota.map(([kota, list]) => (
        <optgroup key={kota} label={kota}>
          {list.map((d) => (
            <option key={districtKey(d)} value={districtKey(d)}>
              {d.kecamatan}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function districtKey(d) {
  return `${d.kota}|${d.kecamatan}`
}

export function findDistrict(districts, key) {
  return districts.find((d) => districtKey(d) === key) ?? null
}
