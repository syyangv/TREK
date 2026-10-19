import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

const { vaultPath, backupRoot } = vi.hoisted(() => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trek-plan-writer-'));
  fs.mkdirSync(path.join(root, '个人整理'), { recursive: true });
  return { vaultPath: path.join(root, 'vault'), backupRoot: path.join(root, 'backups') };
});

vi.mock('../../../src/config', () => ({
  OBSIDIAN_VAULT_PATH: vaultPath,
  OBSIDIAN_DAILY_NOTES_FOLDER: '',
  OBSIDIAN_DAILY_NOTES_FORMAT: '',
}));

import {
  insertPlanRow,
  isTodayOrLater,
  LeavePlanConflictError,
  ObsidianLeavePlanWriter,
  removePlanRows,
  TREK_PLAN_NOTE,
} from '../../../src/nest/common/obsidianLeavePlanWriter';

afterAll(() => fs.rmSync(path.dirname(vaultPath), { recursive: true, force: true }));

// The real file's shape: front matter, comments, a Meta Bind button, then an aligned table.
const PLAN = [
  '---',
  'modified_at: 2026-08-15',
  '---',
  '<!-- 请假计划（未来）。 -->',
  '<!-- Type 只能是: PTO | 病假 | 公共假期 -->',
  '',
  '`BUTTON[add-leave-plan]`',
  '',
  '| Date       | Type | Note            |',
  '| ---------- | ---- | --------------- |',
  '| 2026-06-19 | 公共假期 |                 |',
  '| 2026-12-15 | PTO  | Summer Flex 1/4 |',
  '| 2026-12-25 | PTO  |                 |',
  '',
].join('\n');

describe('insertPlanRow', () => {
  it('inserts in date order and leaves every other line byte-for-byte alone', () => {
    const { content, changed } = insertPlanRow(PLAN, { date: '2026-12-20', type: 'PTO', note: TREK_PLAN_NOTE });
    expect(changed).toBe(true);
    const lines = content.split('\n');
    expect(lines.indexOf('| 2026-12-20 | PTO | TREK |')).toBe(lines.indexOf('| 2026-12-15 | PTO  | Summer Flex 1/4 |') + 1);
    expect(content.replace('| 2026-12-20 | PTO | TREK |\n', '')).toBe(PLAN);
  });

  it('appends after the last row for the latest date and before the first row for the earliest', () => {
    const late = insertPlanRow(PLAN, { date: '2027-01-04', type: 'PTO', note: 'TREK' }).content.split('\n');
    expect(late[late.indexOf('| 2026-12-25 | PTO  |                 |') + 1]).toBe('| 2027-01-04 | PTO | TREK |');
    const early = insertPlanRow(PLAN, { date: '2026-01-02', type: 'PTO', note: 'TREK' }).content.split('\n');
    expect(early[early.indexOf('| ---------- | ---- | --------------- |') + 1]).toBe('| 2026-01-02 | PTO | TREK |');
  });

  it('is a no-op when the same date and type already exist, whatever the note says', () => {
    const result = insertPlanRow(PLAN, { date: '2026-12-15', type: 'PTO', note: 'TREK' });
    expect(result).toEqual({ content: PLAN, changed: false });
  });

  it('adds a second row for the same date when the type differs', () => {
    expect(insertPlanRow(PLAN, { date: '2026-12-15', type: '病假', note: 'TREK' }).changed).toBe(true);
  });

  it('refuses a file without a Date/Type table instead of inventing one', () => {
    expect(() => insertPlanRow('just some notes\n', { date: '2026-12-20', type: 'PTO', note: 'TREK' })).toThrow('leave_plan_table_not_found');
    expect(() => insertPlanRow('| Foo | Bar |\n| --- | --- |\n| a | b |\n', { date: '2026-12-20', type: 'PTO', note: 'TREK' })).toThrow('leave_plan_table_not_found');
  });

  it('keeps CRLF line endings', () => {
    const crlf = PLAN.replace(/\n/g, '\r\n');
    const out = insertPlanRow(crlf, { date: '2026-12-20', type: 'PTO', note: 'TREK' }).content;
    expect(out).toContain('| 2026-12-20 | PTO | TREK |\r\n');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('places cells by header position when the columns are in another order', () => {
    const reordered = '| Type | Note | Date |\n| --- | --- | --- |\n| PTO | x | 2026-12-15 |\n';
    const out = insertPlanRow(reordered, { date: '2026-12-20', type: 'PTO', note: 'TREK' }).content;
    expect(out).toContain('| PTO | TREK | 2026-12-20 |');
  });
});

describe('removePlanRows', () => {
  const withRows = insertPlanRow(
    insertPlanRow(PLAN, { date: '2026-12-15', type: '病假', note: 'TREK' }).content,
    { date: '2026-12-20', type: 'PTO', note: 'TREK' },
  ).content;

  it('removes only the row TREK wrote for that date and type', () => {
    const { content, changed } = removePlanRows(withRows, { date: '2026-12-20', type: 'PTO', note: 'TREK' });
    expect(changed).toBe(true);
    expect(content).not.toContain('2026-12-20');
    expect(content).toContain('Summer Flex 1/4');
  });

  it('never removes a row the user wrote, even for the same date and type', () => {
    const { content, changed } = removePlanRows(withRows, { date: '2026-12-15', type: 'PTO', note: 'TREK' });
    expect(changed).toBe(false);
    expect(content).toBe(withRows);
  });

  it('reports no change when nothing matches', () => {
    expect(removePlanRows(PLAN, { date: '2030-01-01', type: 'PTO', note: 'TREK' }).changed).toBe(false);
  });
});

describe('isTodayOrLater', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 18, 23, 30, 0)); });
  afterEach(() => vi.useRealTimers());

  it('counts today as plannable and yesterday as not, using the local date', () => {
    expect(isTodayOrLater('2026-10-18')).toBe(true);
    expect(isTodayOrLater('2026-10-19')).toBe(true);
    expect(isTodayOrLater('2026-10-17')).toBe(false);
  });
});

