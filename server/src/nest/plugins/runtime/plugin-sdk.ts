/**
 * The plugin-author-facing SDK surface (#plugins, M1) — the minimal in-repo
 * version. The published `@trek/plugin-sdk` (M6) will re-export these types; for
 * now the runtime ships its own copy so the child has zero external deps.
 *
 * PURE — no server imports. This runs inside the isolated child. Every ctx
 * method is plumbing that turns a call into an RPC message to the host; the
 * child holds no db handle, no secrets, no network by default.
 */

export interface PluginContext {
  readonly id: string;
  readonly config: Readonly<Record<string, unknown>>;
  db: {
    query<T = unknown>(sql: string, ...args: unknown[]): Promise<T[]>;
    exec(sql: string, ...args: unknown[]): Promise<{ changes: number }>;
    migrate(id: string, sql: string): Promise<{ applied: boolean }>;
  };
  trips: {
    getById(tripId: number, asUserId: number): Promise<unknown>;
    getPlaces(tripId: number, asUserId: number): Promise<unknown[]>;
    getReservations(tripId: number, asUserId: number): Promise<unknown[]>;
  };
  users: {
    getById(id: number): Promise<unknown>;
  };
  ws: {
    broadcastToTrip(tripId: number, event: string, data: Record<string, unknown>): Promise<void>;
    broadcastToUser(userId: number, event: string, data: Record<string, unknown>): Promise<void>;
  };
  log: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface PluginRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  user: { id: number; username: string; isAdmin: boolean } | null;
}
export interface PluginResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface PluginRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  auth?: boolean;
  handler(req: PluginRequest, ctx: PluginContext): Promise<PluginResponse>;
}
export interface PluginJob {
  id: string;
  schedule: string;
  handler(ctx: PluginContext): Promise<void>;
}
export interface PluginDefinition {
  onLoad?(ctx: PluginContext): Promise<void> | void;
  onUnload?(ctx: PluginContext): Promise<void> | void;
  routes?: PluginRoute[];
  jobs?: PluginJob[];
  // hooks (photo/calendar) land in M2
}

/** Identity helper: gives authors types + a stable shape. A plain object works too. */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}

/** Transport the child entry wires to process.send / message correlation. */
export interface ChildTransport {
  rpc(method: string, params: Record<string, unknown>): Promise<unknown>;
  emit(topic: string, data: unknown): void;
}

/** Build the ctx the plugin's handlers receive — every method is an RPC call. */
export function createPluginContext(
  id: string,
  config: Record<string, unknown>,
  t: ChildTransport,
): PluginContext {
  return {
    id,
    config: Object.freeze({ ...config }),
    db: {
      query: (sql, ...args) => t.rpc('db.query', { sql, args }) as Promise<never[]>,
      exec: (sql, ...args) => t.rpc('db.exec', { sql, args }) as Promise<{ changes: number }>,
      migrate: (mid, sql) => t.rpc('db.migrate', { id: mid, sql }) as Promise<{ applied: boolean }>,
    },
    trips: {
      getById: (tripId, asUserId) => t.rpc('trips.getById', { tripId, asUserId }),
      getPlaces: (tripId, asUserId) => t.rpc('trips.getPlaces', { tripId, asUserId }) as Promise<unknown[]>,
      getReservations: (tripId, asUserId) => t.rpc('trips.getReservations', { tripId, asUserId }) as Promise<unknown[]>,
    },
    users: {
      getById: (uid) => t.rpc('users.getById', { id: uid }),
    },
    ws: {
      broadcastToTrip: async (tripId, event, data) => {
        await t.rpc('ws.broadcastToTrip', { tripId, event, data });
      },
      broadcastToUser: async (userId, event, data) => {
        await t.rpc('ws.broadcastToUser', { userId, event, data });
      },
    },
    log: {
      info: (msg, meta) => t.emit('log', { level: 'info', msg, meta }),
      warn: (msg, meta) => t.emit('log', { level: 'warn', msg, meta }),
      error: (msg, meta) => t.emit('log', { level: 'error', msg, meta }),
    },
  };
}
