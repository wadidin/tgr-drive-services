import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { query } from './config/db.js';
import { authRoutes } from './routes/auth.js';
import { uploadRoutes } from './routes/uploads.js';
import { adminRoutes } from './routes/admin.js';
import { driveRoutes } from './routes/drive.js';

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });

  app.get('/api/health', async () => {
    const dbCheck = await query('SELECT NOW() AS now');
    return {
      status: 'ok',
      service: 'tgr-drive-backend',
      dbTime: dbCheck.rows[0]?.now,
    };
  });

  await app.register(authRoutes);
  await app.register(uploadRoutes);
  await app.register(driveRoutes);
  await app.register(adminRoutes);

  return app;
}

const app = await buildServer();
app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
