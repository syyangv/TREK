export const OBSIDIAN_HOLIDAY_STYLES = {
  'Obsidian PTO': { color: '#f1c40f', labelKey: 'vacay.pto' },
  'Obsidian 病假': { color: '#e74c3c', labelKey: 'vacay.sickLeave' },
  'Obsidian 公共假期': { color: '#e67e22', labelKey: 'vacay.publicHoliday' },
} as const

export const MANUAL_COMPANY_HOLIDAY_COLOR = '#F5D9A6'

export type ObsidianHolidayNote = keyof typeof OBSIDIAN_HOLIDAY_STYLES

export function isObsidianHolidayNote(note?: string): note is ObsidianHolidayNote {
  return !!note && Object.prototype.hasOwnProperty.call(OBSIDIAN_HOLIDAY_STYLES, note)
}

export function companyHolidayColor(note?: string): string {
  return isObsidianHolidayNote(note) ? OBSIDIAN_HOLIDAY_STYLES[note].color : MANUAL_COMPANY_HOLIDAY_COLOR
}

export function countsTowardCompanyHolidayTotal(note?: string): boolean {
  return note !== 'Obsidian 病假'
}

// Half days (#552) make the allowance fractional; one decimal is enough and never drifts.
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** Days already planned over the annual total ("3/26"). The total is the allowance plus the public holidays; sick leave is in neither. */
export function vacationPlanLabel(companyHolidays: { note?: string }[], totalAvailable?: number): string {
  const planned = companyHolidays.filter(h => countsTowardCompanyHolidayTotal(h.note)).length
  if (totalAvailable === undefined) return String(planned)
  const publicHolidays = companyHolidays.filter(h => h.note === 'Obsidian 公共假期').length
  return `${planned}/${fmtDays(totalAvailable + publicHolidays)}`
}
