/*
 * The rose window (薔薇窓) — the special character record's crest (design spec
 * §3.7): a per-character stained-glass rosette, generated as pure SVG from one
 * shared tracery engine so the 13 windows read as one cathedral.
 *
 * Game referents (inspiration only, rebuilt from scratch): the refute cut-in
 * stained-glass blades (leaf mosaic + rose window + witch-script border band,
 * recolored per witch), the trial UI's per-character 魔法 orbital-ellipse
 * seals, and the site's own Verdict Seal (its engraved core sits at every
 * window's heart — the Seal blooming into her glass).
 *
 * Per character: the tracery motif (cell shape) is her canon icon, the glass
 * palette is derived from her ink color, and the outer band's witch-script
 * glyphs are derived deterministically from her magic name (it "spells" her
 * magic in a script no one can read). No randomness anywhere — same inputs,
 * same window — so SSR, the island, html2canvas export, and the OG renderer
 * all agree. Literal hex colors only (html2canvas + resvg constraints).
 */

export type MotifKey =
  | 'leaf'
  | 'sakura'
  | 'flame'
  | 'feather'
  | 'keyhole'
  | 'film'
  | 'ray'
  | 'crescent'
  | 'drop'
  | 'thread'
  | 'iris'
  | 'tarot'
  | 'shard'
  | 'clock'

export interface RoseWindowSpec {
  /** The character's ink color (plain #rrggbb). */
  color: string
  /** Tracery motif — the character's canon icon. */
  motif: MotifKey
  /** Seeds the witch-script band (per-locale magic name works fine). */
  magicName: string
}

/** Canon motif per character id (design doc §3.7). Unmapped ids fall back to
 *  the cut-in's own leaf mosaic — still per-character via palette + script. */
export const CHARACTER_MOTIFS: Record<string, MotifKey> = {
  ema: 'sakura', // 桜羽 — the sakura in her hair, the flowers on her pin
  hiro: 'clock', // 死に戻り — the day wound backwards
  anan: 'crescent', // 眠り姫 — sleep, moon and stars
  noa: 'drop', // 液体操作 — ink and paint
  leia: 'ray', // 舞台の上 — the spotlight
  miria: 'film', // 入れ替わり + old films
  margo: 'tarot', // タロット — the fanned deck
  nanoka: 'shard', // 魔法銃 — glass shards, one bullet a day
  alisa: 'flame', // 発火 — a match's worth of fire
  sherry: 'keyhole', // 破壊探偵 — the locks she studies
  hanna: 'thread', // 裁縫 — needle and thread
  coco: 'iris', // 千里眼 — the watching eye
  meruru: 'feather', // フクロウ — the owl's wing
}

// ── color math (deterministic, literal hex in/out) ──
const LEAD = '#161020' // lead came between glass cells
const GOLD = '#c9954a'
const BONE = '#e9dfcc'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
/** Mix `hex` toward `to` by t (0..1). */
function mix(hex: string, to: string, t: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(to)
  return rgbToHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  )
}

interface Glass {
  base: string
  light: string
  deep: string
  pale: string
  dark: string // the backing glass between cells
  script: string // witch-script stroke
}
function glassFor(color: string): Glass {
  return {
    base: color,
    light: mix(color, '#ffffff', 0.45),
    deep: mix(color, '#3a2340', 0.32),
    pale: mix(BONE, color, 0.25),
    dark: mix('#17121f', color, 0.2),
    script: mix(BONE, color, 0.3),
  }
}

/** Point on a circle around (100,100); angle in degrees, 0 = up. */
function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)]
}
/** Annular sector between rIn..rOut spanning [a0..a1] degrees. */
function sector(rIn: number, rOut: number, a0: number, a1: number): string {
  const [x0, y0] = polar(rOut, a0)
  const [x1, y1] = polar(rOut, a1)
  const [x2, y2] = polar(rIn, a1)
  const [x3, y3] = polar(rIn, a0)
  const f = (v: number) => v.toFixed(2)
  return (
    `M${f(x0)} ${f(y0)}A${rOut} ${rOut} 0 0 1 ${f(x1)} ${f(y1)}` +
    `L${f(x2)} ${f(y2)}A${rIn} ${rIn} 0 0 0 ${f(x3)} ${f(y3)}Z`
  )
}

// ── geometry helpers — all cells are authored pointing UP at center (100,100)
// and rotated into place on an inner <g>/<path> transform (never on <svg>). ──
const CX = 100
const CY = 100

type CellFn = (rIn: number, rOut: number) => string

