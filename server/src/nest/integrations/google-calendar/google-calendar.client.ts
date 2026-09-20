import { Injectable, Logger } from '@nestjs/common';

export interface GoogleCalendarCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

export interface GoogleCalendarTime {
  dateTime?: string; // ISO 8601 string, e.g. 2026-09-30T15:15:00
  date?: string; // YYYY-MM-DD for all-day events
  timeZone?: string; // IANA timezone name, e.g. America/New_York
}

export interface GoogleCalendarEventPayload {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleCalendarTime;
  end: GoogleCalendarTime;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export interface GoogleCalendarEventResponse {
  id: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: GoogleCalendarTime;
  end?: GoogleCalendarTime;
  [key: string]: unknown;
}

@Injectable()
export class GoogleCalendarClient {
  private readonly logger = new Logger(GoogleCalendarClient.name);
  private cachedAccessToken: string | null = null;
  private cachedTokenExpiresAt = 0;

  /**
   * Fetch or return a cached OAuth 2.0 Access Token using the refresh token.
   */
  async getAccessToken(creds: GoogleCalendarCreds, forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.cachedAccessToken && now < this.cachedTokenExpiresAt - 60000) {
      return this.cachedAccessToken;
    }

    if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
      throw new Error('Missing Google Calendar OAuth credentials (clientId, clientSecret, or refreshToken)');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`Failed to refresh Google OAuth token (${res.status}): ${errText}`);
      throw new Error(`Google OAuth refresh failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedAccessToken = data.access_token;
    this.cachedTokenExpiresAt = now + (data.expires_in || 3600) * 1000;
    return this.cachedAccessToken;
  }

  private async request<T>(
    creds: GoogleCalendarCreds,
    path: string,
    options: RequestInit = {},
    retryOnAuth = true,
  ): Promise<T> {
    const token = await this.getAccessToken(creds);
    const url = `https://www.googleapis.com/calendar/v3${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (res.status === 401 && retryOnAuth) {
      this.logger.warn('Google Calendar API returned 401 Unauthorized; refreshing token and retrying...');
      await this.getAccessToken(creds, true);
      return this.request<T>(creds, path, options, false);
    }

    if (res.status === 204) {
      return {} as T;
    }

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Google Calendar API error ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    return res.json() as Promise<T>;
  }

  async getCalendar(creds: GoogleCalendarCreds, calendarId: string): Promise<{ id: string; summary: string } | null> {
    try {
      return await this.request<{ id: string; summary: string }>(
        creds,
        `/calendars/${encodeURIComponent(calendarId)}`,
        { method: 'GET' },
      );
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async insertEvent(
    creds: GoogleCalendarCreds,
    calendarId: string,
    event: GoogleCalendarEventPayload,
  ): Promise<GoogleCalendarEventResponse> {
    return this.request<GoogleCalendarEventResponse>(
      creds,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        body: JSON.stringify(event),
      },
    );
  }

  async patchEvent(
    creds: GoogleCalendarCreds,
    calendarId: string,
    eventId: string,
    event: Partial<GoogleCalendarEventPayload>,
  ): Promise<GoogleCalendarEventResponse> {
    return this.request<GoogleCalendarEventResponse>(
      creds,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(event),
      },
    );
  }

  async deleteEvent(creds: GoogleCalendarCreds, calendarId: string, eventId: string): Promise<boolean> {
    try {
      await this.request<void>(
        creds,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' },
      );
      return true;
    } catch (err: any) {
      if (err.status === 404 || err.status === 410) {
        return true; // Already deleted
      }
      throw err;
    }
  }

  async getEvent(
    creds: GoogleCalendarCreds,
    calendarId: string,
    eventId: string,
  ): Promise<GoogleCalendarEventResponse | null> {
    try {
      return await this.request<GoogleCalendarEventResponse>(
        creds,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'GET' },
      );
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async listEvents(
    creds: GoogleCalendarCreds,
    calendarId: string,
    params: Record<string, string> = {},
  ): Promise<{ items: GoogleCalendarEventResponse[] }> {
    const qs = new URLSearchParams(params).toString();
    const query = qs ? `?${qs}` : '';
    return this.request<{ items: GoogleCalendarEventResponse[] }>(
      creds,
      `/calendars/${encodeURIComponent(calendarId)}/events${query}`,
      { method: 'GET' },
    );
  }
}
