import { useCallback, useState } from 'react'

import { assignmentsApi } from '../api/client'
import type { TimeSlotEditState } from '../components/Planner/TimeSlotModal'
import { useTripStore } from '../store/tripStore'
import type { AssignmentsMap } from '../types'

interface Options {
  tripId: number
  onError: (error: unknown) => void
  onSaved?: () => void | Promise<void>
}

/** Shared assignment-time mutation lifecycle for desktop and mobile editors. */
export function useAssignmentTimeSlotEditor({ tripId, onError, onSaved }: Options) {
  const [timeSlotEdit, setTimeSlotEdit] = useState<TimeSlotEditState | null>(null)
  const [isSavingTimeSlot, setIsSavingTimeSlot] = useState(false)

  const saveTimeSlot = useCallback(async (placeTime: string | null, endTime: string | null) => {
    if (!timeSlotEdit || isSavingTimeSlot) return
    const { dayId, assignmentId } = timeSlotEdit
    setIsSavingTimeSlot(true)
    try {
      await assignmentsApi.updateTime(tripId, assignmentId, { place_time: placeTime, end_time: endTime })

      // Read at completion time so the save cannot overwrite unrelated store or
      // websocket changes that arrived while the request was in flight.
      const current = useTripStore.getState().assignments
      const key = String(dayId)
      if (current[key]) {
        const next: AssignmentsMap = {
          ...current,
          [key]: current[key].map(assignment => assignment.id === assignmentId
            ? {
                ...assignment,
                assignment_time: placeTime,
                assignment_end_time: endTime,
                place: assignment.place
                  ? { ...assignment.place, place_time: placeTime, end_time: endTime }
                  : assignment.place,
              }
            : assignment),
        }
        useTripStore.getState().setAssignments(next)
      }

      await onSaved?.()
      setTimeSlotEdit(null)
    } catch (error) {
      onError(error)
    } finally {
      setIsSavingTimeSlot(false)
    }
  }, [isSavingTimeSlot, onError, onSaved, timeSlotEdit, tripId])

  return { timeSlotEdit, setTimeSlotEdit, isSavingTimeSlot, saveTimeSlot }
}
