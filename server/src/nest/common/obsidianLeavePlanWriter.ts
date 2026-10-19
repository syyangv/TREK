import fs from 'node:fs';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { readEnv } from '../../app-config';
import { OBSIDIAN_VAULT_PATH } from '../../config';

/**
 * Writes TREK-marked days into the Yearly Glance leave-plan table (请假计划.md).
 *
 * The plan file is the single source for planned leave; the Yearly Glance plugin
 * renders it and Obsidian Sync carries it to the other machines.  This is the only
 * vault write TREK makes, so it is narrow on purpose: it is off unless
 * OBSIDIAN_VAULT_WRITE_ENABLED is set, touches one file, only adds/removes the
 * single `| Date | Type | Note |` row it owns (Note = "TREK"), and replaces the
 * file atomically after re-checking that nobody changed it since it was read.
 */

const LEAVE_PLAN_FILE_NAME = '请假计划.md';
const MAX_PLAN_BYTES = 1_000_000;
const BACKUPS_KEPT = 10;
const ROW_RE = /^\s*\|(.*)\|\s*$/;
const DIVIDER_RE = /^\s*\|[\s:|-]+\|\s*$/;

export const TREK_PLAN_NOTE = 'TREK';
export type PlannedLeaveType = 'PTO' | '病假' | '公共假期';
export interface PlanRowSpec { date: string; type: PlannedLeaveType; note: string }
export type PlanWriteResult = 'added' | 'removed' | 'unchanged' | 'skipped';

export class LeavePlanConflictError extends Error {
  constructor() {
    super('leave_plan_changed_during_write');
    this.name = 'LeavePlanConflictError';
  }
}

interface TableLayout { headerIndex: number; dividerIndex: number; columns: { date: number; type: number; note: number }; width: number }

function splitCells(line: string): string[] {
  const match = ROW_RE.exec(line);
  return match ? match[1].split('|').map((cell) => cell.trim()) : [];
}

function findTable(lines: string[]): TableLayout | null {
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!ROW_RE.test(lines[i]) || !DIVIDER_RE.test(lines[i + 1])) continue;
    const header = splitCells(lines[i]).map((cell) => cell.toLowerCase());
    const date = header.indexOf('date');
    const type = header.indexOf('type');
    const note = header.indexOf('note');
    if (date >= 0 && type >= 0) return { headerIndex: i, dividerIndex: i + 1, columns: { date, type, note }, width: header.length };
  }
  return null;
}

/** Rows of the table body, by line index. Stops at the first line that is not a table row. */
function bodyRows(lines: string[], table: TableLayout): { index: number; date: string; type: string; note: string }[] {
  const rows: { index: number; date: string; type: string; note: string }[] = [];
  for (let i = table.dividerIndex + 1; i < lines.length && ROW_RE.test(lines[i]); i++) {
    const cells = splitCells(lines[i]);
    rows.push({ index: i, date: cells[table.columns.date] ?? '', type: cells[table.columns.type] ?? '', note: table.columns.note >= 0 ? (cells[table.columns.note] ?? '') : '' });
  }
  return rows;
}

function renderRow(table: TableLayout, spec: PlanRowSpec): string {
  const cells = new Array<string>(table.width).fill('');
  cells[table.columns.date] = spec.date;
  cells[table.columns.type] = spec.type;
  if (table.columns.note >= 0) cells[table.columns.note] = spec.note;
  return `| ${cells.join(' | ')} |`;
}

function splitLines(content: string): { lines: string[]; eol: string } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return { lines: content.split(/\r?\n/), eol };
}

/** Adds one row in date order; every other line is returned exactly as it was. */
export function insertPlanRow(content: string, spec: PlanRowSpec): { content: string; changed: boolean } {
  const { lines, eol } = splitLines(content);
  const table = findTable(lines);
  if (!table) throw new Error('leave_plan_table_not_found');
  const rows = bodyRows(lines, table);
  if (rows.some((row) => row.date === spec.date && row.type === spec.type)) return { content, changed: false };
  const after = rows.filter((row) => row.date <= spec.date).pop();
  const insertAt = after ? after.index + 1 : table.dividerIndex + 1;
  lines.splice(insertAt, 0, renderRow(table, spec));
  return { content: lines.join(eol), changed: true };
}