/** Classic mosaic leaf — the cut-in blades' own fill pattern. */
const leafCell: CellFn = (rIn, rOut) => {
  const h = rOut - rIn
  return (
    `M${CX} ${CY - rIn}` +
    `C${CX - 14} ${CY - rIn - h * 0.28} ${CX - 16} ${CY - rOut + h * 0.34} ${CX} ${CY - rOut}` +
    `C${CX + 16} ${CY - rOut + h * 0.34} ${CX + 14} ${CY - rIn - h * 0.28} ${CX} ${CY - rIn}Z`
  )
}

/** Sakura petal — notched tip (ema, 桜羽). */
const sakuraCell: CellFn = (rIn, rOut) => {
  return (
    `M${CX} ${CY - rIn}` +
    `C${CX - 17} ${CY - rIn - 9} ${CX - 20} ${CY - rOut + 20} ${CX - 7} ${CY - rOut + 5.5}` +
    `L${CX} ${CY - rOut + 11.5}` +
    `L${CX + 7} ${CY - rOut + 5.5}` +
    `C${CX + 20} ${CY - rOut + 20} ${CX + 17} ${CY - rIn - 9} ${CX} ${CY - rIn}Z`
  )
}

/** Flame tongue — leaning lick with a whipped tip (alisa, 発火). */
const flameCell: CellFn = (rIn, rOut) => {
  const h = rOut - rIn
  return (
    `M${CX} ${CY - rIn}` +
    `C${CX - 16} ${CY - rIn - h * 0.18} ${CX - 15} ${CY - rIn - h * 0.62} ${CX - 7} ${CY - rOut + h * 0.42}` +
    `C${CX - 11} ${CY - rOut + h * 0.2} ${CX - 12} ${CY - rOut + h * 0.06} ${CX - 8} ${CY - rOut}` +
    `C${CX - 4} ${CY - rOut + h * 0.14} ${CX + 3} ${CY - rOut + h * 0.12} ${CX + 6} ${CY - rOut + h * 0.3}` +
    `C${CX + 12} ${CY - rIn - h * 0.34} ${CX + 12} ${CY - rIn - h * 0.16} ${CX} ${CY - rIn}Z`
  )
}

/** Owl feather — round blunt tip, soft flanks (meruru, フクロウ). */
const featherCell: CellFn = (rIn, rOut) => {
  const h = rOut - rIn
  return (
    `M${CX} ${CY - rIn}` +
    `C${CX - 13} ${CY - rIn - h * 0.2} ${CX - 12} ${CY - rOut + h * 0.34} ${CX - 9} ${CY - rOut + 8}` +
    `A9 9 0 0 1 ${CX + 9} ${CY - rOut + 8}` +
    `C${CX + 12} ${CY - rOut + h * 0.34} ${CX + 13} ${CY - rIn - h * 0.2} ${CX} ${CY - rIn}Z`
  )
}

/** Keyhole — round bow over a flaring stem (sherry, the locks she studies). */
const keyholeCell: CellFn = (rIn, rOut) => {
  return (
    `M${CX - 6.5} ${CY - rIn}` +
    `L${CX - 3.4} ${CY - rOut + 16}` +
    `A8.2 8.2 0 1 1 ${CX + 3.4} ${CY - rOut + 16}` +
    `L${CX + 6.5} ${CY - rIn}Z`
  )
}

/** Film frame — rounded rect with perforation notches (miria, old films). */
const filmCell: CellFn = (rIn, rOut) => {
  const t = CY - rOut
  const b = CY - rIn
  return (
    `M${CX - 10} ${b}` +
    `L${CX - 10} ${b - (b - t) * 0.3}` +
    `L${CX - 13} ${b - (b - t) * 0.3}L${CX - 13} ${b - (b - t) * 0.44}L${CX - 10} ${b - (b - t) * 0.44}` +
    `L${CX - 10} ${b - (b - t) * 0.56}` +
    `L${CX - 13} ${b - (b - t) * 0.56}L${CX - 13} ${b - (b - t) * 0.7}L${CX - 10} ${b - (b - t) * 0.7}` +
    `L${CX - 10} ${t + 3}Q${CX - 10} ${t} ${CX - 7} ${t}` +
    `L${CX + 7} ${t}Q${CX + 10} ${t} ${CX + 10} ${t + 3}` +
    `L${CX + 10} ${b - (b - t) * 0.7}` +
    `L${CX + 13} ${b - (b - t) * 0.7}L${CX + 13} ${b - (b - t) * 0.56}L${CX + 10} ${b - (b - t) * 0.56}` +
    `L${CX + 10} ${b - (b - t) * 0.44}` +
    `L${CX + 13} ${b - (b - t) * 0.44}L${CX + 13} ${b - (b - t) * 0.3}L${CX + 10} ${b - (b - t) * 0.3}` +
    `L${CX + 10} ${b}Z`
  )
}

