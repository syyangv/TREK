import { describe, expect, it } from 'vitest'
import type { AssignmentsMap, Day, Place } from '../types'
import {
  selectReservationAssignment,
  selectReservationDate,
  selectReservationPlace,
} from './reservationLinks'

const days = [
  { id: 11, date: '2026-05-01' },
  { id: 12, date: '2026-05-02' },
] as unknown as Day[]

const places = [
  { id: 101, name: 'Museum', address: 'Museum Road' },
  { id: 102, name: 'Cafe', address: 'Cafe Street' },
] as unknown as Place[]

const assignments = {
  '11': [{ id: 201, day_id: 11, place_id: 101, place: places[0], order_index: 0 }],
  '12': [{ id: 202, day_id: 12, place_id: 101, place: places[0], order_index: 0 }],
} as unknown as AssignmentsMap

const form = {
  title: '', location: '', reservation_time: '', assignment_id: '', place_id: '',
}

describe('reservation link synchronization', () => {
  it('assignment selection supplies the linked place, address, and day', () => {
    expect(selectReservationAssignment(form, 201, assignments, days, places)).toMatchObject({
      assignment_id: 201, place_id: 101, title: 'Museum', location: 'Museum Road', reservation_time: '2026-05-01',
    })
  })

  it('place selection reuses the stop on the booking day', () => {
    expect(selectReservationPlace({ ...form, reservation_time: '2026-05-02T19:00' }, 101, places, assignments, days))
      .toMatchObject({ place_id: 101, assignment_id: 202 })
  })

  it('changing the date clears an assignment from another day', () => {
    expect(selectReservationDate({ ...form, place_id: 101, assignment_id: 201 }, '2026-05-02', assignments, days))
      .toMatchObject({ reservation_time: '2026-05-02', assignment_id: 202 })
    expect(selectReservationDate({ ...form, place_id: 102, assignment_id: 201 }, '2026-05-02', assignments, days))
      .toMatchObject({ reservation_time: '2026-05-02', assignment_id: '' })
  })

  it('never overwrites a reservation-specific location override', () => {
    expect(selectReservationPlace({ ...form, location: 'Side entrance' }, 101, places, assignments, days).location)
      .toBe('Side entrance')
  })
})
