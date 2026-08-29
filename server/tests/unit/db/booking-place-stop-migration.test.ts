/**
 * Boot migration for the fork's booking-place stop behavior.
 *
 * Before the booking dialog learned to create a day stop, it was possible to
 * save a dated booking with only `reservations.place_id`. Those rows must be
 * repaired on upgrade so Places does not keep presenting them as unplanned.
 */
import { backfillBookingPlaceStops, runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';

import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';

function makeLegacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db);

  // Seed the legacy rows after the database has reached the previous tip, then
  // rewind exactly one slot so the test exercises an upgrade, not a fresh install.
  runMigrations(db);

  db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'u', 'u@example.test', 'x')").run();
  db.prepare("INSERT INTO trips (id, user_id, title) VALUES (1, 1, 'San Francisco')").run();
  db.prepare('INSERT INTO days (id, trip_id, day_number, date) VALUES (?, ?, ?, ?), (?, ?, ?, ?)').run(
    7,
    1,
    7,
    '2026-08-28',
    9,
    1,
    9,
    '2026-08-30',
  );
  db.prepare(
    'INSERT INTO places (id, trip_id, name, lat, lng) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
  ).run(
    24,
    1,
    'J. P. Murphy Tennis Courts',
    37.751,
    -122.469,
    25,
    1,
    'Lafayette Park tennis court',
    37.792,
    -122.426,
    26,
    1,
    'Existing stop',
    37.78,
    -122.44,
  );
  // A pre-existing stop proves the migration appends rather than disturbing
  // the user's current day-plan ordering.
  db.prepare('INSERT INTO day_assignments (id, day_id, place_id, order_index) VALUES (?, ?, ?, ?)').run(1, 7, 26, 0);
  db.prepare(
    `
    INSERT INTO reservations
      (id, trip_id, day_id, place_id, assignment_id, title, reservation_time, status, type)
    VALUES (?, ?, ?, ?, NULL, ?, ?, 'confirmed', 'event'),
           (?, ?, ?, ?, NULL, ?, ?, 'confirmed', 'event')
  `,
  ).run(
    10,
    1,
    7,
    24,
    'J. P. Murphy Tennis Courts',
    '2026-08-28T16:30',
    12,
    1,
    9,
    25,
    'Lafayette Park tennis court',
    '2026-08-30T15:00',
  );

  const { version } = db.prepare('SELECT version FROM schema_version').get() as { version: number };
  db.prepare('UPDATE schema_version SET version = ?').run(version - 1);

  return db;
}

describe('booking place stop migration', () => {
  it('repairs dated linked bookings and keeps existing day order', () => {
    const db = makeLegacyDb();
    try {
      runMigrations(db);

      const links = db
        .prepare(
          `
        SELECT r.id AS reservation_id, r.assignment_id, da.day_id, da.place_id, da.order_index
          FROM reservations r
          JOIN day_assignments da ON da.id = r.assignment_id
         WHERE r.id IN (10, 12)
         ORDER BY r.id
      `,
        )
        .all();
      expect(links).toEqual([
        { reservation_id: 10, assignment_id: 2, day_id: 7, place_id: 24, order_index: 1 },
        { reservation_id: 12, assignment_id: 3, day_id: 9, place_id: 25, order_index: 0 },
      ]);

      // Re-running the helper sees the links and creates nothing new.
      expect(backfillBookingPlaceStops(db)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS count FROM day_assignments').get()).toEqual({ count: 3 });
    } finally {
      db.close();
    }
  });

  it('does not invent a day stop for undated or hotel bookings', () => {
    const db = makeLegacyDb();
    try {
      db.prepare('INSERT INTO reservations (id, trip_id, place_id, title, status, type) VALUES (?, ?, ?, ?, ?, ?)').run(
        13,
        1,
        26,
        'Undated activity',
        'confirmed',
        'event',
      );
      db.prepare(
        'INSERT INTO reservations (id, trip_id, day_id, place_id, title, status, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(14, 1, 7, 26, 'Hotel metadata', 'confirmed', 'hotel');

      runMigrations(db);

      const untouched = db.prepare('SELECT id, assignment_id FROM reservations WHERE id IN (13, 14) ORDER BY id').all();
      expect(untouched).toEqual([
        { id: 13, assignment_id: null },
        { id: 14, assignment_id: null },
      ]);
    } finally {
      db.close();
    }
  });
});
