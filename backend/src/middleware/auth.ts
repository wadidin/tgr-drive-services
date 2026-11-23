import { FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../config/db.js';
import { verifyAccessToken } from '../utils/jwt.js';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    const queryToken = (request.query as { token?: string } | undefined)?.token;
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (request.cookies?.tgr_access_token) {
      token = request.cookies.tgr_access_token;
    } else if (queryToken) {
      token = queryToken.trim();
    }

    if (!token) {
      return reply.code(401).send({ error: 'Sesi tidak ditemukan. Silakan login.' });
    }

    const decoded = verifyAccessToken(token);
    const res = await query<AuthUser>(
      'SELECT id, username, display_name, role, is_active FROM users WHERE id = $1',
      [decoded.sub]
    );

    const user = res.rows[0];
    if (!user || !user.is_active) {
      return reply
        .code(401)
        .send({ error: 'Akun tidak aktif atau tidak ditemukan.' });
    }

    request.authUser = user;
  } catch {
    return reply.code(401).send({ error: 'Token sesi tidak valid atau kedaluwarsa.' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (request.authUser?.role !== 'admin') {
    return reply.code(403).send({ error: 'Akses ditolak. Khusus Admin.' });
  }
}