/** Spotlight beam — a wedge flaring outward (leia, 舞台の上). */
const rayCell: CellFn = (rIn, rOut) => {
  return (
    `M${CX - 2.4} ${CY - rIn}` +
    `L${CX - 10.5} ${CY - rOut}` +
    `L${CX + 10.5} ${CY - rOut}` +
    `L${CX + 2.4} ${CY - rIn}Z`
  )
}

/** Crescent moon sliver (anan, 眠り姫). */
const crescentCell: CellFn = (rIn, rOut) => {
  const h = rOut - rIn
  return (
    `M${CX} ${CY - rOut}` +
    `A${h * 0.62} ${h * 0.62} 0 0 0 ${CX} ${CY - rIn}` +
    `A${h * 1.05} ${h * 1.05} 0 0 1 ${CX} ${CY - rOut}Z`
  )
}

/** Ink drop — bulb outward, dripping point toward the heart (noa, 液体操作). */
const dropCell: CellFn = (rIn, rOut) => {
  return (
    `M${CX} ${CY - rIn}` +
    `C${CX - 3} ${CY - rIn - 7} ${CX - 11} ${CY - rOut + 17} ${CX - 11} ${CY - rOut + 10}` +
    `A11 11 0 1 1 ${CX + 11} ${CY - rOut + 10}` +
    `C${CX + 11} ${CY - rOut + 17} ${CX + 3} ${CY - rIn - 7} ${CX} ${CY - rIn}Z`
  )
}

/** Twisted ribbon — a thread crossing itself (hanna, 裁縫). */
const threadCell: CellFn = (rIn, rOut) => {
  const h = rOut - rIn
  return (
    `M${CX} ${CY - rIn}` +
    `C${CX - 17} ${CY - rIn - h * 0.34} ${CX + 17} ${CY - rOut + h * 0.34} ${CX} ${CY - rOut}` +
    `C${CX - 17} ${CY - rOut + h * 0.34} ${CX + 17} ${CY - rIn - h * 0.34} ${CX} ${CY - rIn}Z`
  )
}

/** Aperture blade — a comma-curved wedge; the band swirls like a camera
 *  iris closing around the seal-pupil (coco, 千里眼). */
const irisCell: CellFn = (rIn, rOut) => {
  const h = rOut - rIn
  return (
    `M${CX - 2} ${CY - rIn}` +
    `C${CX - 13} ${CY - rIn - h * 0.28} ${CX - 15} ${CY - rOut + h * 0.32} ${CX - 6} ${CY - rOut}` +
    `L${CX + 6} ${CY - rOut}` +
    `C${CX - 1} ${CY - rOut + h * 0.36} ${CX + 1} ${CY - rIn - h * 0.28} ${CX + 4} ${CY - rIn}Z`
  )
}

/** Tarot card — rounded slab, fanned by the band's tilt (margo, タロット). */
const tarotCell: CellFn = (rIn, rOut) => {
  const t = CY - rOut
  const b = CY - rIn
  return (
    `M${CX - 8.5} ${b}` +
    `L${CX - 8.5} ${t + 3}Q${CX - 8.5} ${t} ${CX - 5.5} ${t}` +
    `L${CX + 5.5} ${t}Q${CX + 8.5} ${t} ${CX + 8.5} ${t + 3}` +
    `L${CX + 8.5} ${b}Z`
  )
}

/** Glass shard — jagged asymmetric splinter (nanoka, one bullet a day). */
const shardCell: CellFn = (rIn, rOut) => {
  const h = rOut - rIn
  return (
    `M${CX + 1} ${CY - rIn}` +
    `L${CX - 8} ${CY - rIn - h * 0.42}` +
    `L${CX - 3} ${CY - rIn - h * 0.55}` +
    `L${CX - 5} ${CY - rOut}` +
    `L${CX + 7} ${CY - rOut + h * 0.3}` +
    `L${CX + 4} ${CY - rIn - h * 0.3}Z`
  )
}

/** Clock hour block (outer) — the day, wound backwards (hiro, 死に戻り). */
const clockHourCell: CellFn = (rIn, rOut) => {
  const t = CY - rOut
  const b = CY - rIn
  return (
    `M${CX - 9} ${b}` +
    `L${CX - 12} ${t + 4}Q${CX - 12.5} ${t} ${CX - 8.5} ${t}` +
    `L${CX + 8.5} ${t}Q${CX + 12.5} ${t} ${CX + 12} ${t + 4}` +
    `L${CX + 9} ${b}Z`
  )
}
/** Clock hand — a long thin lozenge (hiro's inner band, three hands). */
const clockHandCell: CellFn = (rIn, rOut) => {
  const mid = CY - (rIn + rOut) / 2
  return (
    `M${CX} ${CY - rIn}` +
    `L${CX - 4} ${mid}` +
    `L${CX} ${CY - rOut}` +
    `L${CX + 4} ${mid}Z`
  )
}

