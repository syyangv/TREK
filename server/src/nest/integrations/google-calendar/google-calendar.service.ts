import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { readEnv } from '../../../app-config';
import { resolveTimeZone } from '../../common/timezoneService';
import { addDays } from '../../days/days.service';
import { decrypt_api_key, encrypt_api_key } from '../../common/crypto/apiKeyCrypto';
import {
  GoogleCalendarClient,
  type GoogleCalendarCreds,
  type GoogleCalendarEventPayload,
} from './google-calendar.client';

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  enabled: boolean;
}

const TYPE_EMOJIS: Record<string, string> = {
  flight: '✈️',
  hotel: '🏨',
  lodging: '🏨',
  restaurant: '🍽️',
  dining: '🍽️',
  food: '🍽️',
  car: '🚗',
  rental: '🚗',
  transit: '🚆',
  train: '🚆',
  activity: '🎟️',
  tour: '🎟️',
  medical: '🏥',
  health: '🏥',
  meeting: '💼',
};

function formatIsoTime(val: string): string {
  const parts = val.split('T');
  if (parts.length < 2) return val;
  const time = parts[1];
  const timeParts = time.split(':');
  if (timeParts.length === 2) {
    return `${parts[0]}T${time}:00`;
  }
  return `${parts[0]}T${time}`;
}

