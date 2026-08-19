# Sky Sampler

A mobile-first PWA for sampling Jakarta sky colour against live AQI readings, to
calibrate a cyanometer-style business card colour scale. No backend — everything
is stored in `localStorage` on the device.

## 1. Air quality data — no API key needed

Air quality comes from **Udara Jakarta** (Dinas Lingkungan Hidup DKI Jakarta),
which serves ~97 live stations across the metro area. There is no token to
obtain and nothing to configure.

AQICN was retired in V3. Its free tier surfaced exactly one live station in
Jakarta (Kemayoran, BMKG), which meant two of the three sampling locations
logged with no AQI at all once the 15km radius gate was applied.

### How the data arrives

Udara Jakarta has **no JSON API** — station data is server-rendered into the
homepage as `window.__SPKU_DATA__`, and the site sends no
`Access-Control-Allow-Origin` header, so a browser cannot fetch it directly.

The usual answer is a server-side proxy. That is not available here: Cloud
Functions require the Blaze plan, and Spark blocks outbound requests to
non-Google services. So instead, scheduled CI takes a snapshot:

```
GitHub Actions (every 30 min)
  → scripts/snapshot-stations.mjs fetches udara.jakarta.go.id
  → validates, then writes public/data/stations.json
  → vite build → firebase deploy
  → the app fetches its own same-origin file: no CORS, no proxy, no key
```

This is better than a proxy on three counts, not just cheaper: nothing can
generate a bill, there is no public endpoint to abuse or rate-limit, and a
government server receives a fixed number of requests per day regardless of how
many people use the app — a stronger reading of their Terms of Service §4 than
one fetch per user.

**A failed snapshot can never reach users.** The script exits non-zero on any
validation failure and writes nothing, so the workflow fails, GitHub notifies,
and the previous good snapshot stays deployed. Verified against nine failure
modes — renamed variable, non-array payload, empty array, too few stations,
coordinates outside Indonesia, malformed JSON, no readings, out-of-range values,
missing update time — all of which exit 1 with the existing file untouched.

The page HTML is located by regex and then `JSON.parse`d. Never `eval`, never
`new Function`: that page is someone else's HTML and could change or be
compromised at any time, and CI has credentials.

### Schedule and the freshness gate — these are coupled

