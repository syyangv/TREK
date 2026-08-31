import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Day } from '../types';
import { PAST_DAY_EXPANSION_DEFAULT_VERSION, usePastDayExpansion } from './usePastDayExpansion';

const day = (id: number, date: string): Day => ({ id, date }) as Day;

const pastDay = day(10, '2020-01-01');
const futureDay = day(11, '2099-01-01');

describe('usePastDayExpansion', () => {
  beforeEach(() => localStorage.clear());

  it('migrates a legacy saved set once by collapsing past days', () => {
    localStorage.setItem('day-expanded-7', JSON.stringify([10, 11]));

    const { result } = renderHook(() =>
      usePastDayExpansion({
        tripId: 7,
        days: [pastDay, futureDay],
      })
    );

    expect([...result.current.expandedDays]).toEqual([11]);
    expect(JSON.parse(localStorage.getItem('day-expanded-7')!)).toEqual([11]);
    expect(localStorage.getItem('day-expanded-defaults-7')).toBe(PAST_DAY_EXPANSION_DEFAULT_VERSION);
  });

  it('preserves a synchronized parent snapshot without rerunning migration', () => {
    const onExpandedDaysChange = vi.fn();
    const { result } = renderHook(() =>
      usePastDayExpansion({
        tripId: 7,
        days: [pastDay, futureDay],
        initialExpandedDayIds: new Set([10]),
        onExpandedDaysChange,
      })
    );

    expect([...result.current.expandedDays]).toEqual([10]);
    expect(localStorage.getItem('day-expanded-7')).toBeNull();
    expect(onExpandedDaysChange).toHaveBeenCalledWith(new Set([10]));
  });

  it('persists explicit changes and auto-expands only newly added future days', () => {
    const { result, rerender } = renderHook(({ days }) => usePastDayExpansion({ tripId: 7, days }), {
      initialProps: { days: [futureDay] },
    });

    act(() => result.current.setPersistedExpandedDays(new Set()));
    expect(JSON.parse(localStorage.getItem('day-expanded-7')!)).toEqual([]);

    rerender({ days: [futureDay, pastDay, day(12, '2099-01-02')] });

    expect([...result.current.expandedDays]).toEqual([12]);
    expect(JSON.parse(localStorage.getItem('day-expanded-7')!)).toEqual([12]);
  });
});
