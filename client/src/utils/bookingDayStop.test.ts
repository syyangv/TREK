import { describe, expect, it } from 'vitest'
import { resolvePendingStopDay } from './bookingDayStop'
import type { Assignment, Day } from '../types'

// FE-UTIL-BOOKDAY-001 to 009

const DAYS = [
  { id: 11, day_number: 1, date: '2026-05-01', title: null },
  { id: 12, day_number: 2, date: '2026-05-02', title: 'Museum day' },
] as unknown as Day[]

const base = {
  isEditing: false,
  type: 'event',
  placeId: 102 as number | string | null,
  assignmentId: null as number | string | null,
  reservationTime: '2026-05-02T19:30',
  days: DAYS,
  assignments: {} as { [dayId: string]: Assignment[] },
}

const stop = (placeId: number) => ({ 12: [{ id: 900, order_index: 0, place: { id: placeId } }] } as unknown as { [dayId: string]: Assignment[] })

describe('resolvePendingStopDay', () => {
  it('FE-UTIL-BOOKDAY-001: returns the day whose date matches the booking', () => {
    expect(resolvePendingStopDay(base)?.id).toBe(12)
  })

  it('FE-UTIL-BOOKDAY-002: an edit can offer to repair a missing day stop', () => {
    expect(resolvePendingStopDay({ ...base, isEditing: true })?.id).toBe(12)
  })

  it('FE-UTIL-BOOKDAY-003: no offer for hotels — they carry an accommodation instead', () => {
    expect(resolvePendingStopDay({ ...base, type: 'hotel' })).toBeNull()
  })

  it('FE-UTIL-BOOKDAY-004: no offer without a linked place', () => {
    expect(resolvePendingStopDay({ ...base, placeId: '' })).toBeNull()
  })

  it('FE-UTIL-BOOKDAY-005: an explicit assignment already wins', () => {
    expect(resolvePendingStopDay({ ...base, assignmentId: 7 })).toBeNull()
  })

  it('FE-UTIL-BOOKDAY-006: no offer without a date', () => {
    expect(resolvePendingStopDay({ ...base, reservationTime: '' })).toBeNull()
  })

  it('FE-UTIL-BOOKDAY-007: only an exact date match counts — never the nearest day', () => {
    expect(resolvePendingStopDay({ ...base, reservationTime: '2026-06-20T10:00' })).toBeNull()
  })

  it('FE-UTIL-BOOKDAY-008: no offer when the place is already a stop on that day', () => {
    expect(resolvePendingStopDay({ ...base, assignments: stop(102) })).toBeNull()
  })

  it('FE-UTIL-BOOKDAY-009: a different place on that day does not suppress the offer', () => {
    expect(resolvePendingStopDay({ ...base, assignments: stop(999) })?.id).toBe(12)
  })

  it('FE-UTIL-BOOKDAY-010: matches a day whose date carries a time component', () => {
    const days = [{ id: 12, day_number: 2, date: '2026-05-02T00:00:00Z', title: null }] as unknown as Day[]
    expect(resolvePendingStopDay({ ...base, days })?.id).toBe(12)
  })

  it('FE-UTIL-BOOKDAY-011: compares place ids across string/number forms', () => {
    expect(resolvePendingStopDay({ ...base, placeId: '102', assignments: stop(102) })).toBeNull()
  })

  it('FE-UTIL-BOOKDAY-012: an existing day id works when the booking has no timestamp', () => {
    expect(resolvePendingStopDay({ ...base, reservationTime: '', dayId: 11 })?.id).toBe(11)
  })
})
