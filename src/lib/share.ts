/*
 * Share module (design spec §D) — two buttons per locale (the social button
 * is a split button: its face fires the locale's default network, a dropdown
 * carries the secondary ones), ported from v1 `src/share.ts` with its
 * hard-won workarounds intact:
 *  - html2canvas dynamic import, scale:2, forced 520px capture width,
 *    document.fonts.ready await, an `exporting` class that kills
 *    animations/shadows/backdrop-filter during capture;
 *  - Web Share files+text fallback chain with AbortError silence, download
 *    fallback, clipboard execCommand fallback;
 *  - exact intent URL templates (X/Threads/Weibo/QQ/Facebook/Reddit/LINE);
 *    locale-gated actions;
 *  - QR (gold-on-ink) for the export footer so WeChat long-press works.
 *
 * Share URLs (§D): non-zh-CN → canonical `/{locale}/r/{tag}/` on
 * PUBLIC_SITE_URL (not location.origin, so any secondary deployment still
 * emits fresh canonical links). zh-CN → PUBLIC_SHARE_URL_ZH_CN when set: the
 * trusted bilibili entry page + `?r={tag}`. That page is a deploy-once
 * redirect shell (tools/bilibili-shell/) forwarding `?r` to the canonical
 * card page, so WeChat/QQ pastes and the export QR carry a domain those apps
 * trust while bilibili never needs redeploying for content releases. The
 * entry-URL+query shape also degrades gracefully if a full mirror is ever
 * hosted there instead: `?r` is ignored and the visitor lands on the exam.
 */
import type { Locale } from '../i18n/config'
import { localePath } from '../i18n/config'
import { t } from '../i18n'

export interface ShareCard {
  locale: Locale
  tag: string
  /** Display witch name (already resolved: user's name or the Nameless Witch). */
  name: string
  /** The magic's name — the card headline and the share hook. */
  magic: string
  /** The magic's effect text — the shareable description. */
  magicText: string
}

export type SocialAction =
  | 'copy'
  | 'weibo'
  | 'qq'
  | 'x'
  | 'threads'
  | 'facebook'
  | 'reddit'
  | 'line'
export type ShareAction = 'image' | SocialAction

export interface ShareRowSpec {
  /** The social button's face — the locale's default network. */
  social: SocialAction
  /** Secondary networks behind the social button's ▾ dropdown. */
  more: SocialAction[]
  /** zh-CN: the social (copy) button leads and renders primary. */
  socialFirst: boolean
}

/**
 * Two buttons per locale, first is primary (§D): the image export, and a
 * social split button — face = where that locale actually shares, dropdown =
 * the widely-used runners-up with a working URL-share intent. zh-CN's face
 * is copy (WeChat/QQ sharing is paste-based; no usable intent URL) with
 * Weibo/QQ intents behind the dropdown. Discord has no share-intent URL —
 * links pasted there unfurl via the per-card OG meta instead.
 */
export function shareRowSpecFor(locale: Locale): ShareRowSpec {
  switch (locale) {
    case 'zh-CN':
      return { social: 'copy', more: ['weibo', 'qq'], socialFirst: true }
    case 'zh-TW':
      return { social: 'threads', more: ['x', 'facebook', 'line', 'copy'], socialFirst: false }
    case 'ja':
      return { social: 'x', more: ['threads', 'line', 'copy'], socialFirst: false }
    default:
      return { social: 'x', more: ['threads', 'facebook', 'reddit', 'copy'], socialFirst: false }
  }
}

function canonicalOrigin(): string {
  const site = import.meta.env.PUBLIC_SITE_URL
  if (site) return site.replace(/\/$/, '')
  return typeof location !== 'undefined' ? location.origin : ''
}

export function shareUrl(card: ShareCard): string {
  if (card.locale === 'zh-CN') {
    const trusted = import.meta.env.PUBLIC_SHARE_URL_ZH_CN
    if (trusted) {
      const sep = trusted.includes('?') ? '&' : '?'
      return `${trusted}${sep}r=${encodeURIComponent(card.tag)}`
    }
  }
  return `${canonicalOrigin()}${localePath(card.locale, `/r/${card.tag}/`)}`
}

function summaryText(card: ShareCard): string {
  return [
    t(card.locale, 'share.template', { name: card.name, magic: card.magic }),
    '',
    `${t(card.locale, 'share.hint')}${shareUrl(card)}`,
  ].join('\n')
}

export async function generateShareQr(card: ShareCard): Promise<string> {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(shareUrl(card), {
    margin: 1,
    width: 200,
    color: { dark: '#c9954a', light: '#0d0b10' },
    errorCorrectionLevel: 'M',
  })
}

export async function copySummary(card: ShareCard): Promise<boolean> {
  return copyText(summaryText(card))
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/*
 * html2canvas 1.4.1's color parser only knows hex/rgb()/hsl()/named colors: any
 * other function throws `unsupported color function`, aborting the capture. Our
 * palette leans on `color-mix(in srgb, …)` (tokens.css hairlines, the card's
 * frame rules and violet text), which Chrome *serializes in computed style* as
 * `color(srgb r g b / a)` — so every capture died before ever reaching toBlob.
 * Fix: rewrite those computed values to rgba() on the cloned tree html2canvas
 * parses (via its `onclone` hook), leaving the live DOM untouched.
 *
 * Only `color(srgb …)` is converted, because `in srgb` is the palette's only
 * mixing space. A future oklch()/lab() token would need the same treatment —
 * it would surface as a visible export failure (ShareRow reports the throw).
 */
const SRGB_FN = /color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+%?))?\s*\)/g

