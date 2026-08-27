import { afterAll, describe, expect, it, vi } from 'vitest';

const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

const { vaultPath } = vi.hoisted(() => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trek-obsidian-'));
  const pluginDir = path.join(root, '.obsidian/plugins/yearly-glance');
  const dailyDir = path.join(root, 'Daily/Yearly Glance');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'data.json'), JSON.stringify({
    config: {
      dailyNoteSource: 'periodic-notes',
    },
    data: {
      customEvents: [
        { text: 'future vacation', emoji: '✈️', duration: 3, dateArr: ['2025-12-20'] },
        { text: 'ordinary flight', emoji: '✈️', duration: 1, dateArr: ['2025-12-23'] },
        { text: 'unrelated concert', emoji: '🎤', duration: 1, dateArr: ['2025-12-24'] },
      ],
    },
  }));
  const periodicDir = path.join(root, '.obsidian/plugins/periodic-notes');
  fs.mkdirSync(periodicDir, { recursive: true });
  fs.writeFileSync(path.join(periodicDir, 'data.json'), JSON.stringify({
    daily: {
      folder: 'Daily/Yearly Glance',
      format: 'YYYY-MM-DD',
      enabled: true,
    },
  }));
  // The global Daily Notes location intentionally differs. This verifies that
  // Yearly Glance follows the root-level Periodic Notes daily configuration.
  fs.writeFileSync(path.join(root, '.obsidian/daily-notes.json'), JSON.stringify({
    folder: 'Daily/Other',
    format: 'YYYY-MM-DD',
  }));
  fs.writeFileSync(path.join(dailyDir, '2025-01-01.md'), '---\n假期: [[放假/公共假期]]\n---\n');
  fs.writeFileSync(path.join(dailyDir, '2025-05-01.md'), '---\n"假期": ["#放假/PTO"]\n---\n');
  fs.writeFileSync(path.join(dailyDir, '2025-05-02.md'), '---\n假期:\n  - 放假/病假\n---\n');
  fs.writeFileSync(path.join(dailyDir, '2025-05-03.md'), '---\n假期: false\n---\n');
  fs.writeFileSync(path.join(root, '请假计划.md'), [
    '| Date | Type | Note |',
    '| --- | --- | --- |',
    '| 2025-08-27 | PTO | planned |',
    '| 2025-09-07 | 公共假期 | holiday |',
    '| 2025-10-01 | Meeting | ignored |',
  ].join('\n'));
  return { vaultPath: root };
});

vi.mock('../../../src/config', () => ({
  OBSIDIAN_VAULT_PATH: vaultPath,
  OBSIDIAN_DAILY_NOTES_FOLDER: '',
  OBSIDIAN_DAILY_NOTES_FORMAT: '',
}));

import {
  getObsidianHolidayNotes,
  getObsidianPublicHolidayNote,
  isObsidianPublicHolidaySourceAvailable,
  loadObsidianPublicHolidaysForYear,
} from '../../../src/nest/common/obsidianYearlyGlanceService';

afterAll(() => require('node:fs').rmSync(vaultPath, { recursive: true, force: true }));

