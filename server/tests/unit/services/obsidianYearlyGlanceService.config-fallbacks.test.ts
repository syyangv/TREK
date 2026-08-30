import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { vaultPath } = vi.hoisted(() => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  return { vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), 'trek-obsidian-config-fallback-')) };
});

vi.mock('../../../src/config', () => ({
  OBSIDIAN_VAULT_PATH: vaultPath,
  OBSIDIAN_DAILY_NOTES_FOLDER: '',
  OBSIDIAN_DAILY_NOTES_FORMAT: 'YYYY-MM-DD',
}));

import { loadObsidianPublicHolidaysForYear } from '../../../src/nest/common/obsidianYearlyGlanceService';

const fs = require('node:fs') as typeof import('node:fs');

beforeAll(() => fs.writeFileSync(`${vaultPath}/2025-02-04.md`, '---\n假期: PTO\n---\n'));
afterAll(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

describe('Obsidian config fallbacks', () => {
  it('does not treat a daily note as a planned leave row', () => {
    expect(loadObsidianPublicHolidaysForYear(2025)).toEqual([]);
  });
});
