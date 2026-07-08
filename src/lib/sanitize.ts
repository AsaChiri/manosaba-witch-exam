/*
 * Witch-name sanitizer (design spec §3.3). The name is carved into the record
 * and echoed into the shared PNG/OG, so it must be stripped of markup and
 * control characters, whitespace-collapsed, and length-capped.
 */
const MAX_NAME = 20

// Built from explicit code-point ranges so no literal control bytes live in
// source: C0/C1 controls + zero-width / bidi-override characters.
const STRIP = new RegExp(
  '[' +
    '\\u0000-\\u001F' +
    '\\u007F-\\u009F' +
    '\\u200B-\\u200F' +
    '\\u202A-\\u202E' +
    '\\u2060\\uFEFF' +
    ']',
  'gu',
)

export function sanitizeWitchName(raw: string): string {
  if (!raw) return ''
  let s = raw.normalize('NFC')
  // Strip anything that looks like a tag.
  s = s.replace(/<[^>]*>/g, '')
  // Remove control / zero-width / bidi characters.
  s = s.replace(STRIP, '')
  // Collapse all whitespace runs to a single space, trim ends.
  s = s.replace(/\s+/g, ' ').trim()
  // Cap length by code point so surrogate pairs are never split.
  const points = Array.from(s)
  if (points.length > MAX_NAME) s = points.slice(0, MAX_NAME).join('')
  return s
}

export const WITCH_NAME_MAX = MAX_NAME