interface BandSpec {
  cell: CellFn
  count: number
  /** Constant tilt in degrees, pivoting each cell around its own base —
   *  fans the cells (tarot) or swirls them (aperture). */
  tilt?: number
  /** Mirror every other cell about its own axis (jagged motifs). */
  mirrorAlt?: boolean
}
interface MotifSpec {
  outer: BandSpec
  inner: BandSpec
}
const MOTIF_SPECS: Record<MotifKey, MotifSpec> = {
  leaf: { outer: { cell: leafCell, count: 12 }, inner: { cell: leafCell, count: 8 } },
  sakura: { outer: { cell: sakuraCell, count: 10 }, inner: { cell: sakuraCell, count: 5 } },
  flame: { outer: { cell: flameCell, count: 12 }, inner: { cell: flameCell, count: 6 } },
  feather: { outer: { cell: featherCell, count: 12 }, inner: { cell: featherCell, count: 8 } },
  keyhole: { outer: { cell: keyholeCell, count: 10 }, inner: { cell: keyholeCell, count: 6 } },
  film: { outer: { cell: filmCell, count: 12 }, inner: { cell: tarotCell, count: 6 } },
  ray: { outer: { cell: rayCell, count: 16 }, inner: { cell: rayCell, count: 8 } },
  crescent: { outer: { cell: crescentCell, count: 12, mirrorAlt: true }, inner: { cell: crescentCell, count: 6 } },
  drop: { outer: { cell: dropCell, count: 12 }, inner: { cell: dropCell, count: 6 } },
  thread: { outer: { cell: threadCell, count: 12 }, inner: { cell: threadCell, count: 6 } },
  iris: { outer: { cell: irisCell, count: 14 }, inner: { cell: irisCell, count: 8 } },
  tarot: { outer: { cell: tarotCell, count: 11, tilt: 8 }, inner: { cell: tarotCell, count: 5, tilt: 8 } },
  shard: { outer: { cell: shardCell, count: 14, mirrorAlt: true }, inner: { cell: shardCell, count: 7 } },
  clock: { outer: { cell: clockHourCell, count: 12 }, inner: { cell: clockHandCell, count: 3 } },
}

// ── the witch-script band: 8 angular glyphs, sequence derived from the magic
// name's char codes — deterministic, per character, unreadable by design. ──
const RUNES = [
  'M-3 3 L-3 -3 L3 3 L3 -3',
  'M0 -4 L0 4 M-3 -1 L3 -1',
  'M-3 -3 L3 -3 L-1 4',
  'M-3 1 L3 1 M0 -4 L-3 1 M0 -4 L3 1',
  'M-2 -4 L-2 4 M-2 0 L2.5 -3.5 M-2 0 L2.5 3.5',
  'M3 -4 L-3 0 L3 4',
  'M0 4 L0 -4 M0 -1 L-3 -4 M0 -1 L3 -4',
  'M-3 4 L0 -4 L3 4 M-1.7 0.8 L1.7 0.8',
]
const BAND_PANELS = 24

function runeSequence(magicName: string): number[] {
  const codes = Array.from(magicName).map((ch) => ch.codePointAt(0) ?? 0)
  const seq: number[] = []
  for (let i = 0; i < BAND_PANELS; i++) {
    const c = codes.length ? codes[i % codes.length]! : 0
    // fold in the position so repeated characters still vary the band
    seq.push((c + i * 7) % RUNES.length)
  }
  return seq
}

