import fs from 'node:fs';
import path from 'node:path';

/**
 * Filesystem layout for the plugin system (#plugins). Code and data are two
 * separate trees so the child can be given a read-only view of its code and a
 * read-write view of only its own data (M1 sets the env; the container runtime
 * in v2 enforces the mounts).
 *
 * Defaults sit under the persisted data dir (server/data), overridable by env
 * so a Docker deployment can point them at dedicated volumes.
 */

const DATA_ROOT = path.resolve(__dirname, '../../../data');

// Read lazily so a deployment (or a test) can point these at dedicated volumes
// via env without import-order surprises.
export function pluginsCodeRoot(): string {
  return process.env.TREK_PLUGINS_DIR || path.join(DATA_ROOT, 'plugins');
}
export function pluginsDataRoot(): string {
  return process.env.TREK_PLUGINS_DATA_DIR || path.join(DATA_ROOT, 'plugins-data');
}

/** A plugin's installed code directory (contains trek-plugin.json + server/index.js). */
export function pluginCodeDir(id: string): string {
  return path.join(pluginsCodeRoot(), id);
}

/** A plugin's writable data directory (its own sqlite file + any blobs). */
export function pluginDataDir(id: string): string {
  return path.join(pluginsDataRoot(), id);
}

/** The plugin's own sqlite file — opened by the HOST, reached by the plugin only via RPC. */
export function pluginDbFile(id: string): string {
  return path.join(pluginDataDir(id), 'plugin.db');
}

/**
 * The child bootstrap entry + the execArgv to fork it with.
 *
 * Prod/dev run the tsc output, so the sibling `runtime/plugin-host-entry.js`
 * exists and forks as plain node. Under vitest the code runs from `src` as TS,
 * so no `.js` sibling exists — fall back to the `.ts` source loaded via tsx (a
 * prod dependency). This keeps the fork path identical in tests and production.
 */
export function resolveChildEntry(): { entry: string; execArgv: string[]; forkCwd?: string } {
  const js = path.join(__dirname, 'runtime', 'plugin-host-entry.js');
  const ts = path.join(__dirname, 'runtime', 'plugin-host-entry.ts');
  if (!fs.existsSync(js) && fs.existsSync(ts)) {
    // tsx (dev/test only) is resolved relative to the child's cwd, so the child
    // must run from a dir where `tsx` is on the node_modules chain (the server
    // root) — NOT the plugin dir. The plugin itself is still loaded by absolute
    // path via createRequire, so this doesn't weaken the prod isolation, where
    // the .js branch below keeps cwd at the plugin dir.
    return { entry: ts, execArgv: ['--import', 'tsx'], forkCwd: process.cwd() };
  }
  return { entry: js, execArgv: ['--max-old-space-size=192'] };
}
