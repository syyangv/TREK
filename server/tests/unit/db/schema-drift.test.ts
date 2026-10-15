/**
 * schema_version only says how many migration slots were consumed, not that the
 * schema they build exists. A database advanced by a different migration list
 * keeps a high version while missing tables/columns, and every query touching
 * them 500s at runtime. findSchemaDrift compares the live schema with what the
 * current migrations build from scratch.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { assertNoSchemaDrift, findSchemaDrift } from '../../../src/db/schema-drift';

function migratedDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db);
  runMigrations(db);
  return db;
}

describe('schema drift check', () => {
  it('SCHEMA-DRIFT-001: reports nothing for a database the current migrations built', () => {
    const db = migratedDb();
    try {
      expect(findSchemaDrift(db)).toEqual({ missingTables: [], missingColumns: {} });
    } finally {
      db.close();
    }
  });

  it('SCHEMA-DRIFT-002: reports a table that is missing despite a current schema_version', () => {
    const db = migratedDb();
    try {
      db.exec('DROP TABLE vacay_shares');
      const drift = findSchemaDrift(db);
      expect(drift.missingTables).toEqual(['vacay_shares']);
      expect(drift.missingColumns).toEqual({});
    } finally {
      db.close();
    }
  });

  it('SCHEMA-DRIFT-003: reports a missing column per table', () => {
    const db = migratedDb();
    try {
      db.exec('ALTER TABLE vacay_entries DROP COLUMN fraction');
      expect(findSchemaDrift(db).missingColumns).toEqual({ vacay_entries: ['fraction'] });
    } finally {
      db.close();
    }
  });

  it('SCHEMA-DRIFT-004: ignores tables and columns the live database has beyond the migrations', () => {
    const db = migratedDb();
    try {
      db.exec('CREATE TABLE operator_scratch (id INTEGER)');
      db.exec('ALTER TABLE vacay_entries ADD COLUMN operator_note TEXT');
      expect(findSchemaDrift(db)).toEqual({ missingTables: [], missingColumns: {} });
    } finally {
      db.close();
    }
  });

  it('SCHEMA-DRIFT-005: leaves the console quiet while it builds the reference schema', () => {
    const db = migratedDb();
    const seen: string[] = [];
    const real = { log: console.log, warn: console.warn };
    console.log = (...a: unknown[]) => { seen.push(a.join(' ')); };
    console.warn = (...a: unknown[]) => { seen.push(a.join(' ')); };
    try {
      findSchemaDrift(db);
    } finally {
      console.log = real.log;
      console.warn = real.warn;
      db.close();
    }
    expect(seen).toEqual([]);
  });

  it('SCHEMA-DRIFT-006: assertNoSchemaDrift throws naming every missing table and column', () => {
    const db = migratedDb();
    try {
      db.exec('DROP TABLE vacay_shares');
      db.exec('ALTER TABLE vacay_entries DROP COLUMN fraction');
      expect(() => assertNoSchemaDrift(db)).toThrow(/vacay_shares[\s\S]*vacay_entries\.fraction|vacay_entries\.fraction[\s\S]*vacay_shares/);
    } finally {
      db.close();
    }
  });

  it('SCHEMA-DRIFT-007: assertNoSchemaDrift passes on a healthy database', () => {
    const db = migratedDb();
    try {
      expect(() => assertNoSchemaDrift(db)).not.toThrow();
    } finally {
      db.close();
    }
  });
});
