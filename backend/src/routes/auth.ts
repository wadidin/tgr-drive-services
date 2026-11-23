import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Username dan password wajib diisi.' });
      }

      const { username, password } = parsed.data;
      const res = await query<UserRow>(
        'SELECT id, username, password_hash, display_name, role, is_active FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
      );

      const user = res.rows[0];
      if (!user) {
        return reply.code(401).send({ error: 'Username atau password salah.' });
      }

      if (!user.is_active) {
        return reply
          .code(403)
          .send({ error: 'Akun Anda sedang dinonaktifkan oleh Admin.' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return reply.code(401).send({ error: 'Username atau password salah.' });
      }

      const payload = { sub: user.id, username: user.username, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      const isProd = env.NODE_ENV === 'production';
      reply
        .setCookie('tgr_access_token', accessToken, {
          httpOnly: true,
          sameSite: isProd ? 'none' : 'lax',
          secure: isProd,
          path: '/',
          maxAge: 60 * 60 * 2,
        })
        .setCookie('tgr_refresh_token', refreshToken, {
          httpOnly: true,
          sameSite: isProd ? 'none' : 'lax',
          secure: isProd,
          path: '/api/auth',
          maxAge: 60 * 60 * 24 * 7,
        });

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
        },
      };
    }
  );

  app.post('/api/auth/refresh', async (request, reply) => {
    const body = (request.body as { refreshToken?: string } | undefined) ?? {};
    const token = body.refreshToken ?? request.cookies?.tgr_refresh_token;

    if (!token) {
      return reply.code(401).send({ error: 'Refresh token tidak ditemukan.' });
    }

    try {
      const decoded = verifyRefreshToken(token);
      const res = await query<UserRow>(
        'SELECT id, username, display_name, role, is_active FROM users WHERE id = $1',
        [decoded.sub]
      );
      const user = res.rows[0];
      if (!user || !user.is_active) {
        return reply.code(401).send({ error: 'Akun tidak aktif.' });
      }

      const accessToken = signAccessToken({
        sub: user.id,
        username: user.username,
        role: user.role,
      });

      const isProd = env.NODE_ENV === 'production';
      reply.setCookie('tgr_access_token', accessToken, {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 2,
      });

      return { accessToken };
    } catch {
      return reply.code(401).send({ error: 'Refresh token tidak valid.' });
    }
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply
      .clearCookie('tgr_access_token', { path: '/' })
      .clearCookie('tgr_refresh_token', { path: '/api/auth' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const u = request.authUser!;
    return {
      user: {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        role: u.role,
      },
    };
  });

  // User self-service profile update (displayName, username, password) with DB uniqueness checks
  app.patch('/api/auth/profile', { preHandler: requireAuth }, async (request, reply) => {
    const profileSchema = z.object({
      displayName: z.string().trim().min(2, 'Nama minimal 2 karakter.').max(120).optional(),
      username: z
        .string()
        .trim()
        .min(3, 'Username minimal 3 karakter.')
        .max(64)
        .regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya boleh huruf, angka, titik, underscore, atau strip.')
        .optional(),
      currentPassword: z.string().optional(),
      newPassword: z.string().min(6, 'Password baru minimal 6 karakter.').max(128).optional(),
    });

    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? 'Data profil tidak valid.' });
    }

    const currentUser = request.authUser!;
    const { displayName, username, currentPassword, newPassword } = parsed.data;

    const existingRes = await query<UserRow>(
      'SELECT id, username, password_hash, display_name, role, is_active FROM users WHERE id = $1',
      [currentUser.id]
    );
    const dbUser = existingRes.rows[0];
    if (!dbUser) {
      return reply.code(404).send({ error: 'User tidak ditemukan.' });
    }

    // Check unique display_name in database
    if (displayName && displayName.toLowerCase() !== dbUser.display_name.toLowerCase()) {
      const dupName = await query(
        'SELECT id FROM users WHERE LOWER(display_name) = LOWER($1) AND id != $2',
        [displayName, currentUser.id]
      );
      if ((dupName.rowCount ?? 0) > 0) {
        return reply.code(409).send({ error: 'Nama sudah terdaftar di database. Gunakan nama lain.' });
      }
    }

    // Check unique username in database
    if (username && username.toLowerCase() !== dbUser.username.toLowerCase()) {
      const dupUser = await query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2',
        [username, currentUser.id]
      );
      if ((dupUser.rowCount ?? 0) > 0) {
        return reply.code(409).send({ error: 'Username sudah digunakan user lain di database.' });
      }
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];

    if (displayName) {
      params.push(displayName);
      sets.push(`display_name = $${params.length}`);
    }
    if (username) {
      params.push(username);
      sets.push(`username = $${params.length}`);
    }
    if (newPassword) {
      if (!currentPassword) {
        return reply.code(400).send({ error: 'Masukkan password saat ini untuk mengganti password.' });
      }
      const ok = await bcrypt.compare(currentPassword, dbUser.password_hash);
      if (!ok) {
        return reply.code(401).send({ error: 'Password saat ini salah.' });
      }
      const newHash = await bcrypt.hash(newPassword, 10);
      params.push(newHash);
      sets.push(`password_hash = $${params.length}`);
    }

    params.push(currentUser.id);
    const updatedRes = await query<UserRow>(
      `UPDATE users SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, username, display_name, role, is_active`,
      params
    );

    const updated = updatedRes.rows[0];
    const payload = { sub: updated.id, username: updated.username, role: updated.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    const isProd = env.NODE_ENV === 'production';
    reply
      .setCookie('tgr_access_token', accessToken, {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 2,
      })
      .setCookie('tgr_refresh_token', refreshToken, {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        path: '/api/auth',
        maxAge: 60 * 60 * 24 * 7,
      });

    return {
      accessToken,
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.display_name,
        role: updated.role,
      },
    };
  });
}
