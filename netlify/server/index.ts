import type { Config } from '@netlify/server';
import { onShutdown } from '@netlify/server';
import { buildServer } from '../../backend/src/app.js';
import { pool } from '../../backend/src/config/db.js';

export const config: Config = {
  path: '/api/*',
};

const app = await buildServer();

onShutdown(async ({ drained }) => {
  await drained;
  await app.close();
  await pool.end();
});

await app.listen({
  port: Number(process.env.PORT) || 3000,
  host: '0.0.0.0',
});
