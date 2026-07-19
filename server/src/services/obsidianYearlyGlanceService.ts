import fs from 'node:fs';
import path from 'node:path';
import {
  OBSIDIAN_DAILY_NOTES_FOLDER,
  OBSIDIAN_DAILY_NOTES_FORMAT,
  OBSIDIAN_VAULT_PATH,
} from '../config';

const YEARLY_GLANCE_DATA_PATH = '.obsidian/plugins/yearly-glance/data.json';
const DAILY_NOTES_DATA_PATH = '.obsidian/daily-notes.json';
const PERIODIC_NOTES_DATA_PATH = '.obsidian/plugins/periodic-notes/data.json';

const OBSIDIAN_HOLIDAY_NOTES = {
  PTO: 'Obsidian PTO',
  病假: 'Obsidian 病假',
  公共假期: 'Obsidian 公共假期',
} as const;

type DailyNoteSettings = {
  folder: string;
  format: string;
};

type ObsidianHoliday = {
  date: string;
  note: string;
};

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

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

function yearlyGlanceConfig(vaultPath: string): Record<string, unknown> | null {
  const data = asRecord(readJson(path.join(vaultPath, YEARLY_GLANCE_DATA_PATH)));
  return asRecord(data?.config);
}

function yearlyGlanceDailyNoteSettings(config: Record<string, unknown> | null): DailyNoteSettings | null {
  if (!config) return null;

  // Custom Yearly Glance builds can keep their own daily-note location instead
  // of delegating to Obsidian's Daily Notes or Periodic Notes plugin.  Honour
  // both the explicit names used by the plugin and the concise names used by
  // older custom configurations.
  const folder = getString(config, 'dailyNoteFolder') ?? getString(config, 'folder');
  const format = getString(config, 'dailyNoteFormat') ?? getString(config, 'format');
  return folder !== null || format !== null
    ? { folder: folder ?? '', format: format ?? 'YYYY-MM-DD' }
    : null;
}

function dailyNotesSettings(vaultPath: string, source: string, config: Record<string, unknown> | null): DailyNoteSettings | null {
  if (OBSIDIAN_DAILY_NOTES_FORMAT || OBSIDIAN_DAILY_NOTES_FOLDER) {
    return {
      format: OBSIDIAN_DAILY_NOTES_FORMAT || 'YYYY-MM-DD',
      folder: OBSIDIAN_DAILY_NOTES_FOLDER || '',
    };
  }

  const yearlyGlanceSettings = yearlyGlanceDailyNoteSettings(config);
  if (yearlyGlanceSettings) return yearlyGlanceSettings;

  if (source === 'periodic-notes') {
    const data = asRecord(readJson(path.join(vaultPath, PERIODIC_NOTES_DATA_PATH)));
    // Periodic Notes currently stores sections at the root (`daily`), while
    // older releases/custom builds nested them below `settings`.
    const daily = asRecord(data?.daily) ?? asRecord(asRecord(data?.settings)?.daily);
    if (daily) {
      return {
        format: getString(daily, 'format') ?? 'YYYY-MM-DD',
        folder: getString(daily, 'folder') ?? '',
      };
    }
  }

  const data = asRecord(readJson(path.join(vaultPath, DAILY_NOTES_DATA_PATH)));
  return {
    format: getString(data, 'format') ?? 'YYYY-MM-DD',
    folder: getString(data, 'folder') ?? '',
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDailyPath(date: Date, settings: DailyNoteSettings): string {
  const yyyy = String(date.getUTCFullYear());
  const yy = yyyy.slice(-2);
  const mm = pad(date.getUTCMonth() + 1);
  const m = String(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const d = String(date.getUTCDate());
  const formatted = settings.format
    .replace(/YYYY/g, yyyy)
    .replace(/YY/g, yy)
    .replace(/MM/g, mm)
    .replace(/M/g, m)
    .replace(/DD/g, dd)
    .replace(/D/g, d);
  const folder = settings.folder.replace(/^\/+|\/+$/g, '');
  return folder ? `${folder}/${formatted}.md` : `${formatted}.md`;
}

function frontmatterBlock(markdown: string): string | null {
  if (!markdown.startsWith('---')) return null;
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return null;
  return markdown.slice(3, end);
}

function stripYamlValue(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function parseJiaqiValues(markdown: string): string[] {
  const block = frontmatterBlock(markdown);
  if (!block) return [];

  const lines = block.split(/\r?\n/);
  const values: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:假期|['"]假期['"])\s*:\s*(.*)$/.exec(lines[i]);
    if (!match) continue;

    const inline = match[1].trim();
    if (inline.startsWith('[') && inline.endsWith(']') && !inline.startsWith('[[')) {
      values.push(...inline.slice(1, -1).split(',').map(stripYamlValue).filter(Boolean));
      continue;
    }
    if (inline) {
      values.push(stripYamlValue(inline));
      continue;
    }

    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*(.+)$/.exec(lines[j]);
      if (item) {
        values.push(stripYamlValue(item[1]));
        continue;
      }
      if (/^\S/.test(lines[j])) break;
    }
  }
  return values;
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

  const config = yearlyGlanceConfig(vaultPath);
  const source = getString(config, 'dailyNoteSource') ?? 'daily-notes';
  const settings = dailyNotesSettings(vaultPath, source, config);
  if (!settings) return [];

  const holidays: ObsidianHoliday[] = [];
  const start = Date.UTC(year, 0, 1);
  const days = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    const dateStr = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    const filePath = path.join(vaultPath, formatDailyPath(date, settings));
    let markdown: string;
    try {
      markdown = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const note = parseJiaqiValues(markdown)
      .map(holidayNoteForJiaqiValue)
      .find((value): value is string => value !== null);
    if (note) holidays.push({ date: dateStr, note });
  }

  return holidays;
}
