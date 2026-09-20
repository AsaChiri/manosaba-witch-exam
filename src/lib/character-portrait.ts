/*
 * The 13 WitchBook profile portraits (src/assets/game/profiles/<id>.webp —
 * game assets, see src/assets/game/ATTRIBUTION.md), resolved to their hashed
 * URLs by Vite so the same lookup serves the Astro /c/ page, the Vue result
 * view and nothing else. A character without a portrait simply gets none
 * (the record renders as before).
 */
const PORTRAITS = import.meta.glob('../assets/game/profiles/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export function characterPortraitUrl(id: string): string | null {
  return PORTRAITS[`../assets/game/profiles/${id}.webp`] ?? null
}
