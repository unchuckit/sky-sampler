import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'sky-sampler-display'

// Display-only preferences. These never change stored data — they change what is
// rendered.
//
// maskSubLocations exists because the demo toggle lets the presenter switch to
// live data on stage, which means the real log — including free-text
// sub-location labels like "Backyard" — appears on a projector. On by default,
// and independent of demo mode: it is a display filter, not a data change, and
// the underlying values stay intact and visible when it is off.
const DEFAULTS = {
  maskSubLocations: true,
  showGeometryAdjusted: false,
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function useDisplaySettings() {
  const [settings, setSettings] = useState(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // A failure to persist a display preference is not worth surfacing.
    }
  }, [settings])

  const toggle = useCallback((key) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return { ...settings, toggle }
}
