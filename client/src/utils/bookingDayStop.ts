import type { Assignment, Day } from '../types'

export interface ResolvePendingStopDayInput {
  /** True when the booking already exists — edits can repair a missing stop too. */
  isEditing: boolean
  type: string
  placeId: number | string | null | undefined
  assignmentId: number | string | null | undefined
  /** Existing reservation day, useful when its time is date-less or legacy. */
  dayId?: number | string | null
  reservationTime: string | null | undefined
  days: Day[] | undefined
  assignments: { [dayId: string]: Assignment[] } | undefined
}

/**
 * Fork addition (docs/FORK_CUSTOMIZATIONS.md). Returns the trip day a booking's
 * linked place should also be scheduled on, or null when the offer doesn't apply.
 *
 * Planned state derives solely from day_assignments, so a booking that links a
 * place without a stop leaves that place filed as unplanned. Only an exact date
 * match qualifies — the server's nearest-day clamp is deliberately not mirrored,
 * so the offer never guesses a day on the user's behalf.
 *
 * Shared by the desktop ReservationModal and the mobile MReservationSheet so the
 * two surfaces cannot drift apart.
 */
export function resolvePendingStopDay({
  isEditing, type, placeId, assignmentId, dayId, reservationTime, days, assignments,
}: ResolvePendingStopDayInput): Day | null {
  // `isEditing` is retained in the input for callers that share this helper with
  // older forms. A legacy edit can be exactly the row that needs the repair.
  void isEditing
  if (type === 'hotel') return null
  if (!placeId || assignmentId) return null
  const date = (reservationTime || '').slice(0, 10)
  const day = date
    ? (days || []).find(d => (d.date || '').slice(0, 10) === date)
    : (days || []).find(d => String(d.id) === String(dayId))
  if (!day) return null
  const pid = Number(placeId)
  const already = (assignments?.[String(day.id)] || []).some(a => Number(a.place?.id ?? a.place_id) === pid)
  return already ? null : day
}
