const CACHE_NAME = 'sky-sampler-v3'
const APP_SHELL = ['/', '/manifest.json', '/icon.svg']

// The station snapshot is deliberately NOT precached. It changes on every
// deploy while the rest of the build does not, and precaching it would serve
// stale readings from the service worker on top of an already-delayed snapshot.
const DATA_PATH = '/data/stations.json'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // Network-first with a cache fallback for the station snapshot. It changes on
  // every deploy while the rest of the build does not, so a cache-first strategy
  // would compound a stale snapshot with a stale cache.
  if (url.origin === self.location.origin && url.pathname === DATA_PATH) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(event.request)),
    )
    return
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})

// US EPA PM2.5 breakpoints. Duplicated from src/aqi.js because this worker is a
// plain script, not part of the Vite bundle, so it cannot import that module.
// Keep the two in sync.
const PM25_BREAKPOINTS = [
  [0.0, 12.0, 0, 50],
  [12.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 350.4, 301, 400],
  [350.5, 500.4, 401, 500],
]

function pm25ToAqi(pm25) {
  if (typeof pm25 !== 'number' || Number.isNaN(pm25) || pm25 < 0) return null
  for (const [cLow, cHigh, aqiLow, aqiHigh] of PM25_BREAKPOINTS) {
    if (pm25 >= cLow && pm25 <= cHigh) {
      return Math.round(((aqiHigh - aqiLow) / (cHigh - cLow)) * (pm25 - cLow) + aqiLow)
    }
  }
  return null
}

// Serverless "push": there is no push backend, so the ideal-window check runs
// here via Periodic Background Sync and raises a local notification. Real Web
// Push would need a push server; this app has none.
//
// Reads the same same-origin snapshot the app does — no third-party request,
// nothing to rate-limit, no token.
async function checkAqiAndNotify() {
  const hour = new Date().getHours()
  if (hour < 10 || hour >= 14) return

  try {
    const res = await fetch(DATA_PATH, { cache: 'no-cache' })
    if (!res.ok) return
    const data = await res.json()
    if (!Array.isArray(data?.stations)) return

    // Only notify on a fresh snapshot. A stale one saying "good sky day" is
    // worse than saying nothing.
    const fetchedAt = new Date(data.fetchedAt).getTime()
    if (Number.isNaN(fetchedAt) || Date.now() - fetchedAt > 6 * 60 * 60 * 1000) return

    let best = null
    for (const s of data.stations) {
      const aqi = pm25ToAqi(s.dominantRawValue)
      if (aqi == null) continue
      const age = Date.now() - new Date(s.dominantMetricTime).getTime()
      if (Number.isNaN(age) || age > 3 * 60 * 60 * 1000) continue
      if (aqi <= 50 && (best == null || aqi < best.aqi)) best = { aqi, name: s.name }
    }

    if (best) {
      await self.registration.showNotification('Good sky day', {
        body: `Good sky day — AQI ${best.aqi} at ${best.name}. Sample now.`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'aqi-good-day',
        data: {},
      })
    }
  } catch (err) {
    // Snapshot unreachable — stay silent rather than guessing.
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'aqi-poll') {
    event.waitUntil(checkAqiAndNotify())
  }
})

// Fallback for browsers without Periodic Background Sync: the page can ask
// the worker to run one check on demand (see useNotifications.js).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_AQI_NOW') {
    event.waitUntil(checkAqiAndNotify())
  }
})

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Good sky day', {
      body: payload.body || 'Good sky day — sample now.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'aqi-good-day',
      data: payload.data || {},
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const locationId = event.notification.data?.locationId || ''
  const targetUrl = `/?openCapture=1&location=${encodeURIComponent(locationId)}`

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_CAPTURE', locationId })
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
