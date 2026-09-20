import { z } from 'zod';

export const googleCalendarStatusSchema = z.object({
  enabled: z.boolean(),
  connected: z.boolean(),
  calendar_id: z.string(),
  email: z.string().nullable().optional(),
});
export type GoogleCalendarStatus = z.infer<typeof googleCalendarStatusSchema>;

export const googleCalendarSyncResultSchema = z.object({
  success: z.boolean(),
  total: z.number(),
  synced: z.number(),
  failed: z.number(),
  errors: z.array(z.string()).optional(),
});
export type GoogleCalendarSyncResult = z.infer<typeof googleCalendarSyncResultSchema>;
