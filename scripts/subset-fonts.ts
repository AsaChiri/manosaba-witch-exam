/*
 * Build-time CJK font subsetter (design spec §2.2 type roles, §4 delivery).
 *
 * The @fontsource CJK packages ship ~100 codepoint-order unicode-range slices
 * per weight; a zh-CN card page pulled 47 woff2 files (1.27 MB) and the 489
 * @font-face rules bloated every zh page's CSS bundle to 517 KB. This script
 * replaces them with OUR OWN subset chunks cut over the corpus + UI strings:
 *
 *   charset per locale = every string in content/cards/*.<loc>.json (all
 *   variants, all fields) + content/characters/<loc>.json + the quiz strings
 *   (+ strings.en.json, the fallback for missing ids) + src/i18n/<loc>.json +
 *   literal CJK in src/**\/*.{astro,vue,ts} + a fixed safety set (ASCII, the
 *   CJK punctuation block, fullwidth forms, general punctuation).
 *
 * Chunking is co-occurrence tiered, NOT codepoint-ordered, so a page only
 * downloads chunks it actually uses (per face):
 *   c0   core: ASCII + punctuation/symbols + page chrome (landing, footer,
 *        card-page labels, share CTA, safety note, locale names)  (every page)
 *   cB   the other locales' suggest-banner lines (hidden until revealed)
 *   c1   head: chars used by ≥ HEAD_DF card/character records   (every card)
 *   cU   remaining UI strings (exam / verdict / result screens)
 *   cF-* tail owned by one card family (ED, ABN, VC, …)         (own family)
 *   cS   shared tail (rare chars spread across families)
 *   cQ   remaining quiz strings (exam only)
 *   cM   literals from src/**\/*.ts (the dev mock engine's bank) — dev only
 *   cP   unused remainder of the safety blocks (never fetched today)
 *   <chunk>x  the part of a chunk the primary source lacks, cut from the
 *             fallback font (zh-TW's fullwidth punctuation lives in c0x)
 * The 700 face is partitioned separately over the BOLD-CAPABLE text only
 * (titles, names, labels, CTAs, question stems): bold prose never happens,
 * so the bold chunks stay a fraction of the regular ones. A bold element
 * containing a char outside that set renders from the 400 face (browser
 * synthesis) instead of pulling a 100 KB chunk for one glyph.
 *
 * Sources: the fontsource TrueType builds (node_modules — offline, the same
 * Google Fonts build the old CSS used; woff2 packs `glyf` ~2.4× tighter than
 * the CFF OTFs from notofonts). Glyphs missing from those single-file subsets
 * come from the full fonts, fetched lazily into scripts/.fonts-cache.
 *
 * Output: public/fonts/<seg>/<slug>-<weight>-<chunk>.<hash8>.woff2 (content-
 * hashed → public/_headers serves /fonts/* immutable) and the three
 * src/styles/fonts-*.css files (GENERATED — see the header they carry).
 * Chunk-level incremental: unchanged chunks are reused from the manifest in
 * scripts/.fonts-cache, so a no-change run only re-derives the charsets.
 *
 * Run: `npm run gen:fonts` (wired into `npm run dev` and `npm run build`).
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
// @ts-expect-error - subset-font ships no types
import subsetFont from 'subset-font'
// @ts-expect-error - wawoff2 ships no types
import wawoff2 from 'wawoff2'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CACHE = join(ROOT, 'scripts/.fonts-cache')
const OUT_DIR = join(ROOT, 'public/fonts')
const MANIFEST_FILE = join(CACHE, 'fonts-manifest.json')
mkdirSync(CACHE, { recursive: true })

/* Bump when the partition algorithm / CSS shape changes in a way that must
 * invalidate every cached chunk. */
const DESIGN_VERSION = 'fonts-v1'

// ── Partition tunables (measured on the 138-card zh-CN corpus, see report) ──
/** A char used by at least this many card/character records is "head" — every
 *  card page pulls it anyway, so it lives in one chunk. */
const HEAD_DF = 11
/** Share of a rare char's records that one family must hold to own it. Lower
 *  values leak: cards start pulling other families' tails. */
const FAMILY_DOMINANCE = 0.67
/** Family tails smaller than this (chars) merge into the shared tail — a 1 KB
 *  file per handful of glyphs is a request, not a saving. */
const MIN_FAMILY_CHUNK = 12

// ── Locale / face config ──
type Weight = 400 | 700
type SourceSpec =
  | { kind: 'fontsource'; pkg: string; subset: string }
  | { kind: 'file'; file: string; url: string; v1?: string }

interface FaceCfg {
  family: string // exactly as tokens.css names it
  slug: string
  primary: Record<Weight, SourceSpec>
  /** Full font, only touched when the primary lacks required glyphs. */
  fallback: Record<Weight, SourceSpec>
}
interface LocaleCfg {
  key: string
  seg: string
  css: string
  serif: FaceCfg
}