/** Every property whose computed value html2canvas runs through that parser. */
const EXPORT_COLOR_PROPS = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  '-webkit-text-stroke-color',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
  'filter',
]

function srgbToRgba(_match: string, r: string, g: string, b: string, a?: string): string {
  const chan = (v: string) => Math.round(Math.min(1, Math.max(0, Number(v))) * 255)
  const alpha = a === undefined ? 1 : a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a)
  return `rgba(${chan(r)}, ${chan(g)}, ${chan(b)}, ${Number(alpha.toFixed(4))})`
}

function flattenExportColors(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView
  if (!view) return
  for (const node of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const computed = view.getComputedStyle(node)
    for (const prop of EXPORT_COLOR_PROPS) {
      const value = computed.getPropertyValue(prop)
      if (!value.includes('color(')) continue
      node.style.setProperty(prop, value.replace(SRGB_FN, srgbToRgba))
    }
  }
}

/**
 * Capture the result-card element as a PNG. html2canvas paints from computed
 * styles (no SVG foreignObject), so it handles borders/positioning on WebKit.
 */
export async function saveResultImage(
  element: HTMLElement,
  card: ShareCard,
): Promise<void> {
  // Wait for any in-flight locale font; else html2canvas captures a fallback.
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      /* non-fatal */
    }
  }

  const CAPTURE_WIDTH = 520
  const originalWidth = element.style.width
  const originalMaxWidth = element.style.maxWidth
  element.classList.add('exporting')
  element.style.width = `${CAPTURE_WIDTH}px`
  element.style.maxWidth = `${CAPTURE_WIDTH}px`
  // Let layout settle at the forced width. rAF never fires while the tab is
  // hidden, so race it against a timer — otherwise backgrounding the tab
  // mid-export strands the card in its `exporting` state forever.
  await new Promise((r) => {
    requestAnimationFrame(() => r(null))
    setTimeout(() => r(null), 100)
  })

  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: '#0d0b10',
      useCORS: true,
      windowWidth: CAPTURE_WIDTH + 40,
      onclone: (_doc, clone) => flattenExportColors(clone),
    })

    const filename = `manosaba-${card.tag}.png`
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )

    if (blob) {
      const file = new File([blob], filename, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          const payload: ShareData = { files: [file], text: summaryText(card) }
          if (navigator.canShare(payload)) {
            await navigator.share(payload)
          } else {
            await navigator.share({ files: [file] })
          }
          return
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return
          /* other errors (desktop Chrome throws NotAllowedError once the
             capture has outlived the click's transient activation) → download */
        }
      }
    }

    // Blob URL over a data: URL — a 1040px-wide PNG runs to several MB, which
    // some in-app WebViews refuse to download as a data: URL.
    const href = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    if (blob) setTimeout(() => URL.revokeObjectURL(href), 60_000)
  } finally {
    element.classList.remove('exporting')
    element.style.width = originalWidth
    element.style.maxWidth = originalMaxWidth
  }
}

function templateText(card: ShareCard): string {
  return t(card.locale, 'share.template', { name: card.name, magic: card.magic })
}

/** Intent URL builders — every network here must accept a plain URL share. */
const INTENT: Record<Exclude<SocialAction, 'copy'>, (card: ShareCard) => string> = {
  x: (card) =>
    `https://x.com/intent/post?text=${encodeURIComponent(templateText(card))}&url=${encodeURIComponent(shareUrl(card))}`,
  // Threads' intent takes the URL inside `text` — its separate `url` param is
  // newer and less reliably honored than X's.
  threads: (card) =>
    `https://www.threads.com/intent/post?text=${encodeURIComponent(`${templateText(card)}\n${shareUrl(card)}`)}`,
  weibo: (card) =>
    `https://service.weibo.com/share/share.php?url=${encodeURIComponent(shareUrl(card))}&title=${encodeURIComponent(templateText(card))}`,
  qq: (card) => {
    const summary = encodeURIComponent(card.magicText)
    return `https://connect.qq.com/widget/shareqq/index.html?url=${encodeURIComponent(shareUrl(card))}&title=${encodeURIComponent(templateText(card))}&desc=${summary}&summary=${summary}&site=${encodeURIComponent(t(card.locale, 'meta.siteName'))}`
  },
  // Facebook's sharer takes only the URL; the preview comes from OG meta.
  facebook: (card) =>
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl(card))}`,
  reddit: (card) =>
    `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl(card))}&title=${encodeURIComponent(templateText(card))}`,
  line: (card) =>
    `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl(card))}&text=${encodeURIComponent(templateText(card))}`,
}

export function openIntent(action: Exclude<SocialAction, 'copy'>, card: ShareCard): void {
  window.open(INTENT[action](card), '_blank', 'noopener,noreferrer')
}
