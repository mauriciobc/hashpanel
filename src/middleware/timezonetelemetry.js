import telemetryService from '../services/telemetryService.js';
import { isAtTimezoneBoundary } from '../utils/timezone.js';

/**
 * Middleware to track timezone usage telemetry
 * Automatically tracks timezone from query parameters
 */
export function timezonetelemetryMiddleware(req, res, next) {
  const timezone = req.query.timezone;
  
  if (timezone) {
    const context = {
      endpoint: req.path,
      method: req.method,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    };

    // Track timezone usage
    telemetryService.trackTimezone(timezone, context);

    // Check if request is near timezone boundary
    if (isAtTimezoneBoundary(new Date(), timezone, 60)) {
      telemetryService.trackBoundaryRequest(timezone);
    }
  }

  next();
}

export default timezonetelemetryMiddleware;
