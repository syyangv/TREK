import type { Assignment, AssignmentsMap, Day, Place } from '../types'

export interface ReservationLinkFields {
  title: string
  location: string
  reservation_time: string
  assignment_id: string | number
  place_id: string | number
}

function sameId(left: unknown, right: unknown): boolean {
  if (left == null || left === '' || right == null || right === '') return false
  return Number(left) === Number(right)
}

export function findReservationAssignment(
  assignments: AssignmentsMap | undefined,
  assignmentId: unknown,
): Assignment | null {
  if (assignmentId == null || assignmentId === '') return null
  for (const items of Object.values(assignments || {})) {
    const match = items.find(item => sameId(item.id, assignmentId))
    if (match) return match
  }
  return null
}

export function findReservationAssignmentForPlace(
  assignments: AssignmentsMap | undefined,
  dayId: unknown,
  placeId: unknown,
): Assignment | null {
  if (dayId == null || placeId == null || placeId === '') return null
  return (assignments?.[String(dayId)] || []).find(item => sameId(item.place_id ?? item.place?.id, placeId)) || null
}

function dayForDate(days: Day[] | undefined, value: string | undefined): Day | null {
  const date = (value || '').slice(0, 10)
  if (!date) return null
  return (days || []).find(day => (day.date || '').slice(0, 10) === date) || null
}

function dateForDay(days: Day[] | undefined, dayId: unknown): string {
  return (days || []).find(day => sameId(day.id, dayId))?.date?.slice(0, 10) || ''
}

function placeForAssignment(assignment: Assignment, places: Place[]): { name?: string; address?: string | null } | null {
  return places.find(place => sameId(place.id, assignment.place_id)) || assignment.place || null
}

/**
 * Selecting a day assignment makes that row authoritative for the booking's
 * place and day. Existing title/location text is intentionally preserved when
 * the user already typed it; the saved place address is only a useful default.
 */
export function selectReservationAssignment<T extends ReservationLinkFields>(
  form: T,
  assignmentId: string | number,
  assignments: AssignmentsMap | undefined,
  days: Day[] | undefined,
  places: Place[],
): T {
  const assignment = findReservationAssignment(assignments, assignmentId)
  if (!assignment) return { ...form, assignment_id: assignmentId || '' }

  const place = placeForAssignment(assignment, places)
  const date = dateForDay(days, assignment.day_id)
  const currentTime = form.reservation_time.includes('T')
    ? form.reservation_time.slice(form.reservation_time.indexOf('T') + 1)
    : ''

  return {
    ...form,
    assignment_id: assignment.id,
    place_id: assignment.place_id,
    title: form.title || place?.name || '',
    location: form.location || place?.address || '',
    reservation_time: date ? (currentTime ? `${date}T${currentTime}` : date) : form.reservation_time,
  }
}

/**
 * Selecting a place keeps an existing assignment only when it points at that
 * place. If the booking has an exact day, reuse that day's existing stop; the
 * server can create the stop when no matching row exists.
 */
export function selectReservationPlace<T extends ReservationLinkFields>(
  form: T,
  placeId: string | number,
  places: Place[],
  assignments: AssignmentsMap | undefined,
  days: Day[] | undefined,
): T {
  const place = places.find(item => sameId(item.id, placeId))
  if (!place) return { ...form, place_id: '', assignment_id: '' }

  const selectedDay = dayForDate(days, form.reservation_time)
  const currentAssignment = findReservationAssignment(assignments, form.assignment_id)
  const matchingAssignment = selectedDay
    ? findReservationAssignmentForPlace(assignments, selectedDay.id, place.id)
    : null

  return {
    ...form,
    place_id: place.id,
    assignment_id: currentAssignment && sameId(currentAssignment.place_id, place.id)
      ? currentAssignment.id
      : (matchingAssignment?.id || ''),
    title: form.title || place.name,
    location: form.location || place.address || '',
  }
}

/**
 * A manually changed date cannot leave an assignment pointing at yesterday's
 * day. Keep the place link, switch to an existing stop on the new day when one
 * exists, and otherwise clear the assignment so the normal create-stop offer
 * can handle it.
 */
export function selectReservationDate<T extends ReservationLinkFields>(
  form: T,
  date: string,
  assignments: AssignmentsMap | undefined,
  days: Day[] | undefined,
): T {
  const next = { ...form, reservation_time: date }
  const currentAssignment = findReservationAssignment(assignments, form.assignment_id)
  if (!currentAssignment || !date) return next

  const assignmentDate = dateForDay(days, currentAssignment.day_id)
  if (!assignmentDate || assignmentDate === date.slice(0, 10)) return next

  const selectedDay = dayForDate(days, date)
  const matchingAssignment = selectedDay
    ? findReservationAssignmentForPlace(assignments, selectedDay.id, form.place_id)
    : null
  return { ...next, assignment_id: matchingAssignment?.id || '' }
}
