import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config', () => ({
  OBSIDIAN_VAULT_PATH: '',
  OBSIDIAN_DAILY_NOTES_FOLDER: '',
  OBSIDIAN_DAILY_NOTES_FORMAT: '',
}));

import {
  isObsidianPublicHolidaySourceAvailable,
  loadObsidianPublicHolidaysForYear,
} from '../../../src/nest/common/obsidianYearlyGlanceService';

describe('unconfigured Obsidian source', () => {
  it('stays unavailable and contributes no holidays', () => {
    expect(isObsidianPublicHolidaySourceAvailable()).toBe(false);
    expect(loadObsidianPublicHolidaysForYear(2025)).toEqual([]);
  });
});
