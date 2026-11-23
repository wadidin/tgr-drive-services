import { Pool, QueryResultRow } from 'pg';
import { env } from './env.js';

const parsed = new URL(env.DATABASE_URL);
const needsSsl =
  parsed.searchParams.get('sslmode') === 'require' ||
  parsed.hostname.includes('aivencloud.com');

export const pool = new Pool({
  host: parsed.hostname,
  port: Number(parsed.port || 5432),
  database: parsed.pathname.replace(/^\//, ''),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  ssl: needsSsl
    ? {
        rejectUnauthorized: false,
        servername: parsed.hostname,
      }
    : undefined,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 30_000,
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}