/** The window as an inner group in a 200×200 box at (0,0) — embed anywhere. */
export function roseWindowGroup(spec: RoseWindowSpec): string {
  const g = glassFor(spec.color)
  const motif = MOTIF_SPECS[spec.motif] ?? MOTIF_SPECS.leaf
  const fills = [g.base, g.light, g.deep, g.pale]
  const parts: string[] = []

  // backing glass + outer lead rings
  parts.push(`<circle cx="${CX}" cy="${CY}" r="97" fill="${g.dark}" stroke="${LEAD}" stroke-width="2.4"/>`)
  parts.push(`<circle cx="${CX}" cy="${CY}" r="90" fill="none" stroke="${LEAD}" stroke-width="1.6"/>`)

  // witch-script band (r 79–90) — the cut-in border language: alternating
  // glazed tiles, each carrying a faint tangential script mark
  const seq = runeSequence(spec.magicName)
  const step = 360 / BAND_PANELS
  for (let i = 0; i < BAND_PANELS; i++) {
    const a = i * step
    const tile = i % 2 === 0 ? g.deep : g.light
    const tileOp = i % 2 === 0 ? 0.5 : 0.28
    parts.push(
      `<path d="${sector(79, 90, a - step / 2, a + step / 2)}" fill="${tile}" fill-opacity="${tileOp}" stroke="${LEAD}" stroke-width="1"/>`,
    )
    // tangential (lying along the band) + alternating flip → reads as script,
    // never as upright Latin letters
    const flip = i % 2 === 0 ? 90 : -90
    parts.push(
      `<path d="${RUNES[seq[i]!]}" fill="none" stroke="${g.script}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" transform="rotate(${a} ${CX} ${CY}) translate(${CX} ${CY - 84.5}) rotate(${flip})"/>`,
    )
  }
  parts.push(`<circle cx="${CX}" cy="${CY}" r="79" fill="none" stroke="${LEAD}" stroke-width="1.6"/>`)

  // luminous field the tracery sits on (glass, not void, between cells)
  parts.push(`<circle cx="${CX}" cy="${CY}" r="79" fill="${g.base}" fill-opacity="0.14"/>`)

  // tracery bands — cells rotated into place; optional per-band tilt (pivoting
  // each cell on its own base → fans/swirls) and alternating mirror
  const band = (b: BandSpec, rIn: number, rOut: number, phase: number, fillShift: number, sw: number) => {
    for (let i = 0; i < b.count; i++) {
      const a = (i * 360) / b.count + phase
      let tf = `rotate(${a} ${CX} ${CY})`
      if (b.tilt) tf += ` rotate(${b.tilt} ${CX} ${CY - rIn})`
      if (b.mirrorAlt && i % 2 === 1) tf += ` translate(${CX * 2} 0) scale(-1 1)`
      parts.push(
        `<path d="${b.cell(rIn, rOut)}" fill="${fills[(i + fillShift) % fills.length]}" fill-opacity="0.95" stroke="${LEAD}" stroke-width="${sw}" stroke-linejoin="round" transform="${tf}"/>`,
      )
    }
  }
  band(motif.outer, 48, 77, 0, 0, 1.5)
  band(motif.inner, 29, 46, 180 / motif.inner.count, 2, 1.4)

  // the trial seal's orbital ellipses, crossing the glass
  for (const a of [-32, 32]) {
    parts.push(
      `<ellipse cx="${CX}" cy="${CY}" rx="86" ry="26" fill="none" stroke="${GOLD}" stroke-width="0.8" opacity="0.4" transform="rotate(${a} ${CX} ${CY})"/>`,
    )
  }

  // the Verdict Seal's engraved core at the heart (brand continuity)
  parts.push(`<circle cx="${CX}" cy="${CY}" r="26" fill="${g.dark}" stroke="${LEAD}" stroke-width="1.8"/>`)
  const petal = (R: number, hw: number, waist: number) =>
    `M${CX} ${CY} Q${CX + hw} ${CY - R * waist} ${CX} ${CY - R} Q${CX - hw} ${CY - R * waist} ${CX} ${CY}Z`
  for (let i = 0; i < 6; i++) {
    parts.push(
      `<path d="${petal(20, 4.6, 0.42)}" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.95" transform="rotate(${i * 60} ${CX} ${CY})"/>`,
    )
  }
  for (let i = 0; i < 6; i++) {
    parts.push(
      `<path d="${petal(11, 3.2, 0.4)}" fill="none" stroke="${GOLD}" stroke-width="0.8" opacity="0.8" transform="rotate(${i * 60 + 30} ${CX} ${CY})"/>`,
    )
  }
  parts.push(`<circle cx="${CX}" cy="${CY}" r="2.4" fill="${GOLD}"/>`)
  parts.push(`<circle cx="${CX}" cy="${CY}" r="5.2" fill="none" stroke="${GOLD}" stroke-width="0.6" opacity="0.7"/>`)

  return `<g>${parts.join('')}</g>`
}

/** The window as a standalone responsive <svg> (the card components). */
export function roseWindowSvg(spec: RoseWindowSpec, title?: string): string {
  const label = title ? `<title>${escapeXml(title)}</title>` : ''
  return `<svg viewBox="0 0 200 200" role="img" aria-hidden="${title ? 'false' : 'true'}" xmlns="http://www.w3.org/2000/svg">${label}${roseWindowGroup(spec)}</svg>`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
