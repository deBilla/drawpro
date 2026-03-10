import Redis from 'ioredis';
import { ENV } from '../config/env';

export const redis = new Redis(ENV.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => console.error('[Redis] connection error:', err));
