import Redis from 'ioredis';
import { logger } from '../utils/logger';

export interface CacheConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number;
  lazyConnect: boolean;
}

class CacheService {
  private redis: Redis;
  private isConnected: boolean = false;

  constructor() {
    const config: CacheConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    };

    this.redis = new Redis(config);

    this.redis.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis connected successfully');
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      logger.error('Redis connection error:', error);
    });

    this.redis.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });
  }

  // Basic cache operations
  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping cache set');
        return false;
      }

      const serializedValue = JSON.stringify(value);
      
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }

      logger.debug(`Cache set: ${key}`, { ttl: ttlSeconds });
      return true;
    } catch (error) {
      logger.error('Cache set error:', { key, error });
      return false;
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping cache get');
        return null;
      }

      const value = await this.redis.get(key);
      
      if (!value) {
        return null;
      }

      const parsedValue = JSON.parse(value);
      logger.debug(`Cache hit: ${key}`);
      return parsedValue;
    } catch (error) {
      logger.error('Cache get error:', { key, error });
      return null;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping cache delete');
        return false;
      }

      const result = await this.redis.del(key);
      logger.debug(`Cache delete: ${key}`, { deleted: result > 0 });
      return result > 0;
    } catch (error) {
      logger.error('Cache delete error:', { key, error });
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error:', { key, error });
      return false;
    }
  }

  // Advanced cache operations
  async mget(keys: string[]): Promise<(any | null)[]> {
    try {
      if (!this.isConnected) {
        return keys.map(() => null);
      }

      const values = await this.redis.mget(...keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      logger.error('Cache mget error:', { keys, error });
      return keys.map(() => null);
    }
  }

  async mset(keyValuePairs: Record<string, any>, ttlSeconds?: number): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      const pipeline = this.redis.pipeline();
      
      for (const [key, value] of Object.entries(keyValuePairs)) {
        const serializedValue = JSON.stringify(value);
        if (ttlSeconds) {
          pipeline.setex(key, ttlSeconds, serializedValue);
        } else {
          pipeline.set(key, serializedValue);
        }
      }

      await pipeline.exec();
      logger.debug(`Cache mset: ${Object.keys(keyValuePairs).length} keys`);
      return true;
    } catch (error) {
      logger.error('Cache mset error:', { error });
      return false;
    }
  }

  // Pattern-based operations
  async keys(pattern: string): Promise<string[]> {
    try {
      if (!this.isConnected) {
        return [];
      }

      const keys = await this.redis.keys(pattern);
      return keys;
    } catch (error) {
      logger.error('Cache keys error:', { pattern, error });
      return [];
    }
  }

  async delPattern(pattern: string): Promise<number> {
    try {
      if (!this.isConnected) {
        return 0;
      }

      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keys);
      logger.debug(`Cache delPattern: ${pattern}`, { deleted: result });
      return result;
    } catch (error) {
      logger.error('Cache delPattern error:', { pattern, error });
      return 0;
    }
  }

  // Cache with fallback function
  async getOrSet<T>(
    key: string,
    fallbackFn: () => Promise<T>,
    ttlSeconds: number = 300
  ): Promise<T> {
    try {
      // Try to get from cache first
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // Cache miss, execute fallback function
      logger.debug(`Cache miss, executing fallback: ${key}`);
      const result = await fallbackFn();

      // Store in cache
      await this.set(key, result, ttlSeconds);

      return result;
    } catch (error) {
      logger.error('Cache getOrSet error:', { key, error });
      // If cache fails, still try to execute fallback
      return await fallbackFn();
    }
  }

  // Cache invalidation helpers
  async invalidateUserCache(userId: string): Promise<void> {
    const patterns = [
      `user:${userId}:*`,
      `auth:${userId}:*`,
      `session:${userId}:*`,
    ];

    for (const pattern of patterns) {
      await this.delPattern(pattern);
    }

    logger.info(`User cache invalidated: ${userId}`);
  }

  async invalidateAuthCache(userId: string): Promise<void> {
    const patterns = [
      `auth:${userId}:*`,
      `session:${userId}:*`,
      `token:${userId}:*`,
    ];

    for (const pattern of patterns) {
      await this.delPattern(pattern);
    }

    logger.info(`Auth cache invalidated: ${userId}`);
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis ping failed:', error);
      return false;
    }
  }

  // Get cache statistics
  async getStats(): Promise<{
    connected: boolean;
    memory: any;
    info: any;
  }> {
    try {
      if (!this.isConnected) {
        return { connected: false, memory: null, info: null };
      }

      const memory = await this.redis.memory('STATS');
      const info = await this.redis.info();

      return {
        connected: this.isConnected,
        memory,
        info: this.parseRedisInfo(info),
      };
    } catch (error) {
      logger.error('Redis stats error:', error);
      return { connected: false, memory: null, info: null };
    }
  }

  private parseRedisInfo(info: string): any {
    const lines = info.split('\r\n');
    const result: any = {};

    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    }

    return result;
  }

  // Close connection
  async close(): Promise<void> {
    try {
      await this.redis.quit();
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error('Redis close error:', error);
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Cache decorator for methods
export function Cache(ttlSeconds: number = 300, keyGenerator?: (...args: any[]) => string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cacheKey = keyGenerator ? keyGenerator(...args) : `${target.constructor.name}:${propertyName}:${JSON.stringify(args)}`;
      
      try {
        // Try to get from cache
        const cached = await cacheService.get(cacheKey);
        if (cached !== null) {
          logger.debug(`Cache hit for method: ${propertyName}`);
          return cached;
        }

        // Execute method and cache result
        const result = await method.apply(this, args);
        await cacheService.set(cacheKey, result, ttlSeconds);
        
        logger.debug(`Cache set for method: ${propertyName}`);
        return result;
      } catch (error) {
        logger.error(`Cache decorator error for ${propertyName}:`, error);
        // If cache fails, still execute method
        return await method.apply(this, args);
      }
    };
  };
}

// Cache key generators
export const CacheKeys = {
  user: (userId: string) => `user:${userId}`,
  userProfile: (userId: string) => `user:${userId}:profile`,
  userSessions: (userId: string) => `user:${userId}:sessions`,
  authToken: (token: string) => `auth:token:${token}`,
  session: (sessionId: string) => `session:${sessionId}`,
  rateLimit: (ip: string, endpoint: string) => `rate:${ip}:${endpoint}`,
  apiResponse: (endpoint: string, params: string) => `api:${endpoint}:${params}`,
};

