import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { GoogleCalendarClient } from './google-calendar.client';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleCalendarController } from './google-calendar.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarClient, GoogleCalendarService],
  exports: [GoogleCalendarService, GoogleCalendarClient],
})
export class GoogleCalendarModule {}
