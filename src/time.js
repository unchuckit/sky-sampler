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
