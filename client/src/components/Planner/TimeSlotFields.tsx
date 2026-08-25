import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import CustomTimePicker from '../shared/CustomTimePicker'
import type { Assignment } from '../../types'

/** End precedes start. A warning, never a block — the planner decides. */
export function isEndBeforeStart(placeTime: string, endTime: string): boolean {
  return !!placeTime && !!endTime && placeTime.length >= 5 && endTime.length >= 5 && endTime <= placeTime
}

/** Assignments on the same Day whose Time Slot overlaps the one being edited.
 *  Also a warning only: a deliberate overlap stays saveable. */
export function findTimeSlotCollisions(
  assignmentId: number | null,
  dayAssignments: Assignment[],
  placeTime: string,
  endTime: string,
): Assignment[] {
  if (!assignmentId || !placeTime || placeTime.length < 5) return []
  // Find the day_id for the current assignment
  const current = dayAssignments.find(a => a.id === assignmentId)
  if (!current) return []
  const myStart = placeTime
  const myEnd = endTime && endTime.length >= 5 ? endTime : null
  return dayAssignments.filter(a => {
    if (a.id === assignmentId) return false
    if (a.day_id !== current.day_id) return false
    const aStart = a.place?.place_time
    const aEnd = a.place?.end_time
    if (!aStart) return false
    // Check overlap: two intervals overlap if start < otherEnd AND otherStart < end
    const s1 = myStart, e1 = myEnd || myStart
    const s2 = aStart, e2 = aEnd || aStart
    return s1 < (e2 || '23:59') && s2 < (e1 || '23:59') && s1 !== e2 && s2 !== e1
  })
}

interface TimeSlotFieldsProps {
  placeTime: string
  endTime: string
  onChange: (field: 'place_time' | 'end_time', value: string) => void
  assignmentId: number | null
  dayAssignments: Assignment[]
  t: (key: string, params?: Record<string, string | number>) => string
}

/** The Time Slot editor — start, end, and their two warnings. Shared by the
 *  Assignment row editor in the Day Plan sidebar and the place modal, so the two
 *  cannot drift apart. */
export function TimeSlotFields({ placeTime, endTime, onChange, assignmentId, dayAssignments, t }: TimeSlotFieldsProps) {
  const collisions = useMemo(
    () => findTimeSlotCollisions(assignmentId, dayAssignments, placeTime, endTime),
    [assignmentId, dayAssignments, placeTime, endTime],
  )

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.startTime')}</label>
          <CustomTimePicker
            value={placeTime}
            onChange={v => onChange('place_time', v)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.endTime')}</label>
          <CustomTimePicker
            value={endTime}
            onChange={v => onChange('end_time', v)}
          />
        </div>
      </div>
      {isEndBeforeStart(placeTime, endTime) && (
        <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-warning, #fef3c7)', color: 'var(--text-warning, #92400e)' }}>
          <AlertTriangle size={13} className="shrink-0" />
          {t('places.endTimeBeforeStart')}
        </div>
      )}
      {collisions.length > 0 && (
        <div className="flex items-start gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-warning, #fef3c7)', color: 'var(--text-warning, #92400e)' }}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            {t('places.timeCollision')}{' '}
            {collisions.map(a => a.place?.name).filter(Boolean).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}
