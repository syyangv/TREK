import ReactDOM from 'react-dom'
import { Clock } from 'lucide-react'
import { TimeSlotFields } from './TimeSlotFields'
import type { Assignment } from '../../types'

export interface TimeSlotEditState {
  dayId: number
  assignmentId: number
  place_time: string
  end_time: string
}

interface DayPlanSidebarTimeSlotModalProps {
  timeSlotEdit: TimeSlotEditState | null
  setTimeSlotEdit: (v: TimeSlotEditState | null) => void
  dayAssignments: Assignment[]
  saveTimeSlot: (placeTime: string | null, endTime: string | null) => void
  isSaving: boolean
  t: (key: string, params?: Record<string, any>) => string
}

/** Compact Time Slot editor for one Assignment row — start and end only, never the
 *  full place editor. Both of its warnings stay warnings: Save is always available. */
export function DayPlanSidebarTimeSlotModal({ timeSlotEdit, setTimeSlotEdit, dayAssignments, saveTimeSlot, isSaving, t }: DayPlanSidebarTimeSlotModalProps) {
  if (!timeSlotEdit) return null
  const title = t('dayplan.timeSlot')
  return ReactDOM.createPortal(
    <div className="bg-[rgba(0,0,0,0.3)]" style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(3px)',
    }} onClick={() => setTimeSlotEdit(null)}>
      <div role="dialog" aria-label={title} className="bg-surface-card" style={{
        width: 340, borderRadius: 16,
        boxShadow: '0 16px 48px rgba(0,0,0,0.22)', padding: '22px 22px 18px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="bg-surface-hover" style={{
            width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%',
          }}>
            <Clock size={18} strokeWidth={1.8} color="var(--text-muted)" />
          </div>
          <div className="text-content" style={{ fontSize: 'calc(14px * var(--fs-scale-body, 1))', fontWeight: 600 }}>
            {title}
          </div>
        </div>
        <TimeSlotFields
          placeTime={timeSlotEdit.place_time}
          endTime={timeSlotEdit.end_time}
          onChange={(field, value) => setTimeSlotEdit({ ...timeSlotEdit, [field]: value })}
          assignmentId={timeSlotEdit.assignmentId}
          dayAssignments={dayAssignments}
          t={t}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={() => saveTimeSlot(null, null)} disabled={isSaving} className="text-content-muted" style={{
            fontSize: 'calc(12px * var(--fs-scale-body, 1))', background: 'none', border: '1px solid var(--border-primary)',
            borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', marginRight: 'auto',
          }}>{t('common.clear')}</button>
          <button onClick={() => setTimeSlotEdit(null)} className="text-content-muted" style={{
            fontSize: 'calc(12px * var(--fs-scale-body, 1))', background: 'none', border: '1px solid var(--border-primary)',
            borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit',
          }}>{t('common.cancel')}</button>
          <button
            onClick={() => saveTimeSlot(timeSlotEdit.place_time || null, timeSlotEdit.end_time || null)}
            disabled={isSaving}
            className="bg-accent text-accent-text"
            style={{
              fontSize: 'calc(12px * var(--fs-scale-body, 1))',
              border: 'none', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
            }}
          >{t('common.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
