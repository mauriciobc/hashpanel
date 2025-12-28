import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { appConfig as config } from '../config/index.js';
import { logger, loggers } from '../utils/logger.js';
import { errorHandler, notFoundHandler, requestLogger } from '../middleware/errorHandler.js';
import { apiRateLimit } from '../middleware/rateLimiter.js';
import { apiRoutes } from './routes/index.js';
import { mastodonService } from '../services/mastodon.js';

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
    // Request logging
    this.app.use(requestLogger);
    
    // Response compression - reduces payload size by 60-80%
    this.app.use(compression({ threshold: 1024 }));
    
    // CORS configuration
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Rate limiting
    this.app.use('/api', apiRateLimit);
    
    // Static files
    this.app.use(express.static('public', {
      maxAge: '1h', // Cache static files for 1 hour
      etag: true,
      lastModified: true
    }));
    
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
  async healthCheck(req, res) {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.server.environment,
        version: process.env.npm_package_version || '1.0.0',
        services: {
          mastodon: 'unknown',
          database: 'unknown'
        },
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
          total: Math.round(process.memoryUsage().heapTotal / (1024 * 1024))
        }
      };

      // Test Mastodon connectivity
      try {
        // Quick API call to test connectivity
        await mastodonService.getTrendingTags(1);
        health.services.mastodon = 'healthy';
      } catch (error) {
        health.services.mastodon = 'unhealthy';
        health.status = 'degraded';
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
        error: error.message
      });
    }
  }

  /**
   * Serve frontend application
   */
  serveFrontend(req, res, next) {
    // Don't serve frontend for API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }

    // Serve index.html for SPA routing
    res.sendFile('index.html', { root: 'public' }, (error) => {
      if (error) {
        logger.error('Failed to serve frontend', error);
        res.status(500).json({
          error: 'Failed to serve frontend',
          code: 'FRONTEND_ERROR'
        });
      }
    });
  }

  /**
   * Start the web server
   */
  async start() {
    if (this.isStarted) {
      throw new Error('Server is already started');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(config.server.port, config.server.host, () => {
          this.isStarted = true;
          
          logger.info(`Web server started successfully`, {
            host: config.server.host,
            port: config.server.port,
            environment: config.server.environment,
            nodeVersion: process.version,
            pid: process.pid
          });

          loggers.business('server_started', {
            host: config.server.host,
            port: config.server.port,
            environment: config.server.environment
          });

          resolve();
        });

        this.server.on('error', (error) => {
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
  getStats() {
    return {
      isStarted: this.isStarted,
      port: config.server.port,
      environment: config.server.environment,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      nodeVersion: process.version,
      connections: this.server?.connections || 0
    };
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
      lastRequestTime: null
    };
  }
}

// Create singleton instance
export const webServer = new WebServer();

// Handle process signals for graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, starting graceful shutdown...');
  try {
    await webServer.shutdown();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, starting graceful shutdown...');
  try {
    await webServer.shutdown();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  logger.error('Shutting down due to uncaught exception');
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  logger.error('Shutting down due to unhandled promise rejection');
  process.exit(1);
});