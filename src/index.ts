import 'dotenv/config';

// Polyfill for DOMMatrix (required by pdf-parse in server environment)
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init?: string | number[]) {
      // Simple DOMMatrix implementation for server-side
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
      
      if (init) {
        if (typeof init === 'string') {
          // Parse matrix string
          const values = init.replace(/matrix\(|\)/g, '').split(',').map(Number);
          if (values.length === 6) {
            [this.a, this.b, this.c, this.d, this.e, this.f] = values;
          }
        } else if (Array.isArray(init) && init.length === 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }
    }
    
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
    
    scale(scaleX: number, scaleY: number = scaleX) {
      return new DOMMatrix([this.a * scaleX, this.b * scaleY, this.c * scaleX, this.d * scaleY, this.e, this.f]);
    }
    
    translate(tx: number, ty: number) {
      return new DOMMatrix([this.a, this.b, this.c, this.d, this.e + tx, this.f + ty]);
    }
    
    toString() {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
  } as any;
}
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initSentry, sentryRequestHandler, sentryTracingHandler, sentryErrorHandler } from './utils/sentry';
import { config } from './config';
import { createAuthRouter } from './routes/auth';
import { createEmailOtpRouter } from './routes/emailOtp';
import { createGoogleAuthRouter } from './routes/google';
import { createAppleAuthRouter } from './routes/apple';
import { createPasswordResetRouter } from './routes/passwordReset';
import { createDeleteAccountRouter } from './routes/deleteAccount';
import { createPremiumRouter } from './routes/premium';
// Chat router: resolve robustly to avoid ESM/CJS interop issues in Render
// We intentionally avoid static import here
import notificationRouter from './routes/notifications';
import revenuecatWebhookRouter from './revenuecat_webhook/revenuecatWebhook';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import { cleanupRateLimits } from './middleware/rateLimitMiddleware';
import { SessionService } from './services/sessionService';
import { auditService } from './services/auditService';
import { cacheService } from './services/cacheService';
import { databaseManager } from './config/database';
import { backupService } from './services/backupService';
import { dataRetentionService } from './services/dataRetentionService';
import { initializeWebSocket } from './services/websocketService';
import { createCorsOptions, getAllowedOriginsSnapshot } from './utils/cors';
import { 
  globalErrorHandler, 
  notFound, 
  handleUnhandledRejection, 
  handleUncaughtException
} from './middleware/errorHandler';
import { logger } from './utils/logger';
import { initializeRedis } from './redis';

// Initialize Sentry first
initSentry();

// Test logger configuration
logger.info({
  environment: process.env.NODE_ENV,
  isRender: process.env.RENDER === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  message: 'Logger initialized successfully'
}, 'Server starting up with logger configuration');

// Initialize database and cache
const initializeServices = async () => {
  try {
    // Initialize Redis first
    await initializeRedis();

    // Initialize database
    await databaseManager.initialize({
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      privateKey: process.env.FIREBASE_PRIVATE_KEY || '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      maxConnections: 100,
      maxIdleTime: 300000,
      connectionTimeout: 30000,
      requestTimeout: 60000,
    });

    // Test cache connection
    const cacheConnected = await cacheService.ping();
    if (!cacheConnected) {
      logger.warn('Cache service not available, continuing without cache');
    }

    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error({ err: error }, 'Service initialization failed');
    process.exit(1);
  }
};

// Initialize services before creating app
let app: express.Application;

