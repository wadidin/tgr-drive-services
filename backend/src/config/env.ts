import 'dotenv/config';

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  DATABASE_URL: requireEnv('DATABASE_URL'),
  JWT_ACCESS_SECRET: requireEnv('JWT_ACCESS_SECRET', 'dev-access-secret-change-in-production-32chars'),
  JWT_REFRESH_SECRET: requireEnv('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-production-32chars'),
  TOKEN_ENCRYPTION_KEY: requireEnv(
    'TOKEN_ENCRYPTION_KEY',
    '0000000000000000000000000000000000000000000000000000000000000000'
  ),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  GOOGLE_REDIRECT_URI:
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/admin/drive/oauth-callback',
  GOOGLE_DEFAULT_FOLDER_ID:
    process.env.GOOGLE_DEFAULT_FOLDER_ID ?? '1KiXQuXQwrk_geD5gvAYRRDjIzHrL9mma',
};
