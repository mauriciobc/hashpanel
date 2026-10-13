import { randomUUID } from 'crypto';
import { appConfig as config } from '../config/index.js';
import { logger } from './logger.js';

// Generate once per module load (per process)
const SESSION_ID = randomUUID();

/**
 * Telemetry is opt-in and disabled by default.
 * Events are only sent when a TELEMETRY_ENDPOINT is configured, and never
 * while running tests or when DISABLE_TELEMETRY is set to 'true'.
 *
 * @returns {boolean} True when telemetry events should be sent
 */
export const isTelemetryEnabled = () =>
  process.env.NODE_ENV !== 'test' &&
  process.env.DISABLE_TELEMETRY !== 'true' &&
  Boolean(config.telemetry.endpoint);

/**
 * Send an anonymous telemetry event to the configured endpoint.
 * Fire-and-forget: this never throws and never blocks the caller's flow.
 *
 * @param {Object} event - Event data (e.g. { event: 'server_started' })
 * @returns {Promise<void>}
 */
export const sendTelemetry = async (event = {}) => {
  if (!isTelemetryEnabled()) {
    return;
  }

  const payload = {
    ...event,
    timestamp: Date.now(),
    sessionId: event.sessionId || SESSION_ID,
  };

  try {
    const response = await fetch(config.telemetry.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.debug('Telemetry ingestion failed', { status: response.status });
    }
  } catch (error) {
    // Never let telemetry failures affect the application
    logger.debug('Telemetry network error', { error: error?.message });
  }
};
