import { useCallback, useEffect, useState } from 'react'

const ENABLED_KEY = 'sky-sampler-notifications-enabled'
const FOREGROUND_POLL_MS = 30 * 60 * 1000

function loadEnabled() {
  const raw = localStorage.getItem(ENABLED_KEY)
  return raw === null ? true : raw === 'true'
}

export function useNotifications({ onOpenCapture, isDemo = false } = {}) {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied')
  const [enabled, setEnabled] = useState(loadEnabled)

  useEffect(() => {
    localStorage.setItem(ENABLED_KEY, String(enabled))
  }, [enabled])

  const requestPermission = useCallback(async () => {
    if (!supported) return 'denied'
    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }, [supported])

  const registerBackgroundPoll = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return
    const registration = await navigator.serviceWorker.ready
    if ('periodicSync' in registration) {
      try {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' })
        if (status.state === 'granted') {
          await registration.periodicSync.register('aqi-poll', { minInterval: 30 * 60 * 1000 })
        }
      } catch (err) {
        // Periodic Background Sync unsupported or blocked — foreground poll below covers this.
      }
    }
  }, [])

  useEffect(() => {
    // Demo mode must never touch the network — venue wifi can't be a dependency.
    if (isDemo || !enabled || permission !== 'granted') return
    registerBackgroundPoll()

    const pingServiceWorker = () => {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CHECK_AQI_NOW' })
    }
    pingServiceWorker()
    const interval = setInterval(pingServiceWorker, FOREGROUND_POLL_MS)
    return () => clearInterval(interval)
  }, [enabled, permission, registerBackgroundPoll, isDemo])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handler = (event) => {
      if (event.data?.type === 'OPEN_CAPTURE') {
        onOpenCapture?.(event.data.locationId)
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [onOpenCapture])

  const toggleEnabled = useCallback(() => setEnabled((prev) => !prev), [])

  return { supported, permission, enabled, requestPermission, toggleEnabled }
}
