import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getDriveStorageQuota,
  initResumableUploadSession,
} from '../services/googleDrive.js';

const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
  'mp4',
  'mov',
  'webm',
  'mkv',
  '3gp',
  'avi',
]);

const ALLOWED_MIME_PREFIXES = ['image/', 'video/'];

const initSchema = z.object({
  fileName: z.string().trim().min(1).max(512),
  mimeType: z.string().trim().min(1).max(128),
  fileSize: z.number().int().positive(),
  folderId: z.string().trim().min(1).max(128).optional(),
});

const completeSchema = z.object({
  driveFileId: z.string().trim().min(1).max(128),
});

const failSchema = z.object({
  status: z.enum(['failed', 'cancelled']).default('failed'),
  errorMessage: z.string().max(1000).optional(),
});

function isAllowedMedia(fileName: string, mimeType: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const hasAllowedExt = ALLOWED_EXTENSIONS.has(ext);
  const hasAllowedMime =
    ALLOWED_MIME_PREFIXES.some((p) => mimeType.toLowerCase().startsWith(p)) ||
    mimeType === 'application/octet-stream';
  return hasAllowedExt && hasAllowedMime;
}

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/api/uploads/init', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = initSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Metadata file tidak valid.' });
    }

    const { fileName, mimeType, fileSize, folderId } = parsed.data;
    if (!isAllowedMedia(fileName, mimeType)) {
      return reply.code(400).send({
        error:
          'Format file tidak didukung. Hanya foto (JPG, PNG, WEBP, HEIC) dan video (MP4, MOV, MKV, WEBM, 3GP, AVI).',
      });
    }

    const user = request.authUser!;

    try {
      // Check Google Pro 5TB available quota before starting upload
      const quota = await getDriveStorageQuota();
      if (fileSize > quota.availableBytes) {
        return reply.code(507).send({
          error: 'Sisa kuota Google Drive fototgr@gmail.com tidak mencukupi untuk file ini.',
        });
      }

      const originHeader = request.headers.origin;
      const { uploadUri, targetFolderId } = await initResumableUploadSession({
        fileName,
        mimeType,
        fileSize,
        uploaderUsername: user.username,
        originHeader,
        folderId,
      });

      const logRes = await query<{ id: string }>(
        `INSERT INTO upload_logs (user_id, original_filename, mime_type, file_size_bytes, status)
         VALUES ($1, $2, $3, $4, 'initiated')
         RETURNING id`,
        [user.id, fileName, mimeType, fileSize]
      );

      return reply.code(201).send({
        uploadId: logRes.rows[0].id,
        uploadUri,
        targetFolderId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal inisiasi upload.';
      return reply.code(502).send({ error: message });
    }
  });

  app.post(
    '/api/uploads/:id/complete',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = completeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'driveFileId wajib diisi.' });
      }

      const user = request.authUser!;
      const res = await query(
        `UPDATE upload_logs
         SET status = 'success', drive_file_id = $1, completed_at = NOW(), error_message = NULL
         WHERE id = $2 AND user_id = $3
         RETURNING id`,
        [parsed.data.driveFileId, id, user.id]
      );

      if (res.rowCount === 0) {
        return reply.code(404).send({ error: 'Log upload tidak ditemukan.' });
      }

      return { ok: true };
    }
  );

  app.post(
    '/api/uploads/:id/fail',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = failSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Payload status tidak valid.' });
      }

      const user = request.authUser!;
      await query(
        `UPDATE upload_logs
         SET status = $1, error_message = $2
         WHERE id = $3 AND user_id = $4`,
        [parsed.data.status, parsed.data.errorMessage ?? null, id, user.id]
      );

      return { ok: true };
    }
  );

  app.get('/api/uploads/history', { preHandler: requireAuth }, async (request) => {
    const user = request.authUser!;
    const q = request.query as { type?: string; status?: string; limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));

    const conditions = ['user_id = $1'];
    const params: unknown[] = [user.id];

    if (q.type === 'video') {
      conditions.push(`mime_type LIKE 'video/%'`);
    } else if (q.type === 'photo') {
      conditions.push(`mime_type LIKE 'image/%'`);
    }

    if (q.status && ['initiated', 'success', 'failed', 'cancelled'].includes(q.status)) {
      params.push(q.status);
      conditions.push(`status = $${params.length}`);
    }

    params.push(limit);

    const rowsRes = await query(
      `SELECT id, original_filename, mime_type, file_size_bytes::text AS file_size_bytes,
              drive_file_id, status, error_message, created_at, completed_at
       FROM upload_logs
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    const statsRes = await query<{
      total_files: string;
      total_bytes: string;
      success_files: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_files,
         COALESCE(SUM(CASE WHEN status = 'success' THEN file_size_bytes ELSE 0 END), 0)::text AS total_bytes,
         COUNT(*) FILTER (WHERE status = 'success')::text AS success_files
       FROM upload_logs
       WHERE user_id = $1`,
      [user.id]
    );

    return {
      items: rowsRes.rows,
      stats: {
        totalFiles: Number(statsRes.rows[0]?.total_files ?? 0),
        totalBytes: Number(statsRes.rows[0]?.total_bytes ?? 0),
        successFiles: Number(statsRes.rows[0]?.success_files ?? 0),
      },
    };
  });
}