/** Removes the row only if it is the one TREK wrote (matching note); user rows are never touched. */
export function removePlanRows(content: string, spec: PlanRowSpec): { content: string; changed: boolean } {
  const { lines, eol } = splitLines(content);
  const table = findTable(lines);
  if (!table) return { content, changed: false };
  const doomed = bodyRows(lines, table).filter((row) => row.date === spec.date && row.type === spec.type && row.note === spec.note);
  if (doomed.length === 0) return { content, changed: false };
  for (const row of doomed.reverse()) lines.splice(row.index, 1);
  return { content: lines.join(eol), changed: true };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local-date comparison; the plan file only holds today and later (earlier days live in the daily note). */
export function isTodayOrLater(date: string): boolean {
  const now = new Date();
  return date >= `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function findPlanFile(vault: string): string | null {
  const stack = [vault];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === LEAVE_PLAN_FILE_NAME) return full;
    }
  }
  return null;
}

@Injectable()
export class ObsidianLeavePlanWriter {
  private readonly logger = new Logger(ObsidianLeavePlanWriter.name);

  isEnabled(): boolean {
    return /^(true|1|on|yes)$/i.test(readEnv().obsidian.vaultWriteEnabled) && OBSIDIAN_VAULT_PATH !== '';
  }

  upsertPlanned(date: string, type: PlannedLeaveType = 'PTO'): PlanWriteResult {
    return this.apply(date, (content) => insertPlanRow(content, { date, type, note: TREK_PLAN_NOTE }), 'added');
  }

  removePlanned(date: string, type: PlannedLeaveType = 'PTO'): PlanWriteResult {
    return this.apply(date, (content) => removePlanRows(content, { date, type, note: TREK_PLAN_NOTE }), 'removed');
  }

  /** Where recovery copies go; must be outside the vault. */
  protected backupDir(): string {
    return path.resolve(__dirname, '../../../data/leave-plan-backups');
  }

  /** Seam for tests: runs after the new content is staged, before the final check and rename. */
  protected beforeReplace(_file: string): void {}

  private apply(date: string, edit: (content: string) => { content: string; changed: boolean }, done: 'added' | 'removed'): PlanWriteResult {
    if (!this.isEnabled()) return 'skipped';
    const vault = fs.realpathSync(OBSIDIAN_VAULT_PATH);
    const file = findPlanFile(vault);
    if (!file) return 'skipped';
    const backups = path.resolve(this.backupDir());
    if (backups === vault || backups.startsWith(vault + path.sep)) throw new Error('leave_plan_backup_dir_inside_vault');

    const before = fs.lstatSync(file);
    if (!before.isFile()) throw new Error('leave_plan_not_regular_file');
    if (before.size > MAX_PLAN_BYTES) throw new Error('leave_plan_too_large');
    const original = fs.readFileSync(file, 'utf8');
    const { content, changed } = edit(original);
    if (!changed) return 'unchanged';

    fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
    const backup = path.join(backups, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${LEAVE_PLAN_FILE_NAME}`);
    fs.writeFileSync(backup, original, { mode: 0o600 });

    const tmp = path.join(path.dirname(file), `.${LEAVE_PLAN_FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
    try {
      const fd = fs.openSync(tmp, 'wx', before.mode & 0o777);
      try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.beforeReplace(file);
      // The file may have been edited (by the user or Obsidian Sync) since we read it: keep their version.
      if (fs.readFileSync(file, 'utf8') !== original) throw new LeavePlanConflictError();
      fs.renameSync(tmp, file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    this.pruneBackups(backups);
    this.logger.log(`leave plan ${done} ${date}`);
    return done;
  }

  private pruneBackups(dir: string): void {
    const all = fs.readdirSync(dir).filter((name) => name.endsWith(LEAVE_PLAN_FILE_NAME)).sort();
    for (const stale of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) fs.rmSync(path.join(dir, stale), { force: true });
  }
}
