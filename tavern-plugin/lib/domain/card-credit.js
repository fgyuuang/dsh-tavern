// Cards written by the card Agent say where they came from, in the creator notes
// every SillyTavern-compatible frontend shows. One credit per card; never repeated.
export const TAVERN_REPOSITORY_URL = 'https://github.com/flizzywine/dsh-tavern'

export function hasTavernCredit(notes) {
  return String(notes || '').includes(TAVERN_REPOSITORY_URL)
}

/** `action` is 创作 for a new card, 修改 for an existing one. */
export function withTavernCredit(notes, action) {
  const text = String(notes || '').trim()
  if (hasTavernCredit(text)) return text
  const credit = '本卡由 DSH Tavern ' + action + '：' + TAVERN_REPOSITORY_URL
  return text === '' ? credit : text + '\n\n' + credit
}
