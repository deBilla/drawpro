import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3002),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_URL: z.string().default('http://localhost:3001'),
  COLLAB_SECRET: z.string().default('collab_secret'),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('❌  Invalid environment variables:', result.error.flatten());
  process.exit(1);
}

export const ENV = result.data;
