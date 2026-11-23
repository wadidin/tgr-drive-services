import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  generateGoogleAuthUrl,
  getDriveConfig,
  getDriveStorageQuota,
  handleOAuthCallback,
} from '../services/googleDrive.js';

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya boleh huruf, angka, titik, garis bawah, atau strip.'),
  password: z.string().min(6).max(128),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(['admin', 'user']).default('user'),
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).max(128).optional(),
});

const folderSchema = z.object({
  targetFolderId: z.string().trim().min(5).max(128),
});

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    const res = await query(
      `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.created_at,
              COUNT(l.id) FILTER (WHERE l.status = 'success')::int AS upload_count,
              COALESCE(SUM(CASE WHEN l.status = 'success' THEN l.file_size_bytes ELSE 0 END), 0)::text AS total_bytes
       FROM users u
       LEFT JOIN upload_logs l ON l.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    return { users: res.rows };
  });

  app.post('/api/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? 'Data user tidak valid.' });
    }

    const { username, password, displayName, role } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const res = await query(
        `INSERT INTO users (username, password_hash, display_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, display_name, role, is_active, created_at`,
        [username, passwordHash, displayName, role]
      );
      return reply.code(201).send({ user: res.rows[0] });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'Username sudah terdaftar.' });
      }
      throw err;
    }
  });

  app.patch(
    '/api/admin/users/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Data update tidak valid.' });
      }

      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];

      if (parsed.data.displayName !== undefined) {
        params.push(parsed.data.displayName);
        sets.push(`display_name = $${params.length}`);
      }
      if (parsed.data.role !== undefined) {
        params.push(parsed.data.role);
        sets.push(`role = $${params.length}`);
      }
      if (parsed.data.isActive !== undefined) {
        params.push(parsed.data.isActive);
        sets.push(`is_active = $${params.length}`);
      }
      if (parsed.data.password !== undefined) {
        const hash = await bcrypt.hash(parsed.data.password, 10);
        params.push(hash);
        sets.push(`password_hash = $${params.length}`);
      }

      params.push(id);
      const res = await query(
        `UPDATE users SET ${sets.join(', ')}
         WHERE id = $${params.length}
         RETURNING id, username, display_name, role, is_active, updated_at`,
        params
      );

      if (res.rowCount === 0) {
        return reply.code(404).send({ error: 'User tidak ditemukan.' });
      }

      return { user: res.rows[0] };
    }
  );

  app.get('/api/admin/drive/status', { preHandler: requireAdmin }, async () => {
    const cfg = await getDriveConfig();
    const dailyRes = await query<{ daily_bytes: string }>(
      `SELECT COALESCE(SUM(file_size_bytes), 0)::text AS daily_bytes
       FROM upload_logs
       WHERE status = 'success' AND completed_at >= NOW() - INTERVAL '24 hours'`
    );
    const dailyBytes = Number(dailyRes.rows[0]?.daily_bytes ?? 0);
    const dailyLimitBytes = 750 * 1024 ** 3; // 750 GB

    if (!cfg || !cfg.encrypted_refresh_token) {
      return {
        connected: false,
        email: 'fototgr@gmail.com',
        targetFolderId: cfg?.target_folder_id || env.GOOGLE_DEFAULT_FOLDER_ID,
        oauthConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        limitBytes: 5 * 1024 ** 4,
        usageBytes: 0,
        availableBytes: 5 * 1024 ** 4,
        dailyBytes,
        dailyLimitBytes,
      };
    }

    try {
      const quota = await getDriveStorageQuota();
      return {
        ...quota,
        oauthConfigured: true,
        dailyBytes,
        dailyLimitBytes,
      };
    } catch (err) {
      return {
        connected: false,
        email: cfg.google_email,
        targetFolderId: cfg.target_folder_id || env.GOOGLE_DEFAULT_FOLDER_ID,
        oauthConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        error: err instanceof Error ? err.message : 'Token perlu diotorisasi ulang.',
        limitBytes: 5 * 1024 ** 4,
        usageBytes: 0,
        availableBytes: 5 * 1024 ** 4,
        dailyBytes,
        dailyLimitBytes,
      };
    }
  });

  app.get('/api/admin/drive/oauth-url', { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      const url = generateGoogleAuthUrl('tgr-admin-auth');
      return { url };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'OAuth belum dikonfigurasi.' });
    }
  });

  // Google redirects the browser directly here after Admin consents with fototgr@gmail.com
  app.get('/api/admin/drive/oauth-callback', async (request, reply) => {
    const q = request.query as { code?: string; error?: string };
    if (q.error) {
      return reply
        .type('text/html')
        .send(`<h2>Otorisasi dibatalkan: ${q.error}</h2><p>Anda bisa menutup tab ini.</p>`);
    }
    if (!q.code) {
      return reply.code(400).send({ error: 'Parameter code tidak ditemukan.' });
    }

    try {
      const result = await handleOAuthCallback(q.code);
      return reply.type('text/html').send(`
        <!doctype html>
        <html lang="id">
        <body style="font-family:sans-serif;background:#FFF8E7;color:#120D1D;padding:40px;">
          <div style="max-width:520px;margin:auto;background:#C8FF00;border:4px solid #120D1D;box-shadow:8px 8px 0 #120D1D;border-radius:20px;padding:32px;">
            <h1 style="margin-top:0;">BERHASIL TERHUBUNG!</h1>
            <p><strong>Akun Google Drive:</strong> ${result.email}</p>
            <p><strong>Folder Global ID:</strong> ${result.targetFolderId}</p>
            <p>Refresh token sudah dienkripsi (AES-256-GCM) dan disimpan ke PostgreSQL. Silakan kembali ke Panel Admin TGR Drive.</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses OAuth callback.';
      return reply.code(500).type('text/html').send(`<h2>Gagal OAuth2</h2><p>${msg}</p>`);
    }
  });

  app.patch('/api/admin/drive/folder', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = folderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'targetFolderId tidak valid.' });
    }

    await query(
      `INSERT INTO drive_integration (id, google_email, encrypted_refresh_token, target_folder_id, updated_at)
       VALUES (1, 'fototgr@gmail.com', '', $1, NOW())
       ON CONFLICT (id)
       DO UPDATE SET target_folder_id = EXCLUDED.target_folder_id, updated_at = NOW()`,
      [parsed.data.targetFolderId]
    );

    return { ok: true, targetFolderId: parsed.data.targetFolderId };
  });

  app.get('/api/admin/uploads', { preHandler: requireAdmin }, async (request) => {
    const q = request.query as { status?: string; username?: string; limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.status && ['initiated', 'success', 'failed', 'cancelled'].includes(q.status)) {
      params.push(q.status);
      conditions.push(`l.status = $${params.length}`);
    }
    if (q.username) {
      params.push(`%${q.username}%`);
      conditions.push(`u.username ILIKE $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const res = await query(
      `SELECT l.id, u.username, u.display_name, l.original_filename, l.mime_type,
              l.file_size_bytes::text AS file_size_bytes, l.drive_file_id,
              l.status, l.error_message, l.created_at, l.completed_at
       FROM upload_logs l
       JOIN users u ON u.id = l.user_id
       ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return { items: res.rows };
  });
}
