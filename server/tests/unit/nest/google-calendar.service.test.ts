import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: () => true,
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { DatabaseService } from '../../../src/nest/database/database.service';
import {
  GoogleCalendarClient,
  type GoogleCalendarCreds,
  type GoogleCalendarEventPayload,
  type GoogleCalendarEventResponse,
} from '../../../src/nest/integrations/google-calendar/google-calendar.client';
import { GoogleCalendarService } from '../../../src/nest/integrations/google-calendar/google-calendar.service';

describe('GoogleCalendarService', () => {
  let dbs: DatabaseService;
  let client: GoogleCalendarClient;
  let service: GoogleCalendarService;

  beforeAll(() => {
    createTables(testDb);
    runMigrations(testDb);
  });

  beforeEach(() => {
    testDb.exec('DELETE FROM reservation_endpoints');
    testDb.exec('DELETE FROM reservations');
    testDb.exec('DELETE FROM day_accommodations');
    testDb.exec('DELETE FROM days');
    testDb.exec('DELETE FROM places');
    testDb.exec('DELETE FROM trips');
    testDb.exec('DELETE FROM users');
    testDb.exec('DELETE FROM app_settings');

    dbs = new DatabaseService(testDb);
    client = new GoogleCalendarClient();

    // Mock client methods by default
    vi.spyOn(client, 'getAccessToken').mockResolvedValue('mock-access-token');
    vi.spyOn(client, 'getCalendar').mockResolvedValue({ id: 'primary', summary: 'test@example.com' });
    vi.spyOn(client, 'insertEvent').mockImplementation(async (_creds, _calId, event) => ({
      id: 'gcal-evt-123',
      summary: event.summary,
      start: event.start,
      end: event.end,
    }));
    vi.spyOn(client, 'patchEvent').mockImplementation(async (_creds, _calId, eventId, event) => ({
      id: eventId,
      summary: event.summary,
      start: event.start,
      end: event.end,
    }));
    vi.spyOn(client, 'deleteEvent').mockResolvedValue(true);

    service = new GoogleCalendarService(dbs, client);
  });

  it('reports not configured when refresh token is missing', () => {
    expect(service.isConfigured()).toBe(false);
  });

  it('reports configured when credentials are provided via DB or env', () => {
    service.saveDbCredentials('mock-refresh-token', 'primary', true);
    expect(service.isConfigured()).toBe(true);
    const creds = service.getCredentials();
    expect(creds.refreshToken).toBe('mock-refresh-token');
    expect(creds.calendarId).toBe('primary');
  });

  describe('mapReservationToEvent', () => {
    it('maps a flight reservation with endpoints correctly', () => {
      // Create user, trip, reservation and endpoints
      testDb.exec("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.com', 'hash')");
      testDb.exec("INSERT INTO trips (id, user_id, title, start_date, end_date) VALUES (1, 1, 'SF Trip', '2026-12-15', '2026-12-25')");
      testDb.exec(`
        INSERT INTO reservations (id, trip_id, title, type, status, confirmation_number, notes)
        VALUES (10, 1, 'SFO-SBA', 'flight', 'confirmed', 'ABC1234', 'Terminal 2 Gate 4')
      `);
      testDb.exec(`
        INSERT INTO reservation_endpoints (id, reservation_id, role, sequence, name, code, lat, lng, timezone, local_time, local_date)
        VALUES
          (1, 10, 'from', 0, 'San Francisco (SFO)', 'SFO', 37.61, -122.37, 'America/Los_Angeles', '14:10', '2026-12-16'),
          (2, 10, 'to', 1, 'Santa Barbara (SBA)', 'SBA', 34.42, -119.83, 'America/Los_Angeles', '15:33', '2026-12-16')
      `);

      const event = service.mapReservationToEvent(10);
      expect(event).not.toBeNull();
      expect(event!.summary).toBe('✈️ SFO-SBA');
      expect(event!.start).toEqual({
        dateTime: '2026-12-16T14:10:00',
        timeZone: 'America/Los_Angeles',
      });
      expect(event!.end).toEqual({
        dateTime: '2026-12-16T15:33:00',
        timeZone: 'America/Los_Angeles',
      });
      expect(event!.description).toContain('Confirmation: ABC1234');
      expect(event!.description).toContain('Notes:\nTerminal 2 Gate 4');
      expect(event!.description).toContain('Trip: SF Trip');
      expect(event!.extendedProperties?.private?.trekReservationId).toBe('10');
    });

    it('maps a hotel reservation with linked accommodation correctly', () => {
      testDb.exec("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.com', 'hash')");
      testDb.exec("INSERT INTO trips (id, user_id, title, start_date, end_date) VALUES (1, 1, 'SF Trip', '2026-12-15', '2026-12-25')");
      testDb.exec("INSERT INTO places (id, trip_id, name, lat, lng) VALUES (2, 1, 'NEMA San Francisco', 37.776, -122.417)");
      testDb.exec("INSERT INTO days (id, trip_id, day_number, date) VALUES (20, 1, 1, '2026-12-18'), (27, 1, 8, '2026-12-25')");
      testDb.exec(`
        INSERT INTO day_accommodations (id, trip_id, start_day_id, end_day_id, check_in, check_out)
        VALUES (1, 1, 20, 27, '15:00', '11:00')
      `);
      testDb.exec(`
        INSERT INTO reservations (id, trip_id, place_id, title, type, accommodation_id, location)
        VALUES (11, 1, 2, 'NEMA San Francisco', 'hotel', 1, '8 10th St, San Francisco, CA')
      `);

      const event = service.mapReservationToEvent(11);
      expect(event).not.toBeNull();
      expect(event!.summary).toBe('🏨 NEMA San Francisco');
      expect(event!.location).toBe('8 10th St, San Francisco, CA');
      expect(event!.start).toEqual({
        dateTime: '2026-12-18T15:00:00',
        timeZone: 'America/Los_Angeles',
      });
      expect(event!.end).toEqual({
        dateTime: '2026-12-25T11:00:00',
        timeZone: 'America/Los_Angeles',
      });
    });

    it('maps a timed restaurant or appointment reservation correctly', () => {
      testDb.exec("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.com', 'hash')");
      testDb.exec("INSERT INTO trips (id, user_id, title, start_date, end_date) VALUES (1, 1, 'NYC Checkup', '2026-09-30', '2026-09-30')");
      testDb.exec("INSERT INTO places (id, trip_id, name, lat, lng) VALUES (10, 1, 'Spring Clinic', 40.722, -73.999)");
      testDb.exec(`
        INSERT INTO reservations (id, trip_id, place_id, title, type, reservation_time, reservation_end_time, location)
        VALUES (12, 1, 10, 'Spring Ob/Gyn', 'medical', '2026-09-30T15:15', '2026-09-30T16:00', '135 Spring St, New York, NY')
      `);

      const event = service.mapReservationToEvent(12);
      expect(event).not.toBeNull();
      expect(event!.summary).toBe('🏥 Spring Ob/Gyn');
      expect(event!.start).toEqual({
        dateTime: '2026-09-30T15:15:00',
        timeZone: 'America/New_York',
      });
      expect(event!.end).toEqual({
        dateTime: '2026-09-30T16:00:00',
        timeZone: 'America/New_York',
      });
      expect(event!.location).toBe('135 Spring St, New York, NY');
    });

    it('maps an all-day reservation with date-only reservation_time', () => {
      testDb.exec("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.com', 'hash')");
      testDb.exec("INSERT INTO trips (id, user_id, title, start_date, end_date) VALUES (1, 1, 'Trip', '2026-10-01', '2026-10-05')");
      testDb.exec(`
        INSERT INTO reservations (id, trip_id, title, type, reservation_time, reservation_end_time)
        VALUES (13, 1, 'Full Day Tour', 'activity', '2026-10-02', '2026-10-03')
      `);

      const event = service.mapReservationToEvent(13);
      expect(event).not.toBeNull();
      expect(event!.summary).toBe('🎟️ Full Day Tour');
      expect(event!.start).toEqual({ date: '2026-10-02' });
      expect(event!.end).toEqual({ date: '2026-10-04' }); // Exclusive end date
    });
  });

  describe('syncReservation and deleteReservation', () => {
    beforeEach(() => {
      service.saveDbCredentials('valid-token', 'primary', true);
      testDb.exec("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.com', 'hash')");
      testDb.exec("INSERT INTO trips (id, user_id, title, start_date, end_date) VALUES (1, 1, 'SF Trip', '2026-12-15', '2026-12-25')");
      testDb.exec(`
        INSERT INTO reservations (id, trip_id, title, type, reservation_time, reservation_end_time)
        VALUES (14, 1, 'Dinner', 'restaurant', '2026-12-16T19:00', '2026-12-16T21:00')
      `);
    });

    it('inserts event and updates reservation metadata when syncing for the first time', async () => {
      const result = await service.syncReservation(14, 1);
      expect(result.synced).toBe(true);
      expect(result.event_id).toBe('gcal-evt-123');
      expect(client.insertEvent).toHaveBeenCalledTimes(1);

      // Verify metadata updated in SQLite
      const row = testDb.prepare('SELECT metadata FROM reservations WHERE id = 14').get() as { metadata: string };
      const meta = JSON.parse(row.metadata);
      expect(meta.gcal_event_id).toBe('gcal-evt-123');
      expect(meta.gcal_synced_at).toBeDefined();
    });

    it('patches existing event when syncing reservation that already has gcal_event_id', async () => {
      testDb.exec(`UPDATE reservations SET metadata = json_object('gcal_event_id', 'existing-gcal-id') WHERE id = 14`);

      const result = await service.syncReservation(14, 1);
      expect(result.synced).toBe(true);
      expect(result.event_id).toBe('existing-gcal-id');
      expect(client.patchEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'existing-gcal-id',
        expect.anything(),
      );
      expect(client.insertEvent).not.toHaveBeenCalled();
    });

    it('re-inserts event when patch returns 404', async () => {
      testDb.exec(`UPDATE reservations SET metadata = json_object('gcal_event_id', 'stale-gcal-id') WHERE id = 14`);
      const err = new Error('Not found');
      (err as any).status = 404;
      vi.spyOn(client, 'patchEvent').mockRejectedValueOnce(err);

      const result = await service.syncReservation(14, 1);
      expect(result.synced).toBe(true);
      expect(result.event_id).toBe('gcal-evt-123');
      expect(client.insertEvent).toHaveBeenCalledTimes(1);
    });

    it('deletes event from Google Calendar when deleted in TREK', async () => {
      const deletedReservation = {
        id: 14,
        metadata: JSON.stringify({ gcal_event_id: 'gcal-evt-123' }),
      };

      const deleted = await service.deleteReservation(deletedReservation, 1);
      expect(deleted).toBe(true);
      expect(client.deleteEvent).toHaveBeenCalledWith(expect.anything(), 'primary', 'gcal-evt-123');
    });
  });

  describe('syncAllUpcomingReservations', () => {
    it('syncs all upcoming reservations across trips', async () => {
      service.saveDbCredentials('valid-token', 'primary', true);
      testDb.exec("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.com', 'hash')");
      testDb.exec("INSERT INTO trips (id, user_id, title, start_date, end_date) VALUES (1, 1, 'Trip 1', '2026-10-01', '2026-10-10')");
      testDb.exec(`
        INSERT INTO reservations (id, trip_id, title, type, reservation_time)
        VALUES
          (101, 1, 'Event 1', 'other', '2026-10-02T10:00'),
          (102, 1, 'Event 2', 'other', '2026-10-03T11:00')
      `);

      const result = await service.syncAllUpcomingReservations();
      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.synced).toBe(2);
      expect(result.failed).toBe(0);
    });
  });
});
