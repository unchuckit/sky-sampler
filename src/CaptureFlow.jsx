import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PROVENANCE, isIdealWindow, MAX_STATION_RADIUS_KM, demoGeometryFor } from './constants'
import { rgbToHex, hexToRgb, averageHexNaive, averageHexLinear } from './colour'
import { ORIENTATION_STATE } from './useOrientation'
import { computeSkyGeometry, isGeometryCompliant, geometryWarnings } from './sunGeometry'
import { geometryAdjustedHex, GEOMETRY_CORRECTION_MODEL } from './geometryCorrection'
import { getCurrentPosition } from './useLocations'

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function averageRegionHex(ctx, cx, cy, size) {
  const half = size / 2
  const x = Math.max(0, Math.round(cx - half))
  const y = Math.max(0, Math.round(cy - half))
  const w = Math.min(size, ctx.canvas.width - x)
  const h = Math.min(size, ctx.canvas.height - y)
  const { data } = ctx.getImageData(x, y, w, h)
  let r = 0
  let g = 0
  let b = 0
  const total = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  return rgbToHex(r / total, g / total, b / total)
}

function isValidHex(value) {
  return /^#?[0-9a-fA-F]{6}$/.test(value.trim())
}

function normalizeHex(value) {
  const v = value.trim()
  return v.startsWith('#') ? v : `#${v}`
}

// Tap-to-add / tap-near-to-remove hit radius, in on-screen (CSS) pixels — this
// is what a finger actually covers, not the canvas's source resolution. Exact
// pixel matching doesn't work on touch, so removal checks distance instead.
const TAP_HIT_RADIUS = 20

// A station object with no AQI means the gates rejected everything in range —
// that is a coverage finding, not a fetch failure, and it is recorded as such.
function aqiProvenanceFor(station) {
  if (!station) return PROVENANCE.UNVERIFIED
  if (station.aqi == null) return PROVENANCE.NO_COVERAGE
  if (station.manual) return PROVENANCE.UNVERIFIED
  return PROVENANCE.VERIFIED
}

const CHECKLIST_BULLETS = [
  'Point straight up toward the zenith',
  'Avoid clouds, avoid sun, avoid horizon',
  'Camera enhancements off — see Settings notes below',
]

/**
 * Capture is gated on orientation sensors.
 *
 * A sample without heading and tilt has no geometry, and geometry now feeds
 * compliance flagging and the adjusted hex — so a sample captured without it is
 * not comparable to one captured with it. Rather than quietly producing
 * second-class samples, capture is blocked and says why.
 *
 * Only capture is gated. The log, the cyanometer strip, sample detail, location
 * management and export all stay available on a laptop: reviewing samples on a
 * larger screen is a legitimate use.
 */
function SensorGate({ orientation, onCancel }) {
  const unsupported = orientation.state === ORIENTATION_STATE.UNSUPPORTED

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <button onClick={onCancel} className="text-sm text-text-secondary">
          Back
        </button>
        <span className="text-sm font-medium">Capture</span>
        <span className="w-10" />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        {unsupported ? (
          <>
            <h2 className="text-base font-semibold">Capture needs a phone</h2>
            <p className="text-sm text-text-secondary">
              Sky Sampler uses your phone’s compass and tilt sensors to record which way the camera was
              pointing. Open this page on your phone to take a sample.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">Motion access needed</h2>
            <p className="text-sm text-text-secondary">
              Sky Sampler records which way the camera was pointing. Turn on motion and orientation access
              in your browser settings, then reload.
            </p>
            {orientation.canRetryPermission && (
              <button
                onClick={() => orientation.requestPermission()}
                className="mt-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-black"
              >
                Allow motion access
              </button>
            )}
          </>
        )}
        <p className="mt-4 text-xs text-text-secondary">
          The log, reference strip and export all work here without sensors.
        </p>
      </div>
    </div>
  )
}