const NOTO_CJK = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF'
const GFONTS = 'https://raw.githubusercontent.com/google/fonts/main/ofl'
const V1_FONTS_DIR = 'D:/Monosaba Personality Test/scripts/fonts-full'

const fontsource = (pkg: string, subset: string): Record<Weight, SourceSpec> => ({
  400: { kind: 'fontsource', pkg, subset },
  700: { kind: 'fontsource', pkg, subset },
})

const LOCALE_KEYS = ['zh-CN', 'zh-TW', 'ja', 'en']
const LOCALES: LocaleCfg[] = [
  {
    key: 'zh-CN',
    seg: 'zh-cn',
    css: 'src/styles/fonts-zh-cn.css',
    serif: {
      family: 'Noto Serif SC',
      slug: 'noto-serif-sc',
      primary: fontsource('noto-serif-sc', 'chinese-simplified'),
      fallback: {
        400: { kind: 'file', file: 'NotoSerifCJKsc-Regular.otf', url: `${NOTO_CJK}/SimplifiedChinese/NotoSerifCJKsc-Regular.otf`, v1: 'NotoSerifCJKsc-Regular.otf' },
        700: { kind: 'file', file: 'NotoSerifCJKsc-Bold.otf', url: `${NOTO_CJK}/SimplifiedChinese/NotoSerifCJKsc-Bold.otf`, v1: 'NotoSerifCJKsc-Bold.otf' },
      },
    },
  },
  {
    key: 'zh-TW',
    seg: 'zh-tw',
    css: 'src/styles/fonts-zh-tw.css',
    serif: {
      family: 'Noto Serif TC',
      slug: 'noto-serif-tc',
      primary: fontsource('noto-serif-tc', 'chinese-traditional'),
      fallback: {
        400: { kind: 'file', file: 'NotoSerifCJKtc-Regular.otf', url: `${NOTO_CJK}/TraditionalChinese/NotoSerifCJKtc-Regular.otf`, v1: 'NotoSerifCJKtc-Regular.otf' },
        700: { kind: 'file', file: 'NotoSerifCJKtc-Bold.otf', url: `${NOTO_CJK}/TraditionalChinese/NotoSerifCJKtc-Bold.otf`, v1: 'NotoSerifCJKtc-Bold.otf' },
      },
    },
  },
  {
    key: 'ja',
    seg: 'ja',
    css: 'src/styles/fonts-ja.css',
    serif: {
      family: 'Shippori Mincho',
      slug: 'shippori-mincho',
      primary: fontsource('shippori-mincho', 'japanese'),
      fallback: {
        400: { kind: 'file', file: 'ShipporiMincho-Regular.ttf', url: `${GFONTS}/shipporimincho/ShipporiMincho-Regular.ttf` },
        700: { kind: 'file', file: 'ShipporiMincho-Bold.ttf', url: `${GFONTS}/shipporimincho/ShipporiMincho-Bold.ttf` },
      },
    },
  },
]

/* The pixel instrument face (readouts, labels, eyebrows). One weight, shared
 * by the three CJK locales, cut to the UI + quiz charset only. */
const INSTRUMENT: FaceCfg = {
  family: 'DotGothic16',
  slug: 'dotgothic16',
  primary: fontsource('dotgothic16', 'japanese'),
  fallback: {
    400: { kind: 'file', file: 'DotGothic16-Regular.ttf', url: `${GFONTS}/dotgothic16/DotGothic16-Regular.ttf` },
    700: { kind: 'file', file: 'DotGothic16-Regular.ttf', url: `${GFONTS}/dotgothic16/DotGothic16-Regular.ttf` },
  },
}

/* i18n sections the landing / 404 chrome renders (report: what the landing
 * needs). */
const LANDING_SECTIONS = ['meta', 'nav', 'landing', 'footer', 'localeSwitcher', 'suggestBanner', 'notFound', 'errors']
/* Sections a static card page renders besides the card itself. */
const CARD_PAGE_SECTIONS = ['meta', 'card', 'shareCta', 'footer', 'localeSwitcher', 'result', 'crisisLinks', 'collection']
/* Chrome = both: c0 carries it so neither the landing nor a card page pays a
 * second chunk for labels. The rest of the UI (consent gate, exam, verdict,
 * share sheet, feedback) is exam-flow only → cU. */
const CHROME_SECTIONS = [...new Set([...LANDING_SECTIONS, ...CARD_PAGE_SECTIONS])]
/* Bold chrome: what bold elements outside the card body set — hero title, CTAs,
 * share-CTA heading, card labels/nameless (h2/inscription/.cta__label). */
const BOLD_CHROME_KEYS = ['landing.title', 'landing.ctaBegin', 'meta.wordmark', 'meta.siteName', 'suggestBanner.accept', 'shareCta', 'card', 'notFound.title']
/* Dev-only modules whose literals must not shape production chunks: the mock
 * engine carries a four-locale question bank that only renders when the real
 * engine is absent (src/lib/engine.ts). */
