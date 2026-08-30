import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../../../../../tests/helpers/render'
import { buildAssignment, buildPlace } from '../../../../../tests/helpers/factories'
import type { TranslationFn } from '../../../../types'
import { PlaceRow } from './MPlanTimelineRows'

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
    const assignment = buildAssignment({ day_id: 1, place })
    const onTimeSlot = vi.fn()

    render(
      <PlaceRow
        assignment={assignment}
        fullPlace={place}
        linkedRes={null}
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
})
