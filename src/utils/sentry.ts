import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { httpIntegration } from '@sentry/node';
import { expressIntegration } from '@sentry/node';

export const initSentry = () => {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    integrations: [
      // Enable HTTP calls tracing
      httpIntegration(),
      // Enable Express.js tracing
      expressIntegration(),
      // Enable profiling
      nodeProfilingIntegration(),
    ],
    // Performance Monitoring
    beforeSend(event) {
      // Filter out sensitive data
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      if (event.request?.headers?.authorization) {
        event.request.headers.authorization = '[Filtered]';
      }
      return event;
    },
  });
};

export const captureException = (error: Error, context?: any) => {
  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext('additional_info', context);
    }
    Sentry.captureException(error);
  });
};

export const captureMessage = (message: string, level: 'info' | 'warning' | 'error' = 'info', context?: any) => {
  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext('additional_info', context);
    }
    Sentry.captureMessage(message, level);
  });
};

export const setUser = (user: { id: string; email?: string; username?: string }) => {
  Sentry.setUser(user);
};

export const addBreadcrumb = (message: string, category: string, level: 'info' | 'warning' | 'error' = 'info', data?: any) => {
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
    timestamp: Date.now() / 1000,
  });
};

export const setTag = (key: string, value: string) => {
  Sentry.setTag(key, value);
};

export const setContext = (key: string, context: any) => {
  Sentry.setContext(key, context);
};

// Performance monitoring
export const startTransaction = (name: string, op: string) => {
  return Sentry.startSpan({ name, op }, () => {});
};

export const finishTransaction = (transaction: any) => {
  // Transactions are automatically finished in new Sentry versions
  return transaction;
};

// Custom error types for better categorization
export const ErrorTypes = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  VALIDATION: 'validation',
  NETWORK: 'network',
  DATABASE: 'database',
  EXTERNAL_API: 'external_api',
  BUSINESS_LOGIC: 'business_logic',
  SYSTEM: 'system',
} as const;

export const captureError = (error: Error, type: string, context?: any) => {
  Sentry.withScope((scope) => {
    scope.setTag('error_type', type);
    if (context) {
      scope.setContext('error_context', context);
    }
    Sentry.captureException(error);
  });
};

// Request ID middleware for Sentry
export const sentryRequestHandler = () => {};
export const sentryTracingHandler = () => {};
export const sentryErrorHandler = () => {};

