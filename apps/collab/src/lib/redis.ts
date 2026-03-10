import Redis from 'ioredis';
import { ENV } from '../config/env';

// Separate client for pub/sub (cannot share with regular commands)
export const redis = new Redis(ENV.REDIS_URL, { maxRetriesPerRequest: 3 });
export const subscriber = new Redis(ENV.REDIS_URL, { maxRetriesPerRequest: 3 });

redis.on('error', (err) => console.error('[Redis] error:', err));
subscriber.on('error', (err) => console.error('[Redis/sub] error:', err));