describe('ObsidianLeavePlanWriter', () => {
  class TestWriter extends ObsidianLeavePlanWriter {
    beforeReplaceHook: ((file: string) => void) | null = null;
    protected backupDir(): string { return backupRoot; }
    protected beforeReplace(file: string): void { this.beforeReplaceHook?.(file); }
  }
  const planFile = () => path.join(vaultPath, '个人整理', '请假计划.md');
  const tmpFiles = () => fs.readdirSync(path.join(vaultPath, '个人整理')).filter((f) => f.includes('.tmp'));

  beforeEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
    fs.rmSync(backupRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(vaultPath, '个人整理'), { recursive: true });
    fs.writeFileSync(planFile(), PLAN, { mode: 0o640 });
    vi.stubEnv('OBSIDIAN_VAULT_WRITE_ENABLED', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing unless writing is switched on', () => {
    vi.stubEnv('OBSIDIAN_VAULT_WRITE_ENABLED', '');
    expect(new TestWriter().upsertPlanned('2026-12-20')).toBe('skipped');
    vi.stubEnv('OBSIDIAN_VAULT_WRITE_ENABLED', 'false');
    expect(new TestWriter().upsertPlanned('2026-12-20')).toBe('skipped');
    expect(fs.readFileSync(planFile(), 'utf8')).toBe(PLAN);
  });

  it('adds a PTO row marked TREK, keeps the file mode, backs up the original and leaves no temp file', () => {
    expect(new TestWriter().upsertPlanned('2026-12-20')).toBe('added');
    expect(fs.readFileSync(planFile(), 'utf8')).toContain('| 2026-12-20 | PTO | TREK |');
    expect(fs.statSync(planFile()).mode & 0o777).toBe(0o640);
    expect(tmpFiles()).toEqual([]);
    const backups = fs.readdirSync(backupRoot);
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(backupRoot, backups[0]), 'utf8')).toBe(PLAN);
  });

  it('leaves the file untouched and writes no backup when the row already exists', () => {
    expect(new TestWriter().upsertPlanned('2026-12-15')).toBe('unchanged');
    expect(fs.readFileSync(planFile(), 'utf8')).toBe(PLAN);
    expect(fs.existsSync(backupRoot)).toBe(false);
  });

  it('removes only its own row', () => {
    const writer = new TestWriter();
    writer.upsertPlanned('2026-12-20');
    expect(writer.removePlanned('2026-12-20')).toBe('removed');
    expect(fs.readFileSync(planFile(), 'utf8')).toBe(PLAN);
    expect(writer.removePlanned('2026-12-15')).toBe('unchanged');
  });

  it('refuses to overwrite a file that changed after it was read, and cleans up', () => {
    const writer = new TestWriter();
    const concurrent = PLAN + '| 2026-12-30 | PTO | typed in Obsidian |\n';
    writer.beforeReplaceHook = (file) => fs.writeFileSync(file, concurrent);
    expect(() => writer.upsertPlanned('2026-12-20')).toThrow(LeavePlanConflictError);
    expect(fs.readFileSync(planFile(), 'utf8')).toBe(concurrent);
    expect(tmpFiles()).toEqual([]);
  });

  it('refuses a symlinked plan file', () => {
    const real = path.join(vaultPath, 'elsewhere.md');
    fs.renameSync(planFile(), real);
    fs.symlinkSync(real, planFile());
    expect(() => new TestWriter().upsertPlanned('2026-12-20')).toThrow();
    expect(fs.readFileSync(real, 'utf8')).toBe(PLAN);
  });

  it('refuses an oversized plan file', () => {
    fs.writeFileSync(planFile(), PLAN + 'x'.repeat(1_100_000));
    expect(() => new TestWriter().upsertPlanned('2026-12-20')).toThrow(/too_large/);
  });

  it('skips quietly when the vault has no plan file', () => {
    fs.rmSync(planFile());
    expect(new TestWriter().upsertPlanned('2026-12-20')).toBe('skipped');
  });

  it('keeps only the ten newest backups', () => {
    const writer = new TestWriter();
    for (let i = 1; i <= 12; i++) {
      const day = String(i).padStart(2, '0');
      writer.upsertPlanned(`2027-01-${day}`);
    }
    expect(fs.readdirSync(backupRoot)).toHaveLength(10);
  });
});
