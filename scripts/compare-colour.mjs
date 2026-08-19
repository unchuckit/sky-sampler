#!/usr/bin/env node
// Prints naive vs. linear averaged hex for an exported log, with per-channel
// deltas, so the correction can be eyeballed before it is trusted.
//
// The correction can only be applied where the 5 raw tap values survive. The
// log stores taps as 6-digit hex, which *is* the 8-bit RGB — nothing was lost
// in that encoding, so recomputation is exact. Samples with no retained taps
// cannot be corrected retroactively at all, and are reported as such rather
// than silently skipped.
//
// Usage: node scripts/compare-colour.mjs path/to/sky-sampler-log.txt
//        node scripts/compare-colour.mjs path/to/log.json

import { readFileSync } from 'node:fs'
import { averageHexNaive, averageHexLinear, hexDelta } from '../src/colour.js'

function parseLog(raw) {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed)
    return (Array.isArray(data) ? data : [data]).map((s) => ({
      label: `${s.location ?? '?'} ${new Date(s.createdAt).toLocaleString()}`,
      storedHex: s.averagedHex ?? null,
      taps: Array.isArray(s.tapSamples) ? s.tapSamples : [],
    }))
  }
  return trimmed
    .split(/^---$/m)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const get = (label) => block.match(new RegExp(`^${label}: (.+)$`, 'm'))?.[1]?.trim()
      const tapLine = get('5 tap samples')
      const taps =
        tapLine && tapLine !== 'n/a'
          ? tapLine.split(',').map((t) => t.trim()).filter((t) => /^#?[0-9a-fA-F]{6}$/.test(t))
          : []
      return {
        label: `${get('Location') ?? '?'} ${get('Date') ?? ''} ${get('Time') ?? ''}`.trim(),
        storedHex: get('Averaged hex') ?? null,
        taps,
      }
    })
}

function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('Usage: node scripts/compare-colour.mjs <exported-log.txt|log.json>')
    process.exit(1)
  }

  const samples = parseLog(readFileSync(path, 'utf8'))
  console.log(`Parsed ${samples.length} sample(s) from ${path}.\n`)

  const correctable = samples.filter((s) => s.taps.length > 0)
  const uncorrectable = samples.filter((s) => s.taps.length === 0)

  if (correctable.length) {
    console.log('Sample'.padEnd(38) + 'Naive'.padEnd(11) + 'Linear'.padEnd(11) + 'Δ per channel (R,G,B)')
    console.log('─'.repeat(88))
    let maxAbs = 0
    for (const s of correctable) {
      const naive = averageHexNaive(s.taps)
      const linear = averageHexLinear(s.taps)
      const d = hexDelta(naive, linear)
      maxAbs = Math.max(maxAbs, Math.abs(d.r), Math.abs(d.g), Math.abs(d.b))
      const fmt = (n) => (n > 0 ? `+${n}` : `${n}`)
      console.log(
        s.label.slice(0, 36).padEnd(38) +
          naive.padEnd(11) +
          linear.padEnd(11) +
          `${fmt(d.r)}, ${fmt(d.g)}, ${fmt(d.b)}`,
      )
    }
    console.log()
    // The correction scales with how far apart the 5 taps are. Tightly clustered
    // taps (the normal case for real sky) barely move at all; widely spread taps
    // move more, legitimately. A large delta on *clustered* taps would be the
    // signal something is wrong.
    console.log(`Largest per-channel delta: ${maxAbs}`)
    if (maxAbs > 8) {
      console.log(
        'WARNING: that is larger than a real correction on sky samples should be.\n' +
          'Check src/colour.js before accepting these values — a delta this size points at a\n' +
          'bug in the transfer functions rather than a genuine correction.',
      )
    } else if (maxAbs === 0) {
      console.log('Taps were tightly clustered, so the correction rounds to zero at 8-bit precision.')
    } else {
      console.log('Consistent with a real correction — deltas grow with how far apart the taps are.')
    }
  } else {
    console.log('No sample in this log retained its 5 raw tap values.')
  }

  if (uncorrectable.length) {
    console.log(
      `\n${uncorrectable.length} sample(s) have no retained tap values, so the linear correction\n` +
        'cannot be applied to them retroactively — they stay on the old maths permanently:',
    )
    for (const s of uncorrectable) console.log(`  - ${s.label} (stored ${s.storedHex ?? 'n/a'})`)
  }
}

main()
