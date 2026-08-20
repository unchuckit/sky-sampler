import { PROVENANCE, TIERS, demoClockFor } from './constants.js'
import { averageHexNaive, averageHexLinear } from './colour.js'
import { pm25ToAqi } from './aqi.js'
import { isGeometryCompliant } from './sunGeometry.js'
import { geometryAdjustedHex, GEOMETRY_CORRECTION_MODEL } from './geometryCorrection.js'

// Fixtures for demo mode. Never written to or read from localStorage.
//
// These are REAL station attachments. Every uid below exists in
// demoStations.js, and every distance/tier/band triple is one the real
// selection logic actually produces: for each area there are real points inside
// that kecamatan from which selectStation picks exactly this station at exactly
// this distance. scripts/test/demo-mode.test.mjs asserts that rather than
// trusting the comment.
//
// coordinateSource is 'gps' because these represent places a person stands to
// photograph the sky, which is also why the distances are non-zero — a district
// centroid can land on top of a station, but a person does not.
//
// Getting any of this wrong would make demo mode show a state the real app
// could never produce, which is the one thing a demo must not do.
export const DEMO_LOCATIONS = [
  {
    id: 'demo-mampang',
    label: 'Mampang Prapatan',
    stationUid: 'caaa1a3e-5d7d-405b-af84-1a6ca0f29ac7',
    stationName: 'LCS-06 Taman Telur',
    distanceKm: 1.2,
    confidenceBand: 'high',
    // Tier B on purpose. This is the only one of these kawasan whose nearest
    // station is a low-cost sensor, and it is what lets the talk show that the
    // app tells a calibrated government instrument apart from an LCS unit.
    tier: TIERS.B,
    coordinateSource: 'gps',
    active: true,
  },
  {
    id: 'demo-jagakarsa',
    label: 'Jagakarsa',
    stationUid: '61246172-d1ec-4e25-8c96-ddf74f967dc5',
    stationName: 'DKI3 Jagakarsa',
    distanceKm: 0.9,
    confidenceBand: 'high',
    tier: TIERS.A,
    coordinateSource: 'gps',
    active: true,
  },
  {
    id: 'demo-menteng',
    label: 'Menteng',
    stationUid: '576c96d1-07d3-459b-814b-824361ad96fe',
    stationName: 'DKI_PM25_38 Taman Ismail Marzuki',
    distanceKm: 0.7,
    confidenceBand: 'high',
    tier: TIERS.A,
    coordinateSource: 'gps',
    active: true,
  },
]

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function jitterHex(hex, n) {
  const v = parseInt(hex.slice(1), 16)
  const clamp = (c) => Math.min(255, Math.max(0, c))
  const r = clamp(((v >> 16) & 255) + n)
  const g = clamp(((v >> 8) & 255) + n)
  const b = clamp((v & 255) + n)
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

// Timestamps are pinned to the seeded sample's own zone moment, minus a spread
// so the log reads with some depth, rather than to real wall-clock time — a
// seeded sample must never appear to have been recorded in the future relative
// to the demo clock the presenter is currently standing on. See demoClockFor.
function seed({ id, pm25, hex, area, zoneKey, agoMs = 0, notes, geometry }) {
  const taps = [jitterHex(hex, -4), jitterHex(hex, 2), hex, jitterHex(hex, -2), jitterHex(hex, 3)]
  const createdAt = new Date(demoClockFor(zoneKey).getTime() - agoMs).toISOString()
  const aqi = pm25ToAqi(pm25)
  const linear = averageHexLinear(taps)

  return {
    id,
    createdAt,
    location: area.label,
    locationId: area.id,
    subLocation: '',
    notes,
    averagedHex: averageHexNaive(taps),
    averagedHexLinear: linear,
    averagedHexGeometryAdjusted: geometryAdjustedHex(linear, geometry),
    geometryCorrectionModel: GEOMETRY_CORRECTION_MODEL,
    linearCorrectable: true,
    tapSamples: taps,
    frames: [],
    selectedFrameIndex: null,
    frameSelectionType: 'median',
    mode: 'camera',
    aqi,
    pm25,
    stationName: area.stationName,
    stationUid: area.stationUid,
    apiTimestamp: createdAt,
    // The demo AQI is synthesised fresh for whichever zone is selected, so
    // there is no real snapshot age to report — 0 is the honest value, not a
    // placeholder.
    snapshotAgeMinutes: 0,
    provenance: PROVENANCE.VERIFIED,
    confidenceBand: area.confidenceBand,
    stationSelection: {
      chosenUid: area.stationUid,
      chosenName: area.stationName,
      tier: area.tier,
      distanceKm: area.distanceKm,
      confidenceBand: area.confidenceBand,
      neighbourDeviation: null,
      suspect: false,
      ceilingPinned: false,
      rejected: [],
      outOfRadiusCount: 0,
    },
    skyGeometry: geometry,
    geometryCompliant: isGeometryCompliant(geometry),
    locationChanges: [],
  }
}

const [MAMPANG, JAGAKARSA, MENTENG] = DEMO_LOCATIONS

// Exactly one seeded sample per demo zone — one open slot left in each, so
// that capturing live in each zone during a run (the DEMO pill's whole point)
// visibly adds to a log that isn't already full, rather than landing in a
// list that already reads as complete. A full run — one live capture per
// zone — brings every zone to two samples and the log to SAMPLE_GOAL (8).
export const DEMO_SAMPLES = [
  // Deliberately non-compliant: 28° from the sun, so the compliance flag is
  // visible on the projector rather than theoretical. Also the Tier B example.
  seed({
    id: 'demo-heavy-haze',
    pm25: 35.9,
    hex: '#82b9dc',
    area: MAMPANG,
    zoneKey: 'heavy-haze',
    agoMs: 1 * DAY,
    notes: 'Shot toward the sun — kept as a counter-example.',
    geometry: { compassHeading: 92, cameraElevation: 52, scatteringAngle: 28, sensorAvailable: true },
  }),
  seed({
    id: 'demo-typical',
    pm25: 30.2,
    hex: '#95c4e1',
    area: MENTENG,
    zoneKey: 'typical-jakarta',
    agoMs: 2 * DAY,
    notes: '',
    geometry: { compassHeading: 210, cameraElevation: 71, scatteringAngle: 96, sensorAvailable: true },
  }),
  seed({
    id: 'demo-good-day',
    pm25: 13.8,
    hex: '#5ca4d1',
    area: JAGAKARSA,
    zoneKey: 'good-day',
    agoMs: 5 * DAY,
    notes: 'Clear, light breeze.',
    geometry: { compassHeading: 160, cameraElevation: 88, scatteringAngle: 91, sensorAvailable: true },
  }),
  seed({
    id: 'demo-aspirational',
    pm25: 6.2,
    hex: '#27658c',
    area: MENTENG,
    zoneKey: 'aspirational',
    agoMs: 8 * DAY,
    notes: 'Deep clear blue, no haze at all.',
    geometry: { compassHeading: 188, cameraElevation: 86, scatteringAngle: 97, sensorAvailable: true },
  }),
]
