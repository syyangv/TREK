import { describe, expect, it } from 'vitest'
import { countsTowardCompanyHolidayTotal, OBSIDIAN_HOLIDAY_STYLES, vacationPlanLabel } from './obsidianHolidays'

describe('OBSIDIAN_HOLIDAY_STYLES', () => {
  it('matches the Obsidian Yearly Glance leave-category colors', () => {
    expect(OBSIDIAN_HOLIDAY_STYLES['Obsidian PTO'].color).toBe('#f1c40f')
    expect(OBSIDIAN_HOLIDAY_STYLES['Obsidian 病假'].color).toBe('#e74c3c')
    expect(OBSIDIAN_HOLIDAY_STYLES['Obsidian 公共假期'].color).toBe('#e67e22')
  })

  it('does not count sick leave as a company holiday', () => {
    expect(countsTowardCompanyHolidayTotal('Obsidian PTO')).toBe(true)
    expect(countsTowardCompanyHolidayTotal('Obsidian 公共假期')).toBe(true)
    expect(countsTowardCompanyHolidayTotal('Obsidian 病假')).toBe(false)
  })
})

describe('vacationPlanLabel', () => {
  const holidays = [
    { note: 'Obsidian PTO' },
    { note: 'Obsidian 公共假期' },
    { note: 'Obsidian 病假' },
    { note: undefined },
  ]

  it('shows planned days over the allowance as stored, with sick leave out of the planned count', () => {
    // planned: PTO + 公共假期 + the manual day = 3. The allowance already includes public holidays, so it is not topped up.
    expect(vacationPlanLabel(holidays, 25)).toBe('3/25')
  })

  it('falls back to the planned count alone while the allowance is unknown', () => {
    expect(vacationPlanLabel(holidays, undefined)).toBe('3')
  })

  it('prints a half-day allowance with one decimal', () => {
    expect(vacationPlanLabel([{ note: 'Obsidian PTO' }, { note: 'Obsidian 公共假期' }], 12)).toBe('2/12')
    expect(vacationPlanLabel([{ note: 'Obsidian PTO' }], 12.5)).toBe('1/12.5')
  })
})
