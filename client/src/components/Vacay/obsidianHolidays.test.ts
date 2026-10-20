import { describe, expect, it } from 'vitest'
import { countsTowardCompanyHolidayTotal, isPlanFullError, leaveSummary, OBSIDIAN_HOLIDAY_STYLES, vacationPlanLabel } from './obsidianHolidays'

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

describe('leaveSummary', () => {
  const holidays = [
    { note: 'Obsidian PTO' },
    { note: 'Obsidian PTO' },
    { note: 'Obsidian 公共假期' },
    { note: 'Obsidian 病假' },
    { note: 'Obsidian 病假' },
    { note: undefined },
  ]

  it('counts public holidays, PTO and sick leave separately; a hand-entered company day is none of them', () => {
    expect(leaveSummary(holidays, 0)).toEqual({ publicHolidays: 1, pto: 2, sickLeave: 2 })
  })

  it('adds the PTO days logged by hand (half days included) to the Obsidian PTO', () => {
    expect(leaveSummary(holidays, 4.5)).toEqual({ publicHolidays: 1, pto: 6.5, sickLeave: 2 })
  })

  it('is all zeros with nothing planned', () => {
    expect(leaveSummary([], 0)).toEqual({ publicHolidays: 0, pto: 0, sickLeave: 0 })
  })
})

describe('isPlanFullError', () => {
  it('recognises the server refusing a day because planned days fill the allowance', () => {
    expect(isPlanFullError({ response: { status: 409, data: { code: 'plan_full', error: 'x' } } })).toBe(true)
  })

  it('ignores every other failure', () => {
    expect(isPlanFullError({ response: { status: 409, data: { code: 'other' } } })).toBe(false)
    expect(isPlanFullError({ response: { status: 500, data: {} } })).toBe(false)
    expect(isPlanFullError(new Error('network'))).toBe(false)
    expect(isPlanFullError(null)).toBe(false)
    expect(isPlanFullError('plan_full')).toBe(false)
  })
})
