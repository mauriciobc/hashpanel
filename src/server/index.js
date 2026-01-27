import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { appConfig as config } from '../config/index.js';
import { SERVER_CONFIG, validateCorsConfig } from '../constants/index.js';
import { logger, loggers } from '../utils/logger.js';
import { errorHandler, notFoundHandler, requestLogger } from '../middleware/errorHandler.js';
import { apiRateLimit } from '../middleware/rateLimiter.js';
import timezonetelemetryMiddleware from '../middleware/timezonetelemetry.js';
import { apiRoutes } from './routes/index.js';
import { sendTelemetry } from '../utils/telemetry.js';
import { mastodonService } from '../services/mastodon.js';
import { hashtagListener } from '../services/hashtagListener.js';
import { getDatabase } from '../database/index.js';

export class WebServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.isStarted = false;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Trust proxy - required when behind reverse proxy (Caddy, nginx, etc.)
    // This allows Express to correctly identify client IPs from X-Forwarded-For headers
    // Configure trust proxy securely: only trust first proxy (the reverse proxy itself)
    // This prevents clients from spoofing X-Forwarded-For headers to bypass rate limiting
    // For Docker: typically 1 proxy (Caddy/nginx) between client and app
    // For direct deployment: set to false or specific IP ranges
    const trustProxyValue =
      process.env.TRUST_PROXY === 'false'
        ? false
        : process.env.TRUST_PROXY
          ? parseInt(process.env.TRUST_PROXY, 10) || 1
          : 1; // Default to 1 proxy (secure: only trust the immediate reverse proxy)

    this.app.set('trust proxy', trustProxyValue);

    // Request logging
    this.app.use(requestLogger);

    // Response compression - reduces payload size by 60-80%
    this.app.use(compression({ threshold: 1024 }));

    // CORS configuration
    // Uses CORS_OPTIONS from constants to ensure consistency
    // When credentials: true, origin cannot be '*' - handled in constants
    this.app.use(
      cors({
        ...SERVER_CONFIG.CORS_OPTIONS,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      })
    );

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    this.app.use('/api', apiRateLimit);

    // Timezone telemetry tracking
    this.app.use('/api', timezonetelemetryMiddleware);

    // Static files
    this.app.use(
      express.static('public', {
        maxAge: '1h', // Cache static files for 1 hour
        etag: true,
        lastModified: true,
      })
    );

    logger.debug('Express middleware configured');
  }

  /**
   * Setup application routes
   */
  setupRoutes() {
    // Health check endpoint (before API routes)
    this.app.get('/health', this.healthCheck);

    // API routes
    this.app.use('/api', apiRoutes);

    // Serve frontend (catch-all for SPA)
    this.app.get('*', this.serveFrontend);

    logger.debug('Application routes configured');
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);

    logger.debug('Error handling configured');
  }

  /**
   * Health check endpoint
   */
  healthCheck = async (req, res) => {
    sendTelemetry({
      location: 'src/server/index.js:92',
      message: 'Healthcheck started',
      data: { uptime: process.uptime() },
      hypothesisId: 'B',
    });
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.server.environment,
        version: process.env.npm_package_version || '1.0.0',
        services: {
          mastodon: 'unknown',
          database: 'unknown',
          websocket: 'unknown',
        },
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
          total: Math.round(process.memoryUsage().heapTotal / (1024 * 1024)),
        },
      };

      // Test Mastodon connectivity
      sendTelemetry({
        location: 'src/server/index.js:111',
        message: 'Before Mastodon API test',
        data: {},
        hypothesisId: 'B',
      });
      try {
        // Quick API call to test connectivity
        await withTimeout(
          mastodonService.getTrendingTags(1),
          config.health.timeoutMs,
          'Mastodon health check timeout'
        );
        sendTelemetry({
          location: 'src/server/index.js:114',
          message: 'Mastodon API test succeeded',
          data: {},
          hypothesisId: 'B',
        });
        health.services.mastodon = 'healthy';
      } catch (error) {
        sendTelemetry({
          location: 'src/server/index.js:117',
          message: 'Mastodon API test failed',
          data: { error: error.message, code: error.code, timeoutMs: config.health.timeoutMs },
          hypothesisId: 'B',
        });
        health.services.mastodon = 'unhealthy';
        health.status = 'degraded';
      }

      // Test database connectivity
      sendTelemetry({
        location: 'src/server/index.js:121',
        message: 'Before database health check',
        data: {},
        hypothesisId: 'C',
      });
      try {
        const dbHealth = getDatabase().healthCheck();
        sendTelemetry({
          location: 'src/server/index.js:123',
          message: 'Database health check succeeded',
          data: { status: dbHealth.status },
          hypothesisId: 'C',
        });
        health.services.database = dbHealth.status;
        if (dbHealth.status !== 'healthy') {
          health.status = 'degraded';
        }
      } catch (error) {
        sendTelemetry({
          location: 'src/server/index.js:128',
          message: 'Database health check failed',
          data: { error: error.message, code: error.code },
          hypothesisId: 'C',
        });
        health.services.database = 'unhealthy';
        health.status = 'degraded';
      }

      // Check WebSocket status
      try {
        const wsStatus = hashtagListener.getStatus();
        if (wsStatus.connected) {
          health.services.websocket = 'healthy';
          health.websocket = {
            connected: true,
            readyState: wsStatus.readyState,
            connectionDurationMs: wsStatus.connectionDurationMs,
            eventCount: wsStatus.eventCount,
            timeSinceLastEventMs: wsStatus.timeSinceLastEventMs
          };
        } else {
          health.services.websocket = 'unhealthy';
          health.status = 'degraded';
          health.websocket = {
            connected: false,
            readyState: wsStatus.readyState,
            reconnectAttempts: wsStatus.reconnectAttempts
          };
        }
      } catch (error) {
        logger.debug('Error checking WebSocket status in health check', {
          error: error.message
        });
        health.services.websocket = 'unknown';
        health.status = 'degraded';
        health.websocket = { connected: false };
      }

      // Determine HTTP status code
      const statusCode = health.status === 'healthy' ? 200 : 503;

      loggers.apiRequest(req.method, req.url);
      loggers.apiResponse(req.method, req.url, statusCode, 0);

      res.status(statusCode).json(health);
    } catch (error) {
      logger.error('Health check failed', error);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  };

  /**
   * Serve frontend application
   */
  serveFrontend = (req, res, next) => {
    // Don't serve frontend for API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }

    // Serve index.html for SPA routing
    res.sendFile('index.html', { root: 'public' }, (error) => {
      if (error) {
        // Handle aborted requests gracefully (common for cached resources like favicon)
        if (error.code === 'ECONNABORTED') {
          logger.debug('Client aborted request', {
            path: req.path,
            method: req.method,
          });
          // Don't try to send a response if connection is already closed
          return;
        }

        // Log actual errors
        logger.error('Failed to serve frontend', error, {
          path: req.path,
          code: error.code,
        });

        // Only try to send error response if connection is still open
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Failed to serve frontend',
            code: 'FRONTEND_ERROR',
          });
        }
      }
    });
  };

  /**
   * Start the web server
   */
  async start() {
    if (this.isStarted) {
      throw new Error('Server is already started');
    }

    // Validate CORS configuration before starting server
    // This ensures fast failure if production config is invalid
    validateCorsConfig();

    return new Promise((resolve, reject) => {
      sendTelemetry({
        location: 'src/server/index.js:183',
        message: 'Before server.listen',
        data: { host: config.server.host, port: config.server.port },
        hypothesisId: 'A',
      });
      try {
        this.server = this.app.listen(config.server.port, config.server.host, () => {
          sendTelemetry({
            location: 'src/server/index.js:186',
            message: 'Server listen callback executed',
            data: { host: config.server.host, port: config.server.port },
            hypothesisId: 'A',
          });
          this.isStarted = true;

          logger.info('Web server started successfully', {
            host: config.server.host,
            port: config.server.port,
            environment: config.server.environment,
            nodeVersion: process.version,
            pid: process.pid,
          });

          loggers.business('server_started', {
            host: config.server.host,
            port: config.server.port,
            environment: config.server.environment,
          });

          // Inicia o listener de hashtag em background
          hashtagListener.start().catch(err => {
            logger.error('Falha ao iniciar HashtagListener em background', err);
          });

          resolve();
        });

        this.server.on('error', (error) => {
          sendTelemetry({
            location: 'src/server/index.js:205',
            message: 'Server error event',
            data: { error: error.message, code: error.code },
            hypothesisId: 'A',
          });
          logger.error('Server startup failed', error);
          reject(error);
        });

        // Handle server errors
        this.server.on('clientError', (error, socket) => {
          logger.warn('Client error', error);
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        });
      } catch (error) {
        logger.error('Failed to start server', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the web server
   */
  async stop() {
    if (!this.isStarted || !this.server) {
      logger.warn('Server is not running');
      return;
    }

    return new Promise((resolve) => {
      logger.info('Stopping web server...');

      // Para o listener de hashtag
      hashtagListener.stop();

      this.server.close((error) => {
        if (error) {
          logger.error('Error stopping server', error);
        } else {
          logger.info('Web server stopped successfully');
          loggers.business('server_stopped');
        }

        this.isStarted = false;
        resolve();
      });

      // Force close after 10 seconds
      setTimeout(() => {
        if (this.isStarted) {
          logger.warn('Force closing server after timeout');
          this.server.close();
          this.isStarted = false;
          resolve();
        }
      }, 10000);
    });
  }

  /**
   * Graceful shutdown handler
   */
  async shutdown() {
    logger.info('Initiating graceful shutdown...');

    try {
      // Stop accepting new connections
      await this.stop();

      // Cleanup resources
      await this.cleanup();

      logger.info('Graceful shutdown completed');
    } catch (error) {
      logger.error('Error during shutdown', error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Close database connections, clear caches, etc.
    // This would be expanded based on actual resources used

    try {
      // Clear any caches
      if (global.gc) {
        global.gc();
      }

      logger.debug('Resources cleaned up');
    } catch (error) {
      logger.error('Error during cleanup', error);
    }
  }

  /**
   * Get server instance
   */
  getServer() {
    return this.server;
  }

  /**
   * Get Express app instance
   */
  getApp() {
    return this.app;
  }

  /**
   * Check if server is running
   */
  isRunning() {
    return this.isStarted;
  }

  /**
   * Get server statistics
   */
  async getStats() {
    const connections = await this.getConnectionsCount();

    return {
      isStarted: this.isStarted,
      port: config.server.port,
      environment: config.server.environment,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      nodeVersion: process.version,
      connections,
    };
  }

  /**
   * Get active connections count using modern Node.js API
   */
  async getConnectionsCount() {
    if (!this.server || !this.server.getConnections) {
      return 'unknown';
    }

    return new Promise((resolve) => {
      this.server.getConnections((err, count) => {
        if (err) {
          resolve('unknown');
        } else {
          resolve(count);
        }
      });
    });
  }

  /**
   * Get request statistics (placeholder for future implementation)
   */
  getRequestStats() {
    // This would typically track request counts, response times, etc.
    return {
      totalRequests: 0,
      averageResponseTime: 0,
      errorRate: 0,
      lastRequestTime: null,
    };
  }
}

// Create singleton instance
export const webServer = new WebServer();

// Handle process signals for graceful shutdown
process.on('SIGTERM', async () => {
  await handleShutdownSignal('SIGTERM');
});

process.on('SIGINT', async () => {
  await handleShutdownSignal('SIGINT');
});

// Helper function to check if an error is a network timeout error
// Handles both direct ETIMEDOUT errors and AggregateErrors containing ETIMEDOUT
function isNetworkTimeoutError(error) {
  // Check direct ETIMEDOUT error
  if (error?.code === 'ETIMEDOUT') {
    return true;
  }

  // Check if it's an AggregateError and if any of its errors are ETIMEDOUT
  if (error?.name === 'AggregateError' && Array.isArray(error.errors)) {
    return error.errors.some((err) => err?.code === 'ETIMEDOUT');
  }

  // Also check the code property on AggregateError itself (some implementations set it)
  if (error?.name === 'AggregateError' && error?.code === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error(message);
      timeoutError.code = 'ETIMEDOUT';
      reject(timeoutError);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

async function handleShutdownSignal(signal) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  try {
    await webServer.shutdown();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
}

function handleNetworkTimeoutNotice(source, error, hypothesisId, extraData = {}) {
  sendTelemetry({
    location: `src/server/index.js:${source}`,
    message: `Network timeout detected in ${source}`,
    data: {
      code: error.code,
      name: error.name,
      isAggregate: error.name === 'AggregateError',
      errorsCount: error.errors?.length,
      ...extraData,
    },
    hypothesisId,
  });
  logger.debug(
    'Network timeout error from connection retry (non-fatal) - server continues running',
    {
      code: error.code,
      name: error.name,
      message: error.message || 'Connection timeout during retry',
      isAggregateError: error.name === 'AggregateError',
      errorsCount: error.errors?.length || 0,
    }
  );
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  sendTelemetry({
    location: 'src/server/index.js:442',
    message: 'Uncaught exception handler',
    data: {
      error: error.message,
      code: error.code,
      name: error.name,
      isAggregate: error.name === 'AggregateError',
      errorsCount: error.errors?.length,
      stack: error.stack?.substring(0, 200),
    },
    hypothesisId: 'C',
  });

  // Don't shutdown for network timeout errors - these are often transient
  // ETIMEDOUT errors from network operations should not crash the server
  // These errors typically occur from connection retries or keep-alive connections
  // that fail after the main request has already completed successfully
  if (isNetworkTimeoutError(error)) {
    handleNetworkTimeoutNotice('uncaughtException', error, 'C');
    return; // Continue running instead of shutting down
  }

  // For other uncaught exceptions, log with full context and shutdown gracefully
  logger.error('Uncaught exception', {
    error: {
      message: error.message,
      code: error.code,
      name: error.name,
      stack: error.stack,
    },
  });

  logger.error('Shutting down due to uncaught exception');
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  sendTelemetry({
    location: 'src/server/index.js:476',
    message: 'Unhandled promise rejection',
    data: {
      reason: reason?.message || String(reason),
      code: reason?.code,
      name: reason?.name,
      isAggregate: reason?.name === 'AggregateError',
      errorsCount: reason?.errors?.length,
    },
    hypothesisId: 'B',
  });

  // Extract error information safely
  // If reason is an Error object, use it directly; otherwise create errorInfo from it
  const error = reason instanceof Error ? reason : { message: String(reason) };
  const errorInfo = {
    message: error.message || String(reason),
    code: error.code,
    name: error.name,
    stack: error.stack,
    errors: error.errors, // For AggregateError
  };

  logger.error('Unhandled promise rejection', {
    reason: errorInfo,
    promise: promise?.toString?.() || 'Unknown promise',
  });

  // Don't shutdown for network timeout errors - these are often transient
  // ETIMEDOUT errors from network operations should not crash the server
  // These errors typically occur from connection retries or keep-alive connections
  // that fail after the main request has already completed successfully
  if (isNetworkTimeoutError(error)) {
    handleNetworkTimeoutNotice('unhandledRejection', errorInfo, 'B', {
      note: 'This error typically occurs when Node.js tries multiple connection attempts and all timeout. The main request likely completed successfully.',
    });
    return; // Continue running instead of shutting down
  }

  // For other unhandled rejections, log and shutdown gracefully
  logger.error('Shutting down due to unhandled promise rejection');
  process.exit(1);
});
