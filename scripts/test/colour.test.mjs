import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  srgbToLinear,
  linearToSrgb,
  averageHexNaive,
  averageHexLinear,
  hexToRgb,
  rgbToHex,
  hexDelta,
} from '../../src/colour.js'

describe('sRGB transfer functions', () => {
  test('round-trip is identity across the full range', () => {
    for (let v = 0; v <= 255; v++) {
      const c = v / 255
      const back = linearToSrgb(srgbToLinear(c))
      assert.ok(Math.abs(back - c) < 1e-12, `round-trip failed at ${v}: ${back} !== ${c}`)
    }
  })

  test('anchors: 0 → 0, 1 → 1', () => {
    assert.equal(srgbToLinear(0), 0)
    assert.ok(Math.abs(srgbToLinear(1) - 1) < 1e-12)
    assert.equal(linearToSrgb(0), 0)
    assert.ok(Math.abs(linearToSrgb(1) - 1) < 1e-12)
  })

  test('mid-grey 128 carries roughly 22% of the light of 255, not 50%', () => {
    // This is the whole reason the naive average is biased.
    const linear = srgbToLinear(128 / 255)
    assert.ok(linear > 0.21 && linear < 0.23, `expected ~0.216, got ${linear}`)
  })

  test('uses the piecewise linear segment near black, not a bare power curve', () => {
    // At c = 0.04 we are below the cutoff, so the linear branch applies.
    assert.equal(srgbToLinear(0.04), 0.04 / 12.92)
    // A ^2.2 shortcut would give a materially different answer here.
    assert.ok(Math.abs(srgbToLinear(0.04) - Math.pow(0.04, 2.2)) > 1e-4)
  })
})

describe('hex helpers', () => {
  test('hexToRgb / rgbToHex round-trip', () => {
    for (const hex of ['#000000', '#ffffff', '#91a7bf', '#4698cb', '#27658c']) {
      const [r, g, b] = hexToRgb(hex)
      assert.equal(rgbToHex(r, g, b), hex)
    }
  })

  test('rgbToHex clamps out-of-range channels', () => {
    assert.equal(rgbToHex(-10, 300, 128), '#00ff80')
  })
})

describe('averaging pipeline', () => {
  // The required invariant: five identical values must survive the full
  // linearise → average → re-encode pipeline exactly. Any drift here is a bug
  // in the transfer functions, not a rounding artefact.
  test('five identical values return exactly that value', () => {
    const samples = ['#91a7bf', '#4698cb', '#27658c', '#000000', '#ffffff', '#7f7f7f', '#010203']
    for (const hex of samples) {
      assert.equal(averageHexLinear([hex, hex, hex, hex, hex]), hex, `failed for ${hex}`)
    }
  })

  test('every 8-bit grey survives the pipeline unchanged', () => {
    for (let v = 0; v <= 255; v++) {
      const hex = rgbToHex(v, v, v)
      assert.equal(averageHexLinear([hex, hex, hex, hex, hex]), hex, `failed at grey ${v}`)
    }
  })

  test('linear average is brighter than naive for widely separated values', () => {
    // Black + white: naive gives ~128; linear light averages to 0.5, which
    // re-encodes to ~188. The gap is the bias the naive method introduces.
    const naive = averageHexNaive(['#000000', '#ffffff'])
    const linear = averageHexLinear(['#000000', '#ffffff'])
    assert.equal(naive, '#808080')
    const [lr] = hexToRgb(linear)
    assert.ok(lr > 180 && lr < 195, `expected ~188, got ${lr}`)
  })

  test('sky-like samples differ by only a few points per channel', () => {
    // Real sky taps sit close together, so the correction should be small.
    // A large delta here would mean the implementation is wrong.
    const taps = ['#8fa5bd', '#93a9c1', '#8da3bb', '#95abc3', '#91a7bf']
    const naive = averageHexNaive(taps)
    const linear = averageHexLinear(taps)
    const delta = hexDelta(naive, linear)
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(Math.abs(delta[ch]) <= 3, `channel ${ch} delta ${delta[ch]} exceeds expected range`)
    }
  })

  test('empty or missing input returns null rather than throwing', () => {
    assert.equal(averageHexLinear([]), null)
    assert.equal(averageHexLinear(null), null)
    assert.equal(averageHexNaive([]), null)
  })

  test('averaging is order-independent', () => {
    const taps = ['#8fa5bd', '#93a9c1', '#8da3bb', '#95abc3', '#91a7bf']
    const reversed = [...taps].reverse()
    assert.equal(averageHexLinear(taps), averageHexLinear(reversed))
  })
})
