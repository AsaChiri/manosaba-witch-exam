/**
 * One-shot importer for the ORIGINAL GAME assets the site is licensed to use
 * (owner confirmation 2026-09-11 — see src/assets/game/ATTRIBUTION.md).
 *
 * Reads the AssetRipper export on the owner's machine and writes optimised,
 * committed copies into src/assets/game/. Scope is deliberately small (v1's
 * approach): two room backgrounds for the page atmosphere + OG plates, and the
 * 13 WitchBook profile portraits for the character OG. Nothing else from the
 * rip ships.
 *
 * Run: `npm run import:assets` (needs MANOSABA_ASSETS_DIR or the default path
 * below). The outputs are committed, so a normal clone never needs the rip.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const RIP = process.env.MANOSABA_ASSETS_DIR || 'D:/AssetRipper_win_x64/manosaba/Assets'
const OUT = join(ROOT, 'src/assets/game')
const BG_SRC = join(RIP, '#WitchTrials/Textures/Naninovel/Backgrounds/MainBackground/RGB')
const PROFILE_SRC = join(RIP, '#WitchTrials/Textures/General/NonPacked/WitchBook/Profiles')

/** Room backgrounds: site id → source file. court = the trial chamber
 *  (landing + root OG); wall = the red-panelled wall under the gallery
 *  (record pages + card/character OG). */
const ROOMS: Record<string, string> = {
  court: 'Background_013_001.png',
  wall: 'Background_014_001.png',
}
/** Character id (content/characters) → WitchBook profile file. */
const PROFILES: Record<string, string> = {
  alisa: 'Profile_Alisa.png',
  anan: 'Profile_AnAn.png',
  coco: 'Profile_Coco.png',
  ema: 'Profile_Ema.png',
  hanna: 'Profile_Hanna.png',
  hiro: 'Profile_Hiro.png',
  leia: 'Profile_Leia.png',
  margo: 'Profile_Margo.png',
  meruru: 'Profile_Meruru.png',
  miria: 'Profile_Miria.png',
  nanoka: 'Profile_Nanoka.png',
  noa: 'Profile_Noah.png',
  sherry: 'Profile_Sherry.png',
}

async function main() {
  mkdirSync(join(OUT, 'profiles'), { recursive: true })
  const lines: string[] = []
  for (const [id, file] of Object.entries(ROOMS)) {
    const src = join(BG_SRC, file)
    // desktop 1920w + mobile 960w, WebP. The page shows them at ≤40% opacity
    // under a blur, so q70 is invisible.
    for (const [suffix, width] of [['', 1920], ['-m', 960]] as const) {
      const out = join(OUT, `${id}${suffix}.webp`)
      const info = await sharp(src).resize({ width }).webp({ quality: 70 }).toFile(out)
      lines.push(`${id}${suffix}.webp ← ${file} (${info.width}×${info.height}, ${Math.round(info.size / 1024)} KB)`)
    }
  }
  for (const [id, file] of Object.entries(PROFILES)) {
    const src = join(PROFILE_SRC, file)
    // OG-only (build time): 512px, alpha kept so the plate's ring composites it.
    const out = join(OUT, 'profiles', `${id}.webp`)
    const info = await sharp(src).resize({ width: 512 }).webp({ quality: 82 }).toFile(out)
    lines.push(`profiles/${id}.webp ← ${file} (${Math.round(info.size / 1024)} KB)`)
  }
  writeFileSync(join(OUT, 'MANIFEST.txt'), lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

await main()
