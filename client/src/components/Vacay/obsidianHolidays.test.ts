import { describe, expect, it } from 'vitest'
import { OBSIDIAN_HOLIDAY_STYLES } from './obsidianHolidays'

describe('OBSIDIAN_HOLIDAY_STYLES', () => {
  it('matches the Obsidian Yearly Glance leave-category colors', () => {
    expect(OBSIDIAN_HOLIDAY_STYLES['Obsidian PTO'].color).toBe('#f1c40f')
    expect(OBSIDIAN_HOLIDAY_STYLES['Obsidian 病假'].color).toBe('#e74c3c')
    expect(OBSIDIAN_HOLIDAY_STYLES['Obsidian 公共假期'].color).toBe('#e67e22')
  })
})
