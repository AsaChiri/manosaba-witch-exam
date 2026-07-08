/*
 * Aggregate telemetry (design spec §G). Four events, no user identifiers ever.
 * Transport: navigator.sendBeacon to PUBLIC_BEACON_URL when set; otherwise a
 * console.debug no-op in dev. The real Cloudflare Pages Function + KV lands in
 * Phase 6 — the client contract is frozen here.
 */
export type BeaconEvent =
  | { type: 'exam_start' }
  | { type: 'question_answered'; index: number }
  | { type: 'result_landed'; cell: string; tag: string }
  | { type: 'share_clicked'; channel: string }

function endpoint(): string | undefined {
  const url = import.meta.env.PUBLIC_BEACON_URL
  return url && url.length ? url : undefined
}

export function beacon(event: BeaconEvent): void {
  const payload = { ...event, t: Date.now() }
  const url = endpoint()
  if (!url) {
    if (import.meta.env.DEV) console.debug('[beacon:noop]', payload)
    return
  }
  try {
    const body = JSON.stringify(payload)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(url, blob)
    } else if (typeof fetch !== 'undefined') {
      void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
    }
  } catch {
    /* telemetry must never break the flow */
  }
}

export const examStart = () => beacon({ type: 'exam_start' })
export const questionAnswered = (index: number) => beacon({ type: 'question_answered', index })
export const resultLanded = (cell: string, tag: string) => beacon({ type: 'result_landed', cell, tag })
export const shareClicked = (channel: string) => beacon({ type: 'share_clicked', channel })
