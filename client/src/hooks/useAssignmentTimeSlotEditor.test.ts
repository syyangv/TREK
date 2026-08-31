import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assignmentsApi } from '../api/client'
import { useTripStore } from '../store/tripStore'
import { buildAssignment, buildPlace } from '../../tests/helpers/factories'
import { resetAllStores } from '../../tests/helpers/store'
import { useAssignmentTimeSlotEditor } from './useAssignmentTimeSlotEditor'

vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    assignmentsApi: { ...actual.assignmentsApi, updateTime: vi.fn() },
  }
})

describe('useAssignmentTimeSlotEditor', () => {
  beforeEach(() => {
    resetAllStores()
    vi.clearAllMocks()
  })

  it('saves the assignment override, reconciles effective values, and runs the refresh hook', async () => {
    vi.mocked(assignmentsApi.updateTime).mockResolvedValue({} as never)
    const assignment = buildAssignment({
      id: 12,
      day_id: 7,
      assignment_time: null,
      assignment_end_time: null,
      place: buildPlace({ id: 3, place_time: null, end_time: null }),
    })
    useTripStore.getState().setAssignments({ '7': [assignment] })
    const onSaved = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useAssignmentTimeSlotEditor({ tripId: 42, onSaved, onError }))

    act(() => result.current.setTimeSlotEdit({
      dayId: 7,
      assignmentId: 12,
      place_time: '',
      end_time: '',
    }))
    await act(() => result.current.saveTimeSlot('09:15', '10:45'))

    expect(assignmentsApi.updateTime).toHaveBeenCalledWith(42, 12, {
      place_time: '09:15',
      end_time: '10:45',
    })
    const saved = useTripStore.getState().assignments['7'][0]
    expect(saved).toMatchObject({ assignment_time: '09:15', assignment_end_time: '10:45' })
    expect(saved.place).toMatchObject({ place_time: '09:15', end_time: '10:45' })
    expect(onSaved).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.timeSlotEdit).toBeNull()
  })

  it('keeps the editor open and reports the error when the endpoint rejects', async () => {
    const error = new Error('locked')
    vi.mocked(assignmentsApi.updateTime).mockRejectedValue(error)
    const onError = vi.fn()
    const { result } = renderHook(() => useAssignmentTimeSlotEditor({ tripId: 42, onError }))
    const edit = { dayId: 7, assignmentId: 12, place_time: '09:00', end_time: '' }

    act(() => result.current.setTimeSlotEdit(edit))
    await act(() => result.current.saveTimeSlot('09:30', null))

    expect(onError).toHaveBeenCalledWith(error)
    expect(result.current.timeSlotEdit).toEqual(edit)
    await waitFor(() => expect(result.current.isSavingTimeSlot).toBe(false))
  })
})
