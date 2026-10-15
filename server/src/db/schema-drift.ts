import Database from 'better-sqlite3';
import { createTables } from './schema';
import { runMigrations } from './migrations';

export interface SchemaDrift {
  missingTables: string[];
  missingColumns: Record<string, string[]>;
}

type Shape = Map<string, Set<string>>;

function readShape(db: Database.Database): Shape {
  const shape: Shape = new Map();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  for (const { name } of tables) {
    const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all(name) as { name: string }[];
    shape.set(name, new Set(columns.map((c) => c.name)));
  }
  return shape;
}

// The migrations narrate every step to the console; building a throwaway schema
// on each boot must not repeat that story in the operator's log.
function buildReferenceShape(): Shape {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const reference = new Database(':memory:');
  try {
    reference.exec('PRAGMA foreign_keys = ON');
    createTables(reference);
    runMigrations(reference);
    return readShape(reference);
  } finally {
    console.log = log;
    console.warn = warn;
    reference.close();
  }
}

/**
 * Compares the live schema with what the current migrations build from scratch.
 * schema_version only counts consumed migration slots, so a database advanced by
 * a different migration list can read as current while lacking tables or columns.
 * Only absences are reported: extra tables/columns are harmless to this code.
 */
export function findSchemaDrift(live: Database.Database): SchemaDrift {
  const expected = buildReferenceShape();
  const actual = readShape(live);
  const missingTables: string[] = [];
  const missingColumns: Record<string, string[]> = {};
  for (const [table, columns] of expected) {
    const present = actual.get(table);
    if (!present) {
      missingTables.push(table);
      continue;
    }
    const absent = [...columns].filter((c) => !present.has(c));
    if (absent.length > 0) missingColumns[table] = absent;
  }
  return { missingTables, missingColumns };
}

/** Refuses a database whose schema lacks anything the current migrations create. */
export function assertNoSchemaDrift(live: Database.Database): void {
  const { missingTables, missingColumns } = findSchemaDrift(live);
  const columnLines = Object.entries(missingColumns).flatMap(([table, columns]) => columns.map((c) => `${table}.${c}`));
  if (missingTables.length === 0 && columnLines.length === 0) return;
  const lines = [
    'Database schema is behind the code although schema_version says it is current.',
    ...(missingTables.length > 0 ? [`Missing tables: ${missingTables.join(', ')}`] : []),
    ...(columnLines.length > 0 ? [`Missing columns: ${columnLines.join(', ')}`] : []),
    'Restore a backup, or apply the matching migration statements, before starting.',
  ];
  throw new Error(lines.join('\n'));
}