const DEV_ONLY_MODULES = new Set(['src/lib/mock-engine.ts'])

/* Fixed safety set beyond what the copy uses today. */
const SAFETY_PUNCT = '—―–…‥·「」『』（）《》〈〉【】〔〕“”‘’・～〜、。，！？：；￥％＆＊＋－／＝＠'
const SAFETY_BLOCKS: [number, number][] = [
  [0x3000, 0x303f], // CJK symbols & punctuation
  [0xff00, 0xffef], // halfwidth & fullwidth forms
]

// ── Small helpers ──
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}
function sha1(...parts: (string | Uint8Array)[]): string {
  const h = createHash('sha1')
  for (const p of parts) h.update(p).update('\0')
  return h.digest('hex')
}
/** Every string value in a JSON tree, depth-first. */
function walkStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) walkStrings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) walkStrings(x, out)
  return out
}
function codepoints(strs: Iterable<string>): Set<number> {
  const set = new Set<number>()
  for (const s of strs) for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp > 0x20 && cp !== 0x7f) set.add(cp) // U+0020 is in every font's core anyway
  }
  return set
}
const isIdeograph = (cp: number) =>
  (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || cp >= 0x20000
const isKana = (cp: number) => cp >= 0x3041 && cp <= 0x30ff
/** Anything that is not a running-text glyph: punctuation, symbols, fullwidth
 *  forms, Latin-ext — cheap and ubiquitous, so it rides in c0. */
const isSymbolish = (cp: number) => cp > 0x7f && !isIdeograph(cp) && !isKana(cp)

// ── Source fonts ──
const cmapCache = new Map<string, Set<number>>()
/** cmap coverage (formats 4 + 12) of an sfnt buffer. */
function cmapOf(buf: Buffer, key: string): Set<number> {
  const hit = cmapCache.get(key)
  if (hit) return hit
  const numTables = buf.readUInt16BE(4)
  let cmapOff = -1
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16
    if (buf.toString('latin1', o, o + 4) === 'cmap') cmapOff = buf.readUInt32BE(o + 8)
  }
  const set = new Set<number>()
  if (cmapOff < 0) throw new Error(`no cmap table in ${key}`)
  const nt = buf.readUInt16BE(cmapOff + 2)
  for (let i = 0; i < nt; i++) {
    const rec = cmapOff + 4 + i * 8
    const off = cmapOff + buf.readUInt32BE(rec + 4)
    const fmt = buf.readUInt16BE(off)
    if (fmt === 4) {
      const segX2 = buf.readUInt16BE(off + 6)
      const ends = off + 14
      const starts = ends + segX2 + 2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = buf.readUInt16BE(ends + s * 2)
        const start = buf.readUInt16BE(starts + s * 2)
        if (start === 0xffff) continue
        for (let c = start; c <= end; c++) set.add(c)
      }
    } else if (fmt === 12) {
      const ngroups = buf.readUInt32BE(off + 12)
      for (let g = 0; g < ngroups; g++) {
        const r = off + 16 + g * 12
        const start = buf.readUInt32BE(r)
        const end = buf.readUInt32BE(r + 4)
        for (let c = start; c <= end; c++) set.add(c)
      }
    }
  }
  cmapCache.set(key, set)
  return set
}

interface LoadedFont {
  buf: Buffer
  hash: string
  cmap: Set<number>
  label: string
}
const fontCache = new Map<string, Promise<LoadedFont | null>>()

async function loadFontsource(spec: Extract<SourceSpec, { kind: 'fontsource' }>, weight: Weight): Promise<LoadedFont | null> {
  const name = `${spec.pkg}-${spec.subset}-${weight}-normal`
  const woff2 = join(ROOT, `node_modules/@fontsource/${spec.pkg}/files/${name}.woff2`)
  if (!existsSync(woff2)) {
    console.warn(`[gen:fonts] missing ${woff2} — is @fontsource/${spec.pkg} installed?`)
    return null
  }
  // harfbuzz wants sfnt input: decompress once into the cache (deterministic).
  const ttf = join(CACHE, `${name}.ttf`)
  if (!existsSync(ttf) || statSync(ttf).mtimeMs < statSync(woff2).mtimeMs) {
    const raw: Uint8Array = await wawoff2.decompress(readFileSync(woff2))
    writeFileSync(ttf, Buffer.from(raw))
  }
  const buf = readFileSync(ttf)
  return { buf, hash: sha1(buf), cmap: cmapOf(buf, ttf), label: `@fontsource/${spec.pkg} ${spec.subset} ${weight}` }
}

