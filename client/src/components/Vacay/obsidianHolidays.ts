export const OBSIDIAN_HOLIDAY_STYLES = {
  'Obsidian PTO': { color: '#f1c40f', labelKey: 'vacay.pto' },
  'Obsidian 病假': { color: '#e74c3c', labelKey: 'vacay.sickLeave' },
  'Obsidian 公共假期': { color: '#e67e22', labelKey: 'vacay.publicHoliday' },
} as const

export type ObsidianHolidayNote = keyof typeof OBSIDIAN_HOLIDAY_STYLES

export function isObsidianHolidayNote(note?: string): note is ObsidianHolidayNote {
  return !!note && Object.prototype.hasOwnProperty.call(OBSIDIAN_HOLIDAY_STYLES, note)
}
