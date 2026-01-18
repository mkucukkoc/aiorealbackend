import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const isRender = process.env.RENDER === 'true'; // Render'da çalışıp çalışmadığını kontrol et

// Base logger configuration
const baseConfig = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => {
      return { level: label.toUpperCase() };
    },
  },
  serializers: {
    req: (req: any) => ({
      method: req.method,
      url: req.url,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
      },
      remoteAddress: req.remoteAddress,
    }),
    res: (res: any) => ({
      statusCode: res.statusCode,
      headers: res.headers,
    }),
    err: (err: any) => ({
      type: err.constructor.name,
      message: err.message,
      stack: err.stack,
      ...err,
    }),
  },
};

// Development logger (pretty print)
const developmentLogger = pino({
  ...baseConfig,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// Production logger (JSON format to console for Render)
const productionLogger = pino({
  ...baseConfig,
  // Render'da console'a yaz, dosyaya değil
  transport: undefined,
});

// Render logger (console'a yaz, pretty format)
const renderLogger = pino({
  ...baseConfig,
  level: 'debug', // Render'da daha detaylı loglar
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: false, // Render'da renk yok
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// Choose logger based on environment
export const logger = isRender ? renderLogger : (isDevelopment ? developmentLogger : productionLogger);

// Request logging middleware
export const requestLogger = (req: any, res: any, next: any) => {
  const start = Date.now();
  
  // Generate request ID
  const requestId = req.headers['x-request-id'] || 
    Math.random().toString(36).substr(2, 9);
  
  req.requestId = requestId;
  res.set('X-Request-ID', requestId);

  // Log request
  logger.info({
    req,
    requestId,
    message: 'Incoming request',
  }, `${req.method} ${req.url}`);

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk: any, encoding: any) {
    const duration = Date.now() - start;
    
    logger.info({
      res,
      requestId,
      duration,
      message: 'Request completed',
    }, `${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);

    originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Error logging helper
export const logError = (error: Error, context?: any) => {
  logger.error({
    err: error,
    context,
    message: 'Error occurred',
  }, error.message);
};

// Performance logging helper
export const logPerformance = (operation: string, duration: number, metadata?: any) => {
  logger.info({
    operation,
    duration,
    metadata,
    message: 'Performance metric',
  }, `${operation} completed in ${duration}ms`);
};

// Security event logging
export const logSecurityEvent = (event: string, details: any) => {
  logger.warn({
    securityEvent: event,
    details,
    message: 'Security event detected',
  }, `Security: ${event}`);
};

// Business logic logging
export const logBusinessEvent = (event: string, userId?: string, metadata?: any) => {
  logger.info({
    businessEvent: event,
    userId,
    metadata,
    message: 'Business event',
  }, `Business: ${event}`);
};