The workflow runs **half-hourly** (`7,37 * * * *`, offset from the hour because
GitHub's scheduled runners are contended at `:00`), and `MAX_READING_AGE_HOURS`
is **3**.

On a **public** repo Actions minutes are unlimited and this is free. On a
**private** repo the 2,000 min/month allowance will be exceeded — in that case
change the cron to hourly **and** widen the gate to 4, together. An LCS reading
can already be 2h old when the snapshot is taken, plus up to an hour before the
next one lands, which sits exactly on a 3-hour gate.

Why 3 and not 2: LCS stations report systematically later than DKI stations
(median 2.0h behind against 0.0h in a live fetch). Kemang's nearest station is
LCS-06 Taman Telur at exactly 2h stale, so a 2-hour gate would leave it
permanently on the boundary, intermittently failing and silently falling back to
a further station.

### Two staleness clocks, both surfaced

- **Station reading age** — each station's own `dominantMetricTime`, an absolute
  timestamp, so it is unaffected by snapshot delay. This is the 3-hour gate.
- **Snapshot age** — how long ago the whole file was taken. Under 90 minutes:
  nothing shown. 90 min to 6 hours: *"Air quality data from 2 hours ago"*. Over
  6 hours: treated as unavailable, samples log with `provenance: 'no-coverage'`,
  and the panel says so. This is the safety net for the workflow failing
  silently.

### `ispu` is never used

The payload carries both `ispu` and `dominantRawValue`, and they do not
correspond. Observed live: Bundaran HI reported `ispu: 95` against
`dominantRawValue: 57.7` µg/m³, which is AQI **152** under US EPA breakpoints.
ISPU averages over a long window (conventionally 24h); the raw value is
near-instantaneous, and a sample paired with a photograph of one moment needs
the short-window value.

AQI is computed from raw PM2.5 in `src/aqi.js` using the explicit EPA breakpoint
table. `ispu` is stripped at the snapshot boundary so it cannot be used
downstream by accident.

### Tiering, and a bug found by verifying against real data

Tier comes from the station-name prefix, which is native to this source. Udara
Jakarta's own FAQ states the distinction: SPKU units are calibrated government
instruments suitable as a policy basis; LCS units extend coverage but are not a
policy basis alone.

- `LCS-*` → **Tier B** (multiplier 1.3)
- everything else (`DKI`, `DKJ`, `BAM`, `pm25_`) → **Tier A** (1.0)

Neighbour-median deviation was inert in V2.1 with one station. With ~97
simultaneous readings it does real work — and running it against live data
surfaced a real bug.

**Deviation is measured in raw PM2.5, not AQI.** The EPA curve is piecewise
linear with an 8× slope difference between segments (4.17 AQI per µg/m³ in the
0–12 band against 0.52 in 55.5–150.4). Comparing in AQI space exaggerates
disagreement wherever neighbours straddle a breakpoint, which Jakarta readings
constantly do. Measured: an AQI-space threshold of 40 flagged **31%** of the
network, and that over-firing changed which station both Kemang and Depok
resolved to. The same stations deviate unremarkably in physical terms — LCS-06
Taman Telur is 17.1 µg/m³ off its neighbours, below the 75th percentile, against
41.5 in AQI space.

The threshold is now **30 µg/m³**, roughly the full width of the EPA "Moderate"
band, which flags ~8%.

A station reporting *exactly* an instrument ceiling (250, 500, 999 µg/m³) is
flagged independently of neighbour deviation — a whole neighbourhood of pinned
sensors would agree with each other and defeat a median check.

## Sun geometry

The largest uncontrolled variable in these samples is the **scattering angle**,
the angle between the sun and where the camera points. Sky at ~90° from the sun
is deepest and most saturated; sky near the sun is washed out. This moves the
sampled hex more than a 50-point AQI change does — so two samples at identical
AQI, one shot at 30° and one at 90°, will not match, and without recording it
that difference is indistinguishable from a real air-quality difference.

Everything is computed client-side from device orientation plus `suncalc`. No
network, no API.

**Capture is gated on orientation sensors.** A sample without heading and tilt
has no geometry, and geometry feeds compliance flagging and the adjusted hex, so
it would not be comparable to one captured with it. Rather than quietly
producing second-class samples, capture is blocked and says why — "Capture needs
a phone" on desktop, "Motion access needed" (with a retry button on iOS) when
permission is missing. **Only capture is gated**: the log, cyanometer strip,
sample detail, location management and export all work on a laptop.

Three uses, in descending order of how well-founded they are:

1. **Capture-time guidance.** Warns below 40° from the sun or below 30°
   elevation. Never blocks the save; the warning that fired is recorded.
2. **Compliance flag.** `geometryCompliant` is true at 60–120° scattering and
   above 45° elevation — the band where sky colour is most stable and most
   comparable. The log has a "Comparable only" filter. Non-compliant samples
   remain valid data; they are simply not directly comparable.
3. **Geometry-adjusted hex — provisional.** Stored *additively* as
   `averagedHexGeometryAdjusted` alongside the untouched `averagedHexLinear`,
   with `geometryCorrectionModel` naming the model. The uncorrected value is
   shown by default and the adjusted one is labelled provisional.

### The correction model, and its limits

`rayleigh-hg-g0.7-singlescatter-v1` — Rayleigh scattering plus a
Henyey-Greenstein aerosol phase function at g = 0.7 (a standard haze value),
with a `sec(z)` air-mass term for elevation. It is derived from textbook physics
and **deliberately not fitted to this project's data**: with four historical
samples and no Aspirational-zone data, any fitted coefficient would be fitted to
noise.

Significant assumptions, all of which weaken it: single-scattering only (real
skies are multiply scattered, which matters most in haze — exactly when these
samples are taken); fixed aerosol asymmetry and mixing ratio, both of which
actually vary with the aerosol load being measured; no ground albedo or cloud;
and sRGB primaries as a coarse proxy for a spectral calculation. The correction
is scaled conservatively for that reason.

### What is stored, and what is deliberately not

```js
skyGeometry: { compassHeading, cameraElevation, scatteringAngle, sensorAvailable }
```

Whole degrees only, and **`solarAzimuth` / `solarElevation` are never stored**.
Solar position at a precise timestamp can be back-solved into a location — that
is how celestial navigation works. Retaining them alongside an exact timestamp
is the thing that would leak position. At whole-degree precision the recoverable
position is on the order of a hundred kilometres, which costs nothing
analytically since the compliance band is sixty degrees wide.

A GPS fix is taken at capture, held in memory for the flow only (it survives a
retake, because geometry is recomputed per frame), and dropped on save.

## Demo mode

For live talks — fully offline, deterministic, zero network requests in every
state.

**The DEMO pill is the control.** It has to be on screen anyway, so it is the
interface rather than a second one:

- **Displays state:** `DEMO · TYPICAL JAKARTA`
- **Tap:** advance to the next zone, wrapping
- **Long-press:** open the control panel (on/off, jump to zone, reset)

That keeps stage choreography to one gesture per device — press *next* on the
clicker, tap *next* on the phone. Both are "advance", so there is nothing to
remember and nothing to mis-select.

> **`DEMO_ZONE_ORDER` in `src/constants.js` must match the OBS hotkey order.**
> It is currently Aspirational → Good Day → Typical Jakarta → Heavy Haze,
> following the disc from lightest sky to heaviest haze. If you reorder the OBS
> scenes, reorder this too or the two will drift apart mid-talk.

`?demo=<zone>` still sets initial state and is mirrored back via
`history.replaceState`, so an accidental refresh lands in the same place. Only
demo on/off and the zone go in the URL — never a sampling area, coordinates, or
note text.

Everything is driven from React state: **no reload in either direction**, which
avoids a white flash, a lost camera permission, or a service worker update
prompt mid-talk. A **wake lock** is held while demo mode is on.

**Reset** returns the flow to a clean start — no area selected, capture back to
step one, samples from the previous run discarded — but keeps the seeded log,
because an empty log on a projector shows neither the cyanometer strip nor the
zone spread, which are the point.

**One honest limitation:** on iOS, once `DeviceOrientationEvent.requestPermission()`
has been granted for an origin, the OS dialog cannot be triggered again from the
page. Reset returns the app's *own* permission explainer to unshown and the flow
advances normally, but the OS dialog will not reappear. That is not a bug.

Camera and sun geometry work normally in demo mode — only AQI is mocked. That is
the point: the presenter samples the sky live while the projected loop matches
the selected zone.

## Privacy

- **No raw coordinates are ever stored.** Not in `localStorage`, not in exports,
  not in the URL. Coordinates are used to resolve a station and then discarded.
- Sampling areas persist as `{ label, stationUid, stationName, distanceKm,
  confidenceBand, coordinateSource }` — enough to reconstruct every provenance
  decision, nothing more. `distanceKm` is rounded to one decimal: a ring of known
  radius around a known station already narrows a position, and a second decimal
  tightens it for no analytical gain.
- **Sub-location masking is on by default** — the log shows area and station
  only. The demo toggle means the real log can end up on a projector, and
  sub-locations are free text like "Backyard". It is a display filter; the
  underlying values are intact and visible when the setting is off.
- Station and district names come from a page this project does not control and
  are rendered as text. There is no `dangerouslySetInnerHTML` anywhere.

## Managing sampling areas

Home → **Areas**. Add, rename, or retire the places you sample from; they live in
`localStorage` under `sky-sampler-locations`, deliberately a different key from
the sample log so a corrupted location list cannot take the samples with it.

Adding an area runs the full selection logic against its coordinates and shows
the result **before** you confirm — nearest station, distance, tier and
confidence band, or "No monitoring station within 15km". Areas with no coverage
can still be added: somewhere worth photographing is still worth photographing,
and the absence of coverage is itself worth recording. It just should never be a
surprise found after the fact.

Removing an area that has samples against it **retires** rather than deletes it,
so a logged sample is never orphaned from where it was taken.

## Colour: linearise, average, re-encode

sRGB values are gamma-encoded, so they are not proportional to light — 128
carries about 22% of the light of 255, not 50%. Averaging encoded values returns
the average of the *encoding*, biasing every sample the same direction. New
samples therefore store both:

- `averagedHex` — the original gamma-space average, kept so historical values
  stay reproducible and comparable
- `averagedHexLinear` — linearised per channel, averaged in linear light,
  re-encoded

Transfer functions are written out explicitly in `src/colour.js`, including the
piecewise linear segment near black, rather than approximated with a `^2.2`
shortcut.

Compare naive vs linear for an exported log:

```bash
node scripts/compare-colour.mjs path/to/sky-sampler-log.txt
```

**On the four pre-existing samples:** the correction needs the 5 raw tap values.
Those are stored as 6-digit hex, which *is* the 8-bit RGB, so where they survive
the recomputation is exact. Where a sample has no retained taps the correction
**cannot** be applied retroactively and that sample stays on the old maths
permanently — the migration marks it `linearCorrectable: false` and the compare
script lists it explicitly rather than skipping it silently. Run the script
against your own exported log to see which of yours fall into which case.

Expect deltas of roughly 1–3 points per channel; tightly clustered taps can round
to zero. A large delta on clustered taps means the implementation is wrong, and
the script says so rather than accepting it.

## Expansion survey

```bash
npm run survey
```

Sweeps major Indonesian metros and writes `coverage-survey.json`, ranked by 4×4
**grid-cell spread** rather than station count — ten sensors in one subdistrict
is not coverage, four across a city is. Agricultural-cluster candidates (seasonal
burning signature rather than traffic haze) are listed as a separate category,
since they would want different zone thresholds and a different seasonal
argument.

## Backfilling AQI against OpenAQ

`scripts/backfill-aqi.js` cross-checks logged AQI values against OpenAQ PM2.5
readings for **Depok only** (per the original request — the four pre-existing
samples are all "Depok — Backyard"; samples tagged to other locations are
reported as out of scope, not silently skipped). It never writes to the log —
it prints a comparison table and writes `backfilled.json` for manual review.

```bash
# Export your log first: Log view → Export → sky-sampler-log-YYYY-MM-DD.txt
OPENAQ_API_KEY=xxxx node scripts/backfill-aqi.js path/to/sky-sampler-log-2026-08-06.txt
```

Get a free key at [explore.openaq.org/register](https://explore.openaq.org/register).
Without a key, or with an invalid one, the script says so plainly and exits —
it does not fall back to a distant station or return silent nulls, and if
OpenAQ has no PM2.5 station within 25km of Depok (or no measurement within
±1 hour of a given sample's timestamp) it reports that plainly per-row instead
of guessing. The PM2.5 → US AQI conversion uses the EPA breakpoint table
written out explicitly in the script (`PM25_BREAKPOINTS`), not a black-box
formula — verified against the EPA's own reference points before shipping.

## Notes on the AQI alert notifications

This app has no server, so there is no traditional Web Push (which needs a
push provider to wake the service worker). Instead, `public/sw.js` uses the
**Periodic Background Sync API** to poll AQICN directly from the service
worker roughly every 30 minutes and raise a local notification when any
monitored station drops to AQI ≤ 50 between 10:00–14:00. Periodic Background
Sync is currently Chrome/Android-only and requires the app to be installed to
the home screen with notification permission granted. On other browsers
(Safari, desktop Chrome) the app falls back to checking while it's open in the
foreground — it won't alert you while fully closed.

## Note on camera colour accuracy

Phone camera colour processing varies significantly and affects the accuracy
of extracted sky hex values:

- **Samsung phones** apply aggressive scene/colour processing (saturation
  boosts, sky "enhancement") that is difficult to fully disable and will skew
  results.
- **iPhone** with **Smart HDR turned off** (Settings → Camera → Smart HDR) is
  the most consistent option for this kind of colour sampling.

Sample from the same device across all readings if possible, and note the
device in your own records if you switch.

## Project structure

```
/src
  App.jsx               — root, view routing, demo/real source switching
  Home.jsx              — AQI panel, snapshot age, attribution, capture gate
  CaptureFlow.jsx       — sensor gate → checklist → camera/3-shot (+ retake)
                           → median select → 5-point extraction, geometry capture
  SaveEntry.jsx         — save form, location-bound AQI guard
  LogView.jsx           — log, cyanometer strip, geometry + compliance filter, export
  LocationsView.jsx     — sampling areas: GPS / district add, rename, retire
  DemoPill.jsx          — on-stage demo control (tap = next zone, hold = panel)

  aqi.js                — US EPA PM2.5 → AQI breakpoints (pure)
  colour.js             — sRGB linearise / average / re-encode (pure)
  sunGeometry.js        — solar position, scattering angle, compliance (pure)
  geometryCorrection.js — provisional Rayleigh+HG correction (pure, additive)
  stationSelection.js   — gates, scoring, neighbour deviation (pure)

  useStations.js        — loads the snapshot, builds the station + district lists
  useAQI.js             — per-area AQI via stationSelection; demo interception
  useLocations.js       — sampling areas; coordinates computed-then-discarded
  useLog.js             — localStorage log + migrations
  useOrientation.js     — device orientation + the three-state permission gate
  useDemoMode.js        — demo state, zone advance, wake lock, URL mirroring
  useDisplaySettings.js — sub-location masking and other display-only prefs
  useNotifications.js   — notification permission + background poll wiring
  constants.js          — swatches, zones, gates, tiers, thresholds (no coordinates)
  demoData.js           — seeded areas + samples, timestamps relative to now

/scripts
  snapshot-stations.mjs — fetch + validate Udara Jakarta → public/data/stations.json
  survey-coverage.mjs   — standalone AQICN research: national coverage survey
  compare-colour.mjs    — naive vs linear hex comparison for an exported log
  backfill-aqi.js       — OpenAQ cross-check, review-only
  gen-icons.mjs         — PWA icon generation
  test/                 — node:test suites (selection, colour, geometry)

/.github/workflows
  snapshot.yml          — scheduled snapshot + build + deploy

/public
  data/stations.json    — the snapshot (network-first in the service worker)
  manifest.json
  sw.js                 — install cache, network-first data, notification routing
```

## Before making the repository public

`git init` was run fresh for V3, so **no coordinates were ever committed** —
sampling areas are user-managed and `constants.js` holds none. There is no
history to audit or rewrite.

Add `FIREBASE_SERVICE_ACCOUNT` as a repository secret before the workflow can
deploy. The deploy job is restricted to pushes and scheduled runs on the default
branch, so pull requests from forks never see it.

`LICENSE` is MIT. Note that it covers this software only — the air quality data
belongs to Udara Jakarta and carries their terms.
