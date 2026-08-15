/** Small deterministic color generator for entities created at runtime (see
 *  applyGrantIndependence) -- mirrors the build-time fallback generator in
 *  scripts/generate-baseline-data.ts (kept separate/duplicated rather than
 *  shared, since one runs in Node at build time and one runs in the browser
 *  worker, and the logic is tiny). */
function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase()
}

export function generateDistinguishableColor(seedStr: string, usedColors: Iterable<string>): string {
  const used = new Set([...usedColors].map((c) => c.toLowerCase()))
  const rng = mulberry32(hashSeed(seedStr))
  for (let attempt = 0; attempt < 50; attempt++) {
    const hue = Math.floor(rng() * 360)
    const sat = 0.2 + rng() * 0.2
    const light = 0.32 + rng() * 0.16
    const hex = hslToHex(hue, sat, light)
    if (!used.has(hex.toLowerCase())) return hex
  }
  return '#7a7a7a'
}
