/*
 * Share module (design spec §D), ported from v1 `src/share.ts` with its
 * hard-won workarounds intact:
 *  - html2canvas dynamic import, scale:2, forced 520px capture width,
 *    document.fonts.ready await, an `exporting` class that kills
 *    animations/shadows/backdrop-filter during capture;
 *  - Web Share files+text fallback chain with AbortError silence, download
 *    fallback, clipboard execCommand fallback;
 *  - exact Weibo/QQ/X share URL templates; locale-gated channels;
 *  - QR (gold-on-ink) for the export footer so WeChat long-press works.
 * Share URL → /{locale}/r/{tag}/.
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

export type ShareChannel = 'save' | 'copy' | 'weibo' | 'qq' | 'x' | 'webshare'

/** Locale-gated channel order (Weibo/QQ for zh, X for others). */
export function shareChannelsFor(locale: Locale): ShareChannel[] {
  const isZh = locale === 'zh-CN' || locale === 'zh-TW'
  const social: ShareChannel[] = isZh ? ['weibo', 'qq'] : ['x']
  return ['save', 'copy', ...social, 'webshare']
}

export function shareUrl(card: ShareCard): string {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  return `${origin}${localePath(card.locale, `/r/${card.tag}/`)}`
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
  const text = summaryText(card)
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

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
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
  // Let layout settle at the forced width.
  await new Promise((r) => requestAnimationFrame(() => r(null)))

  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: '#0d0b10',
      useCORS: true,
      windowWidth: CAPTURE_WIDTH + 40,
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
          /* other errors → download fallback */
        }
      }
    }

    const dataUrl = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    element.classList.remove('exporting')
    element.style.width = originalWidth
    element.style.maxWidth = originalMaxWidth
  }
}

export function shareToWeibo(card: ShareCard): void {
  const text = encodeURIComponent(
    t(card.locale, 'share.template', { name: card.name, magic: card.magic }),
  )
  const url = encodeURIComponent(shareUrl(card))
  window.open(
    `https://service.weibo.com/share/share.php?url=${url}&title=${text}`,
    '_blank',
    'noopener,noreferrer',
  )
}

export function shareToQQ(card: ShareCard): void {
  const title = encodeURIComponent(
    t(card.locale, 'share.template', { name: card.name, magic: card.magic }),
  )
  const summary = encodeURIComponent(card.magicText)
  const url = encodeURIComponent(shareUrl(card))
  const site = encodeURIComponent(t(card.locale, 'meta.siteName'))
  window.open(
    `https://connect.qq.com/widget/shareqq/index.html?url=${url}&title=${title}&desc=${summary}&summary=${summary}&site=${site}`,
    '_blank',
    'noopener,noreferrer',
  )
}

export function shareToX(card: ShareCard): void {
  const text = encodeURIComponent(
    t(card.locale, 'share.template', { name: card.name, magic: card.magic }),
  )
  const url = encodeURIComponent(shareUrl(card))
  window.open(
    `https://x.com/intent/tweet?text=${text}&url=${url}`,
    '_blank',
    'noopener,noreferrer',
  )
}

/** Bare Web Share (text only) for the generic Share button. */
export async function webShare(card: ShareCard): Promise<void> {
  const data: ShareData = { text: summaryText(card), url: shareUrl(card) }
  try {
    if (navigator.share) await navigator.share(data)
    else await copySummary(card)
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return
    await copySummary(card)
  }
}
