import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.coerce.number().default(60 * 60 * 24 * 7), // 7 days in seconds
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('drawpro'),
  COLLAB_SECRET: z.string().default('collab_secret'),

  // Firebase service account — used only to verify Google sign-in ID tokens.
  // All three must be set together; leaving them unset disables /auth/google
  // (the rest of the API runs normally).
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('❌  Invalid environment variables:');
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

export const ENV = result.data;

/** Google sign-in is available only when the whole service account is configured. */
export const GOOGLE_AUTH_ENABLED = Boolean(
  ENV.FIREBASE_PROJECT_ID && ENV.FIREBASE_CLIENT_EMAIL && ENV.FIREBASE_PRIVATE_KEY,
);

if (!GOOGLE_AUTH_ENABLED) {
  console.warn('[env] FIREBASE_* not fully set — Google sign-in is disabled');
}
