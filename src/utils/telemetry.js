import { logger } from './logger.js';

/**
 * Get the default telemetry endpoint based on environment
 * @returns {string} The telemetry endpoint URL
 */
const getDefaultEndpoint = () => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  return isDevelopment
    ? 'http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840'
    : 'https://telemetry.hashpanel.com/ingest/f426892d-b7cd-4420-929c-80542dc01840';
};

import { randomUUID } from 'crypto';

// Generate once per module load (per process)
const SESSION_ID = randomUUID();

const TELEMETRY_ENDPOINT = getDefaultEndpoint();

export const sendTelemetry = async (data) => {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_TELEMETRY === 'true') {
    return;
  }

  const payload = {
    ...data,
    timestamp: Date.now(),
    sessionId: data.sessionId || SESSION_ID,
    runId: data.runId,
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
    logger?.debug?.('Telemetry network error', { error: error?.message, stack: error?.stack });
  }
};