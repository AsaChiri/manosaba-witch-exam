/** Canonical source token used for the examined witch's proper name. */
export const WITCH_NAME_TOKEN = '{WITCH_NAME}'

/** Resolve every source-token occurrence for presentation without mutating content. */
export function resolveWitchName(text: string, witchName: string): string {
  return text.split(WITCH_NAME_TOKEN).join(witchName)
}