async function loadFile(spec: Extract<SourceSpec, { kind: 'file' }>): Promise<LoadedFont | null> {
  const dst = join(CACHE, spec.file)
  if (!existsSync(dst)) {
    const v1 = spec.v1 ? join(V1_FONTS_DIR, spec.v1) : null
    if (v1 && existsSync(v1)) {
      writeFileSync(dst, readFileSync(v1))
      console.log(`[gen:fonts] copied ${spec.file} from v1 cache`)
    } else {
      console.log(`[gen:fonts] downloading ${spec.file} …`)
      try {
        const res = await fetch(spec.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        writeFileSync(dst, Buffer.from(await res.arrayBuffer()))
      } catch (err) {
        console.warn(`[gen:fonts] download FAILED for ${spec.file} (${(err as Error).message}) — glyphs only that font has will fall back to system fonts`)
        return null
      }
    }
  }
  const buf = readFileSync(dst)
  return { buf, hash: sha1(buf), cmap: cmapOf(buf, dst), label: spec.file }
}

function loadSource(spec: SourceSpec, weight: Weight): Promise<LoadedFont | null> {
  const key = spec.kind === 'fontsource' ? `fs:${spec.pkg}:${spec.subset}:${weight}` : `file:${spec.file}`
  let p = fontCache.get(key)
  if (!p) {
    p = spec.kind === 'fontsource' ? loadFontsource(spec, weight) : loadFile(spec)
    fontCache.set(key, p)
  }
  return p
}

// ── Content + i18n (read from disk; no Vite here) ──
const CONTENT_DIR = join(ROOT, 'content')
const FIXTURE_DIR = join(ROOT, 'src/fixtures')
const useContent = existsSync(join(CONTENT_DIR, 'cards', 'manifest.json'))
const cardsDir = useContent ? join(CONTENT_DIR, 'cards') : join(FIXTURE_DIR, 'cards')

interface Doc {
  id: string
  family: string
  text: string[]
  bold: string[]
}
interface LocaleTexts {
  i18n: Record<string, unknown>
  /** landing + card-page chrome (→ c0) */
  chrome: string[]
  /** the OTHER locales' suggest-banner lines (→ cB: server-rendered on every
   *  page but `hidden` until the visitor's browser language reveals one, and
   *  browsers only fetch fonts for laid-out text) */
  banner: string[]
  /** what bold chrome elements set (→ bold c0) */
  chromeBold: string[]
  /** the landing alone (report) */
  landing: string[]
  ui: string[]
  quiz: string[]
  quizBold: string[]
  /** literal CJK inside dev-only modules (the mock bank) */
  modules: string[]
  docs: Doc[]
}

/** Literal CJK / CJK-punctuation runs inside src templates + modules (comments
 *  stripped), so hard-coded marks (the 魔法 ornament, the locale names in
 *  src/i18n/config.ts) are never missed. i18n module literals are page chrome
 *  (c0); other component/module literals are UI (cU); the dev-only mock
 *  engine's bank gets its own regular-only chunk (cM) production never
 *  touches. */
const LITERAL_RE = /[\u2000-\u206f\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]+/g
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')
}
function scanSrcLiterals(): { chrome: string[]; ui: string[]; modules: string[] } {
  const chrome: string[] = []
  const ui: string[] = []
  const modules: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'fixtures') continue
        walk(p)
        continue
      }
      const ext = extname(entry.name)
      if (ext !== '.astro' && ext !== '.vue' && ext !== '.ts') continue
      const found = stripComments(readFileSync(p, 'utf-8')).match(LITERAL_RE)
      if (!found) continue
      const rel = p.slice(ROOT.length + 1).replace(/\\/g, '/')
      if (DEV_ONLY_MODULES.has(rel)) modules.push(...found)
      else if (rel.startsWith('src/i18n/')) chrome.push(...found)
      else ui.push(...found)
    }
  }
  walk(join(ROOT, 'src'))
  return { chrome, ui, modules }
}
const SRC_LITERALS = scanSrcLiterals()

function pick(i18n: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), i18n)
}

function familyOfTag(tag: string): string {
  return tag.split('-')[0] ?? 'X'
}

