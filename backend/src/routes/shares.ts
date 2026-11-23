import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getDriveFileMetadata,
  isItemWithinSharedRoot,
  listDriveFolderContents,
} from '../services/googleDrive.js';

interface ShareRow {
  id: string;
  token: string;
  drive_item_id: string;
  item_name: string;
  is_folder: boolean;
  mime_type: string;
  is_active: boolean;
  created_at: string;
}

const createShareSchema = z.object({
  driveItemId: z.string().trim().min(1).max(128),
  itemName: z.string().trim().min(1).max(512),
  isFolder: z.boolean(),
  mimeType: z.string().trim().min(1).max(128),
});

async function getActiveShareByToken(token: string): Promise<ShareRow | null> {
  const res = await query<ShareRow>(
    'SELECT * FROM public_shares WHERE token = $1 AND is_active = TRUE',
    [token]
  );
  return res.rows[0] ?? null;
}

export async function shareRoutes(app: FastifyInstance) {
  // Authenticated: create or retrieve an active public share link for a folder or file
  app.post('/api/shares', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createShareSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Data item yang dibagikan tidak valid.' });
    }

    const { driveItemId, itemName, isFolder, mimeType } = parsed.data;
    const user = request.authUser!;

    // Reuse existing active share link for the same Drive item if already created
    const existing = await query<ShareRow>(
      `SELECT * FROM public_shares
       WHERE drive_item_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [driveItemId]
    );

    if (existing.rows[0]) {
      return { share: existing.rows[0] };
    }

    const token = crypto.randomBytes(16).toString('hex');
    const res = await query<ShareRow>(
      `INSERT INTO public_shares (token, drive_item_id, item_name, is_folder, mime_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [token, driveItemId, itemName, isFolder, mimeType, user.id]
    );

    return reply.code(201).send({ share: res.rows[0] });
  });

  // Authenticated: revoke an active share link
  app.delete('/api/shares/:token', { preHandler: requireAuth }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const res = await query(
      'UPDATE public_shares SET is_active = FALSE WHERE token = $1 RETURNING id',
      [token]
    );
    if (res.rowCount === 0) {
      return reply.code(404).send({ error: 'Link share tidak ditemukan.' });
    }
    return { ok: true };
  });

  // ==================== PUBLIC READ-ONLY ROUTES (NO LOGIN REQUIRED) ====================

  // View shared folder contents OR single shared file metadata
  app.get('/api/public/share/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const q = request.query as { folderId?: string };

    const share = await getActiveShareByToken(token);
    if (!share) {
      return reply
        .code(404)
        .send({ error: 'Link share tidak valid atau sudah dinonaktifkan.' });
    }

    try {
      if (!share.is_folder) {
        const meta = await getDriveFileMetadata(share.drive_item_id);
        let uploadedBy: string | null = null;
        if (meta.description) {
          const m = meta.description.match(/(?:Uploaded|Created)\s+by:\s*@?([a-zA-Z0-9._-]+)/i);
          if (m) uploadedBy = m[1];
        }
        return {
          share: {
            token: share.token,
            isFolder: false,
            itemName: meta.name,
            driveItemId: meta.id,
          },
          file: {
            id: meta.id,
            name: meta.name,
            mimeType: meta.mimeType,
            isFolder: false,
            size: meta.size,
            modifiedTime: meta.modifiedTime,
            hasThumbnail: Boolean(meta.thumbnailLink),
            description: meta.description,
            uploadedBy,
          },
          files: [],
        };
      }

      const requestedFolderId = q.folderId?.trim() || share.drive_item_id;
      const allowed = await isItemWithinSharedRoot(requestedFolderId, share.drive_item_id);
      if (!allowed) {
        return reply.code(403).send({ error: 'Folder di luar cakupan link share.' });
      }

      const listing = await listDriveFolderContents({ folderId: requestedFolderId });
      return {
        share: {
          token: share.token,
          isFolder: true,
          itemName: share.item_name,
          driveItemId: share.drive_item_id,
        },
        activeFolderId: requestedFolderId,
        files: listing.files,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat konten share.';
      return reply.code(502).send({ error: msg });
    }
  });

  // Public thumbnail proxy (scoped strictly to shared item/descendants)
  app.get('/api/public/share/:token/files/:fileId/thumbnail', async (request, reply) => {
    const { token, fileId } = request.params as { token: string; fileId: string };
    const share = await getActiveShareByToken(token);
    if (!share) return reply.code(404).send({ error: 'Link share tidak ditemukan.' });

    try {
      const allowed = await isItemWithinSharedRoot(fileId, share.drive_item_id);
      if (!allowed) return reply.code(403).send({ error: 'Akses ditolak.' });

      const meta = await getDriveFileMetadata(fileId);
      if (!meta.thumbnailLink) return reply.code(404).send({ error: 'Thumbnail tidak tersedia.' });

      const thumbUrl = meta.thumbnailLink.replace(/=s\d+$/, '=s600');
      const resp = await fetch(thumbUrl, {
        headers: { Authorization: `Bearer ${meta.accessToken}` },
      });
      if (!resp.ok || !resp.body) return reply.code(404).send({ error: 'Thumbnail gagal dimuat.' });

      reply
        .header('Content-Type', resp.headers.get('content-type') ?? 'image/jpeg')
        .header('Cache-Control', 'public, max-age=300');
      return reply.send(Readable.fromWeb(resp.body as never));
    } catch {
      return reply.code(404).send({ error: 'Thumbnail gagal dimuat.' });
    }
  });

  // Public preview stream (supports HTTP Range for video seeking + HEIC -> JPEG transcode)
  app.get('/api/public/share/:token/files/:fileId/stream', async (request, reply) => {
    const { token, fileId } = request.params as { token: string; fileId: string };
    const share = await getActiveShareByToken(token);
    if (!share) return reply.code(404).send({ error: 'Link share tidak ditemukan.' });

    try {
      const allowed = await isItemWithinSharedRoot(fileId, share.drive_item_id);
      if (!allowed) return reply.code(403).send({ error: 'Akses ditolak.' });

      const meta = await getDriveFileMetadata(fileId);
      const isHeic = /heic|heif/i.test(meta.mimeType) || /\.(heic|heif)$/i.test(meta.name);

      if (isHeic && meta.thumbnailLink) {
        const hiResUrl = meta.thumbnailLink.replace(/=s\d+$/, '=s2048');
        const thumbResp = await fetch(hiResUrl, {
          headers: { Authorization: `Bearer ${meta.accessToken}` },
        });
        if (thumbResp.ok && thumbResp.body) {
          reply
            .header('Content-Type', thumbResp.headers.get('content-type') ?? 'image/jpeg')
            .header('Cache-Control', 'public, max-age=300');
          return reply.send(Readable.fromWeb(thumbResp.body as never));
        }
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${meta.accessToken}`,
      };
      if (request.headers.range) headers['Range'] = request.headers.range;

      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers }
      );
      if (!resp.ok && resp.status !== 206) {
        return reply.code(resp.status).send({ error: 'Gagal memuat preview.' });
      }

      reply.code(resp.status);
      reply.header('Content-Type', resp.headers.get('content-type') ?? meta.mimeType);
      reply.header('Accept-Ranges', 'bytes');
      const contentLength = resp.headers.get('content-length');
      if (contentLength) reply.header('Content-Length', contentLength);
      const contentRange = resp.headers.get('content-range');
      if (contentRange) reply.header('Content-Range', contentRange);

      if (!resp.body) return reply.send();
      return reply.send(Readable.fromWeb(resp.body as never));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal preview file.';
      return reply.code(502).send({ error: msg });
    }
  });
}
