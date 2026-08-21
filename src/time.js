// Timestamp handling for Udara Jakarta data.
//
// The source stamps readings as "2026-08-20T00:30:00" — Jakarta local time with
// NO timezone marker. JavaScript parses a timezone-less date-time as the LOCAL
// time of whoever is running, so the same string means different instants on
// different machines:
//
//   read in Jakarta (UTC+7) -> correct
//   read in UTC (CI, most servers) -> 7 hours off
//   read in New York (UTC-4) -> 11 hours off
//
// That skew feeds straight into the freshness gate, so a reading could look
// hours fresher or staler than it is depending purely on where the reader sits.
// Every timestamp from this source is therefore pinned to Jakarta explicitly.

export const JAKARTA_UTC_OFFSET = '+07:00'

// Matches a bare date-time with no trailing offset or Z.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/

/**
 * Normalise a Udara Jakarta timestamp to an unambiguous ISO string.
 * Values that already carry an offset are returned untouched.
 */
export function toJakartaIso(raw) {
  if (typeof raw !== 'string' || !raw) return null
  const trimmed = raw.trim()
  if (!NAIVE_DATETIME.test(trimmed)) return trimmed // already has Z or ±HH:MM
  return `${trimmed.replace(' ', 'T')}${JAKARTA_UTC_OFFSET}`
}

/**
 * Parse a Udara Jakarta timestamp into a Date, treating a missing timezone as
 * Jakarta rather than as the reader's own timezone.
 */
export function parseJakartaTimestamp(raw) {
  const iso = toJakartaIso(raw)
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------
// `toLocaleDateString()` renders 12 August as "8/12/2026" under en-US, which
// reads as 8 December to most of the world and to every Indonesian reader of
// this log. A month written in letters cannot be misread, so it is written in
// letters.
//
// Times are 12-hour with a meridiem, and the hour is NOT zero-padded — "9:07 AM",
// not "09:07 AM". Formatting is done by hand rather than via toLocaleTimeString
// because that pads the hour under most locales and switches to 24-hour under
// others, so the same build would render differently for different readers.
//
// These render in the reader's own timezone, which is correct: a sample's
// timestamp describes the moment the person was standing there.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const pad = (n) => String(n).padStart(2, '0')

/** "12 Aug 2026" */
export function formatDate(value) {
  const d = asDate(value)
  if (!d) return '—'
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "3:20 PM" — 12-hour, meridiem, hour never zero-padded. */
export function formatTime(value) {
  const d = asDate(value)
  if (!d) return '—'
  const h24 = d.getHours()
  // Midnight and noon are both "12": 0 → 12 AM, 12 → 12 PM.
  const hour = h24 % 12 === 0 ? 12 : h24 % 12
  return `${hour}:${pad(d.getMinutes())} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** "12 Aug 2026, 3:20 PM" */
export function formatDateTime(value) {
  const d = asDate(value)
  if (!d) return '—'
  return `${formatDate(d)}, ${formatTime(d)}`
}
