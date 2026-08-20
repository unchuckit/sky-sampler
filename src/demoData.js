import { PROVENANCE, TIERS } from './constants'
import { averageHexNaive, averageHexLinear } from './colour'
import { pm25ToAqi } from './aqi'
import { isGeometryCompliant } from './sunGeometry'
import { geometryAdjustedHex, GEOMETRY_CORRECTION_MODEL } from './geometryCorrection'

// Fixtures for demo mode. Never written to or read from localStorage.
//
// Sampling areas here carry real station attachments, verified against a live
// snapshot, and follow the same rules the running app enforces:
//
//   - every band matches its distance (under 5km is high)
//   - coordinateSource is 'gps', because these represent places a person stands
//     to photograph the sky, which is also why the distances are non-zero — a
//     district centroid can land on top of a station, but a person does not
//
// Getting either of those wrong would make demo mode show a state the real app
// could never produce, which is the one thing a demo must not do.
export const DEMO_LOCATIONS = [
  {
    id: 'demo-mampang',
    label: 'Mampang Prapatan',
    stationUid: 'demo-lcs06',
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
    stationUid: 'demo-dki3',
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
    stationUid: 'demo-dki38',
    stationName: 'DKI_PM25_38 Taman Ismail Marzuki',
    distanceKm: 0.7,
    confidenceBand: 'high',
    tier: TIERS.A,
    coordinateSource: 'gps',
    active: true,
  },
]

// Timestamps are generated relative to now — "2 hours ago", "yesterday" — so the
// projected log never shows stale dates and needs no editing before a run.
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

function seed({ id, pm25, hex, area, ago, notes, geometry }) {
  const taps = [jitterHex(hex, -4), jitterHex(hex, 2), hex, jitterHex(hex, -2), jitterHex(hex, 3)]
  const createdAt = new Date(Date.now() - ago).toISOString()
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

export const DEMO_SAMPLES = [
  seed({
    id: 'demo-1',
    pm25: 78.4, // Heavy Haze
    hex: '#cfe4f1',
    area: JAGAKARSA,
    ago: 2 * HOUR,
    notes: 'Thick haze, sun barely visible.',
    geometry: { compassHeading: 195, cameraElevation: 78, scatteringAngle: 88, sensorAvailable: true },
  }),
  seed({
    id: 'demo-2',
    pm25: 52.1,
    hex: '#bcd9ec',
    area: JAGAKARSA,
    ago: 6 * HOUR,
    notes: 'Grey haze, no clouds.',
    geometry: { compassHeading: 140, cameraElevation: 66, scatteringAngle: 74, sensorAvailable: true },
  }),
  // Deliberately non-compliant: 28° from the sun, so the compliance flag is
  // visible on the projector rather than theoretical.
  seed({
    id: 'demo-3',
    pm25: 35.9,
    hex: '#82b9dc',
    area: MAMPANG,
    ago: 1 * DAY + 3 * HOUR,
    notes: 'Shot toward the sun — kept as a counter-example.',
    geometry: { compassHeading: 92, cameraElevation: 52, scatteringAngle: 28, sensorAvailable: true },
  }),
  seed({
    id: 'demo-4',
    pm25: 30.2,
    hex: '#95c4e1',
    area: MENTENG,
    ago: 2 * DAY,
    notes: '',
    geometry: { compassHeading: 210, cameraElevation: 71, scatteringAngle: 96, sensorAvailable: true },
  }),
  seed({
    id: 'demo-5',
    pm25: 18.4, // Good Day
    hex: '#4999cb',
    area: MAMPANG,
    ago: 3 * DAY + 5 * HOUR,
    notes: 'Some scattered cloud at the horizon.',
    geometry: { compassHeading: 175, cameraElevation: 82, scatteringAngle: 104, sensorAvailable: true },
  }),
  seed({
    id: 'demo-6',
    pm25: 13.8,
    hex: '#5ca4d1',
    area: JAGAKARSA,
    ago: 5 * DAY,
    notes: 'Clear, light breeze.',
    geometry: { compassHeading: 160, cameraElevation: 88, scatteringAngle: 91, sensorAvailable: true },
  }),
  seed({
    id: 'demo-7',
    pm25: 6.2, // Aspirational
    hex: '#27658c',
    area: MENTENG,
    ago: 8 * DAY,
    notes: 'Deep clear blue, no haze at all.',
    geometry: { compassHeading: 188, cameraElevation: 86, scatteringAngle: 97, sensorAvailable: true },
  }),
  seed({
    id: 'demo-8',
    pm25: 4.1,
    hex: '#296a92',
    area: MENTENG,
    ago: 11 * DAY,
    notes: 'Best sky of the month.',
    geometry: { compassHeading: 205, cameraElevation: 79, scatteringAngle: 83, sensorAvailable: true },
  }),
]