export default function CaptureFlow({
  aqiStations,
  locations,
  orientation,
  initialLocationId,
  demo,
  onCancel,
  onComplete,
}) {
  const [step, setStep] = useState('checklist')
  const [locationId, setLocationId] = useState(initialLocationId || null)
  const [subLocation, setSubLocation] = useState('')

  const [cameraError, setCameraError] = useState(null)
  const [manualHex, setManualHex] = useState('')
  const [manualAqi, setManualAqi] = useState('')

  const [frames, setFrames] = useState([]) // [{ dataUrl, centreHex, width, height }]
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(null)
  const [autoSelectedIndex, setAutoSelectedIndex] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [capturedCount, setCapturedCount] = useState(0)

  const [tapPoints, setTapPoints] = useState([]) // [{ x%, y%, hex }]

  // Sun geometry, recomputed per capture. The GPS fix is held in a ref for the
  // duration of the flow only — it must survive a retake, because geometry is
  // recomputed per frame — and is never written anywhere on save.
  const [skyGeometry, setSkyGeometry] = useState(null)
  const [geoError, setGeoError] = useState(null)
  const [liveGeometry, setLiveGeometry] = useState(null)
  const positionRef = useRef(null)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const reviewCanvasRef = useRef(null)

  // Bound to whichever location is currently selected — not the lowest AQI across
  // all stations. That "pick the lowest" behaviour was the actual save-time bug:
  // it silently ignored which location the user chose.
  const selectedAqi = useMemo(
    () => (locationId ? aqiStations.find((s) => s.id === locationId) ?? null : null),
    [aqiStations, locationId],
  )

  // Against the demo clock when there is one, so the checklist agrees with the
  // header rather than reading the real wall time mid-talk.
  const ideal = isIdealWindow(demo?.active && demo.demoNow ? demo.demoNow : new Date())

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Coordinates are held for the flow's lifetime only. Cleared on unmount so
  // they cannot outlive the capture that needed them.
  useEffect(() => {
    return () => {
      positionRef.current = null
    }
  }, [])

  const compliant = useMemo(() => isGeometryCompliant(skyGeometry), [skyGeometry])

  async function openCamera() {
    setCameraError(null)
    setStep('camera')
    // Kicked off alongside the camera, not lazily at capture time, so the live
    // geometry readout has a coordinate to compute a scattering angle against
    // while the person is still framing the shot. Skipped in demo mode, where
    // the geometry is fixed per zone — there is nothing to compute, and a
    // location prompt mid-talk is the last thing anyone wants.
    if (!demoGeometry && !positionRef.current) {
      getCurrentPosition()
        .then((position) => {
          positionRef.current = position
        })
        .catch((err) => setGeoError(err.message))
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch (err) {
      setCameraError('Camera access denied — enable in Settings to capture.')
    }
  }

  const { getReading } = orientation

  // Fixed per zone and always inside the comparable band — see
  // DEMO_ZONE_GEOMETRY. Null outside demo mode, which is what every branch
  // below tests against.
  const demoGeometry = useMemo(
    () => (demo?.active ? demoGeometryFor(demo.zoneKey) : null),
    [demo?.active, demo?.zoneKey],
  )

  // Live sky-geometry readout while framing, so a non-compliant shot is
  // apparent before the shutter fires rather than discovered afterwards.
  // Polled on an interval rather than reacting to the orientation hook's own
  // `reading` state, which updates on every deviceorientation event — often
  // 60+ times a second — and would otherwise re-render at that rate instead of
  // the ~10/s this is throttled to.
  useEffect(() => {
    if (step !== 'camera' || cameraError) {
      setLiveGeometry(null)
      return
    }
    // On stage the phone points at a projector, not the sky, so real sensors
    // would report a non-compliant frame for reasons unrelated to the talk.
    if (demoGeometry) {
      setLiveGeometry(demoGeometry)
      return
    }
    const id = setInterval(() => {
      const reading = getReading()
      const position = positionRef.current
      setLiveGeometry(
        computeSkyGeometry({
          heading: reading.heading,
          beta: reading.beta,
          lat: position?.lat,
          lng: position?.lng,
          date: new Date(),
        }),
      )
    }, 100)
    return () => clearInterval(id)
  }, [step, cameraError, getReading, demoGeometry])

  const liveWarning = useMemo(() => geometryWarnings(liveGeometry)[0] ?? null, [liveGeometry])

  /**
   * Read heading + tilt at the instant of capture and combine with solar
   * position. The GPS fix is taken once per flow and reused across retakes; the
   * orientation reading is taken fresh every time, because the phone will have
   * moved.
   */
  const captureGeometry = useCallback(async () => {
    if (demoGeometry) {
      setSkyGeometry(demoGeometry)
      return demoGeometry
    }
    let position = positionRef.current
    if (!position) {
      try {
        position = await getCurrentPosition()
        positionRef.current = position
      } catch (err) {
        setGeoError(err.message)
      }
    }
    const reading = orientation.getReading()
    const geometry = computeSkyGeometry({
      heading: reading.heading,
      beta: reading.beta,
      lat: position?.lat,
      lng: position?.lng,
      date: new Date(),
    })
    setSkyGeometry(geometry)
    return geometry
  }, [orientation, demoGeometry])

  async function captureThreeShots() {
    if (capturing) return
    setCapturing(true)
    setCapturedCount(0)
    // Read geometry first, while the phone is still pointed where the person
    // aimed it — not after three shots and a step transition.
    await captureGeometry()
    const shots = []
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 500))
      const video = videoRef.current
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const centreHex = averageRegionHex(ctx, canvas.width / 2, canvas.height / 2, 100)
      shots.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), centreHex, width: canvas.width, height: canvas.height })
      setCapturedCount(i + 1)
    }

    streamRef.current?.getTracks().forEach((t) => t.stop())

    const sorted = [...shots].sort((a, b) => luminance(a.centreHex) - luminance(b.centreHex))
    const medianHex = sorted[1].centreHex
    const medianIdx = shots.findIndex((s) => s.centreHex === medianHex)

    setFrames(shots)
    setAutoSelectedIndex(medianIdx)
    setSelectedFrameIndex(medianIdx)
    setCapturing(false)
    setStep('frames')
  }

  function retake() {
    // Discard the frame and any tap points — their coordinates only make sense
    // against the frame they were placed on. No confirmation: retake is meant
    // to be a fast, silent reset.
    setFrames([])
    setSelectedFrameIndex(null)
    setAutoSelectedIndex(null)
    setTapPoints([])
    // Geometry belongs to the discarded frame. The GPS fix in positionRef is
    // kept deliberately — the person has not moved, and re-prompting for
    // location on every retake would be hostile.
    setSkyGeometry(null)
    openCamera()
  }

  function handleReviewImageLoad() {
    const canvas = reviewCanvasRef.current
    const frame = frames[selectedFrameIndex]
    if (!canvas || !frame) return
    const img = new Image()
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
    }
    img.src = frame.dataUrl
  }

  useEffect(() => {
    if (step === 'points') handleReviewImageLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedFrameIndex])

  function handleTap(e) {
    const canvas = reviewCanvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.clientX ?? e.touches?.[0]?.clientX
    const clientY = e.clientY ?? e.touches?.[0]?.clientY
    const xRatio = (clientX - rect.left) / rect.width
    const yRatio = (clientY - rect.top) / rect.height

    // Hit-test against existing points in on-screen (CSS) pixel space, not
    // canvas source-resolution space — exact pixel matching doesn't work on
    // touch, and the radius needs to match what the finger actually covers.
    const nearbyIndex = tapPoints.findIndex((p) => {
      const px = rect.left + (p.xPct / 100) * rect.width
      const py = rect.top + (p.yPct / 100) * rect.height
      return Math.hypot(clientX - px, clientY - py) <= TAP_HIT_RADIUS
    })

    if (nearbyIndex !== -1) {
      setTapPoints((prev) => prev.filter((_, i) => i !== nearbyIndex))
      return
    }

    if (tapPoints.length >= 5) return

    const px = Math.round(xRatio * canvas.width)
    const py = Math.round(yRatio * canvas.height)
    const ctx = canvas.getContext('2d')
    const { data } = ctx.getImageData(Math.min(px, canvas.width - 1), Math.min(py, canvas.height - 1), 1, 1)
    const hex = rgbToHex(data[0], data[1], data[2])
    setTapPoints((prev) => [...prev, { xPct: xRatio * 100, yPct: yRatio * 100, hex }])
  }

  // Both values are kept: `averagedHex` is the original gamma-space average,
  // retained so historical samples stay comparable; `averagedHexLinear` is the
  // correct one, averaged in linear light. See src/colour.js.
  const averagedHex = useMemo(
    () => (tapPoints.length < 5 ? null : averageHexNaive(tapPoints.map((p) => p.hex))),
    [tapPoints],
  )
  const averagedHexLinear = useMemo(
    () => (tapPoints.length < 5 ? null : averageHexLinear(tapPoints.map((p) => p.hex))),
    [tapPoints],
  )

  function finishWithFrames() {
    onComplete({
      mode: 'camera',
      locationId,
      subLocation,
      aqi: selectedAqi?.aqi ?? null,
      stationName: selectedAqi?.manual ? null : selectedAqi?.stationName ?? null,
      stationUid: selectedAqi?.manual ? null : selectedAqi?.stationUid ?? null,
      apiTimestamp: selectedAqi?.manual ? null : selectedAqi?.apiTimestamp ?? null,
      aqiProvenance: aqiProvenanceFor(selectedAqi),
      stationSelection: selectedAqi?.stationSelection ?? null,
      confidenceBand: selectedAqi?.stationSelection?.confidenceBand ?? null,
      frames: frames.map((f) => ({ dataUrl: f.dataUrl, centreHex: f.centreHex })),
      selectedFrameIndex,
      frameSelectionType: selectedFrameIndex === autoSelectedIndex ? 'median' : 'manual override',
      tapSamples: tapPoints.map((p) => p.hex),
      averagedHex,
      averagedHexLinear,
      // Provisional and additive — never replaces averagedHexLinear. If the
      // model turns out to be wrong the original measurement survives.
      averagedHexGeometryAdjusted: geometryAdjustedHex(averagedHexLinear, skyGeometry),
      geometryCorrectionModel: skyGeometry?.sensorAvailable ? GEOMETRY_CORRECTION_MODEL : null,
      linearCorrectable: true,
      // Only derived whole-degree values. The GPS coordinates used to compute
      // them are dropped here and never reach storage.
      skyGeometry,
      geometryCompliant: isGeometryCompliant(skyGeometry),
      geometryWarningsFired: geometryWarnings(skyGeometry).map((w) => w.key),
    })
  }

  function finishManual() {
    onComplete({
      mode: 'manual',
      locationId,
      subLocation,
      aqi: manualAqi === '' ? null : Number(manualAqi),
      stationName: null,
      stationUid: null,
      apiTimestamp: null,
      aqiProvenance: PROVENANCE.UNVERIFIED,
      frames: [],
      selectedFrameIndex: null,
      frameSelectionType: null,
      tapSamples: [],
      averagedHex: normalizeHex(manualHex),
    })
  }

  const selectedLocation = locations.find((l) => l.id === locationId)

  // Sensors are required before anything else in this flow — except in demo
  // mode, where the geometry is fixed per zone and never read from a sensor.
  // The gate exists to stop real samples being recorded without geometry; a
  // demo capture has geometry by construction, so the gate would only block a
  // rehearsal on a laptop for no benefit.
  if (
    !demoGeometry &&
    (orientation.state === ORIENTATION_STATE.UNSUPPORTED ||
      orientation.state === ORIENTATION_STATE.DENIED)
  ) {
    return <SensorGate orientation={orientation} onCancel={onCancel} />
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <button onClick={onCancel} className="text-sm text-text-secondary">
          Cancel
        </button>
        <span className="text-sm font-medium">
          {{ checklist: 'Before you start', camera: 'Capture', frames: 'Select frame', points: 'Sample sky' }[step]}
        </span>
        <span className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto">
        {step === 'checklist' && (
          <div className="space-y-5 p-4">
            {!ideal && (
              <div className="rounded-lg border border-zone-moderate/40 bg-zone-moderate/10 px-4 py-3 text-sm text-zone-moderate">
                Outside ideal window — light conditions may skew colour.
              </div>
            )}

            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-text-secondary">Current AQI</div>
              {!locationId ? (
                <div className="mt-1 text-sm text-text-secondary">Select a location below to see its AQI</div>
              ) : selectedAqi?.aqi != null ? (
                <div className="mt-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono-data text-2xl font-bold">{selectedAqi.aqi}</span>
                    <span className="text-sm text-text-secondary">{selectedAqi.label}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {selectedAqi.manual ? 'Entered manually' : `${selectedAqi.stationName ?? 'Unknown station'} station`}
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-sm text-text-secondary">AQI unavailable for this location</div>
              )}
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className={ideal ? 'text-zone-good' : 'text-zone-moderate'}>{ideal ? '✓' : '!'}</span>
                <span>{ideal ? '10:00–14:00 — ideal window' : 'Outside 10:00–14:00 window'}</span>
              </div>
            </div>

            <ul className="space-y-2 text-sm">
              {CHECKLIST_BULLETS.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-accent">—</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <details className="text-xs text-text-secondary">
              <summary className="cursor-pointer text-accent">Turn off camera enhancements</summary>
              <p className="mt-1">
                iOS: Settings → Camera → turn off Smart HDR. Android: Camera app → Settings → disable Scene
                Optimizer / HDR / Auto beautification.
              </p>
            </details>

            <div>
              <div className="text-sm text-text-secondary">Location</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {locations.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => setLocationId(loc.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      locationId === loc.id
                        ? 'border-accent bg-accent text-black'
                        : 'border-border bg-surface text-text'
                    }`}
                  >
                    {loc.label}
                  </button>
                ))}
              </div>
              {selectedLocation && (
                <p className="mt-2 text-xs text-text-secondary">{selectedLocation.guidance}</p>
              )}
            </div>

            <div>
              <label className="text-sm text-text-secondary" htmlFor="sub-location">
                Specific spot (optional)
              </label>
              <input
                id="sub-location"
                type="text"
                value={subLocation}
                onChange={(e) => setSubLocation(e.target.value)}
                placeholder="Specific spot e.g. rooftop, corner of Jl X"
                className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-text"
              />
            </div>
          </div>
        )}

        {step === 'camera' && (
          <div className="relative flex h-full flex-col">
            {cameraError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-sm text-text-secondary">{cameraError}</p>
                <p className="text-xs text-text-secondary">Enter a hex value manually instead:</p>
                <input
                  type="text"
                  value={manualHex}
                  onChange={(e) => setManualHex(e.target.value)}
                  placeholder="#4698cb"
                  className="w-40 rounded border border-border bg-surface px-3 py-2 text-center font-mono-data text-sm"
                />
                <input
                  type="number"
                  value={manualAqi}
                  onChange={(e) => setManualAqi(e.target.value)}
                  placeholder="AQI number"
                  className="w-40 rounded border border-border bg-surface px-3 py-2 text-center font-mono-data text-sm"
                />
                <button
                  disabled={!isValidHex(manualHex)}
                  onClick={finishManual}
                  className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-black disabled:opacity-40"
                >
                  Use manual entry
                </button>
              </div>
            ) : (
              <>
                <div className="relative flex-1 overflow-hidden bg-black">
                  <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="h-32 w-32 rounded-full border-2 border-white/80">
                      <div className="relative h-full w-full">
                        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/60" />
                        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/60" />
                      </div>
                    </div>
                    <span className="mt-3 rounded bg-black/50 px-2 py-1 text-xs text-white">point at zenith</span>
                  </div>
                  {capturing && (
                    <div className="absolute inset-x-0 top-4 flex justify-center gap-2">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className={`h-3 w-3 rounded-full border border-white ${
                            i < capturedCount ? 'bg-white' : 'bg-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                  {/* Live, not after-the-fact: lets the person adjust aim before
                      shooting instead of finding out afterwards. No sensors, no
                      readout — never zeros or "unknown" in their place. */}
                  {liveGeometry?.sensorAvailable && liveGeometry.scatteringAngle != null && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
                      <span
                        className={`rounded bg-black/50 px-2.5 py-1 font-mono-data text-xs ${
                          liveWarning ? 'text-zone-moderate' : 'text-white'
                        }`}
                      >
                        {liveWarning
                          ? liveWarning.text
                          : `${liveGeometry.scatteringAngle}° from sun · ${liveGeometry.cameraElevation}° up`}
                      </span>
                    </div>
                  )}
                </div>
                <div className="border-t border-border bg-surface px-4 py-2 text-center text-xs text-text-secondary">
                  Smart HDR off? Check Settings → Camera before capturing.
                </div>
                <div className="p-4">
                  <button
                    disabled={capturing}
                    onClick={captureThreeShots}
                    className="w-full rounded-lg bg-accent py-4 text-base font-semibold text-black disabled:opacity-50"
                  >
                    {capturing ? 'Capturing…' : 'Capture 3 shots'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'frames' && (
          <div className="p-4">
            <p className="text-sm text-text-secondary">
              Median frame auto-selected. Tap another to override.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {frames.map((frame, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedFrameIndex(i)}
                  className={`overflow-hidden rounded-lg border-2 ${
                    selectedFrameIndex === i ? 'border-white' : 'border-transparent'
                  }`}
                >
                  <img src={frame.dataUrl} alt={`Frame ${i + 1}`} className="h-24 w-full object-cover" />
                  <div className="flex items-center justify-between bg-surface px-1.5 py-1">
                    <span
                      className="h-3 w-3 rounded-full border border-border"
                      style={{ backgroundColor: frame.centreHex }}
                    />
                    <span className="font-mono-data text-[10px]">{frame.centreHex}</span>
                  </div>
                  {i === autoSelectedIndex && (
                    <div className="bg-white py-0.5 text-center text-[10px] font-semibold text-black">
                      Auto-selected
                    </div>
                  )}
                </button>
              ))}
            </div>
            {skyGeometry?.sensorAvailable && (
              <div className="mt-4 rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono-data text-sm">
                    {skyGeometry.scatteringAngle != null ? `${skyGeometry.scatteringAngle}° from sun` : 'Sun angle unknown'}
                    {' · '}
                    {skyGeometry.cameraElevation}° elevation
                  </span>
                  <span className={`text-xs ${compliant ? 'text-zone-good' : 'text-text-secondary'}`}>
                    {compliant ? '✓ comparable' : 'outside band'}
                  </span>
                </div>
              </div>
            )}
            {geoError && (
              <p className="mt-3 text-xs text-text-secondary">
                {geoError} — sun angle not recorded for this sample.
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={retake}
                className="flex-1 rounded-lg border border-border py-4 text-base font-semibold text-text"
              >
                Retake
              </button>
              <button
                onClick={() => setStep('points')}
                className="flex-1 rounded-lg bg-accent py-4 text-base font-semibold text-black"
              >
                Use this shot
              </button>
            </div>
          </div>
        )}

        {step === 'points' && (
          <div className="p-4">
            <p className="text-sm text-text-secondary">Tap 5 spots. Tap a spot again to remove it.</p>
            <div className="relative mt-3">
              <canvas
                ref={reviewCanvasRef}
                onClick={handleTap}
                className="w-full rounded-lg border border-border"
              />
              {tapPoints.map((p, i) => (
                <div
                  key={i}
                  className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-black/60 text-[10px] text-white"
                  style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
                  title={p.hex}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex gap-1.5">
                {tapPoints.map((p, i) => (
                  <span key={i} className="h-6 w-6 rounded border border-border" style={{ backgroundColor: p.hex }} />
                ))}
                {Array.from({ length: Math.max(0, 5 - tapPoints.length) }).map((_, i) => (
                  <span key={`empty-${i}`} className="h-6 w-6 rounded border border-dashed border-border" />
                ))}
              </div>
              <span className="font-mono-data text-sm text-text-secondary">{tapPoints.length} of 5 sampled</span>
            </div>

            {averagedHex && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                <span className="h-14 w-14 shrink-0 rounded" style={{ backgroundColor: averagedHex }} />
                <span className="font-mono-data text-lg">{averagedHex}</span>
              </div>
            )}

            <button
              disabled={tapPoints.length < 5}
              onClick={finishWithFrames}
              className="mt-6 w-full rounded-lg bg-accent py-4 text-base font-semibold text-black disabled:opacity-40"
            >
              Save sample
            </button>
          </div>
        )}
      </div>

      {step === 'checklist' && (
        <div className="border-t border-border p-4">
          <button
            disabled={!locationId}
            onClick={openCamera}
            className="w-full rounded-lg bg-accent py-4 text-base font-semibold text-black disabled:opacity-40"
          >
            Open camera
          </button>
        </div>
      )}
    </div>
  )
}
