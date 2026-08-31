import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { Day } from '../types';

export const PAST_DAY_EXPANSION_DEFAULT_VERSION = 'past-days-collapsed-v1';

export function isPastDay(day: Pick<Day, 'date'>): boolean {
  const date = day.date?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return date < todayDate;
}

interface UsePastDayExpansionOptions {
  tripId: number;
  days: Day[];
  initialExpandedDayIds?: Set<number> | null;
  onExpandedDaysChange?: (expandedDayIds: Set<number>) => void;
}

interface PastDayExpansionState {
  expandedDays: Set<number>;
  setExpandedDays: Dispatch<SetStateAction<Set<number>>>;
  setPersistedExpandedDays: Dispatch<SetStateAction<Set<number>>>;
}

/** Owns the versioned past-day collapse migration and persisted expansion set. */
export function usePastDayExpansion({
  tripId,
  days,
  initialExpandedDayIds,
  onExpandedDaysChange,
}: UsePastDayExpansionOptions): PastDayExpansionState {
  const defaultsAppliedRef = useRef(false);
  const expansionKey = `day-expanded-${tripId}`;
  const defaultsVersionKey = `day-expanded-defaults-${tripId}`;
  const [expandedDays, setExpandedDays] = useState<Set<number>>(() => {
    if (initialExpandedDayIds) {
      defaultsAppliedRef.current = true;
      return new Set(initialExpandedDayIds);
    }
    try {
      const saved = localStorage.getItem(expansionKey);
      const defaultsApplied = localStorage.getItem(defaultsVersionKey) === PAST_DAY_EXPANSION_DEFAULT_VERSION;
      if (defaultsApplied) {
        defaultsAppliedRef.current = true;
        if (saved) return new Set<number>(JSON.parse(saved) as number[]);
      } else if (saved) {
        const expanded = new Set<number>(JSON.parse(saved) as number[]);
        days.forEach((day) => {
          if (isPastDay(day)) expanded.delete(day.id);
        });
        return expanded;
      }
    } catch {}
    return new Set<number>(days.filter((day) => !isPastDay(day)).map((day) => day.id));
  });

  const persist = useCallback(
    (next: Set<number>) => {
      try {
        localStorage.setItem(expansionKey, JSON.stringify([...next]));
        localStorage.setItem(defaultsVersionKey, PAST_DAY_EXPANSION_DEFAULT_VERSION);
      } catch {}
      defaultsAppliedRef.current = true;
    },
    [defaultsVersionKey, expansionKey]
  );

  const setPersistedExpandedDays = useCallback(
    (next: SetStateAction<Set<number>>) => {
      setExpandedDays((previous) => {
        const resolved = typeof next === 'function' ? next(previous) : next;
        persist(resolved);
        return resolved;
      });
    },
    [persist]
  );

  useEffect(() => {
    onExpandedDaysChange?.(expandedDays);
  }, [expandedDays, onExpandedDaysChange]);

  const previousDayIdsRef = useRef(new Set(days.map((day) => day.id)));
  useEffect(() => {
    if (days.some((day) => !previousDayIdsRef.current.has(day.id))) {
      setExpandedDays((previous) => {
        const next = new Set(previous);
        days.forEach((day) => {
          if (!previousDayIdsRef.current.has(day.id) && !isPastDay(day)) next.add(day.id);
        });
        persist(next);
        return next;
      });
    } else if (!defaultsAppliedRef.current && days.length > 0) {
      setExpandedDays((previous) => {
        const next = new Set(previous);
        days.forEach((day) => {
          if (isPastDay(day)) next.delete(day.id);
        });
        persist(next);
        return next;
      });
    }
    previousDayIdsRef.current = new Set(days.map((day) => day.id));
  }, [days, persist]);

  return { expandedDays, setExpandedDays, setPersistedExpandedDays };
}
