/*
 * OG image generator (design spec §7/§F). Hand-built 1200×630 SVGs rendered
 * with resvg-js — every surface is a framed plate: gold double hairlines with
 * the CardFrame fleurons, a witch-script band along the top and bottom, a
 * vignette that keeps the centre luminous. Root OG per locale (Seal over a
 * faint red rose-window halo + title + hook line), per-card OG (eyebrow, big
 * Seal, 魔法 mark, the magic NAME as the dominant blood-red element, one line
 * of magic text) and per-character OG (her rose window as the crest, the
 * magic name in her colour). CJK fonts come from the full Noto Serif CJK OTFs
 * (cached) — no network. Rendering is fanned out across a worker pool with
 * content-hash incremental skip.
 *
 * Reads content from `content/` if the compiler has produced it, else the
 * fixtures. Also rewrites public/robots.txt with the deploy origin.
 *
 * Run: `npm run gen:og` (also wired into `npm run build`).
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import os from 'node:os'
import { Worker } from 'node:worker_threads'
// @ts-expect-error - wawoff2 ships no types
import wawoff2 from 'wawoff2'
import { roseWindowGroup, CHARACTER_MOTIFS } from '../src/lib/rose-window'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SITE = (process.env.PUBLIC_SITE_URL || 'https://manosaba-witch-exam.asachiri.com').replace(/\/$/, '')
const DESIGN_VERSION = 'og-v3'
const CACHE = join(ROOT, 'scripts/.fonts-cache')
mkdirSync(CACHE, { recursive: true })

// ── Palette (mirrors src/styles/tokens.css) ──
// red = the witch colour (verdict/card), gold = seals/ornament, bone = prose.
const C = {
  ink: '#0a0608',
  ink2: '#0c0608',
  velvet: '#1b1016',
  oxblood: '#5c0f1a',
  red: '#c42838',
  redDeep: '#7a1828',
  gold: '#c9954a',
  goldBright: '#e8b04a',
  goldDeep: '#ad7237',
  bone: '#e9dfcc',
  boneDim: '#b3a892',
}

// ── Canvas + plate geometry ──
const W = 1200
const H = 630
/* The CardFrame fleuron is authored in a 52-unit box (src/components/
 * CardFrame.astro): outer rule at 3, inner rule at 9, both ending at 49.
 * Scaled by FRAME_K and pinned FRAME_INSET from each edge; the plate's
 * hairlines are derived from the same numbers so they meet the scrolls. */
const FRAME_INSET = 18
const FRAME_K = 1.4
const RULE_OUT = FRAME_INSET + 3 * FRAME_K
const RULE_IN = FRAME_INSET + 9 * FRAME_K
const RULE_END = FRAME_INSET + 49 * FRAME_K
const BAND_X0 = RULE_END + 16 // witch-script bands start clear of the fleuron
/** Width the magic name may span (inside the plate, generous margins). */
const NAME_MAX_W = 920
/** Average advance of Cinzel 700 (caps + small caps), em units. */
const CINZEL_EM = 0.64

// ── Locale config ──
interface LocaleCfg {
  key: string
  seg: string
  font: string
  weightBig: number
  isCjk: boolean
}
/* Display/body families resolve against the FULL Noto Serif CJK OTFs (fontsource
 * CJK packages ship sliced subsets that leave resvg with partial coverage — the
 * cause of sans/pixel fallbacks in earlier renders). Latin display stays Cinzel,
 * latin body Cormorant Garamond; every chain ends in the pan-CJK serif. */
const LOCALES: LocaleCfg[] = [
  { key: 'zh-CN', seg: 'zh-cn', font: 'Noto Serif CJK SC', weightBig: 700, isCjk: true },
  { key: 'en', seg: 'en', font: 'Cinzel', weightBig: 700, isCjk: false },
  { key: 'ja', seg: 'ja', font: 'Noto Serif CJK SC', weightBig: 700, isCjk: true },
  { key: 'zh-TW', seg: 'zh-tw', font: 'Noto Serif CJK TC', weightBig: 700, isCjk: true },
]

// ── Content + i18n (read from disk; no Vite import.meta.glob here) ──
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}
const I18N: Record<string, any> = {}
for (const l of LOCALES) I18N[l.key] = readJson(join(ROOT, `src/i18n/${l.key}.json`))

const CONTENT_DIR = join(ROOT, 'content')
const FIXTURE_DIR = join(ROOT, 'src/fixtures')
const useContent = existsSync(join(CONTENT_DIR, 'cards', 'manifest.json'))
const cardsDir = useContent ? join(CONTENT_DIR, 'cards') : join(FIXTURE_DIR, 'cards')
const manifestPath = useContent
  ? join(CONTENT_DIR, 'cards', 'manifest.json')
  : join(FIXTURE_DIR, 'manifest.json')
const manifest = readJson<{ tags: Record<string, unknown> }>(manifestPath)
const TAGS = Object.keys(manifest.tags)

function loadCard(tag: string, key: string): any | null {
  const p = join(cardsDir, `${tag}.${key}.json`)
  if (existsSync(p)) return readJson(p)
  // fallback to zh-CN card
  const fb = join(cardsDir, `${tag}.zh-CN.json`)
  return existsSync(fb) ? readJson(fb) : null
}

/* The 13 special character records (design spec §3.7) — one OG per character
 * per locale (`c-<id>.png`). Absent unless the compiler shipped them; the
 * feature (and its OG jobs) auto-disable with an empty list. */
const charactersDir = join(CONTENT_DIR, 'characters')
function loadCharacters(key: string): any[] {
  const p = join(charactersDir, `${key}.json`)
  if (existsSync(p)) return readJson(p)
  const fb = join(charactersDir, 'zh-CN.json')
  return existsSync(fb) ? readJson(fb) : []
}

