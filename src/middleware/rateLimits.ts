import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../utils/logger';

type PlanTier = 'free' | 'premium';

const getPlanTier = (req: any): PlanTier => {
  const raw = req?.user?.planTier;
  if (typeof raw === 'string' && raw.toLowerCase().includes('premium')) {
    return 'premium';
  }
  return 'free';
};

const getIp = (req: any) => req.ip || req.connection?.remoteAddress || 'unknown';

const json429 = (message: string) => (req: any, res: any) => {
  res.status(429).json({
    error: 'rate_limit_exceeded',
    message,
  });
};

const buildLimiter = (options: {
  windowMs: number;
  max: number | ((req: any, res: any) => number);
  message: string;
  keyGenerator?: (req: any) => string;
}): RateLimitRequestHandler =>
  rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    handler: (req, res) => {
      const reqAny = req as any;
      const key = options.keyGenerator ? options.keyGenerator(reqAny) : `ip:${getIp(reqAny)}`;
      logger.warn(
        {
          key,
          ip: getIp(reqAny),
          userId: reqAny?.user?.id || null,
          planTier: getPlanTier(reqAny),
          method: req.method,
          path: req.originalUrl || req.url,
        },
        'Rate limit exceeded'
      );
      json429(options.message)(reqAny, res);
    },
    standardHeaders: true,
    legacyHeaders: true,
    keyGenerator: options.keyGenerator,
  });

export const globalIpLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many requests. Please try again later.',
  keyGenerator: (req) => `ip:${getIp(req)}`,
});

export const authRateLimits = {
  register: buildLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many registration attempts. Please try again later.',
  }),
  login: buildLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts. Please try again later.',
  }),
  refresh: buildLimiter({
    windowMs: 5 * 60 * 1000,
    max: 20,
    message: 'Too many refresh attempts. Please try again later.',
  }),
  general: buildLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many requests. Please try again later.',
  }),
  passwordReset: buildLimiter({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: 'Too many password reset attempts. Please try again later.',
  }),
  deleteAccount: buildLimiter({
    windowMs: (config.deleteAccount.rateLimitWindowSeconds || 600) * 1000,
    max: config.deleteAccount.rateLimitMaxRequests || 2,
    message: 'Delete account isteği kısa süre içinde çok kez denendi. Lütfen tekrar deneyin.',
    keyGenerator: (req) => {
      const userId = req?.user?.id;
      return userId ? `delete-account:${userId}` : `delete-account-ip:${getIp(req)}`;
    },
  }),
};

export const aiUserLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: (req: any) => {
    const planTier = getPlanTier(req);
    const freeMax = Number(process.env.RATE_LIMIT_AI_FREE_PER_MIN || 30);
    const premiumMax = Number(process.env.RATE_LIMIT_AI_PREMIUM_PER_MIN || 120);
    return planTier === 'premium' ? premiumMax : freeMax;
  },
  message: 'Too many AI requests. Please try again later.',
  keyGenerator: (req) => {
    const userId = req?.user?.id;
    return userId ? `ai:${userId}` : `ai-ip:${getIp(req)}`;
  },
});
