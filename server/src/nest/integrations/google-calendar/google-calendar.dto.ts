import { createZodDto } from 'nestjs-zod';
import { googleCalendarSettingsRequestSchema } from '@trek/shared';

/**
 * Server-side createZodDto wrapper over the @trek/shared Google Calendar
 * contract. The global ZodValidationPipe validates any @Body() parameter typed
 * with this class by metatype.
 */
export class GoogleCalendarSettingsDto extends createZodDto(googleCalendarSettingsRequestSchema) {}
