import logger from '../utils/logger.js';
import { getTimezoneInfo, getTimezoneOffset } from '../utils/timezone.js';

/**
 * Telemetry service for tracking timezone usage patterns
 * Collects anonymous usage statistics to understand how users interact with the system
 */

class TelemetryService {
  constructor() {
    // In-memory storage for telemetry data
    this.timezoneUsage = new Map(); // timezone -> count
    this.requestsByTimezone = new Map(); // timezone -> array of timestamps
    this.uniqueTimezones = new Set();
    this.startTime = new Date();
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      requestsWithTimezone: 0,
      requestsWithoutTimezone: 0,
      invalidTimezones: 0,
      boundaryRequests: 0, // Requests near midnight
    };
  }

  /**
   * Track a timezone usage event
   * @param {string} timezone - IANA timezone identifier
   * @param {Object} context - Additional context (endpoint, user agent, etc.)
   */
  trackTimezone(timezone, context = {}) {
    if (!timezone) {
      this.stats.requestsWithoutTimezone++;
      this.stats.totalRequests++;
      return;
    }

    this.stats.totalRequests++;
    this.stats.requestsWithTimezone++;

    // Validate timezone
    const tzInfo = getTimezoneInfo(timezone);
    if (!tzInfo.isValid) {
      this.stats.invalidTimezones++;
      logger.warn('Invalid timezone tracked', { timezone, context });
      return;
    }

    // Track unique timezone
    this.uniqueTimezones.add(timezone);

    // Increment usage count
    const currentCount = this.timezoneUsage.get(timezone) || 0;
    this.timezoneUsage.set(timezone, currentCount + 1);

    // Track request timestamp
    if (!this.requestsByTimezone.has(timezone)) {
      this.requestsByTimezone.set(timezone, []);
    }
    this.requestsByTimezone.get(timezone).push({
      timestamp: new Date().toISOString(),
      endpoint: context.endpoint,
      userAgent: context.userAgent,
    });

    // Log periodically (every 100 requests)
    if (this.stats.totalRequests % 100 === 0) {
      this._logSummary();
    }
  }

  /**
   * Track a request near timezone boundary (midnight)
   * @param {string} timezone - IANA timezone identifier
   * @param {Date} requestTime - Time of request
   */
  trackBoundaryRequest(timezone, requestTime = new Date()) {
    this.stats.boundaryRequests++;
    logger.debug('Request near timezone boundary detected', {
      timezone,
      requestTime: requestTime.toISOString(),
      timezoneOffset: getTimezoneOffset(timezone),
    });
  }

  /**
   * Get telemetry statistics
   * @returns {Object} Telemetry data
   */
  getStats() {
    const topTimezones = Array.from(this.timezoneUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tz, count]) => ({
        timezone: tz,
        offset: getTimezoneOffset(tz),
        count,
        percentage: ((count / this.stats.requestsWithTimezone) * 100).toFixed(1),
      }));

    return {
      uptime: Date.now() - this.startTime.getTime(),
      stats: { ...this.stats },
      uniqueTimezones: this.uniqueTimezones.size,
      topTimezones,
      timezoneDistribution: Object.fromEntries(this.timezoneUsage),
    };
  }

  /**
   * Get timezone usage for a specific timezone
   * @param {string} timezone - IANA timezone identifier
   * @returns {Object} Usage statistics for the timezone
   */
  getTimezoneUsage(timezone) {
    return {
      timezone,
      count: this.timezoneUsage.get(timezone) || 0,
      requests: this.requestsByTimezone.get(timezone) || [],
      info: getTimezoneInfo(timezone),
    };
  }

  /**
   * Reset telemetry data
   */
  reset() {
    this.timezoneUsage.clear();
    this.requestsByTimezone.clear();
    this.uniqueTimezones.clear();
    this.stats = {
      totalRequests: 0,
      requestsWithTimezone: 0,
      requestsWithoutTimezone: 0,
      invalidTimezones: 0,
      boundaryRequests: 0,
    };
    this.startTime = new Date();
    logger.info('Telemetry data reset');
  }

  /**
   * Log summary of telemetry data
   * @private
   */
  _logSummary() {
    const stats = this.getStats();
    logger.info('Timezone telemetry summary', {
      totalRequests: stats.stats.totalRequests,
      uniqueTimezones: stats.uniqueTimezones,
      topTimezone: stats.topTimezones[0]?.timezone,
      withTimezone: stats.stats.requestsWithTimezone,
      withoutTimezone: stats.stats.requestsWithoutTimezone,
    });
  }

  /**
   * Export telemetry data for analysis
   * @returns {Object} Exportable telemetry data
   */
  export() {
    const stats = this.getStats();
    return {
      exportedAt: new Date().toISOString(),
      uptime: stats.uptime,
      stats: stats.stats,
      uniqueTimezones: stats.uniqueTimezones,
      topTimezones: stats.topTimezones,
      allTimezones: Array.from(this.uniqueTimezones).sort(),
      timezoneUsage: Object.fromEntries(
        Array.from(this.timezoneUsage.entries()).sort((a, b) => b[1] - a[1])
      ),
    };
  }
}

// Singleton instance
const telemetryService = new TelemetryService();

export default telemetryService;
