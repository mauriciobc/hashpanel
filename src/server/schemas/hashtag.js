import { z } from 'zod';

export const hashtagParamsSchema = z.object({
  hashtag: z
    .string()
    .min(1)
    .transform((val) => val.replace(/^#/, '')),
});

export const timezoneSchema = z
  .string()
  .optional()
  .refine(
    (tz) => {
      if (!tz) return true;
      // Use Intl.DateTimeFormat for validation (more reliable than moment.tz.zone)
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    {
      message: 'Invalid IANA timezone identifier',
    }
  );

export const statsQuerySchema = z.object({
  timeframe: z.enum(['today', 'week', 'month', 'all']).default('today'),
  timezone: timezoneSchema,
});

export const timelineQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const analysisQuerySchema = z.object({
  includeToots: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const usersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const historyQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  week: z.coerce.number().int().min(1).max(53).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  daily: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});
