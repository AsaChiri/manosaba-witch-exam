/*
 * OG image generator (design spec §7/§F). Hand-built 1200×630 SVGs rendered
 * with resvg-js — root OG per locale (Seal + title on velvet) and per-card OG
 * (epithet in inscription type + Seal + cell line on velvet). CJK fonts come
 * from @fontsource woff2 decompressed to ttf (wawoff2) — no network. Rendering
 * is fanned out across a worker pool with content-hash incremental skip.
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SITE = (process.env.PUBLIC_SITE_URL || 'https://manosaba-exam.pages.dev').replace(/\/$/, '')
const DESIGN_VERSION = 'og-v1'
const CACHE = join(ROOT, 'scripts/.fonts-cache')
mkdirSync(CACHE, { recursive: true })

// ── Palette (mirrors src/styles/tokens.css) ──
const C = {
  ink: '#0d0b10',
  ink2: '#100c14',
  velvet: '#1b1016',
  oxblood: '#5c0f1a',
  violet: '#a17dde',
  violetDeep: '#6b4fae',
  gold: '#c9954a',
  goldBright: '#e8b04a',
  goldDeep: '#ad7237',
  bone: '#e9dfcc',
  boneDim: '#b3a892',
}

// ── Locale config ──
interface LocaleCfg {
  key: string
  seg: string
  font: string
  weightBig: number
  isCjk: boolean
}
const LOCALES: LocaleCfg[] = [
  { key: 'zh-CN', seg: 'zh-cn', font: 'Noto Serif SC', weightBig: 900, isCjk: true },
  { key: 'en', seg: 'en', font: 'Cinzel', weightBig: 700, isCjk: false },
  { key: 'ja', seg: 'ja', font: 'Shippori Mincho', weightBig: 800, isCjk: true },
  { key: 'zh-TW', seg: 'zh-tw', font: 'Noto Serif TC', weightBig: 900, isCjk: true },
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

// ── Fonts: decompress @fontsource woff2 → ttf (cached) ──
const FONT_SPECS: { pkg: string; files: string[] }[] = [
  { pkg: 'cinzel', files: ['cinzel-latin-600-normal', 'cinzel-latin-700-normal', 'cinzel-latin-ext-700-normal'] },
  { pkg: 'vt323', files: ['vt323-latin-400-normal'] },
  { pkg: 'noto-serif-sc', files: ['noto-serif-sc-chinese-simplified-400-normal', 'noto-serif-sc-chinese-simplified-900-normal', 'noto-serif-sc-latin-400-normal', 'noto-serif-sc-latin-900-normal'] },
  { pkg: 'noto-serif-tc', files: ['noto-serif-tc-chinese-traditional-400-normal', 'noto-serif-tc-chinese-traditional-900-normal', 'noto-serif-tc-latin-400-normal', 'noto-serif-tc-latin-900-normal'] },
  { pkg: 'shippori-mincho', files: ['shippori-mincho-japanese-400-normal', 'shippori-mincho-japanese-800-normal', 'shippori-mincho-latin-400-normal', 'shippori-mincho-latin-800-normal'] },
]

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
  return lines
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
  return lines
}
function layout(
  text: string,
  isCjk: boolean,
  maxWidth: number,
  preferred: number,
  min = 30,
  maxLines = 3,
): { size: number; lines: string[] } {
  const factor = isCjk ? 1.0 : 0.56
  let size = preferred
  let lines = isCjk ? wrapCjk(text, Math.max(1, Math.floor(maxWidth / (size * factor)))) : wrapLatin(text, Math.max(1, Math.floor(maxWidth / (size * factor))))
  while (size > min && lines.length > maxLines) {
    size -= 4
    const maxChars = Math.max(1, Math.floor(maxWidth / (size * factor)))
    lines = isCjk ? wrapCjk(text, maxChars) : wrapLatin(text, maxChars)
  }
  return { size, lines }
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

function bgAndDefs(): string {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.ink2}"/>
      <stop offset="46%" stop-color="${C.ink}"/>
      <stop offset="100%" stop-color="#08060a"/>
    </linearGradient>
    <radialGradient id="glowV" cx="50%" cy="6%" r="72%">
      <stop offset="0%" stop-color="${C.violetDeep}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${C.violetDeep}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowO" cx="50%" cy="112%" r="60%">
      <stop offset="0%" stop-color="${C.oxblood}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${C.oxblood}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.gold}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${C.gold}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${C.gold}" stop-opacity="0"/>
    </linearGradient>
    <filter id="softglow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glowV)"/>
  <rect width="1200" height="630" fill="url(#glowO)"/>
  <rect x="18" y="18" width="1164" height="594" fill="none" stroke="${C.gold}" stroke-opacity="0.22"/>`
}

function fam(cfg: LocaleCfg): string {
  return `'${cfg.font}', 'Noto Serif SC'`
}

function brandBlock(cfg: LocaleCfg, s: any): string {
  const site = escapeXml(s.meta.siteName)
  const domain = SITE.replace(/^https?:\/\//, '')
  return `<text x="600" y="588" text-anchor="middle" fill="${C.goldDeep}" font-family="${fam(cfg)}" font-size="22" letter-spacing="6">${site}</text>
    <text x="600" y="612" text-anchor="middle" fill="${C.boneDim}" fill-opacity="0.6" font-family="'VT323', 'Noto Serif SC'" font-size="18" letter-spacing="3">${escapeXml(domain)}</text>`
}

function buildRootSvg(cfg: LocaleCfg): string {
  const s = I18N[cfg.key]
  const title = s.landing.title as string
  const tagline = s.meta.tagline as string
  const caseLine = s.landing.caseLine as string
  const tl = layout(title, cfg.isCjk, 1000, cfg.isCjk ? 92 : 84, 44, 2)
  const titleCenterY = 340
  const lh = tl.size * 1.16
  const startY = titleCenterY - ((tl.lines.length - 1) * lh) / 2
  const titleTspans = tl.lines
    .map((l, i) => `<tspan x="600" y="${startY + i * lh}">${escapeXml(l)}</tspan>`)
    .join('')
  const ruleY = startY + (tl.lines.length - 1) * lh + tl.size * 0.62 + 26
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${bgAndDefs()}
  <text x="600" y="120" text-anchor="middle" fill="${C.goldDeep}" font-family="'VT323','Noto Serif SC'" font-size="24" letter-spacing="8">${escapeXml(caseLine)}</text>
  ${sealMarkup(600, 210, 58, C.gold)}
  <text text-anchor="middle" fill="${C.bone}" font-family="${fam(cfg)}" font-weight="${cfg.weightBig}" font-size="${tl.size}" letter-spacing="4">${titleTspans}</text>
  <rect x="530" y="${ruleY}" width="140" height="1.6" fill="url(#rule)"/>
  <text x="600" y="${ruleY + 52}" text-anchor="middle" fill="${C.violet}" font-family="${fam(cfg)}" font-size="30" letter-spacing="2">${escapeXml(tagline)}</text>
  ${brandBlock(cfg, s)}
</svg>`
}

function buildCardSvg(cfg: LocaleCfg, card: any): string {
  const s = I18N[cfg.key]
  const fields = card.variants?.[0]?.fields ?? card
  const epithet = (fields.epithet ?? '') as string
  // Diegetic archive code (ED-1 · PE-1) — never English taxonomy names on the viral surface
  const fileNo = (I18N[cfg.key].card?.fileNo ?? '') as string
  const cellLabel = `${fileNo} ${String(card.tag ?? '').replace('_', ' · ')}`.trim()
  const kicker = s.card?.sentenceMark ?? s.meta.siteName
  const el = layout(epithet, cfg.isCjk, 1000, cfg.isCjk ? 88 : 78, 40, 3)
  const centerY = 350
  const lh = el.size * 1.16
  const startY = centerY - ((el.lines.length - 1) * lh) / 2
  const tspans = el.lines
    .map((l, i) => `<tspan x="600" y="${startY + i * lh}">${escapeXml(l)}</tspan>`)
    .join('')
  const cellY = startY + (el.lines.length - 1) * lh + el.size * 0.62 + 46
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${bgAndDefs()}
  <text x="600" y="104" text-anchor="middle" fill="${C.goldDeep}" font-family="'VT323','Noto Serif SC'" font-size="22" letter-spacing="10">${escapeXml(kicker)}</text>
  ${sealMarkup(600, 168, 50, C.gold)}
  <text text-anchor="middle" fill="${C.violet}" font-family="${fam(cfg)}" font-weight="${cfg.weightBig}" font-size="${el.size}" letter-spacing="2">${tspans}</text>
  <rect x="540" y="${cellY - 20}" width="120" height="1.4" fill="url(#rule)"/>
  <text x="600" y="${cellY + 18}" text-anchor="middle" fill="${C.boneDim}" font-family="'VT323','Noto Serif SC'" font-size="26" letter-spacing="6">${escapeXml(cellLabel)}</text>
  ${brandBlock(cfg, s)}
</svg>`
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
    () => new Worker(workerUrl, { workerData: { fontFiles, defaultFamily: 'Noto Serif SC' } }),
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
  const fontFiles = await loadFontFiles()
  console.log(`[gen:og] fonts ready (${fontFiles.length} ttf), content=${useContent ? 'content/' : 'fixtures'}, tags=${TAGS.length}`)

  const allJobs = collectJobs()
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
