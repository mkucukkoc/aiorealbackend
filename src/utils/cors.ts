import type { CorsOptions } from 'cors';
import { config } from '../config';
import { logger } from './logger';

const DEFAULT_PORT_BY_PROTOCOL: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

const expandOriginVariants = (origin: string): string[] => {
  const variants = new Set<string>();
  const trimmed = origin.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed === '*') {
    variants.add('*');
    return Array.from(variants);
  }

  variants.add(trimmed);

  try {
    const url = new URL(trimmed);
    variants.add(`${url.protocol}//${url.host}`);
    variants.add(`${url.protocol}//${url.hostname}`);

    if (!url.port) {
      const defaultPort = DEFAULT_PORT_BY_PROTOCOL[url.protocol];
      if (defaultPort) {
        variants.add(`${url.protocol}//${url.hostname}:${defaultPort}`);
      }
    }
  } catch (error) {
    logger.warn({ origin: trimmed, error }, 'Failed to parse origin for normalization');
  }

  return Array.from(variants);
};

const buildAllowedOrigins = (origins: string[]): Set<string> => {
  const allowed = new Set<string>();

  origins.forEach(origin => {
    expandOriginVariants(origin).forEach(variant => allowed.add(variant));
  });

  if (allowed.size === 0) {
    allowed.add('*');
  }

  return allowed;
};

const allowedOrigins = buildAllowedOrigins(config.corsOrigin);

const isOriginAllowed = (origin?: string | null): boolean => {
  if (!origin || allowedOrigins.has('*')) {
    return true;
  }

  const trimmed = origin.trim();
  if (!trimmed) {
    return true;
  }

  if (allowedOrigins.has(trimmed)) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    const candidates = new Set<string>();
    candidates.add(`${url.protocol}//${url.host}`);
    candidates.add(`${url.protocol}//${url.hostname}`);

    if (!url.port) {
      const defaultPort = DEFAULT_PORT_BY_PROTOCOL[url.protocol];
      if (defaultPort) {
        candidates.add(`${url.protocol}//${url.hostname}:${defaultPort}`);
      }
    }

    for (const candidate of candidates) {
      if (allowedOrigins.has(candidate)) {
        return true;
      }
    }
  } catch (error) {
    logger.warn({ origin: trimmed, error }, 'Failed to parse origin when validating CORS');
  }

  return false;
};

export const createCorsOptions = (): CorsOptions => ({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    logger.warn({ origin }, 'CORS policy rejected origin');
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
});

export const isWebSocketOriginAllowed = (origin?: string | null): boolean => {
  return isOriginAllowed(origin);
};

export const getAllowedOriginsSnapshot = (): string[] => Array.from(allowedOrigins);