describe('loadObsidianPublicHolidaysForYear', () => {
  it('preserves each Yearly Glance 假期 category using root-level Periodic Notes settings', () => {
    expect(loadObsidianPublicHolidaysForYear(2025)).toEqual([
      { date: '2025-01-01', note: getObsidianPublicHolidayNote() },
      { date: '2025-05-01', note: 'Obsidian PTO' },
      { date: '2025-05-02', note: 'Obsidian 病假' },
      { date: '2025-08-27', note: 'Obsidian PTO' },
      { date: '2025-09-07', note: 'Obsidian 公共假期' },
      { date: '2025-12-20', note: 'Obsidian PTO' },
      { date: '2025-12-21', note: 'Obsidian PTO' },
      { date: '2025-12-22', note: 'Obsidian PTO' },
    ]);
    expect(getObsidianHolidayNotes()).toEqual([
      'Obsidian PTO',
      'Obsidian 病假',
      'Obsidian 公共假期',
    ]);
  });

  it('uses explicit Yearly Glance daily-note settings and parses a non-periodic note', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    const notePath = path.join(vaultPath, 'Daily/Explicit/2025/04/05.md');
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, '---\n假期:\n  - PTO\n  ignored: value\nother: value\n---\n');
    fs.writeFileSync(yearlyPath, JSON.stringify({
      config: {
        dailyNoteSource: 'daily-notes',
        dailyNoteFolder: 'Daily/Explicit',
        dailyNoteFormat: 'YYYY/MM/DD',
      },
      data: { customEvents: [] },
    }));

    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-04-05', note: 'Obsidian PTO' });
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
      fs.rmSync(path.join(vaultPath, 'Daily/Explicit'), { recursive: true, force: true });
    }
  });

  it('falls back to Obsidian Daily Notes settings and tolerates malformed frontmatter', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    const noteDir = path.join(vaultPath, 'Daily/Other');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(path.join(noteDir, '2025-03-06.md'), '---\n假期: [[放假/PTO]]\n---\n');
    fs.writeFileSync(path.join(noteDir, '2025-03-07.md'), '---\n假期: PTO\n');
    fs.writeFileSync(path.join(noteDir, '2025-03-08.md'), 'plain text');
    fs.writeFileSync(yearlyPath, JSON.stringify({ config: { dailyNoteSource: 'daily-notes' }, data: { customEvents: [] } }));

    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-03-06', note: 'Obsidian PTO' });
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
      fs.rmSync(noteDir, { recursive: true, force: true });
    }
  });

  it('reads nested Periodic Notes settings when the root daily section is absent', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const periodicPath = path.join(vaultPath, '.obsidian/plugins/periodic-notes/data.json');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    const originalPeriodic = fs.readFileSync(periodicPath, 'utf8');
    const noteDir = path.join(vaultPath, 'Daily/Nested');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(path.join(noteDir, '2025-06-01.md'), '---\n假期: 公共假期\n---\n');
    fs.writeFileSync(yearlyPath, JSON.stringify({ config: { dailyNoteSource: 'periodic-notes' }, data: { customEvents: [] } }));
    fs.writeFileSync(periodicPath, JSON.stringify({ settings: { daily: { folder: 'Daily/Nested', format: 'YYYY-MM-DD' } } }));

    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-06-01', note: 'Obsidian 公共假期' });
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
      fs.writeFileSync(periodicPath, originalPeriodic);
      fs.rmSync(noteDir, { recursive: true, force: true });
    }
  });

  it('maps only leave-related Yearly Glance UI events, expands dates, and skips malformed events', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    fs.writeFileSync(yearlyPath, JSON.stringify({
      config: { dailyNoteSource: 'daily-notes' },
      data: {
        customEvents: [
          null,
          { text: 'sick leave', dateArr: ['2025-06-01'] },
          { text: 'public holiday', eventDate: { isoDate: '2025-06-02' }, duration: 2 },
          { text: 'vacation', dateArr: ['2025-06-03', '2025-06-05'] },
          { text: 'vacation', dateArr: ['2024-12-31'], duration: 2 },
          { text: 'vacation', eventDate: { isoDate: '2025-06-10' }, duration: 0 },
          { text: 'PTO', dateArr: ['2025-06-11'] },
          { text: 'vacation', dateArr: [123], eventDate: { isoDate: 'not-a-date' } },
          { text: null, dateArr: ['2025-06-11'] },
        ],
      },
    }));

    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toEqual(expect.arrayContaining([
        { date: '2025-06-01', note: 'Obsidian 病假' },
        { date: '2025-06-02', note: 'Obsidian 公共假期' },
        { date: '2025-06-03', note: 'Obsidian PTO' },
        { date: '2025-06-05', note: 'Obsidian PTO' },
        { date: '2025-01-01', note: 'Obsidian PTO' },
        { date: '2025-06-10', note: 'Obsidian PTO' },
        { date: '2025-06-11', note: 'Obsidian PTO' },
      ]));
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
    }
  });

  it('handles malformed Yearly Glance JSON and a missing leave-plan file', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const leavePath = path.join(vaultPath, '请假计划.md');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    const originalLeave = fs.readFileSync(leavePath, 'utf8');
    fs.writeFileSync(yearlyPath, '{not-json');
    fs.unlinkSync(leavePath);

    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toEqual([]);
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
      fs.writeFileSync(leavePath, originalLeave);
    }
  });

  it('finds nested leave plans and rejects short or malformed tables', () => {
    const rootLeavePath = path.join(vaultPath, '请假计划.md');
    const nestedDir = path.join(vaultPath, 'Archive');
    const nestedLeavePath = path.join(nestedDir, '请假计划.md');
    const originalLeave = fs.readFileSync(rootLeavePath, 'utf8');
    fs.unlinkSync(rootLeavePath);
    fs.mkdirSync(nestedDir, { recursive: true });

    try {
      fs.writeFileSync(nestedLeavePath, [
        'metadata',
        '| Date | Type | Note |',
        '| --- | --- | --- |',
        '| 2025-11-01 | PTO | nested |',
      ].join('\n'));
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-11-01', note: 'Obsidian PTO' });

      fs.writeFileSync(nestedLeavePath, 'metadata\n| Date | Type | Note |\n');
      expect(loadObsidianPublicHolidaysForYear(2025)).not.toContainEqual({ date: '2025-11-01', note: 'Obsidian PTO' });

      fs.writeFileSync(nestedLeavePath, [
        '| Wrong | Headers |',
        '| --- | --- |',
        '| 2025-11-02 | PTO |',
      ].join('\n'));
      expect(loadObsidianPublicHolidaysForYear(2025)).not.toContainEqual({ date: '2025-11-02', note: 'Obsidian PTO' });

      fs.writeFileSync(nestedLeavePath, [
        '| Date | Type | Note |',
        '| --- | --- | --- |',
        '| 2025-11-03 |',
      ].join('\n'));
      expect(loadObsidianPublicHolidaysForYear(2025)).not.toContainEqual({ date: '2025-11-03', note: 'Obsidian PTO' });
    } finally {
      fs.writeFileSync(rootLeavePath, originalLeave);
      fs.rmSync(nestedDir, { recursive: true, force: true });
    }
  });

  it('uses default formats for incomplete Periodic Notes and Daily Notes settings', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const periodicPath = path.join(vaultPath, '.obsidian/plugins/periodic-notes/data.json');
    const dailyNotesPath = path.join(vaultPath, '.obsidian/daily-notes.json');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    const originalPeriodic = fs.readFileSync(periodicPath, 'utf8');
    const originalDailyNotes = fs.readFileSync(dailyNotesPath, 'utf8');
    const firstNote = path.join(vaultPath, '2025-11-05.md');
    const secondNote = path.join(vaultPath, '2025-11-06.md');
    fs.writeFileSync(yearlyPath, JSON.stringify({ config: { dailyNoteSource: 'periodic-notes' }, data: { customEvents: [] } }));

    try {
      fs.writeFileSync(periodicPath, JSON.stringify({ daily: {} }));
      fs.writeFileSync(firstNote, '---\n假期: 公共假期\n---\n');
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-11-05', note: 'Obsidian 公共假期' });

      fs.writeFileSync(periodicPath, JSON.stringify({ settings: {} }));
      fs.writeFileSync(dailyNotesPath, JSON.stringify({}));
      fs.writeFileSync(secondNote, '---\n假期: PTO\n---\n');
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-11-06', note: 'Obsidian PTO' });
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
      fs.writeFileSync(periodicPath, originalPeriodic);
      fs.writeFileSync(dailyNotesPath, originalDailyNotes);
      fs.rmSync(firstNote, { force: true });
      fs.rmSync(secondNote, { force: true });
    }
  });

  it('supports concise Yearly Glance settings and leap-year scanning', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    const notePath = path.join(vaultPath, 'Daily/Short/2025-11-07.md');
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, '---\n假期: 公共假期\n---\n');
    fs.writeFileSync(yearlyPath, JSON.stringify({
      config: { dailyNoteSource: 'daily-notes', folder: 'Daily/Short' },
      data: { customEvents: [] },
    }));

    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-11-07', note: 'Obsidian 公共假期' });
      expect(loadObsidianPublicHolidaysForYear(2024)).toEqual([]);
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
      fs.rmSync(path.join(vaultPath, 'Daily/Short'), { recursive: true, force: true });
    }
  });

  it('supports a concise format-only setting with the default empty folder', () => {
    const yearlyPath = path.join(vaultPath, '.obsidian/plugins/yearly-glance/data.json');
    const originalYearly = fs.readFileSync(yearlyPath, 'utf8');
    const notePath = path.join(vaultPath, '2025/11/08.md');
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, '---\n假期: PTO\n---\n');
    fs.writeFileSync(yearlyPath, JSON.stringify({
      config: { dailyNoteSource: 'daily-notes', format: 'YYYY/MM/DD' },
      data: { customEvents: [] },
    }));

    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toContainEqual({ date: '2025-11-08', note: 'Obsidian PTO' });
    } finally {
      fs.writeFileSync(yearlyPath, originalYearly);
      fs.rmSync(path.join(vaultPath, '2025'), { recursive: true, force: true });
    }
  });

  it('returns no leave-plan rows when recursive vault discovery throws', () => {
    const readdir = vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('vault closed');
    });
    try {
      expect(loadObsidianPublicHolidaysForYear(2025)).toEqual(expect.any(Array));
    } finally {
      readdir.mockRestore();
    }
  });

  it('reports whether the configured vault is a readable directory', () => {
    expect(isObsidianPublicHolidaySourceAvailable()).toBe(true);
    const stat = vi.spyOn(fs, 'statSync');
    stat.mockReturnValue({ isDirectory: () => false } as never);
    expect(isObsidianPublicHolidaySourceAvailable()).toBe(false);
    stat.mockImplementation(() => {
      throw new Error('stat failed');
    });
    expect(isObsidianPublicHolidaySourceAvailable()).toBe(false);
    stat.mockRestore();
  });
});