const startServer = async () => {
  try {
    // Initialize services first
    await initializeServices();
    
    // Create app after services are initialized
    app = express();

    // Dynamically load chat router to handle default/named export differences
    let createChatRouter: (() => express.Router) | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./routes/chatBridge');
      createChatRouter = (mod && (mod.createChatRouter || mod.default)) as (() => express.Router) | null;
      if (typeof createChatRouter !== 'function') {
        logger.warn({ modKeys: Object.keys(mod || {}) }, 'chatBridge export not a function');
        createChatRouter = null;
      }
    } catch (err) {
      logger.error({ err }, 'Failed to load chatBridge module');
    }

    const mountRouter = (path: string, routerFactory: () => express.Router, name: string) => {
      try {
        app.use(path, routerFactory());
        logger.info({ route: name, path }, 'Route mounted');
      } catch (err) {
        logger.error({ err, route: name, path }, 'Failed to mount route');
        throw err;
      }
    };

    const mountRouterInstance = (path: string, routerInstance: express.Router, name: string) => {
      try {
        app.use(path, routerInstance);
        logger.info({ route: name, path }, 'Route mounted');
      } catch (err) {
        logger.error({ err, route: name, path }, 'Failed to mount route instance');
        throw err;
      }
    };
    
    // Trust proxy for accurate IP addresses
    app.set('trust proxy', 1);

    // Request logging
    // app.use(requestLogger); // Commented out - not available

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    const corsOptions = createCorsOptions();
    logger.info({ allowedOrigins: getAllowedOriginsSnapshot() }, 'Configured CORS origins');
    app.use(cors(corsOptions));
    app.use(helmet());

    // Global rate limiting
    const limiter = rateLimit({ 
      windowMs: 60_000, 
      max: 100,
      message: {
        error: 'rate_limit_exceeded',
        message: 'Too many requests from this IP, please try again later.'
      }
    });
    app.use(limiter);

    // Swagger documentation
    try {
      app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
      logger.info({ path: '/docs' }, 'Swagger mounted');
    } catch (err) {
      logger.error({ err }, 'Swagger setup failed');
      throw err;
    }

    // Health check
    app.get('/health', (_req, res) => {
      res.json({ 
        ok: true, 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // API Versioning
    const API_VERSION = process.env.API_VERSION || 'v1';

    // API routes with versioning
    mountRouter(`/api/${API_VERSION}/auth`, createAuthRouter, 'auth');
    mountRouter(`/api/${API_VERSION}/auth/email`, createEmailOtpRouter, 'emailOtp');
    mountRouter(`/api/${API_VERSION}/auth/google`, createGoogleAuthRouter, 'googleAuth');
    mountRouter(`/api/${API_VERSION}/auth/apple`, createAppleAuthRouter, 'appleAuth');
    mountRouter(`/api/${API_VERSION}/auth/password-reset`, createPasswordResetRouter, 'passwordReset');
    mountRouter(`/api/${API_VERSION}/delete-account`, createDeleteAccountRouter, 'deleteAccount');
    mountRouter(`/api/${API_VERSION}/premium`, createPremiumRouter, 'premium');
    mountRouterInstance(`/api/${API_VERSION}/webhooks/revenuecat`, revenuecatWebhookRouter, 'revenuecatWebhook');
    if (createChatRouter) {
      mountRouter(`/api/${API_VERSION}/chat`, createChatRouter, 'chat');
    }


    // Legacy routes (backward compatibility)
    mountRouter('/auth', createAuthRouter, 'auth (legacy)');
    mountRouter('/auth/email', createEmailOtpRouter, 'emailOtp (legacy)');
    mountRouter('/auth/google', createGoogleAuthRouter, 'googleAuth (legacy)');
    mountRouter('/auth/apple', createAppleAuthRouter, 'appleAuth (legacy)');
    mountRouter('/auth/password-reset', createPasswordResetRouter, 'passwordReset (legacy)');
    mountRouter('/delete-account', createDeleteAccountRouter, 'deleteAccount (legacy)');
    mountRouter('/premium', createPremiumRouter, 'premium (legacy)');
    mountRouterInstance('/webhooks/revenuecat', revenuecatWebhookRouter, 'revenuecatWebhook (legacy)');
    if (createChatRouter) {
      mountRouter('/chat', createChatRouter, 'chat (legacy)');
    }
    mountRouterInstance('/notifications', notificationRouter, 'notifications');

    // 404 handler (must be before error handler)
    app.use(notFound);

    // Sentry error handler (must be before other error handlers)
    app.use(sentryErrorHandler);

    // Global error handler (must be last)
    app.use(globalErrorHandler);

    // Start server
    const server = app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Server listening');
    });

    // Initialize WebSocket
    initializeWebSocket(server);

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

    // Error handling setup
    handleUncaughtException();
    handleUnhandledRejection();

    // Cleanup tasks (run every hour)
    setInterval(async () => {
      try {
        const { PasswordResetService } = await import('./services/passwordResetService');
        await Promise.all([
          SessionService.cleanupExpiredSessions(),
          auditService.cleanupOldAuditLogs(90), // Keep 90 days
          PasswordResetService.cleanupExpiredTokens(),
          cleanupRateLimits(),
        ]);
        logger.info('Cleanup tasks completed');
      } catch (error) {
        logger.error({ error }, 'Cleanup tasks failed');
      }
    }, 60 * 60 * 1000); // 1 hour

    // Data retention cleanup (run daily at 3 AM)
    setInterval(async () => {
      try {
        const results = await dataRetentionService.runRetentionPolicies();
        const totalDeleted = results.reduce((sum, result) => sum + result.deletedCount, 0);
        logger.info(`Data retention cleanup completed: ${totalDeleted} documents deleted`);
      } catch (error) {
        logger.error('Data retention cleanup failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Backup tasks (run daily at 2 AM)
    setInterval(async () => {
      try {
        const backupResult = await backupService.createFullBackup();
        if (backupResult.success) {
          logger.info(`Daily backup completed: ${backupResult.backupId}`);
        } else {
          logger.error(`Daily backup failed: ${backupResult.error}`);
        }
      } catch (error) {
        logger.error('Backup task failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Cleanup old backups (run weekly)
    setInterval(async () => {
      try {
        const deletedCount = await backupService.cleanupOldBackups();
        logger.info(`Backup cleanup completed: ${deletedCount} old backups deleted`);
      } catch (error) {
        logger.error('Backup cleanup failed:', error);
      }
    }, 7 * 24 * 60 * 60 * 1000); // 7 days

  } catch (error) {
    logger.error({ err: error }, 'Server startup failed');
    process.exit(1);
  }
};

// Start the server
startServer().catch(err => {
  logger.error({ error: err }, 'Failed to start server');
  process.exit(1);
});