function collectTexts(key: string): LocaleTexts {
  const i18n = readJson<Record<string, unknown>>(join(ROOT, `src/i18n/${key}.json`))
  const landing = walkStrings(LANDING_SECTIONS.map((s) => i18n[s]))
  const chrome = walkStrings(CHROME_SECTIONS.map((s) => i18n[s])).concat(SRC_LITERALS.chrome)
  // The suggest banner server-renders every OTHER locale's line in its own
  // words (LangSuggestBanner.astro), hidden until one is revealed.
  const banner: string[] = []
  for (const other of LOCALE_KEYS) {
    if (other === key) continue
    const p = join(ROOT, `src/i18n/${other}.json`)
    if (existsSync(p)) walkStrings(readJson<Record<string, unknown>>(p).suggestBanner, banner)
  }
  const chromeBold = walkStrings(BOLD_CHROME_KEYS.map((k) => pick(i18n, k)))
  const ui = walkStrings(i18n).concat(SRC_LITERALS.ui)

  const quiz: string[] = []
  const quizBold: string[] = []
  for (const loc of [key, 'en']) {
    const p = join(CONTENT_DIR, 'quiz', `strings.${loc}.json`)
    if (!existsSync(p)) continue
    const bank = readJson<{ questions?: Record<string, { stem?: string }> }>(p)
    walkStrings(bank, quiz)
    for (const q of Object.values(bank.questions ?? {})) if (q.stem) quizBold.push(q.stem)
  }

  const docs: Doc[] = []
  if (existsSync(cardsDir)) {
    for (const f of readdirSync(cardsDir).sort()) {
      if (!f.endsWith(`.${key}.json`)) continue
      const card = readJson<any>(join(cardsDir, f))
      const variants: any[] = Array.isArray(card.variants) ? card.variants : [card]
      docs.push({
        id: String(card.tag ?? f),
        family: String(card.family ?? familyOfTag(String(card.tag ?? f))),
        text: walkStrings(card),
        // The headline is the magic name (700); the epithet is short enough to
        // keep bold-capable in case a layout promotes it.
        bold: variants.flatMap((v) => {
          const fields = v?.fields ?? v
          return [String(fields?.magic?.name ?? ''), String(fields?.epithet ?? '')]
        }),
      })
    }
  }
  const charsPath = join(CONTENT_DIR, 'characters', `${key}.json`)
  if (existsSync(charsPath)) {
    for (const ch of readJson<any[]>(charsPath)) {
      docs.push({
        id: `c-${ch.id}`,
        family: familyOfTag(String(ch.tag ?? '')),
        text: walkStrings(ch),
        bold: [String(ch.name ?? ''), String(ch.magicName ?? ''), String(ch.epithet ?? '')],
      })
    }
  }
  return { i18n, chrome, banner, chromeBold, landing, ui, quiz, quizBold, modules: SRC_LITERALS.modules, docs }
}

// ── Partition ──
interface Chunk {
  name: string
  cps: number[]
}
interface FaceInput {
  /** page chrome → c0 */
  chrome: Set<number>
  /** other-locale suggest-banner text → cB */
  banner: Set<number>
  ui: Set<number>
  quiz: Set<number>
  /** dev-only module literals → cM (regular serif only) */
  modules: Set<number>
  docs: { id: string; family: string; set: Set<number> }[]
  /** Fixed core glyphs (ASCII + safety punctuation). */
  core: Set<number>
  /** ja: kana is running text on every page — keep it in c0. */
  kanaIsCore: boolean
  /** Regular serif only: append the unused safety-block remainder as cP. */
  safetyRemainder: boolean
}

