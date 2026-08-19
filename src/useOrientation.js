import { useCallback, useEffect, useRef, useState } from 'react'

// Device orientation, and the permission dance around it.
//
// Capture is gated on this because a sample without heading and tilt has no
// geometry, and geometry now feeds compliance flagging and the adjusted hex.
// A sample captured without it is not comparable to one captured with it, so
// rather than quietly producing second-class samples, capture is blocked.
//
// Three states, each handled differently by the UI:
//   'unsupported' — no orientation sensors at all (desktop, most laptops)
//   'denied'      — sensors exist, permission refused or not yet granted
//   'granted'     — good to capture

export const ORIENTATION_STATE = {
  CHECKING: 'checking',
  UNSUPPORTED: 'unsupported',
  DENIED: 'denied',
  GRANTED: 'granted',
}

// iOS 13+ requires an explicit permission call, from a user gesture.
function needsExplicitPermission() {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  )
}

function hasOrientationApi() {
  return typeof window !== 'undefined' && typeof DeviceOrientationEvent !== 'undefined'
}

export function useOrientation() {
  const [state, setState] = useState(ORIENTATION_STATE.CHECKING)
  const [reading, setReading] = useState({ heading: null, beta: null, gamma: null })
  const listeningRef = useRef(false)
  // Kept in a ref as well so capture can read the latest value synchronously at
  // the moment the shutter fires, without depending on a React render landing first.
  const readingRef = useRef(reading)

  const handleEvent = useCallback((event) => {
    // webkitCompassHeading is already a true compass bearing and is markedly
    // more reliable on iOS. `alpha` is relative to an arbitrary starting
    // orientation on many Android devices, so it is the fallback, not the
    // preference. absolute === false means alpha is not a compass bearing.
    const webkitHeading =
      typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)
        ? event.webkitCompassHeading
        : null

    let heading = webkitHeading
    if (heading == null && typeof event.alpha === 'number' && !Number.isNaN(event.alpha)) {
      // alpha counts anticlockwise from north; compass bearings run clockwise.
      heading = (360 - event.alpha) % 360
    }

    const next = {
      heading,
      beta: typeof event.beta === 'number' ? event.beta : null,
      gamma: typeof event.gamma === 'number' ? event.gamma : null,
      absolute: event.absolute ?? null,
    }
    readingRef.current = next
    setReading(next)

    if (next.heading != null && next.beta != null) {
      setState(ORIENTATION_STATE.GRANTED)
    }
  }, [])

  const startListening = useCallback(() => {
    if (listeningRef.current || !hasOrientationApi()) return
    listeningRef.current = true
    // deviceorientationabsolute gives true-north heading on Android where
    // available; plain deviceorientation is the fallback and is what iOS fires.
    window.addEventListener('deviceorientationabsolute', handleEvent, true)
    window.addEventListener('deviceorientation', handleEvent, true)
  }, [handleEvent])

  const requestPermission = useCallback(async () => {
    if (!hasOrientationApi()) {
      setState(ORIENTATION_STATE.UNSUPPORTED)
      return ORIENTATION_STATE.UNSUPPORTED
    }
    if (needsExplicitPermission()) {
      try {
        const result = await DeviceOrientationEvent.requestPermission()
        if (result === 'granted') {
          startListening()
          setState(ORIENTATION_STATE.GRANTED)
          return ORIENTATION_STATE.GRANTED
        }
        setState(ORIENTATION_STATE.DENIED)
        return ORIENTATION_STATE.DENIED
      } catch {
        // requestPermission throws when not called from a user gesture.
        setState(ORIENTATION_STATE.DENIED)
        return ORIENTATION_STATE.DENIED
      }
    }
    startListening()
    return ORIENTATION_STATE.GRANTED
  }, [startListening])

  useEffect(() => {
    if (!hasOrientationApi()) {
      setState(ORIENTATION_STATE.UNSUPPORTED)
      return
    }

    if (needsExplicitPermission()) {
      // Cannot know without asking, and asking needs a gesture — so present as
      // 'denied' (which the UI renders as "needs permission, here is the button")
      // rather than guessing.
      setState(ORIENTATION_STATE.DENIED)
      return
    }

    // Android and desktop: subscribe and see whether events actually arrive.
    // A desktop browser exposes the API but never fires a usable event, so the
    // absence of an event within the window is the signal.
    startListening()
    const timer = setTimeout(() => {
      setState((prev) => {
        if (prev === ORIENTATION_STATE.GRANTED) return prev
        const r = readingRef.current
        return r.heading != null && r.beta != null
          ? ORIENTATION_STATE.GRANTED
          : ORIENTATION_STATE.UNSUPPORTED
      })
    }, 1200)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('deviceorientationabsolute', handleEvent, true)
      window.removeEventListener('deviceorientation', handleEvent, true)
      listeningRef.current = false
    }
  }, [handleEvent, startListening])

  const getReading = useCallback(() => readingRef.current, [])

  return {
    state,
    reading,
    getReading,
    requestPermission,
    canRetryPermission: needsExplicitPermission(),
    isSupported: hasOrientationApi(),
  }
}
