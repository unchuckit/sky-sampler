import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEMO_ZONES, DEMO_ZONE_ORDER, demoClockFor } from './constants'

// Demo mode, driven from React state rather than the URL.
//
// The stage constraint that shapes this: the presenter is already operating a
// wireless clicker advancing cloud-loop footage on a projector. Every control
// the phone adds is another thing to keep in sync mid-sentence. So the DEMO pill
// — which has to be on screen anyway — is the control, and the only gesture
// during a normal run is "tap to advance", matching "press next" on the clicker.
//
// DEMO_ZONE_ORDER must match the OBS hotkey order. See README.

const URL_PARAM = 'demo'

function zoneFromUrl() {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get(URL_PARAM)
  return raw && DEMO_ZONES[raw] ? raw : null
}

/**
 * Mirror demo state to the URL so an accidental refresh lands in the same place.
 * Only demo on/off and the zone go here — never a sampling area, coordinates, or
 * note text. URLs persist in history, leak via referrers, and end up in any
 * screenshot of the address bar.
 */
function syncUrl(zoneKey) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (zoneKey) url.searchParams.set(URL_PARAM, zoneKey)
  else url.searchParams.delete(URL_PARAM)
  window.history.replaceState({}, '', url.pathname + (url.search || '') )
}

export function useDemoMode() {
  const [zoneKey, setZoneKey] = useState(zoneFromUrl)
  // Bumped on every reset. Components key off it to clear their own flow state
  // without a reload — no white flash, no lost camera permission, no service
  // worker update prompt mid-talk.
  const [resetToken, setResetToken] = useState(0)
  const wakeLockRef = useRef(null)

  const active = zoneKey != null

  useEffect(() => {
    syncUrl(zoneKey)
  }, [zoneKey])

  // A phone dimming or locking mid-demo, on a projector, is an avoidable failure.
  useEffect(() => {
    let cancelled = false

    async function acquire() {
      if (!('wakeLock' in navigator)) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          lock.release().catch(() => {})
          return
        }
        wakeLockRef.current = lock
      } catch {
        // Denied or unsupported — not worth interrupting a talk over.
      }
    }

    function release() {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }

    if (active) {
      acquire()
      // The OS drops the lock when the tab is backgrounded; re-take it on return.
      const onVisibility = () => {
        if (document.visibilityState === 'visible' && active && !wakeLockRef.current) acquire()
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => {
        cancelled = true
        document.removeEventListener('visibilitychange', onVisibility)
        release()
      }
    }

    release()
    return () => {
      cancelled = true
    }
  }, [active])

  const reset = useCallback(() => setResetToken((n) => n + 1), [])

  const enable = useCallback(
    (key = DEMO_ZONE_ORDER[0]) => {
      setZoneKey(DEMO_ZONES[key] ? key : DEMO_ZONE_ORDER[0])
      reset()
    },
    [reset],
  )

  const disable = useCallback(() => {
    setZoneKey(null)
    reset()
  }, [reset])

  const toggle = useCallback(() => {
    if (active) disable()
    else enable()
  }, [active, disable, enable])

  /** Advance to the next zone, wrapping. The one on-stage gesture. */
  const nextZone = useCallback(() => {
    setZoneKey((prev) => {
      if (!prev) return DEMO_ZONE_ORDER[0]
      const i = DEMO_ZONE_ORDER.indexOf(prev)
      return DEMO_ZONE_ORDER[(i + 1) % DEMO_ZONE_ORDER.length]
    })
  }, [])

  const jumpToZone = useCallback((key) => {
    if (DEMO_ZONES[key]) setZoneKey(key)
  }, [])

  // Fixed to the zone's own clock time — recomputed only when the zone changes,
  // not on a tick, so it reads as a snapshot of that moment rather than a live
  // clock. Always today's date; see demoClockFor.
  const demoNow = useMemo(() => (zoneKey ? demoClockFor(zoneKey) : null), [zoneKey])

  return {
    active,
    zoneKey,
    zoneConfig: active ? DEMO_ZONES[zoneKey] : null,
    zoneLabel: active ? DEMO_ZONES[zoneKey].label : null,
    demoNow,
    resetToken,
    enable,
    disable,
    toggle,
    nextZone,
    jumpToZone,
    reset,
    zoneOrder: DEMO_ZONE_ORDER,
  }
}
