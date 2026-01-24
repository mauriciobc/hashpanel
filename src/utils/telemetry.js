import { appConfig as config } from '../config/index.js';
import { logger } from './logger.js';

const TELEMETRY_ENDPOINT = 'http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840';

/**
 * Send telemetry data to the ingestion service
 * @param {Object} data - Telemetry payload
 */
export const sendTelemetry = async (data) => {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_TELEMETRY === 'true') {
    return;
  }

  const payload = {
    ...data,
    timestamp: Date.now(),
    sessionId: 'debug-session',
    runId: 'run1',
    hypothesisId: data.hypothesisId || 'default',
  };

  try {
    const response = await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.debug('Telemetry ingestion failed', { status: response.status });
    }
  } catch (error) {
    // Ignore telemetry errors to avoid crashing the main application
    logger.debug('Telemetry network error', { error: error.message });
  }
};