// ── Fonts ──
// Latin from @fontsource (single-file subsets, reliable); CJK from the FULL
// Noto Serif CJK OTFs (fetched once into the cache; also found in the v1
// project's scripts/fonts-full — copied from there when present).
const FONT_SPECS: { pkg: string; files: string[] }[] = [
  { pkg: 'cinzel', files: ['cinzel-latin-600-normal', 'cinzel-latin-700-normal', 'cinzel-latin-ext-700-normal'] },
  { pkg: 'cormorant-garamond', files: ['cormorant-garamond-latin-500-normal', 'cormorant-garamond-latin-600-normal'] },
]
const CJK_FULL: { file: string; url: string }[] = [
  { file: 'NotoSerifCJKsc-Bold.otf', url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf' },
  { file: 'NotoSerifCJKsc-Regular.otf', url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf' },
  { file: 'NotoSerifCJKtc-Bold.otf', url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/TraditionalChinese/NotoSerifCJKtc-Bold.otf' },
  { file: 'NotoSerifCJKtc-Regular.otf', url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/TraditionalChinese/NotoSerifCJKtc-Regular.otf' },
]
const V1_FONTS_DIR = 'D:/Monosaba Personality Test/scripts/fonts-full'

async function ensureCjkFull(): Promise<string[]> {
  const out: string[] = []
  for (const { file, url } of CJK_FULL) {
    const dst = join(CACHE, file)
    if (!existsSync(dst)) {
      const v1 = join(V1_FONTS_DIR, file)
      if (existsSync(v1)) {
        writeFileSync(dst, readFileSync(v1))
        console.log(`[gen:og] copied ${file} from v1 cache`)
      } else {
        console.log(`[gen:og] downloading ${file} …`)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`font download failed: ${file} (${res.status})`)
        writeFileSync(dst, Buffer.from(await res.arrayBuffer()))
      }
    }
    out.push(dst)
  }
  return out
}

async function ensureTtf(pkg: string, file: string): Promise<string | null> {
  const woff2 = join(ROOT, `node_modules/@fontsource/${pkg}/files/${file}.woff2`)
  if (!existsSync(woff2)) {
    console.warn(`[gen:og] missing font ${file}.woff2 — skipping`)
    return null
  }
  const ttf = join(CACHE, `${file}.ttf`)
  if (existsSync(ttf)) return ttf
  const buf: Uint8Array = await wawoff2.decompress(readFileSync(woff2))
  writeFileSync(ttf, Buffer.from(buf))
  return ttf
}

async function loadFontFiles(): Promise<string[]> {
  const out: string[] = []
  for (const spec of FONT_SPECS) {
    for (const f of spec.files) {
      const ttf = await ensureTtf(spec.pkg, f)
      if (ttf) out.push(ttf)
    }
  }
  out.push(...(await ensureCjkFull()))
  return out
}

// ── SVG helpers ──
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── colour math (literal hex in/out; resvg wants no CSS colour functions) ──
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function mix(hex: string, to: string, t: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(to)
  const c = (i: number) =>
    Math.max(0, Math.min(255, Math.round(a[i]! + (b[i]! - a[i]!) * t)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(0)}${c(1)}${c(2)}`
}

// 禁則処理: closing punctuation never starts a line (it hangs on the previous
// line), opening punctuation never ends one, and the last line never dangles
// a single character.
const CLOSE_PUNCT = new Set(Array.from('。，、！？：；）」』》〉…‥・％,.!?;:%)]'))
const OPEN_PUNCT = new Set(Array.from('（「『《〈([“"'))
function kinsoku(lines: string[]): string[] {
  for (let i = 1; i < lines.length; i++) {
    // hang leading closers on the previous line
    let cur = Array.from(lines[i]!)
    while (cur.length && CLOSE_PUNCT.has(cur[0]!)) {
      lines[i - 1] += cur.shift()!
    }
    // push trailing openers down
    const prev = Array.from(lines[i - 1]!)
    while (prev.length && OPEN_PUNCT.has(prev[prev.length - 1]!)) {
      cur.unshift(prev.pop()!)
    }
    lines[i - 1] = prev.join('')
    lines[i] = cur.join('')
  }
  return lines.filter((l) => Array.from(l).length > 0)
}
function fixCjkOrphan(lines: string[]): string[] {
  if (lines.length < 2) return lines
  const last = Array.from(lines[lines.length - 1]!)
  const meaningful = last.filter((c) => !CLOSE_PUNCT.has(c) && !OPEN_PUNCT.has(c))
  if (meaningful.length > 1) return lines
  // borrow one character from the previous line (skipping a trailing opener)
  const prev = Array.from(lines[lines.length - 2]!)
  if (prev.length < 3) return lines
  const moved = prev.pop()!
  lines[lines.length - 2] = prev.join('')
  lines[lines.length - 1] = moved + last.join('')
  return kinsoku(lines)
}
function wrapCjk(text: string, maxChars: number): string[] {
  const chars = Array.from(text)
  const lines: string[] = []
  let line = ''
  for (const ch of chars) {
    if (Array.from(line).length >= maxChars) {
      lines.push(line)
      line = ''
    }
    line += ch
  }
  if (line) lines.push(line)
  return fixCjkOrphan(kinsoku(lines))
}
function wrapLatin(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w
    if (trial.length > maxChars && line) {
      lines.push(line)
      line = w
    } else {
      line = trial
    }
  }
  if (line) lines.push(line)
  // no dangling stub on the last line: borrow the previous word
  if (lines.length >= 2 && lines[lines.length - 1]!.replace(/[.,!?;:]/g, '').length <= 3) {
    const prev = lines[lines.length - 2]!.split(' ')
    if (prev.length > 1) {
      const moved = prev.pop()!
      lines[lines.length - 2] = prev.join(' ')
      lines[lines.length - 1] = `${moved} ${lines[lines.length - 1]}`
    }
  }
  return lines
}
/** Wrap at `preferred` px, shrinking by 4 until the text fits `maxLines`.
 *  `factor` is the average advance in em (CJK 1.0; Latin defaults to a
 *  conservative 0.56 — pass CINZEL_EM for the display face). */
function layout(
  text: string,
  isCjk: boolean,
  maxWidth: number,
  preferred: number,
  min = 30,
  maxLines = 3,
  factor = isCjk ? 1.0 : 0.56,
): { size: number; lines: string[] } {
  let size = preferred
  let lines = isCjk ? wrapCjk(text, Math.max(1, Math.floor(maxWidth / (size * factor)))) : wrapLatin(text, Math.max(1, Math.floor(maxWidth / (size * factor))))
  while (size > min && lines.length > maxLines) {
    size -= 4
    const maxChars = Math.max(1, Math.floor(maxWidth / (size * factor)))
    lines = isCjk ? wrapCjk(text, maxChars) : wrapLatin(text, maxChars)
  }
  return { size, lines }
}

/** Rough advance-width estimate of a tracked run (for placing ornaments). */
function estWidth(text: string, size: number, letterSpacing: number, emFactor: number): number {
  return Array.from(text).length * (size * emFactor + letterSpacing)
}

/** The Verdict Seal as an SVG group at (cx,cy) with outer radius r. */
function sealMarkup(cx: number, cy: number, r: number, color: string): string {
  const s = (2 * r) / 100
  const tx = cx - r
  const ty = cy - r
  const ticks = Array.from({ length: 48 }, (_, i) => (i * 360) / 48)
    .map((a) => `<line x1="50" y1="4.5" x2="50" y2="7.4" transform="rotate(${a} 50 50)"/>`)
    .join('')
  const orbits = [0, 60, 120]
    .map((a) => `<ellipse cx="50" cy="50" rx="30" ry="12" transform="rotate(${a} 50 50)"/>`)
    .join('')
  const petal = (R: number, hw: number, waist: number) =>
    `M50 50 Q${50 + hw} ${50 - R * waist}, 50 ${50 - R} Q${50 - hw} ${50 - R * waist}, 50 50 Z`
  const outer = Array.from({ length: 12 }, (_, i) => (i * 360) / 12)
    .map((a) => `<path d="${petal(20, 4.4, 0.42)}" transform="rotate(${a} 50 50)"/>`)
    .join('')
  const inner = Array.from({ length: 6 }, (_, i) => (i * 360) / 6 + 30)
    .map((a) => `<path d="${petal(10.5, 3.1, 0.4)}" transform="rotate(${a} 50 50)"/>`)
    .join('')
  return `<g transform="translate(${tx} ${ty}) scale(${s})" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round">
    <circle cx="50" cy="50" r="47.5" stroke-width="1.3"/>
    <circle cx="50" cy="50" r="43" stroke-width="0.7" opacity="0.85"/>
    <circle cx="50" cy="50" r="34" stroke-width="0.5" opacity="0.5"/>
    <g stroke-width="0.5" opacity="0.6">${ticks}</g>
    <g stroke-width="0.75" opacity="0.68">${orbits}</g>
    <g stroke-width="0.85" opacity="0.92">${outer}</g>
    <g stroke-width="0.7" opacity="0.8">${inner}</g>
    <circle cx="50" cy="50" r="2.6" fill="${color}" stroke="none"/>
    <circle cx="50" cy="50" r="5.2" stroke-width="0.6" opacity="0.7"/>
  </g>`
}

// ── Plate ornament ──

/** Soft radial glow (resvg has no filters — gradients only). */
function radialDef(id: string, color: string, alpha: number, mid = 0.45): string {
  return `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${color}" stop-opacity="${alpha}"/>
      <stop offset="${Math.round(mid * 100)}%" stop-color="${color}" stop-opacity="${(alpha * 0.36).toFixed(3)}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>`
}
/** Vertical light→colour→dark gradient for the big name (depth without filters). */
function nameGradDef(id: string, color: string): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${mix(color, '#ffffff', 0.16)}"/>
      <stop offset="52%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${mix(color, '#000000', 0.3)}"/>
    </linearGradient>`
}

function defs(extra = ''): string {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.ink2}"/>
      <stop offset="46%" stop-color="${C.ink}"/>
      <stop offset="100%" stop-color="#08060a"/>
    </linearGradient>
    <radialGradient id="glowO" cx="50%" cy="112%" r="60%">
      <stop offset="0%" stop-color="${C.oxblood}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${C.oxblood}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%">
      <stop offset="0%" stop-color="${C.ink}" stop-opacity="0"/>
      <stop offset="42%" stop-color="${C.ink}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${C.ink}" stop-opacity="0.85"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.gold}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${C.gold}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${C.gold}" stop-opacity="0"/>
    </linearGradient>
    ${extra}
  </defs>`
}
/** Velvet ground + oxblood foot glow + vignette (drawn under every glow). */
function ground(): string {
  return `<rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glowO)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>`
}

/** Double hairline plate with the CardFrame fleuron scrolls in all four corners. */
function frameMarkup(color: string): string {
  const e = RULE_END
  const rules = `<g fill="none" stroke="${color}">
    <path d="M${e} ${RULE_OUT}H${W - e}M${e} ${H - RULE_OUT}H${W - e}M${RULE_OUT} ${e}V${H - e}M${W - RULE_OUT} ${e}V${H - e}" stroke-width="1.5" stroke-opacity="0.66"/>
    <path d="M${e} ${RULE_IN}H${W - e}M${e} ${H - RULE_IN}H${W - e}M${RULE_IN} ${e}V${H - e}M${W - RULE_IN} ${e}V${H - e}" stroke-width="0.8" stroke-opacity="0.34"/>
  </g>`
  // path data verbatim from src/components/CardFrame.astro (52-unit box)
  const art = `<path d="M3 49 L3 15 Q3 3 15 3 L49 3" stroke-width="1.1" opacity="0.9"/>
    <path d="M9 49 L9 17 Q9 9 17 9 L49 9" stroke-width="0.6" opacity="0.45"/>
    <path d="M15 33 C15 23, 23 15, 33 15" stroke-width="0.8" opacity="0.8"/>
    <path d="M15 33 C19 27, 21 25, 20 20 M15 33 C21 29, 23 31, 28 30" stroke-width="0.7" opacity="0.7"/>
    <circle cx="16" cy="16" r="1.7" fill="${color}" stroke="none" opacity="0.85"/>`
  const F = FRAME_INSET
  const k = FRAME_K
  const corners = [
    `translate(${F} ${F}) scale(${k})`,
    `translate(${W - F} ${F}) scale(${-k} ${k})`,
    `translate(${F} ${H - F}) scale(${k} ${-k})`,
    `translate(${W - F} ${H - F}) scale(${-k} ${-k})`,
  ]
  return rules + corners.map((t) => `<g transform="${t}" fill="none" stroke="${color}" opacity="0.75">${art}</g>`).join('')
}

/* Witch-script glyphs — mirrors RUNES in src/lib/rose-window.ts (not exported
 * from there; keep in sync). Sequence derived from the seed text's code points
 * the same way the window's band is, so each plate "spells" its own magic. */
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
function runeBand(y: number, x0: number, x1: number, seed: string, offset: number, color: string, opacity: number): string {
  const STEP = 26
  const S = 1.7
  const n = Math.floor((x1 - x0) / STEP)
  if (n < 1) return ''
  const codes = Array.from(seed).map((ch) => ch.codePointAt(0) ?? 0)
  const start = x0 + (x1 - x0 - (n - 1) * STEP) / 2
  const glyphs: string[] = []
  for (let i = 0; i < n; i++) {
    const j = i + offset
    const c = codes.length ? codes[j % codes.length]! : 0
    const idx = (c + j * 7) % RUNES.length
    // tangential + alternating flip → reads as script, never as upright letters
    const flip = j % 2 === 0 ? 90 : -90
    glyphs.push(`<path d="${RUNES[idx]}" transform="translate(${(start + i * STEP).toFixed(1)} ${y}) scale(${S}) rotate(${flip})"/>`)
  }
  return `<g fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${glyphs.join('')}</g>`
}
/** A band across the plate at y, parted around a centred plaque of half-width gapHalf (0 = unbroken). */
function runeBands(y: number, gapHalf: number, seed: string, color: string, opacity: number): string {
  const x0 = BAND_X0
  const x1 = W - BAND_X0
  if (gapHalf <= 0) return runeBand(y, x0, x1, seed, 0, color, opacity)
  return runeBand(y, x0, 600 - gapHalf, seed, 0, color, opacity) + runeBand(y, 600 + gapHalf, x1, seed, 11, color, opacity)
}

/** Hairline flourishes flanking the 魔法 mark: a double wave, a lozenge, a terminal dot. */
function markFlourishes(y: number, half: number, color: string): string {
  const art = `<path d="M0 0C12 -6 24 6 36 0S60 6 72 0" stroke-width="0.9" opacity="0.72"/>
    <rect x="-3.4" y="-3.4" width="6.8" height="6.8" transform="translate(84 0) rotate(45)" fill="${color}" stroke="none" opacity="0.9"/>
    <circle cx="97" cy="0" r="1.4" fill="${color}" stroke="none" opacity="0.55"/>`
  return `<g transform="translate(${600 + half} ${y})" fill="none" stroke="${color}" stroke-linecap="round">${art}</g>
    <g transform="translate(${600 - half} ${y}) scale(-1 1)" fill="none" stroke="${color}" stroke-linecap="round">${art}</g>`
}

function fam(cfg: LocaleCfg): string {
  return `'${cfg.font}', 'Noto Serif CJK SC'`
}
/** Body/prose family (the magic's effect text). */
function bodyFam(cfg: LocaleCfg): string {
  return cfg.isCjk ? fam(cfg) : `'Cormorant Garamond', 'Noto Serif CJK SC'`
}

const BRAND_Y1 = 572
const BRAND_Y2 = 593
/** Brand block at the plate's foot; `half` is the plaque half-width the bottom band parts around. */
function brandBlock(cfg: LocaleCfg, s: any): { markup: string; half: number; mid: number } {
  const site = String(s.meta.siteName)
  const domain = SITE.replace(/^https?:\/\//, '')
  const w1 = estWidth(site, 19, 6, cfg.isCjk ? 1 : 0.72)
  const w2 = estWidth(domain, 12.5, 3, 0.55)
  const markup = `<text x="600" y="${BRAND_Y1}" text-anchor="middle" fill="${C.goldDeep}" font-family="${fam(cfg)}" font-size="19" letter-spacing="6">${escapeXml(site)}</text>
    <text x="600" y="${BRAND_Y2}" text-anchor="middle" fill="${C.boneDim}" fill-opacity="0.55" font-family="${fam(cfg)}" font-size="12.5" letter-spacing="3">${escapeXml(domain)}</text>`
  return { markup, half: Math.max(w1, w2) / 2 + 28, mid: 578 }
}

/** tspans for a centered block; returns markup and the block's bottom y. */
function textBlock(lines: string[], startBaseline: number, size: number, lineHeight: number): { tspans: string; bottom: number } {
  return textBlockAt(600, lines, startBaseline, size, lineHeight)
}
/** Like textBlock, centered on an arbitrary x (tracked runs shift their optical
 *  centre by half a letter-space — callers compensate through cx). */
function textBlockAt(cx: number, lines: string[], startBaseline: number, size: number, lineHeight: number): { tspans: string; bottom: number } {
  const lh = size * lineHeight
  const tspans = lines
    .map((l, i) => `<tspan x="${cx}" y="${startBaseline + i * lh}">${escapeXml(l)}</tspan>`)
    .join('')
  return { tspans, bottom: startBaseline + (lines.length - 1) * lh }
}

/** Wrap to at most maxLines; append an ellipsis when truncated. */
function clampLines(text: string, isCjk: boolean, maxWidth: number, size: number, maxLines: number): string[] {
  const factor = isCjk ? 1.0 : 0.5
  const maxChars = Math.max(1, Math.floor(maxWidth / (size * factor)))
  const lines = isCjk ? wrapCjk(text, maxChars) : wrapLatin(text, maxChars)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = isCjk ? Array.from(kept[maxLines - 1]!).slice(0, -1).join('') : kept[maxLines - 1]!.replace(/\s+\S+$/, '')
  // never leave punctuation dangling before the ellipsis
  last = last.replace(/[。，、！？：；・,.!?;:\s（「『《〈([“"]+$/u, '')
  kept[maxLines - 1] = last + '…'
  return kept
}

// ── The big name (magic name / title): sizing, budget fit, markup ──
interface NameFit {
  size: number
  lines: string[]
  /** letter-spacing in px */
  ls: number
  /** block height from glyph top of line 1 to glyph bottom of the last line */
  height: number
}
/** Display-face vertical metrics in em: glyph top above baseline, line pitch, descent. */
function nameMetrics(cfg: LocaleCfg): { asc: number; lh: number; desc: number } {
  return cfg.isCjk ? { asc: 0.86, lh: 1.1, desc: 0.1 } : { asc: 0.72, lh: 1.08, desc: 0.04 }
}
function nameHeight(cfg: LocaleCfg, size: number, lineCount: number): number {
  const m = nameMetrics(cfg)
  return size * (m.asc + m.desc + m.lh * (lineCount - 1))
}
function nameSpacing(cfg: LocaleCfg, chars: number, size: number): number {
  if (!cfg.isCjk) return size * 0.03
  return size * (chars <= 2 ? 0.18 : chars === 3 ? 0.1 : 0.05)
}
/** Size the name so 2–4 CJK characters span ~35–55% of the plate (Latin: one
 *  line when it fits at ≥84px, else two lines), then shrink until the block
 *  fits `budget` px of height. Shared by the renderers and the audit. */
function fitName(cfg: LocaleCfg, text: string, budget: number, cap = 212): NameFit {
  const n = Array.from(text).length
  let preferred: number
  let min: number
  if (cfg.isCjk) {
    preferred = Math.min(cap, Math.floor(640 / Math.max(1, n)))
    min = 72
  } else {
    const single = Math.floor(NAME_MAX_W / (CINZEL_EM * Math.max(1, n)))
    preferred = single >= 84 ? Math.min(Math.min(cap, 150), single) : 104
    min = 60
  }
  const factor = cfg.isCjk ? 1 : CINZEL_EM
  let size = Math.max(preferred, min)
  for (;;) {
    const r = layout(text, cfg.isCjk, NAME_MAX_W, size, min, 2, factor)
    size = r.size
    const height = nameHeight(cfg, size, r.lines.length)
    if (height <= budget || size <= min) {
      return { size, lines: r.lines, ls: nameSpacing(cfg, n, size), height }
    }
    size = Math.max(min, size - 4)
  }
}
/** The name as gradient-filled display type over a darker offset echo. */
function bigName(cfg: LocaleCfg, fit: NameFit, top: number, fill: string, echo: string): string {
  const m = nameMetrics(cfg)
  const cx = 600 + fit.ls / 2
  const tb = textBlockAt(cx, fit.lines, top + m.asc * fit.size, fit.size, m.lh)
  const common = `text-anchor="middle" font-family="${fam(cfg)}" font-weight="${cfg.weightBig}" font-size="${fit.size}" letter-spacing="${fit.ls.toFixed(1)}"`
  return `<text ${common} fill="${echo}" fill-opacity="0.72" transform="translate(4 7)">${tb.tspans}</text>
    <text ${common} fill="${fill}">${tb.tspans}</text>`
}
/** Estimated rendered width of the widest name line (for the glow ellipse). */
function nameWidth(cfg: LocaleCfg, fit: NameFit): number {
  const em = cfg.isCjk ? 1 : CINZEL_EM
  return Math.max(...fit.lines.map((l) => estWidth(l, fit.size, fit.ls, em)))
}

// ── Root OG ──
const RT = { sealCy: 172, sealR: 66, haloR: 215, titleTop: 274 }
function rootLayout(cfg: LocaleCfg): { title: NameFit; tagline: { size: number; lines: string[] } } {
  const s = I18N[cfg.key]
  const text = String(s.landing.title)
  const factor = cfg.isCjk ? 1 : CINZEL_EM
  const r = layout(text, cfg.isCjk, 1000, cfg.isCjk ? 112 : 92, 56, 2, factor)
  const title: NameFit = {
    size: r.size,
    lines: r.lines,
    ls: cfg.isCjk ? r.size * 0.08 : r.size * 0.04,
    height: nameHeight(cfg, r.size, r.lines.length),
  }
  const tagline = layout(String(s.meta.tagline), cfg.isCjk, 1000, 34, 24, 2)
  return { title, tagline }
}
function buildRootSvg(cfg: LocaleCfg): string {
  const s = I18N[cfg.key]
  const { title, tagline } = rootLayout(cfg)
  const brand = brandBlock(cfg, s)
  const seed = title.lines.join('')
  const titleBottom = RT.titleTop + title.height
  const ruleY = titleBottom + 30
  const tagY = ruleY + 30 + tagline.size
  const tag = textBlock(tagline.lines, tagY, tagline.size, 1.4)
  // the faint red rose window — the summons' own crest, haloing the Seal
  const hs = (RT.haloR * 2) / 200
  const halo = `<g opacity="0.16" transform="translate(${600 - RT.haloR} ${RT.sealCy - RT.haloR}) scale(${hs})">${roseWindowGroup({ color: C.red, motif: 'leaf', magicName: seed })}</g>`
  const titleGrad = `<linearGradient id="titleGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4ecdb"/>
      <stop offset="60%" stop-color="${C.bone}"/>
      <stop offset="100%" stop-color="${C.boneDim}"/>
    </linearGradient>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(radialDef('haloGlow', C.redDeep, 0.5, 0.4) + radialDef('sealGlow', C.goldBright, 0.2, 0.4) + titleGrad)}
  ${ground()}
  <circle cx="600" cy="${RT.sealCy}" r="${RT.haloR + 40}" fill="url(#haloGlow)"/>
  ${halo}
  <circle cx="600" cy="${RT.sealCy}" r="150" fill="url(#sealGlow)"/>
  ${frameMarkup(C.gold)}
  ${runeBands(55, 0, seed, C.gold, 0.3)}
  ${runeBands(brand.mid, brand.half, seed, C.gold, 0.3)}
  ${sealMarkup(600, RT.sealCy, RT.sealR, C.gold)}
  ${bigName(cfg, title, RT.titleTop, 'url(#titleGrad)', '#1a0c10')}
  <rect x="510" y="${ruleY}" width="180" height="1.6" fill="url(#rule)"/>
  <text text-anchor="middle" fill="${C.red}" font-family="${bodyFam(cfg)}" font-size="${tagline.size}" letter-spacing="2">${tag.tspans}</text>
  ${brand.markup}
</svg>`
}

// ── Card OG ──
const CD = { eyebrowY: 62, sealCy: 146, sealR: 64, markY: 246, nameTop: 272, descGap: 34, descLimit: 538 }
/** Share of leftover vertical room moved above a short name+text group, so a
 *  small (long) name does not leave the lower half of the plate empty. */
const SLACK_SHARE = 0.42
interface CardLayout {
  name: NameFit
  desc: { size: number; lines: string[] }
  /** y of the name's glyph top after slack distribution */
  nameTop: number
}
function cardLayout(cfg: LocaleCfg, headline: string, desc: string): CardLayout {
  const dsz = cfg.isCjk ? 32 : 34
  const lines = desc ? clampLines(desc, cfg.isCjk, 1000, dsz, 2) : []
  const descH = lines.length ? dsz * (1 + 1.45 * (lines.length - 1)) : 0
  const descBlock = lines.length ? CD.descGap + descH : 0
  const budget = CD.descLimit - CD.nameTop - descBlock
  const name = fitName(cfg, headline, budget)
  const slack = Math.max(0, budget - name.height)
  return { name, desc: { size: dsz, lines }, nameTop: CD.nameTop + slack * SLACK_SHARE }
}
function buildCardSvg(cfg: LocaleCfg, card: any): string {
  const s = I18N[cfg.key]
  const fields = card.variants?.[0]?.fields ?? card
  // The magic pair IS the shareable unit: its NAME as the headline, its effect
  // text immediately under (mirrors the card layout). Name is structural —
  // the compiler guarantees it; fail loudly otherwise.
  const headline = String(fields.magic?.name ?? '').trim()
  if (!headline) throw new Error(`OG FAIL: card ${card.tag} has no magic name`)
  const desc = String(fields.magic?.text ?? '').trim()
  const kicker = String(s.card?.sentenceMark ?? s.meta.siteName)
  const markText = String(s.card?.magicMark ?? '魔法')

  const L = cardLayout(cfg, headline, desc)
  const nameBottom = L.nameTop + L.name.height
  const d = textBlock(L.desc.lines, nameBottom + CD.descGap + 0.74 * L.desc.size, L.desc.size, 1.45)
  const brand = brandBlock(cfg, s)

  const eyebrowHalf = estWidth(kicker, 20, cfg.isCjk ? 9 : 8, cfg.isCjk ? 1 : 0.72) / 2 + 30
  const markHalf = estWidth(markText, 24, 12, cfg.isCjk ? 1 : 0.72) / 2 + 14
  const nameMid = L.nameTop + L.name.height / 2
  const glowRx = Math.min(560, nameWidth(cfg, L.name) / 2 + 150)
  const glowRy = L.name.height / 2 + 80

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(radialDef('sealGlow', C.goldBright, 0.22, 0.4) + radialDef('nameGlow', C.red, 0.32, 0.45) + nameGradDef('nameGrad', C.red))}
  ${ground()}
  <circle cx="600" cy="${CD.sealCy}" r="180" fill="url(#sealGlow)"/>
  <ellipse cx="600" cy="${nameMid}" rx="${glowRx}" ry="${glowRy}" fill="url(#nameGlow)"/>
  ${frameMarkup(C.gold)}
  ${runeBands(CD.eyebrowY - 7, eyebrowHalf, headline, C.gold, 0.3)}
  ${runeBands(brand.mid, brand.half, headline, C.gold, 0.3)}
  <text x="600" y="${CD.eyebrowY}" text-anchor="middle" fill="${C.goldDeep}" font-family="${fam(cfg)}" font-size="20" letter-spacing="${cfg.isCjk ? 9 : 8}">${escapeXml(kicker)}</text>
  ${sealMarkup(600, CD.sealCy, CD.sealR, C.gold)}
  <text x="600" y="${CD.markY}" text-anchor="middle" fill="${C.gold}" font-family="${fam(cfg)}" font-size="24" letter-spacing="12">${escapeXml(markText)}</text>
  ${markFlourishes(CD.markY - 7, markHalf, C.gold)}
  ${bigName(cfg, L.name, L.nameTop, 'url(#nameGrad)', mix(C.red, '#000000', 0.62))}
  <text text-anchor="middle" fill="${C.bone}" fill-opacity="0.94" font-family="${bodyFam(cfg)}" font-size="${L.desc.size}">${d.tspans}</text>
  ${brand.markup}
</svg>`
}

// ── Character OG ──
/* Special character record OG (design spec §3.7) — the one theme-colored
 * surface. The MAGIC NAME is the headline in the character color (the visitor
 * detected the same magic), crowned by her rose window as the plate's crest.
 * The character's name is withheld: the unfurl reveals the magic, never who
 * it belongs to. */
/* Character plate: window → 魔法 mark → magic name → the CHARACTER'S NAME in her
 * colour (owner decision 2026-09-02: the /c/ page's og:title and description
 * already name her, so the plate says it too) → brand. `charLine` is the
 * vertical room reserved under the magic name for that line. */
const CH = { winCy: 164, winR: 120, markY: 322, nameTop: 348, nameLimit: 526, charLine: 58 }
function characterLayout(
  cfg: LocaleCfg,
  magic: string,
): { fit: NameFit; nameTop: number; charY: number } {
  const budget = CH.nameLimit - CH.charLine - CH.nameTop
  const fit = fitName(cfg, magic, budget, 200)
  const nameTop = CH.nameTop + Math.max(0, budget - fit.height) * SLACK_SHARE
  // baseline of the character line: just under the magic name's glyph bottom
  const charY = nameTop + fit.height + 44
  return { fit, nameTop, charY }
}
function buildCharacterSvg(cfg: LocaleCfg, ch: any): string {
  const s = I18N[cfg.key]
  const color = String(ch.color)
  const magic = String(ch.magicName ?? '').trim()
  if (!magic) throw new Error(`OG FAIL: character ${ch.id} missing magicName`)
  const markText = String(s.card?.magicMark ?? '魔法')

  const { fit, nameTop, charY } = characterLayout(cfg, magic)
  const brand = brandBlock(cfg, s)
  // her name, in her colour, quieter than the magic: 『』 in CJK, plain in Latin,
  // a short hairline either side
  const charName = String(ch.name ?? '').trim()
  const charLabel = cfg.isCjk ? `『${charName}』` : charName
  const charSize = cfg.isCjk ? 30 : 27
  const charLs = cfg.isCjk ? 5 : 4
  const charHalf = estWidth(charLabel, charSize, charLs, cfg.isCjk ? 1 : 0.62) / 2 + 22
  const charLine = charName
    ? `<line x1="${600 - charHalf - 70}" y1="${charY - 10}" x2="${600 - charHalf}" y2="${charY - 10}" stroke="${color}" stroke-width="0.9" opacity="0.5"/>
    <line x1="${600 + charHalf}" y1="${charY - 10}" x2="${600 + charHalf + 70}" y2="${charY - 10}" stroke="${color}" stroke-width="0.9" opacity="0.5"/>
    <text x="${600 + charLs / 2}" y="${charY}" text-anchor="middle" fill="${color}" fill-opacity="0.92" font-family="${fam(cfg)}" font-weight="${cfg.weightBig}" font-size="${charSize}" letter-spacing="${charLs}">${escapeXml(charLabel)}</text>`
    : ''
  const ws = (CH.winR * 2) / 200
  const window = `<g transform="translate(${600 - CH.winR} ${CH.winCy - CH.winR}) scale(${ws})">${roseWindowGroup({
    color,
    motif: CHARACTER_MOTIFS[ch.id] ?? 'leaf',
    magicName: magic,
  })}</g>`
  const markHalf = estWidth(markText, 24, 12, cfg.isCjk ? 1 : 0.72) / 2 + 14
  const nameMid = nameTop + fit.height / 2
  const glowRx = Math.min(560, nameWidth(cfg, fit) / 2 + 150)
  const glowRy = fit.height / 2 + 80

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(radialDef('winGlow', color, 0.34, 0.42) + radialDef('nameGlow', color, 0.22, 0.45) + nameGradDef('nameGrad', color))}
  ${ground()}
  <circle cx="600" cy="${CH.winCy}" r="250" fill="url(#winGlow)"/>
  <ellipse cx="600" cy="${nameMid}" rx="${glowRx}" ry="${glowRy}" fill="url(#nameGlow)"/>
  ${frameMarkup(C.gold)}
  ${runeBands(55, 0, magic, color, 0.32)}
  ${runeBands(brand.mid, brand.half, magic, color, 0.32)}
  ${window}
  <text x="600" y="${CH.markY}" text-anchor="middle" fill="${C.gold}" font-family="${fam(cfg)}" font-size="24" letter-spacing="12">${escapeXml(markText)}</text>
  ${markFlourishes(CH.markY - 7, markHalf, C.gold)}
  ${bigName(cfg, fit, nameTop, 'url(#nameGrad)', mix(color, '#000000', 0.62))}
  ${charLine}
  ${brand.markup}
</svg>`
}

// ── Dangling-character audit (OG_AUDIT=1): re-runs the exact wrap paths for
// every rendered string and reports kinsoku/orphan/overflow violations. ──
function auditLines(where: string, lines: string[], isCjk: boolean, maxWidth: number, size: number, factor: number): string[] {
  const bad: string[] = []
  lines.forEach((l, i) => {
    const chars = Array.from(l)
    if (chars.length === 0) bad.push(`${where}: empty line ${i}`)
    if (chars.length && CLOSE_PUNCT.has(chars[0]!) ) bad.push(`${where}: line ${i} starts with '${chars[0]}'`)
    if (chars.length && OPEN_PUNCT.has(chars[chars.length - 1]!)) bad.push(`${where}: line ${i} ends with '${chars[chars.length - 1]}'`)
    // hanging punctuation may exceed by ~1 char; anything more is real overflow
    if (chars.length * size * factor > maxWidth + size * 1.2) bad.push(`${where}: line ${i} overflows (${chars.length} chars @${size})`)
  })
  const last = Array.from(lines[lines.length - 1] ?? '')
  const meaningful = last.filter((c) => !CLOSE_PUNCT.has(c) && !OPEN_PUNCT.has(c) && c !== '…')
  if (lines.length > 1 && isCjk && meaningful.length <= 1) bad.push(`${where}: dangling last line '${lines[lines.length - 1]}'`)
  return bad
}

function runAudit(): number {
  const problems: string[] = []
  for (const cfg of LOCALES) {
    const nameFactor = cfg.isCjk ? 1 : CINZEL_EM
    const rl = rootLayout(cfg)
    problems.push(...auditLines(`${cfg.key} root title`, rl.title.lines, cfg.isCjk, 1000, rl.title.size, nameFactor))
    problems.push(...auditLines(`${cfg.key} root tagline`, rl.tagline.lines, cfg.isCjk, 1000, rl.tagline.size, cfg.isCjk ? 1 : 0.5))
    for (const t of TAGS) {
      const card = loadCard(t, cfg.key)
      if (!card) continue
      const fields = card.variants?.[0]?.fields ?? card
      const L = cardLayout(cfg, String(fields.magic.name), String(fields.magic.text ?? ''))
      problems.push(...auditLines(`${cfg.key} ${t} name`, L.name.lines, cfg.isCjk, NAME_MAX_W, L.name.size, nameFactor))
      problems.push(...auditLines(`${cfg.key} ${t} desc`, L.desc.lines, cfg.isCjk, 1000, L.desc.size, cfg.isCjk ? 1 : 0.5))
    }
    for (const ch of loadCharacters(cfg.key)) {
      const { fit } = characterLayout(cfg, String(ch.magicName))
      problems.push(...auditLines(`${cfg.key} c-${ch.id} magic`, fit.lines, cfg.isCjk, NAME_MAX_W, fit.size, nameFactor))
    }
  }
  if (problems.length) {
    console.error(`[og-audit] ${problems.length} violation(s):`)
    for (const p of problems) console.error('  ' + p)
  } else {
    console.log('[og-audit] clean — no dangling characters, kinsoku violations, or overflows')
  }
  return problems.length
}

interface Job {
  svg: string
  outPath: string
}

function collectJobs(): Job[] {
  const jobs: Job[] = []
  for (const cfg of LOCALES) {
    jobs.push({ svg: buildRootSvg(cfg), outPath: join(ROOT, `public/og/${cfg.seg}/root.png`) })
    for (const tag of TAGS) {
      const card = loadCard(tag, cfg.key)
      if (!card) continue
      jobs.push({ svg: buildCardSvg(cfg, card), outPath: join(ROOT, `public/og/${cfg.seg}/${tag}.png`) })
    }
    for (const ch of loadCharacters(cfg.key)) {
      jobs.push({
        svg: buildCharacterSvg(cfg, ch),
        outPath: join(ROOT, `public/og/${cfg.seg}/c-${ch.id}.png`),
      })
    }
  }
  return jobs
}

// ── Incremental skip ──
const HASH_FILE = join(CACHE, 'og-hashes.json')
function loadHashes(): Record<string, string> {
  return existsSync(HASH_FILE) ? readJson<Record<string, string>>(HASH_FILE) : {}
}
function hashOf(svg: string): string {
  return createHash('sha1').update(DESIGN_VERSION).update('\0').update(svg).digest('hex')
}

// ── Worker pool render ──
async function render(jobs: Job[], fontFiles: string[]): Promise<void> {
  const n = Math.max(1, Math.min(os.cpus().length, jobs.length))
  const workerUrl = new URL('./og-worker.mjs', import.meta.url)
  const workers = Array.from(
    { length: n },
    () => new Worker(workerUrl, { workerData: { fontFiles, defaultFamily: 'Noto Serif CJK SC' } }),
  )
  let next = 0
  let done = 0
  await new Promise<void>((resolvePool, rejectPool) => {
    if (jobs.length === 0) return resolvePool()
    const feed = (w: Worker) => {
      if (next < jobs.length) w.postMessage(jobs[next++])
    }
    for (const w of workers) {
      w.on('message', (msg: { ok: boolean; outPath: string; error?: string }) => {
        done++
        if (!msg.ok) console.error(`[gen:og] FAILED ${basename(msg.outPath)}: ${msg.error}`)
        else console.log(`[gen:og] wrote ${msg.outPath.replace(ROOT, '.')}`)
        if (next < jobs.length) feed(w)
        if (done === jobs.length) resolvePool()
      })
      w.on('error', rejectPool)
      feed(w)
    }
  })
  await Promise.all(workers.map((w) => w.terminate()))
}

// ── robots.txt with the deploy origin ──
function writeRobots(): void {
  const txt = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap-index.xml\n`
  writeFileSync(join(ROOT, 'public/robots.txt'), txt, 'utf-8')
  console.log('[gen:og] wrote public/robots.txt')
}

async function main() {
  if (process.env.OG_AUDIT === '1') {
    process.exit(runAudit() ? 1 : 0)
  }
  const fontFiles = await loadFontFiles()
  console.log(`[gen:og] fonts ready (${fontFiles.length} ttf), content=${useContent ? 'content/' : 'fixtures'}, tags=${TAGS.length}`)

  let allJobs = collectJobs()
  // OG_ONLY=zh-cn/root,en/ABN-1_CL-1 … renders a subset (design iteration).
  const only = (process.env.OG_ONLY ?? '')
    .split(',')
    .map((x) => x.trim().replace(/\\/g, '/'))
    .filter(Boolean)
  if (only.length) {
    allJobs = allJobs.filter((j) => only.some((o) => j.outPath.replace(/\\/g, '/').endsWith(`/og/${o}.png`)))
  }
  const hashes = loadHashes()
  const pending: Job[] = []
  let skipped = 0
  for (const job of allJobs) {
    const h = hashOf(job.svg)
    if (hashes[job.outPath] === h && existsSync(job.outPath)) {
      skipped++
      continue
    }
    hashes[job.outPath] = h
    pending.push(job)
  }
  console.log(`[gen:og] ${allJobs.length} images — ${pending.length} to render, ${skipped} unchanged`)

  await render(pending, fontFiles)
  writeFileSync(HASH_FILE, JSON.stringify(hashes, null, 0), 'utf-8')
  writeRobots()
  console.log('[gen:og] done')
}

await main()
