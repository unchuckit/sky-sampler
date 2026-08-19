import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

// Minimal PNG encoder (no deps) — draws a cyanometer-style disc icon.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const RINGS = [
  '#2c739f',
  '#307cab',
  '#378fc5',
  '#4999cb',
  '#5ca4d1',
  '#6fafd6',
  '#82b9dc',
]

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function makeIcon(size) {
  const bg = hexToRgb('#0f0f0f')
  const cx = size / 2
  const cy = size / 2
  const maxR = size * 0.42

  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      let rgb = bg
      let a = 255
      if (dist < maxR) {
        const ringIdx = Math.min(RINGS.length - 1, Math.floor((dist / maxR) * RINGS.length))
        rgb = hexToRgb(RINGS[RINGS.length - 1 - ringIdx])
      } else if (dist < maxR + size * 0.01) {
        rgb = hexToRgb('#f0f0f0')
      }
      const off = rowStart + 1 + x * 4
      raw[off] = rgb[0]
      raw[off + 1] = rgb[1]
      raw[off + 2] = rgb[2]
      raw[off + 3] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = deflateSync(raw)

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return png
}

writeFileSync(new URL('../public/icon-192.png', import.meta.url), makeIcon(192))
writeFileSync(new URL('../public/icon-512.png', import.meta.url), makeIcon(512))
console.log('Generated icon-192.png and icon-512.png')
