import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../../../../../tests/helpers/render'
import { buildAssignment, buildPlace, buildReservation } from '../../../../../tests/helpers/factories'
import type { TranslationFn } from '../../../../types'
import { PlaceRow } from './MPlanTimelineRows'
import { UpNextCard } from './MPlanTimeline'
import type { MPlanTimelineController } from './useMPlanTimeline'

vi.mock('../../../../services/photoService', () => ({
  getCached: vi.fn(() => null),
  isLoading: vi.fn(() => false),
  fetchPhoto: vi.fn(),
  onThumbReady: vi.fn(() => () => {}),
}))

const t = ((key: string) => key) as TranslationFn

describe('MPlanTimelineRows — place time slots', () => {
  it('shows the complete time range and exposes the editor in travel mode', () => {
    const place = buildPlace({ name: 'Timed event', place_time: '09:00', end_time: '10:30' })
    const assignment = buildAssignment({
      day_id: 1,
      place,
      assignment_time: '09:00',
      assignment_end_time: '10:30',
    })
    const reservation = buildReservation({
      assignment_id: assignment.id,
      reservation_time: '2025-06-01T11:00',
      reservation_end_time: '2025-06-01T13:00',
    })
    const onTimeSlot = vi.fn()

    render(
      <PlaceRow
        assignment={assignment}
        fullPlace={place}
        linkedRes={reservation}
        chrome={{ editing: false, t, language: 'en', timeFormat: '24h' }}
        reorder={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onTimeSlot={onTimeSlot}
      />,
    )

    expect(screen.getByText('09:00 – 10:30')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'dayplan.timeSlot' }))
    expect(onTimeSlot).toHaveBeenCalledOnce()
  })

  it('uses the linked reservation instead of a shared place default when no assignment override exists', () => {
    const place = buildPlace({ name: 'Reserved event', place_time: '09:00', end_time: '10:00' })
    const assignment = buildAssignment({ day_id: 1, place, assignment_time: null, assignment_end_time: null })
    const reservation = buildReservation({
      assignment_id: assignment.id,
      reservation_time: '2025-06-01T15:00',
      reservation_end_time: '2025-06-01T16:00',
    })

    render(
      <PlaceRow
        assignment={assignment}
        fullPlace={place}
        linkedRes={reservation}
        chrome={{ editing: false, t, language: 'en', timeFormat: '24h' }}
        reorder={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('15:00 – 16:00')).toBeInTheDocument()
    expect(screen.queryByText('09:00 – 10:00')).not.toBeInTheDocument()
  })

  it('keeps an explicit assignment override ahead of the linked reservation', () => {
    const place = buildPlace({ name: 'Planned event', place_time: '12:00', end_time: '13:00' })
    const assignment = buildAssignment({
      day_id: 1,
      place,
      assignment_time: '12:00',
      assignment_end_time: '13:00',
    })
    const reservation = buildReservation({
      assignment_id: assignment.id,
      reservation_time: '2025-06-01T15:00',
      reservation_end_time: '2025-06-01T16:00',
    })

    render(
      <PlaceRow
        assignment={assignment}
        fullPlace={place}
        linkedRes={reservation}
        chrome={{ editing: false, t, language: 'en', timeFormat: '24h' }}
        reorder={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('12:00 – 13:00')).toBeInTheDocument()
    expect(screen.queryByText('15:00 – 16:00')).not.toBeInTheDocument()
  })

  it('shows the complete start/end range in the travel up-next summary', () => {
    const assignment = buildAssignment({
      day_id: 1,
      place: buildPlace({ name: 'Next event', place_time: '09:00', end_time: '10:30' }),
    })

    render(
      <UpNextCard
        tl={{
          upNext: { assignment, minutesUntil: null, linkedRes: null },
          language: 'en',
          timeFormat: '24h',
        } as MPlanTimelineController}
        t={t}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText('09:00 – 10:30')).toBeInTheDocument()
  })
})
