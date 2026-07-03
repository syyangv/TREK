/**
 * Small pure helpers of the plugin module (#plugins): permission recognition and
 * the code/data path resolution (both the env-override and default branches).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isKnownPermission, METHOD_PERMISSION, KNOWN_METHODS } from '../../../src/nest/plugins/protocol/envelope';
import path from 'node:path';
import { pluginsCodeRoot, pluginsDataRoot, pluginCodeDir, pluginDbFile, resolveChildEntry } from '../../../src/nest/plugins/paths';

afterEach(() => {
  delete process.env.TREK_PLUGINS_DIR;
  delete process.env.TREK_PLUGINS_DATA_DIR;
});

describe('envelope helpers', () => {
  it('recognises known permissions, http:outbound:<host>, and rejects unknown', () => {
    expect(isKnownPermission('db:own')).toBe(true);
    expect(isKnownPermission('http:outbound')).toBe(true);
    expect(isKnownPermission('http:outbound:api.example.com')).toBe(true);
    expect(isKnownPermission('fs:read')).toBe(false);
    expect(isKnownPermission('')).toBe(false);
  });

  it('every known method maps to a permission', () => {
    for (const m of KNOWN_METHODS) {
      expect(METHOD_PERMISSION[m]).toBeTruthy();
    }
  });
});

describe('paths', () => {
  it('uses the env override when set', () => {
    process.env.TREK_PLUGINS_DIR = '/custom/code';
    process.env.TREK_PLUGINS_DATA_DIR = '/custom/data';
    expect(pluginsCodeRoot()).toBe('/custom/code');
    expect(pluginsDataRoot()).toBe('/custom/data');
    expect(pluginCodeDir('x')).toBe(path.join('/custom/code', 'x'));
    expect(path.basename(pluginDbFile('x'))).toBe('plugin.db');
  });

  it('falls back to the data-dir default when unset', () => {
    expect(pluginsCodeRoot()).toContain('plugins');
    expect(pluginsDataRoot()).toContain('plugins-data');
  });

  it('resolves a child entry with fork args', () => {
    const r = resolveChildEntry();
    expect(r.entry).toMatch(/plugin-host-entry\.(js|ts)$/);
    expect(Array.isArray(r.execArgv)).toBe(true);
  });
});
