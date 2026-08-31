import { describe, expect, it } from 'vitest'
import { getTripRosterState, rosterHasCompanions } from './tripRosterState'

describe('tripRosterState', () => {
  it.each([
    [false, 0, 'loading'],
    [false, 2, 'loading'],
    [true, 0, 'solo'],
    [true, 1, 'solo'],
    [true, 2, 'collaborative'],
  ] as const)('classifies loaded=%s count=%s as %s', (loaded, count, expected) => {
    expect(getTripRosterState(loaded, count)).toBe(expected)
    expect(rosterHasCompanions(expected)).toBe(expected === 'collaborative')
  })
})
