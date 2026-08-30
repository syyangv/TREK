import fs from 'node:fs';
import path from 'node:path';
import { OBSIDIAN_VAULT_PATH } from '../../config';

const LEAVE_PLAN_FILE_NAME = '请假计划.md';

const OBSIDIAN_HOLIDAY_NOTES = {
  PTO: 'Obsidian PTO',
  病假: 'Obsidian 病假',
  公共假期: 'Obsidian 公共假期',
} as const;

type ObsidianHoliday = {
  date: string;
  note: string;
};

function normalizeVaultPath(): string | null {
  if (!OBSIDIAN_VAULT_PATH) return null;
  const resolved = path.resolve(OBSIDIAN_VAULT_PATH);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}
function holidayNoteForJiaqiValue(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^#/, '')
    .trim();

  if (/^(?:放假\/)?pto$/i.test(normalized)) return OBSIDIAN_HOLIDAY_NOTES.PTO;
  if (/^(?:放假\/)?(?:病假|sick)$/i.test(normalized)) return OBSIDIAN_HOLIDAY_NOTES.病假;
  if (/^(?:放假\/)?(?:公共假期|public)$/i.test(normalized)) return OBSIDIAN_HOLIDAY_NOTES.公共假期;
  return null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? null;
}

function findFileByName(root: string, fileName: string): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.obsidian' || entry.name.startsWith('.trash')) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return entryPath;
    if (entry.isDirectory()) {
      const found = findFileByName(entryPath, fileName);
      if (found) return found;
    }
  }
  return null;
}

function leavePlanHolidays(vaultPath: string, year: number): ObsidianHoliday[] {
  let filePath: string | null;
  try {
    filePath = findFileByName(vaultPath, LEAVE_PLAN_FILE_NAME);
  } catch {
    return [];
  }
  if (!filePath) return [];

  const rows = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(line => line.trim().startsWith('|'));
  if (rows.length < 3) return [];
  const headers = rows[0].split('|').slice(1, -1).map(cell => cell.trim().toLowerCase());
  const dateIndex = headers.indexOf('date');
  const typeIndex = headers.indexOf('type');
  if (dateIndex < 0 || typeIndex < 0) return [];

  const holidays: ObsidianHoliday[] = [];
  for (const row of rows.slice(2)) {
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
    const date = isoDate(cells[dateIndex]);
    const note = holidayNoteForJiaqiValue(cells[typeIndex] ?? '');
    if (date?.startsWith(`${year}-`) && note) holidays.push({ date, note });
  }
  return holidays;
}

export function getObsidianPublicHolidayNote(): string {
  return OBSIDIAN_HOLIDAY_NOTES.公共假期;
}

export function getObsidianHolidayNotes(): string[] {
  return Object.values(OBSIDIAN_HOLIDAY_NOTES);
}

export function isObsidianPublicHolidaySourceAvailable(): boolean {
  return normalizeVaultPath() !== null;
}

export function loadObsidianPublicHolidaysForYear(year: number): ObsidianHoliday[] {
  const vaultPath = normalizeVaultPath();
  if (!vaultPath) return [];

  // The leave-plan table is the sole authoritative source.  Yearly Glance
  // custom events and daily-note text are not structured leave declarations,
  // so they must never be inferred as PTO, sick leave, or public holidays.
  return leavePlanHolidays(vaultPath, year).sort((a, b) => a.date.localeCompare(b.date));
}