function partition(inp: FaceInput): Chunk[] {
  // (module literals are deliberately NOT in the universe: their punctuation
  // must not leak into c0 either)
  const universe = new Set<number>([...inp.core, ...inp.chrome, ...inp.banner, ...inp.ui, ...inp.quiz])
  for (const d of inp.docs) for (const cp of d.set) universe.add(cp)

  // document frequency + per-family record counts over the card/character docs
  const df = new Map<number, number>()
  const fam = new Map<number, Map<string, number>>()
  for (const d of inp.docs) {
    for (const cp of d.set) {
      df.set(cp, (df.get(cp) ?? 0) + 1)
      let m = fam.get(cp)
      if (!m) fam.set(cp, (m = new Map()))
      m.set(d.family, (m.get(d.family) ?? 0) + 1)
    }
  }

  const claimed = new Set<number>()
  const chunks: Chunk[] = []
  const take = (name: string, cps: Iterable<number>) => {
    const arr = [...cps].filter((cp) => !claimed.has(cp)).sort((a, b) => a - b)
    for (const cp of arr) claimed.add(cp)
    if (arr.length) chunks.push({ name, cps: arr })
  }

  // c0 — core + every symbol/punctuation glyph in use + page chrome (+ kana for ja)
  const c0 = new Set<number>([...inp.core, ...inp.chrome])
  for (const cp of universe) if (isSymbolish(cp) || (inp.kanaIsCore && isKana(cp))) c0.add(cp)
  take('c0', c0)

  // cB — the hidden other-locale banner lines (fetched only when revealed)
  take('cB', inp.banner)

  // c1 — head: used by ≥ HEAD_DF records
  take('c1', [...df.keys()].filter((cp) => (df.get(cp) ?? 0) >= HEAD_DF))

  // cU — the rest of the UI, claimed BEFORE the tails so a label glyph that one
  // card happens to share never drags a family tail onto the exam screens.
  // (Measured both orders for the bold face: this one is smaller for zh-CN and
  // zh-TW card pages, the other only for ja — one rule is worth the 10 KB.)
  take('cU', inp.ui)

  // tails — owned by a family when dominant, else shared
  const owned = new Map<string, number[]>()
  const shared: number[] = []
  for (const cp of [...df.keys()].sort((a, b) => a - b)) {
    if (claimed.has(cp)) continue
    const total = df.get(cp)!
    let best = ''
    let bestN = 0
    for (const [f, n] of [...fam.get(cp)!.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (n > bestN) {
        best = f
        bestN = n
      }
    }
    if (bestN / total >= FAMILY_DOMINANCE) {
      let arr = owned.get(best)
      if (!arr) owned.set(best, (arr = []))
      arr.push(cp)
    } else shared.push(cp)
  }
  for (const f of [...owned.keys()].sort()) {
    const arr = owned.get(f)!
    if (arr.length >= MIN_FAMILY_CHUNK) take(`cF-${f}`, arr)
    else shared.push(...arr)
  }
  take('cS', shared)

  // exam-only quiz text, dev-only literals
  take('cQ', inp.quiz)
  take('cM', inp.modules)

  if (inp.safetyRemainder) {
    const rest: number[] = []
    for (const [lo, hi] of SAFETY_BLOCKS) for (let cp = lo; cp <= hi; cp++) rest.push(cp)
    take('cP', rest)
  }
  return chunks
}

/** Split a partition by what the primary font can actually serve. The part of
 *  a chunk only the fallback has becomes its own `<name>x` chunk (so zh-TW's
 *  fullwidth punctuation rides along as c0x without dragging anything else);
 *  chars in neither source are dropped and reported. The safety remainder
 *  (cP) is primary-only — never worth a fallback cut. */
function routeToSources(
  chunks: Chunk[],
  primary: LoadedFont,
  fallback: LoadedFont | null,
): { primary: Chunk[]; fallback: Chunk[]; dropped: Map<string, number[]> } {
  const p: Chunk[] = []
  const f: Chunk[] = []
  const dropped = new Map<string, number[]>()
  for (const c of chunks) {
    const keep: number[] = []
    const x: number[] = []
    for (const cp of c.cps) {
      if (primary.cmap.has(cp)) keep.push(cp)
      else if (c.name !== 'cP' && fallback?.cmap.has(cp)) x.push(cp)
      else if (c.name !== 'cP') {
        let arr = dropped.get(c.name)
        if (!arr) dropped.set(c.name, (arr = []))
        arr.push(cp)
      }
    }
    if (keep.length) p.push({ name: c.name, cps: keep })
    if (x.length) f.push({ name: `${c.name}x`, cps: x })
  }
  return { primary: p, fallback: f, dropped }
}

/** Codepoints → CSS unicode-range list, consecutive runs collapsed. */
function unicodeRange(cps: number[]): string {
  const sorted = [...cps].sort((a, b) => a - b)
  const parts: string[] = []
  const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, '0')
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++
    parts.push(i === j ? `U+${hex(sorted[i]!)}` : `U+${hex(sorted[i]!)}-${hex(sorted[j]!)}`)
    i = j + 1
  }
  return parts.join(', ')
}

// ── Build (chunk-level incremental) ──
interface ManifestEntry {
  file: string
  bytes: number
}
interface Manifest {
  version: string
  chunks: Record<string, ManifestEntry>
}
const manifest: Manifest = existsSync(MANIFEST_FILE)
  ? readJson<Manifest>(MANIFEST_FILE)
  : { version: DESIGN_VERSION, chunks: {} }
if (manifest.version !== DESIGN_VERSION) {
  manifest.version = DESIGN_VERSION
  manifest.chunks = {}
}

interface BuiltChunk {
  face: FaceCfg
  weight: Weight
  name: string
  cps: number[]
  file: string // basename under public/fonts/<seg>/
  bytes: number
  reused: boolean
}

async function buildChunk(seg: string, face: FaceCfg, weight: Weight, chunk: Chunk, src: LoadedFont): Promise<BuiltChunk> {
  const key = sha1(DESIGN_VERSION, face.slug, String(weight), chunk.name, src.hash, chunk.cps.join(','))
  const dir = join(OUT_DIR, seg)
  mkdirSync(dir, { recursive: true })
  const cached = manifest.chunks[key]
  if (cached && existsSync(join(dir, cached.file))) {
    return { face, weight, name: chunk.name, cps: chunk.cps, file: cached.file, bytes: cached.bytes, reused: true }
  }
  const text = chunk.cps.map((cp) => String.fromCodePoint(cp)).join('')
  const out: Buffer = await subsetFont(src.buf, text, { targetFormat: 'woff2' })
  const file = `${face.slug}-${weight}-${chunk.name.toLowerCase()}.${sha1(out).slice(0, 8)}.woff2`
  writeFileSync(join(dir, file), out)
  manifest.chunks[key] = { file, bytes: out.length }
  return { face, weight, name: chunk.name, cps: chunk.cps, file, bytes: out.length, reused: false }
}

function fontFaceRule(face: FaceCfg, weight: Weight, url: string, cps: number[]): string {
  return [
    '@font-face {',
    `  font-family: '${face.family}';`,
    '  font-style: normal;',
    `  font-weight: ${weight};`,
    '  font-display: swap;',
    `  src: url('${url}') format('woff2');`,
    `  unicode-range: ${unicodeRange(cps)};`,
    '}',
    '',
  ].join('\n')
}

function writeIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf-8') === content) return false
  writeFileSync(path, content, 'utf-8')
  return true
}

// ── Report helpers ──
interface PageEstimate {
  bytes: number
  files: string[]
}
function estimate(built: BuiltChunk[], needs: { face: FaceCfg; weight: Weight; cps: Set<number> }[]): PageEstimate {
  const files = new Map<string, number>()
  for (const n of needs) {
    for (const b of built) {
      if (b.face !== n.face || b.weight !== n.weight) continue
      if (b.cps.some((cp) => n.cps.has(cp))) files.set(b.file, b.bytes)
    }
  }
  let bytes = 0
  for (const v of files.values()) bytes += v
  return { bytes, files: [...files.keys()] }
}
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`

// ── Main ──
async function main() {
  const t0 = Date.now()
  console.log(`[gen:fonts] content=${useContent ? 'content/' : 'fixtures'}`)

  const ascii: number[] = []
  for (let cp = 0x21; cp < 0x7f; cp++) ascii.push(cp)
  const coreSet = new Set<number>([...ascii, ...codepoints([SAFETY_PUNCT])])

  const referenced = new Map<string, Set<string>>() // seg → files to keep
  let totalBuilt = 0
  let totalReused = 0

  for (const loc of LOCALES) {
    const texts = collectTexts(loc.key)
    const docsR = texts.docs.map((d) => ({ id: d.id, family: d.family, set: codepoints(d.text) }))
    const docsB = texts.docs.map((d) => ({ id: d.id, family: d.family, set: codepoints(d.bold) }))
    const i18n = texts.i18n as any
    const chromeR = codepoints(texts.chrome)
    const chromeB = codepoints(texts.chromeBold)
    const bannerR = codepoints(texts.banner)

    const none = new Set<number>()
    const faces: { face: FaceCfg; weight: Weight; input: FaceInput }[] = [
      {
        face: loc.serif,
        weight: 400,
        input: { chrome: chromeR, banner: bannerR, ui: codepoints(texts.ui), quiz: codepoints(texts.quiz), modules: codepoints(texts.modules), docs: docsR, core: coreSet, kanaIsCore: loc.key === 'ja', safetyRemainder: true },
      },
      {
        face: loc.serif,
        weight: 700,
        // bold kana rides on frequency like everything else: every kana in c0
        // would put ~40 KB on any page with one bold line
        input: { chrome: chromeB, banner: none, ui: codepoints(texts.ui), quiz: codepoints(texts.quizBold), modules: none, docs: docsB, core: coreSet, kanaIsCore: false, safetyRemainder: false },
      },
      {
        face: INSTRUMENT,
        weight: 400,
        // no docs: the instrument never sets card prose → c0 / cB / cU / cQ only
        input: { chrome: chromeR, banner: bannerR, ui: codepoints(texts.ui), quiz: codepoints(texts.quiz), modules: none, docs: [], core: coreSet, kanaIsCore: loc.key === 'ja', safetyRemainder: false },
      },
    ]

    const built: BuiltChunk[] = []
    for (const { face, weight, input } of faces) {
      const primary = await loadSource(face.primary[weight], weight)
      if (!primary) throw new Error(`[gen:fonts] primary source missing for ${face.family} ${weight}`)
      const chunks = partition(input)
      // Only reach for the full font when the primary actually lacks something.
      const needFallback = chunks.some((c) => c.name !== 'cP' && c.cps.some((cp) => !primary.cmap.has(cp)))
      const fallback = needFallback ? await loadSource(face.fallback[weight], weight) : null
      const routed = routeToSources(chunks, primary, fallback)
      for (const [chunk, cps] of routed.dropped) {
        const shown = cps.slice(0, 24).map((cp) => String.fromCodePoint(cp)).join('')
        const why =
          chunk === 'cM'
            ? 'dev-only module literals (other locales in the mock bank), fine'
            : chunk === 'cB'
              ? 'other-locale suggest-banner text (revealed only to that browser language), fine'
              : face === INSTRUMENT
              ? 'not in DotGothic16 — instrument text falls through to the serif, as before'
              : 'in NO source — system fallback glyphs'
        console.warn(`[gen:fonts] ${loc.key} ${face.family} ${weight} ${chunk}: ${cps.length} char(s) ${why}: ${shown}${cps.length > 24 ? '…' : ''}`)
      }
      for (const c of routed.primary) built.push(await buildChunk(loc.seg, face, weight, c, primary))
      for (const c of routed.fallback) built.push(await buildChunk(loc.seg, face, weight, c, fallback!))
    }

    // ── CSS ──
    const rules = built.map((b) => fontFaceRule(b.face, b.weight, `/fonts/${loc.seg}/${b.file}`, b.cps)).join('\n')
    const header = [
      '/* GENERATED by scripts/subset-fonts.ts — do not edit.',
      ` * ${loc.key} CJK bundle: ${loc.serif.family} 400/700 + DotGothic16 400, subset over the`,
      ' * card corpus + UI + quiz strings and cut into co-occurrence-tiered unicode-range',
      ' * chunks (c0 core · cB hidden banner · c1 head · cU ui · cF-* family tails ·',
      ' * cS shared · cQ quiz · cM dev literals · cP safety · *x fallback-sourced). Only 400 and 700 are',
      ' * shipped: weights 600/800/900 requested by components resolve to the 700',
      ' * face, and bold text outside the bold-capable charset (titles, names, labels,',
      ' * stems) renders from the 400 face. Regenerate with `npm run gen:fonts`. */',
      '',
    ].join('\n')
    const cssPath = join(ROOT, loc.css)
    const cssChanged = writeIfChanged(cssPath, header + rules)

    // ── Bookkeeping + report ──
    const keep = new Set(built.map((b) => b.file))
    referenced.set(loc.seg, keep)
    const reused = built.filter((b) => b.reused).length
    totalBuilt += built.length - reused
    totalReused += reused

    console.log(`\n[gen:fonts] ${loc.key} — ${built.length} chunks (${built.length - reused} built, ${reused} reused), css ${cssChanged ? 'rewritten' : 'unchanged'}: ${loc.css}`)
    console.log('  face                  wt  chunk    chars     bytes')
    for (const b of built) {
      console.log(`  ${b.face.family.padEnd(20)} ${String(b.weight).padStart(3)}  ${b.name.padEnd(7)} ${String(b.cps.length).padStart(6)} ${String(b.bytes).padStart(9)}`)
    }
    const sum = (w: Weight, f: FaceCfg) => built.filter((b) => b.face === f && b.weight === w).reduce((a, b) => a + b.bytes, 0)
    console.log(`  total: ${loc.serif.family} 400 ${kb(sum(400, loc.serif))} · 700 ${kb(sum(700, loc.serif))} · DotGothic16 ${kb(sum(400, INSTRUMENT))}`)

    // what a page would download (union of chunks its text intersects)
    const landingBold = [i18n.landing?.title, i18n.landing?.ctaBegin, i18n.meta?.wordmark].filter((s: unknown): s is string => typeof s === 'string')
    const landingInstr = codepoints([i18n.landing?.ctaAside, i18n.meta?.latin, i18n.localeSwitcher?.label, ...walkStrings(i18n.suggestBanner)].filter((s): s is string => typeof s === 'string'))
    const landingEst = estimate(built, [
      { face: loc.serif, weight: 400, cps: codepoints(texts.landing) },
      { face: loc.serif, weight: 700, cps: codepoints(landingBold) },
      { face: INSTRUMENT, weight: 400, cps: landingInstr },
    ])
    console.log(`  landing  ≈ ${kb(landingEst.bytes).padStart(9)}  ${landingEst.files.length} files`)
    const sampleId = texts.docs.find((d) => d.id === 'ED-1_P-1')?.id ?? texts.docs.find((d) => !d.id.startsWith('c-'))?.id
    const sample = texts.docs.find((d) => d.id === sampleId)
    if (sample) {
      const cardUi = walkStrings(CARD_PAGE_SECTIONS.map((s) => i18n[s]))
      const cardBold = [sample.bold[0] ?? '', i18n.shareCta?.title, i18n.shareCta?.button, i18n.card?.nameless].filter((s): s is string => typeof s === 'string')
      const cardInstr = walkStrings([i18n.card, i18n.localeSwitcher, i18n.meta])
      const cardEst = estimate(built, [
        { face: loc.serif, weight: 400, cps: codepoints([...sample.text, ...cardUi]) },
        { face: loc.serif, weight: 700, cps: codepoints(cardBold) },
        { face: INSTRUMENT, weight: 400, cps: codepoints(cardInstr) },
      ])
      console.log(`  card ${sample.id.padEnd(10)} ≈ ${kb(cardEst.bytes).padStart(9)}  ${cardEst.files.length} files  (${cardEst.files.map((f) => f.replace(/\.[0-9a-f]{8}\.woff2$/, '').replace(/^.*-(\d{3})-/, '$1:')).join(' ')})`)
    }
  }

  // ── Prune stale files + manifest entries ──
  let pruned = 0
  for (const [seg, keep] of referenced) {
    const dir = join(OUT_DIR, seg)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!keep.has(f)) {
        unlinkSync(join(dir, f))
        pruned++
      }
    }
  }
  const live = new Set<string>()
  for (const keep of referenced.values()) for (const f of keep) live.add(f)
  for (const [k, v] of Object.entries(manifest.chunks)) if (!live.has(v.file)) delete manifest.chunks[k]
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 0), 'utf-8')

  console.log(`\n[gen:fonts] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${totalBuilt} chunk(s) subset, ${totalReused} reused, ${pruned} stale file(s) pruned`)
}

await main()
