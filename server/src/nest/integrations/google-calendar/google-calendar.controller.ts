import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { User } from '../../../types';
import { GoogleCalendarService } from './google-calendar.service';
import { readEnv } from '../../../app-config';

@Controller('api/integrations/google-calendar')
export class GoogleCalendarController {
  constructor(private readonly googleCalendar: GoogleCalendarService) {}

  @UseGuards(JwtAuthGuard)
  @Get('status')
  async status() {
    return this.googleCalendar.getStatus();
  }

  @UseGuards(JwtAuthGuard)
  @Get('auth-url')
  authUrl() {
    const creds = this.googleCalendar.getCredentials();
    const appUrl = readEnv().app.appUrl?.replace(/\/$/, '') || 'http://localhost:3000';
    const redirectUri = `${appUrl}/api/integrations/google-calendar/oauth-callback`;

    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirect_uri: redirectUri,
    };
  }

  @Public('Google OAuth callback requires no existing session; exchanges auth code')
  @Get('oauth-callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error || !code) {
      res.status(400).send(`<html><body><h2>Google Authorization Failed</h2><p>${error || 'No code provided'}</p></body></html>`);
      return;
    }

    const creds = this.googleCalendar.getCredentials();
    const appUrl = readEnv().app.appUrl?.replace(/\/$/, '') || 'http://localhost:3000';
    const redirectUri = `${appUrl}/api/integrations/google-calendar/oauth-callback`;

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
      }

      const tokenData = (await tokenRes.json()) as { refresh_token?: string };
      if (!tokenData.refresh_token) {
        throw new Error('Google did not return a refresh token (try revoking app permissions and consenting again)');
      }

      this.googleCalendar.saveDbCredentials(tokenData.refresh_token);

      // Auto-trigger sync of upcoming reservations
      void this.googleCalendar.syncAllUpcomingReservations().catch(() => {});

      res.send(`<html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2 style="color: #22c55e;">Google Calendar Connected!</h2>
        <p>Reservations will now automatically sync to your Google Calendar.</p>
        <p><a href="/trips" style="color: #6366f1; font-weight: bold;">Return to TREK</a></p>
      </body></html>`);
    } catch (err: any) {
      res.status(500).send(`<html><body><h2>Connection Error</h2><p>${err.message}</p></body></html>`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync-all')
  async syncAll(@CurrentUser() user: User) {
    if (user.role !== 'admin') {
      throw new HttpException({ error: 'Admin only' }, 403);
    }
    return this.googleCalendar.syncAllUpcomingReservations();
  }

  @UseGuards(JwtAuthGuard)
  @Post('settings')
  async updateSettings(
    @CurrentUser() user: User,
    @Body() body: { refresh_token?: string; calendar_id?: string; enabled?: boolean },
  ) {
    if (user.role !== 'admin') {
      throw new HttpException({ error: 'Admin only' }, 403);
    }
    this.googleCalendar.saveDbCredentials(body.refresh_token || '', body.calendar_id, body.enabled);
    return { success: true };
  }
}
