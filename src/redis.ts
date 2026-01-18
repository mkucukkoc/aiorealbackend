import Redis from 'ioredis';
import { config } from './config';
import { logger } from './utils/logger';

// Redis bağlantısını optional hale getir
let redis: Redis | null = null;
let redisConnected = false;

// Redis bağlantısını başlat
export async function initializeRedis(): Promise<void> {
  try {
    // Redis URL kontrolü
    const redisUrl = config.redis.url;
    const redisPassword = config.redis.password;
    
    if (!redisUrl || redisUrl === 'redis://red-d2nf9m7diees73cjdo40:6379') {
      logger.warn({
        redisUrl: redisUrl,
        message: 'Redis URL not configured or using default, skipping Redis connection'
      }, 'Redis connection skipped');
      return;
    }

    // Redis connection options
    const redisOptions: any = {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
    };

    // Authentication ekle
    if (redisPassword) {
      redisOptions.password = redisPassword;
      logger.info({
        host: config.redis.host,
        port: config.redis.port,
        hasPassword: !!redisPassword
      }, 'Redis connection with authentication');
    } else {
      logger.info({
        host: config.redis.host,
        port: config.redis.port,
        hasPassword: false
      }, 'Redis connection without authentication');
    }

    // URL veya host/port ile bağlan
    if (redisUrl.startsWith('redis://')) {
      // Redis URL'sini parse et
      const url = new URL(redisUrl);
      const parsedOptions = {
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        password: url.password || undefined,
        username: url.username || undefined,
        ...redisOptions
      };
      
      logger.info({
        host: parsedOptions.host,
        port: parsedOptions.port,
        hasPassword: !!parsedOptions.password,
        hasUsername: !!parsedOptions.username
      }, 'Parsed Redis URL for connection');
      
      redis = new Redis(parsedOptions);
    } else {
      redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: redisPassword,
        ...redisOptions
      });
    }

    redis.on('connect', () => {
      logger.info({ message: 'Redis connected successfully' }, 'Redis connection established');
      redisConnected = true;
    });

    redis.on('error', (error) => {
      logger.error({ 
        error: error.message,
        redisUrl: redisUrl,
        host: config.redis.host,
        port: config.redis.port
      }, 'Redis connection error');
      redisConnected = false;
    });

    redis.on('close', () => {
      logger.warn({ message: 'Redis connection closed' }, 'Redis connection closed');
      redisConnected = false;
    });

    // Bağlantıyı test et
    await redis.ping();
    logger.info({ 
      message: 'Redis ping successful',
      host: config.redis.host,
      port: config.redis.port
    }, 'Redis connection verified');
    
  } catch (error: any) {
    logger.error({ 
      error: error.message,
      redisUrl: config.redis.url,
      host: config.redis.host,
      port: config.redis.port,
      hasPassword: !!config.redis.password
    }, 'Failed to initialize Redis connection');
    redis = null;
    redisConnected = false;
  }
}

// Redis instance'ını döndür
export function getRedis(): Redis | null {
  return redis;
}

// Redis bağlantı durumunu kontrol et
export function isRedisConnected(): boolean {
  return redisConnected && redis !== null;
}

export async function setJson(key: string, value: unknown, ttlSec?: number): Promise<void> {
  if (!isRedisConnected() || !redis) {
    logger.debug({ 
      key, 
      message: 'Redis not connected, skipping set operation' 
    }, 'Redis set operation skipped');
    return;
  }

  try {
    const payload = JSON.stringify(value);
    if (ttlSec) {
      await redis.set(key, payload, 'EX', ttlSec);
    } else {
      await redis.set(key, payload);
    }
    logger.debug({ key, ttlSec }, 'Redis set operation successful');
  } catch (error: any) {
    logger.error({ 
      error: error.message, 
      key 
    }, 'Redis set operation failed');
  }
}

export async function getJson<T = unknown>(key: string): Promise<T | null> {
  if (!isRedisConnected() || !redis) {
    logger.debug({ 
      key, 
      message: 'Redis not connected, returning null' 
    }, 'Redis get operation skipped');
    return null;
  }

  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const result = JSON.parse(raw) as T;
    logger.debug({ key }, 'Redis get operation successful');
    return result;
  } catch (error: any) {
    logger.error({ 
      error: error.message, 
      key 
    }, 'Redis get operation failed');
    return null;
  }
}



