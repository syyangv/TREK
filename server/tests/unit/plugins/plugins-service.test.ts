/**
 * The read-side plugin service + controller (#plugins, M0). Lists installed
 * plugins and reports whether the runtime is enabled (TREK_PLUGINS_ENABLED).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE plugins (
    id TEXT PRIMARY KEY, name TEXT, description TEXT, type TEXT, icon TEXT, version TEXT,
    status TEXT, reviewed_at TEXT, source_repo TEXT, sort_order INTEGER DEFAULT 0)`);
  return { testDb: db };
});
vi.mock('../../../src/db/database', () => ({ db: testDb }));

import { PluginsService } from '../../../src/nest/plugins/plugins.service';
import { PluginsController } from '../../../src/nest/plugins/plugins.controller';

beforeEach(() => {
  testDb.exec('DELETE FROM plugins');
  delete process.env.TREK_PLUGINS_ENABLED;
});
afterEach(() => {
  delete process.env.TREK_PLUGINS_ENABLED;
});

describe('PluginsService.list', () => {
  it('returns the installed plugins and the runtime-enabled flag', () => {
    testDb
      .prepare('INSERT INTO plugins (id, name, description, type, status, version) VALUES (?,?,?,?,?,?)')
      .run('flight', 'Flight', 'desc', 'widget', 'inactive', '1.0.0');
    process.env.TREK_PLUGINS_ENABLED = 'true';

    const out = new PluginsService().list();
    expect(out.enabled).toBe(true);
    expect(out.plugins).toHaveLength(1);
    expect(out.plugins[0]).toMatchObject({ id: 'flight', name: 'Flight', status: 'inactive' });
  });

  it('reports disabled when the kill switch is off (default)', () => {
    const out = new PluginsService().list();
    expect(out.enabled).toBe(false);
    expect(out.plugins).toEqual([]);
  });

  it('controller delegates to the service', () => {
    const svc = { list: vi.fn(() => ({ enabled: false, plugins: [] })) } as unknown as PluginsService;
    const res = new PluginsController(svc).list();
    expect(svc.list).toHaveBeenCalled();
    expect(res).toEqual({ enabled: false, plugins: [] });
  });
});
