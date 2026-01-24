import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables once at module import
config();

// Environment variable schema with validation
const envSchema = z.object({
  // Required Mastodon configuration
  MASTODON_URL: z.string().url({ message: 'MASTODON_URL must be a valid URL' }),
  CLIENT_KEY: z.string().min(1, { message: 'CLIENT_KEY is required' }),
  CLIENT_SECRET: z.string().min(1, { message: 'CLIENT_SECRET is required' }),
  ACCESS_TOKEN: z.string().min(1, { message: 'ACCESS_TOKEN is required' }),

  // Optional configuration with defaults
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  PREFERRED_TIMEZONE: z
    .string()
    .default('America/Sao_Paulo')
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      {
        message:
          'PREFERRED_TIMEZONE must be a valid IANA timezone identifier (e.g., America/Sao_Paulo, UTC, Europe/London)',
      }
    ),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Performance settings
  API_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  RATE_LIMIT_DELAY_MS: z.coerce.number().int().min(0).default(1000),
  MAX_API_PAGES: z.coerce.number().int().min(1).default(20),
  TOOTS_PER_PAGE: z.coerce.number().int().min(1).default(40),

  // Cache settings
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(300),
  ENABLE_CACHE: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),

  // Media proxy settings
  MEDIA_PROXY_ALLOWLIST: z.string().optional().default(''),
  MEDIA_PROXY_CACHE_MAX_MB: z.coerce.number().int().min(1).default(50),
  MEDIA_PROXY_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).default(200),

  // Health check settings
  HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().min(500).default(2500),
});

// Parse and validate environment variables
export const env = envSchema.parse(process.env);

// Export configuration object for easy access
export const appConfig = {
  mastodon: {
    url: env.MASTODON_URL,
    clientKey: env.CLIENT_KEY,
    clientSecret: env.CLIENT_SECRET,
    accessToken: env.ACCESS_TOKEN,
    timeout: env.API_TIMEOUT_MS,
  },
  server: {
    port: parseInt(env.PORT),
    host: env.HOST,
    timezone: env.PREFERRED_TIMEZONE,
    environment: env.NODE_ENV,
  },
  performance: {
    rateLimitDelay: env.RATE_LIMIT_DELAY_MS,
    maxApiPages: env.MAX_API_PAGES,
    tootsPerPage: env.TOOTS_PER_PAGE,
  },
  cache: {
    enabled: env.ENABLE_CACHE,
    ttlSeconds: env.CACHE_TTL_SECONDS,
  },
  media: {
    allowlist: env.MEDIA_PROXY_ALLOWLIST
      ? env.MEDIA_PROXY_ALLOWLIST.split(',').map((entry) => entry.trim()).filter(Boolean)
      : [
          'cdn.ursal.zone',
          'i.cdn.ursal.zone',
          'files.mastodon.social',
          'media.mastodon.social',
          'cdn.mastodon.social',
        ],
    cacheMaxBytes: env.MEDIA_PROXY_CACHE_MAX_MB * 1024 * 1024,
    cacheMaxEntries: env.MEDIA_PROXY_CACHE_MAX_ENTRIES,
  },
  health: {
    timeoutMs: env.HEALTHCHECK_TIMEOUT_MS,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
};
