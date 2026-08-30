import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { vaultPath } = vi.hoisted(() => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  return { vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), 'trek-obsidian-config-format-')) };
});

vi.mock('../../../src/config', () => ({
  OBSIDIAN_VAULT_PATH: vaultPath,
  OBSIDIAN_DAILY_NOTES_FOLDER: 'Configured Daily',
  OBSIDIAN_DAILY_NOTES_FORMAT: '',
}));

import { loadObsidianPublicHolidaysForYear } from '../../../src/nest/common/obsidianYearlyGlanceService';

const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

beforeAll(() => {
  const notePath = path.join(vaultPath, 'Configured Daily/2025-02-05.md');
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(notePath, '---\n假期: PTO\n---\n');
});

afterAll(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

describe('Obsidian format fallback', () => {
  it('does not treat a configured daily note as a planned leave row', () => {
    expect(loadObsidianPublicHolidaysForYear(2025)).toEqual([]);
  });
});
