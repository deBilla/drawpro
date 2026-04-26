import * as Minio from 'minio';
import { ENV } from '../config/env';

export const minio = new Minio.Client({
  endPoint: ENV.MINIO_ENDPOINT,
  port: ENV.MINIO_PORT,
  useSSL: false,
  accessKey: ENV.MINIO_ACCESS_KEY,
  secretKey: ENV.MINIO_SECRET_KEY,
});

export async function ensureMinioBucket(): Promise<void> {
  try {
    const exists = await minio.bucketExists(ENV.MINIO_BUCKET);
    if (!exists) {
      await minio.makeBucket(ENV.MINIO_BUCKET, 'us-east-1');
      console.log(`[MinIO] bucket '${ENV.MINIO_BUCKET}' created`);
    }
  } catch (err) {
    console.warn('[MinIO] could not ensure bucket (skipping):', (err as Error).message);
  }
}