function addHoursToIso(iso: string, hours: number): string {
  const parts = iso.split('T');
  if (parts.length !== 2) return iso;
  const [dateStr, timeStr] = parts;
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + hours * 60;
  const newDays = Math.floor(totalMinutes / 1440);
  const remMinutes = totalMinutes % 1440;
  const newH = Math.floor(remMinutes / 60);
  const newM = remMinutes % 60;
  const newDate = newDays > 0 ? addDays(dateStr, newDays) : dateStr;
  return `${newDate}T${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}:00`;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly client: GoogleCalendarClient,
  ) {}

  /**
   * Resolve Google Calendar credentials from environment variables, falling back
   * to database app_settings.
   */
  getCredentials(): GoogleCalendarConfig {
    const env = readEnv();
    const envGcal = (env as any).integrations?.googleCalendar || {};

    const rawClientId = envGcal.clientId || process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const rawClientSecret = envGcal.clientSecret || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const rawRefreshToken = envGcal.refreshToken || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
    const rawCalendarId = envGcal.calendarId || process.env.GOOGLE_CALENDAR_ID;
    const rawEnabled = process.env.GOOGLE_CALENDAR_SYNC_ENABLED;

    // Read DB settings overrides if present
    const getSetting = (k: string): string | null => {
      try {
        const row = this.db.get<{ value?: string }>('SELECT value FROM app_settings WHERE key = ?', k);
        return row?.value || null;
      } catch {
        return null;
      }
    };

    const dbClientId = getSetting('google_calendar_client_id');
    const dbClientSecret = decrypt_api_key(getSetting('google_calendar_client_secret'));
    const dbRefreshToken = decrypt_api_key(getSetting('google_calendar_refresh_token'));
    const dbCalendarId = getSetting('google_calendar_id');
    const dbEnabled = getSetting('google_calendar_enabled');

    const clientId = (dbClientId || rawClientId || '').trim();
    const clientSecret = (dbClientSecret || rawClientSecret || '').trim();
    const refreshToken = (dbRefreshToken || rawRefreshToken || '').trim();
    const calendarId = (dbCalendarId || rawCalendarId || 'primary').trim();
    const enabled = dbEnabled !== null
      ? dbEnabled === 'true' || dbEnabled === '1'
      : rawEnabled !== undefined
        ? !['false', '0', 'off', 'no'].includes(rawEnabled.toLowerCase().trim())
        : true;

    return {
      clientId,
      clientSecret,
      refreshToken,
      calendarId,
      enabled,
    };
  }

  isConfigured(): boolean {
    const creds = this.getCredentials();
    return !!(creds.enabled && creds.refreshToken && creds.clientId && creds.clientSecret);
  }

  async getStatus(): Promise<{ enabled: boolean; connected: boolean; calendar_id: string; email?: string | null }> {
    const creds = this.getCredentials();
    if (!creds.enabled || !creds.refreshToken) {
      return { enabled: creds.enabled, connected: false, calendar_id: creds.calendarId };
    }

    try {
      const cal = await this.client.getCalendar(creds, creds.calendarId);
      return {
        enabled: true,
        connected: !!cal,
        calendar_id: creds.calendarId,
        email: cal?.summary || null,
      };
    } catch (err: any) {
      this.logger.warn(`Google Calendar status probe failed: ${err.message}`);
      return {
        enabled: true,
        connected: false,
        calendar_id: creds.calendarId,
      };
    }
  }

  saveDbCredentials(refreshToken: string, calendarId?: string, enabled?: boolean): void {
    const upsert = (key: string, value: string) => {
      this.db.run(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
    };

    if (refreshToken) {
      upsert('google_calendar_refresh_token', encrypt_api_key(refreshToken));
    }
    if (calendarId) {
      upsert('google_calendar_id', calendarId);
    }
    if (enabled !== undefined) {
      upsert('google_calendar_enabled', enabled ? 'true' : 'false');
    }
  }

  /**
   * Build a complete Google Calendar event representation from a reservation and its associated records.
   */
  mapReservationToEvent(reservationId: number | string): GoogleCalendarEventPayload | null {
    const r = this.db.get<{
      id: number;
      trip_id: number;
      title: string;
      reservation_time?: string | null;
      reservation_end_time?: string | null;
      location?: string | null;
      confirmation_number?: string | null;
      notes?: string | null;
      status?: string | null;
      type?: string | null;
      accommodation_id?: number | null;
      metadata?: string | null;
      place_name?: string | null;
      place_address?: string | null;
      place_lat?: number | null;
      place_lng?: number | null;
      trip_title?: string | null;
      trip_timezone?: string | null;
    }>(
      `SELECT r.*,
              p.name as place_name, p.address as place_address, p.lat as place_lat, p.lng as place_lng,
              t.title as trip_title
       FROM reservations r
       LEFT JOIN places p ON r.place_id = p.id
       JOIN trips t ON r.trip_id = t.id
       WHERE r.id = ?`,
      reservationId,
    );

    if (!r) return null;

    // Load any transportation endpoints
    const endpoints = this.db.all<{
      role: string;
      sequence: number;
      name: string;
      code?: string | null;
      lat: number;
      lng: number;
      timezone?: string | null;
      local_time?: string | null;
      local_date?: string | null;
    }>(
      'SELECT * FROM reservation_endpoints WHERE reservation_id = ? ORDER BY sequence ASC',
      r.id,
    );

    // Load accommodation if linked
    let stay: { start_date?: string | null; end_date?: string | null; check_in?: string | null; check_out?: string | null } | null = null;
    if (r.accommodation_id) {
      stay = this.db.get(
        `SELECT a.*, sd.date as start_date, ed.date as end_date
         FROM day_accommodations a
         LEFT JOIN days sd ON a.start_day_id = sd.id
         LEFT JOIN days ed ON a.end_day_id = ed.id
         WHERE a.id = ?`,
        r.accommodation_id,
      ) || null;
    }

    let placeLat = r.place_lat;
    let placeLng = r.place_lng;
    let placeAddress = r.place_address;
    let placeName = r.place_name;

    if ((!placeLat || !placeLng) && r.trip_id) {
      // If place is not linked directly, try finding place in same trip matching reservation title
      const matchedPlace = this.db.get<{ name?: string; lat?: number; lng?: number; address?: string }>(
        'SELECT name, lat, lng, address FROM places WHERE trip_id = ? AND name = ? AND lat IS NOT NULL LIMIT 1',
        r.trip_id,
        r.title,
      );
      if (matchedPlace) {
        if (!placeLat) placeLat = matchedPlace.lat;
        if (!placeLng) placeLng = matchedPlace.lng;
        if (!placeAddress) placeAddress = matchedPlace.address;
        if (!placeName) placeName = matchedPlace.name;
      }
    }

    // Try finding primary timezone of the trip from any mapped place
    let tripPlaceTz: string | null = null;
    if (r.trip_id) {
      const anyPlace = this.db.get<{ lat?: number; lng?: number }>(
        'SELECT lat, lng FROM places WHERE trip_id = ? AND lat IS NOT NULL LIMIT 1',
        r.trip_id,
      );
      if (anyPlace?.lat && anyPlace?.lng) {
        tripPlaceTz = resolveTimeZone(anyPlace.lat, anyPlace.lng);
      }
    }

    // Determine start and end
    let start: { dateTime?: string; date?: string; timeZone?: string } | null = null;
    let end: { dateTime?: string; date?: string; timeZone?: string } | null = null;

    const defaultTz = r.trip_timezone || tripPlaceTz || process.env.TZ || 'America/New_York';

    if (endpoints && endpoints.length > 0) {
      const first = endpoints[0];
      const last = endpoints[endpoints.length - 1];

      if (first.local_date && first.local_time) {
        const startTz = first.timezone || resolveTimeZone(first.lat, first.lng) || defaultTz;
        start = {
          dateTime: `${first.local_date}T${first.local_time}:00`,
          timeZone: startTz,
        };

        if (last !== first && last.local_date && last.local_time) {
          const endTz = last.timezone || resolveTimeZone(last.lat, last.lng) || startTz;
          end = {
            dateTime: `${last.local_date}T${last.local_time}:00`,
            timeZone: endTz,
          };
        } else if (r.reservation_end_time) {
          const endIso = formatIsoTime(r.reservation_end_time);
          end = {
            dateTime: endIso,
            timeZone: startTz,
          };
        } else {
          end = {
            dateTime: addHoursToIso(`${first.local_date}T${first.local_time}:00`, 2),
            timeZone: startTz,
          };
        }
      }
    }

    if (!start && stay && stay.start_date) {
      const startTz = resolveTimeZone(placeLat, placeLng) || defaultTz;
      if (stay.check_in && stay.check_out && stay.end_date) {
        start = {
          dateTime: `${stay.start_date}T${stay.check_in}:00`,
          timeZone: startTz,
        };
        end = {
          dateTime: `${stay.end_date}T${stay.check_out}:00`,
          timeZone: startTz,
        };
      } else {
        start = { date: stay.start_date };
        const lastDay = stay.end_date || stay.start_date;
        end = { date: addDays(lastDay, 1) }; // Google Calendar all-day end date is exclusive
      }
    }

    if (!start && r.reservation_time) {
      const tz = resolveTimeZone(placeLat, placeLng) || defaultTz;
      if (r.reservation_time.includes('T')) {
        const startIso = formatIsoTime(r.reservation_time);
        start = {
          dateTime: startIso,
          timeZone: tz,
        };

        if (r.reservation_end_time && r.reservation_end_time.includes('T')) {
          end = {
            dateTime: formatIsoTime(r.reservation_end_time),
            timeZone: tz,
          };
        } else {
          end = {
            dateTime: addHoursToIso(startIso, 1),
            timeZone: tz,
          };
        }
      } else {
        // Date-only
        start = { date: r.reservation_time };
        const endDate = r.reservation_end_time && r.reservation_end_time >= r.reservation_time
          ? r.reservation_end_time
          : r.reservation_time;
        end = { date: addDays(endDate, 1) };
      }
    }

    if (!start || !end) {
      return null;
    }

    // Build summary with appropriate emoji
    const resType = (r.type || 'other').toLowerCase();
    const emoji = TYPE_EMOJIS[resType] || '📅';
    const summary = r.title.startsWith(emoji) ? r.title : `${emoji} ${r.title}`;

    // Build detailed description
    const descLines: string[] = [];
    if (r.confirmation_number) descLines.push(`Confirmation: ${r.confirmation_number}`);
    if (r.status) descLines.push(`Status: ${r.status}`);
    if (r.type) descLines.push(`Type: ${r.type}`);
    if (r.notes) descLines.push(`\nNotes:\n${r.notes}`);

    const appUrl = readEnv().app.appUrl?.replace(/\/$/, '') || '';
    if (appUrl) {
      descLines.push(`\nTrip: ${r.trip_title || 'Trip'} (${appUrl}/trips/${r.trip_id})`);
    } else if (r.trip_title) {
      descLines.push(`\nTrip: ${r.trip_title}`);
    }
    descLines.push(`\nTREK Reservation ID: ${r.id}`);

    const location = r.location || placeAddress || placeName || undefined;

    return {
      summary,
      location,
      description: descLines.join('\n'),
      start,
      end,
      extendedProperties: {
        private: {
          trekReservationId: String(r.id),
          trekTripId: String(r.trip_id),
        },
      },
    };
  }

  /**
   * Sync a reservation to Google Calendar (create or update).
   */
  async syncReservation(
    reservationOrId: number | string | { id: number | string; metadata?: unknown },
    tripId: number | string,
  ): Promise<{ synced: boolean; event_id?: string; reason?: string }> {
    if (!this.isConfigured()) {
      return { synced: false, reason: 'not_configured' };
    }

    const creds = this.getCredentials();
    const resId = typeof reservationOrId === 'object' ? reservationOrId.id : reservationOrId;

    const eventPayload = this.mapReservationToEvent(resId);
    if (!eventPayload) {
      return { synced: false, reason: 'no_calendar_time' };
    }

    // Read current metadata from database
    const row = this.db.get<{ metadata?: string | null }>(
      'SELECT metadata FROM reservations WHERE id = ?',
      resId,
    );

    let meta: Record<string, unknown> = {};
    if (row?.metadata) {
      try {
        meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      } catch {
        meta = {};
      }
    }

    const existingEventId = (meta.gcal_event_id as string) || null;
    let eventId = existingEventId;

    try {
      if (existingEventId) {
        try {
          const res = await this.client.patchEvent(creds, creds.calendarId, existingEventId, eventPayload);
          eventId = res.id;
        } catch (err: any) {
          if (err.status === 404) {
            // Event was deleted in Google Calendar; re-create
            const res = await this.client.insertEvent(creds, creds.calendarId, eventPayload);
            eventId = res.id;
          } else {
            throw err;
          }
        }
      } else {
        const res = await this.client.insertEvent(creds, creds.calendarId, eventPayload);
        eventId = res.id;
      }

      // Update metadata in database
      meta.gcal_event_id = eventId;
      meta.gcal_synced_at = new Date().toISOString();
      this.db.run(
        'UPDATE reservations SET metadata = ? WHERE id = ?',
        JSON.stringify(meta),
        resId,
      );

      this.logger.log(`Synced reservation ${resId} (${eventPayload.summary}) to Google Calendar event ${eventId}`);
      return { synced: true, event_id: eventId };
    } catch (err: any) {
      this.logger.error(`Failed to sync reservation ${resId} to Google Calendar: ${err.message}`, err.stack);
      return { synced: false, reason: err.message };
    }
  }

  /**
   * Delete a reservation event from Google Calendar when deleted in TREK.
   */
  async deleteReservation(
    deletedReservation: { id?: number | string; metadata?: unknown },
    tripId: number | string,
  ): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const creds = this.getCredentials();
    let meta: Record<string, unknown> = {};
    if (deletedReservation.metadata) {
      try {
        meta = typeof deletedReservation.metadata === 'string'
          ? JSON.parse(deletedReservation.metadata)
          : (deletedReservation.metadata as Record<string, unknown>);
      } catch {
        meta = {};
      }
    }

    const eventId = meta.gcal_event_id as string;
    if (!eventId) return false;

    try {
      await this.client.deleteEvent(creds, creds.calendarId, eventId);
      this.logger.log(`Deleted reservation ${deletedReservation.id} Google Calendar event ${eventId}`);
      return true;
    } catch (err: any) {
      this.logger.warn(`Failed to delete Google Calendar event ${eventId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Sync all active and upcoming reservations across all unarchived trips.
   */
  async syncAllUpcomingReservations(): Promise<{
    success: boolean;
    total: number;
    synced: number;
    failed: number;
    errors?: string[];
  }> {
    if (!this.isConfigured()) {
      return { success: false, total: 0, synced: 0, failed: 0, errors: ['Google Calendar is not configured or disabled'] };
    }

    const rows = this.db.all<{ id: number; trip_id: number; title: string }>(
      `SELECT r.id, r.trip_id, r.title
       FROM reservations r
       JOIN trips t ON r.trip_id = t.id
       WHERE t.is_archived = 0
         AND (
           r.reservation_time >= date('now', '-1 day')
           OR r.reservation_end_time >= date('now', '-1 day')
           OR t.end_date >= date('now', '-1 day')
           OR t.end_date IS NULL
         )
       ORDER BY r.reservation_time ASC, r.id ASC`,
    );

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const res = await this.syncReservation(row.id, row.trip_id);
        if (res.synced) {
          synced++;
        } else if (res.reason !== 'no_calendar_time') {
          failed++;
          if (res.reason) errors.push(`Reservation ${row.id} (${row.title}): ${res.reason}`);
        }
      } catch (err: any) {
        failed++;
        errors.push(`Reservation ${row.id} (${row.title}): ${err.message}`);
      }
    }

    return {
      success: failed === 0,
      total: rows.length,
      synced,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
