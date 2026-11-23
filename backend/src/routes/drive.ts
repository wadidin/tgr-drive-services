import { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const createArchive = require('archiver') as (
  format: 'zip',
  options?: { store?: boolean }
) => import('archiver').Archiver;
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  createDriveSubFolder,
  getDriveFileMetadata,
  getDriveStorageQuota,
  listDriveFolderContents,
  renameDriveItem,
  trashDriveItem,
} from '../services/googleDrive.js';

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentFolderId: z.string().trim().min(1).max(128).optional(),
});

const zipSchema = z.object({
  fileIds: z.array(z.string().trim().min(1)).min(1).max(50),
});

export async function driveRoutes(app: FastifyInstance) {
  // List contents of the global folder (or any sub-folder inside it) + storage summary
  app.get('/api/drive/files', { preHandler: requireAuth }, async (request, reply) => {
    const q = request.query as { folderId?: string; search?: string };
    try {
      const [listing, quota] = await Promise.all([
        listDriveFolderContents({ folderId: q.folderId, search: q.search }),
        getDriveStorageQuota(),
      ]);
      return {
        ...listing,
        quota: {
          connected: quota.connected,
          email: quota.email,
          limitBytes: quota.limitBytes,
          usageBytes: quota.usageBytes,
          availableBytes: quota.availableBytes,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat isi folder Google Drive.';
      return reply.code(502).send({ error: msg });
    }
  });

  // Create a sub-folder inside the currently opened folder
  app.post('/api/drive/folders', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createFolderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Nama folder wajib diisi.' });
    }
    try {
      const folder = await createDriveSubFolder(
        parsed.data.name,
        parsed.data.parentFolderId,
        request.authUser?.username
      );
      return reply.code(201).send({ folder });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat folder baru.';
      return reply.code(502).send({ error: msg });
    }
  });

  // Rename file or folder
  app.patch(
    '/api/drive/files/:fileId/rename',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      const body = (request.body as { name?: string } | undefined) ?? {};
      const newName = body.name?.trim();
      if (!newName) {
        return reply.code(400).send({ error: 'Nama baru wajib diisi.' });
      }
      try {
        const updated = await renameDriveItem(fileId, newName);
        return { ok: true, file: updated };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal mengganti nama.';
        return reply.code(502).send({ error: msg });
      }
    }
  );

  // Move file or folder to Google Drive Trash (reversible)
  app.delete(
    '/api/drive/files/:fileId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      try {
        await trashDriveItem(fileId);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal menghapus file.';
        return reply.code(502).send({ error: msg });
      }
    }
  );

  // Proxy thumbnail image securely (supports ?size=600 or ?size=2048 for high-res preview)
  app.get(
    '/api/drive/files/:fileId/thumbnail',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      const q = request.query as { size?: string };
      const size = Math.min(2560, Math.max(200, Number(q.size ?? 600) || 600));
      try {
        const meta = await getDriveFileMetadata(fileId);
        if (!meta.thumbnailLink) {
          return reply.code(404).send({ error: 'Thumbnail tidak tersedia.' });
        }

        const thumbUrl = meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
        const resp = await fetch(thumbUrl, {
          headers: { Authorization: `Bearer ${meta.accessToken}` },
        });

        if (!resp.ok || !resp.body) {
          return reply.code(404).send({ error: 'Gagal memuat thumbnail.' });
        }

        const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
        reply
          .header('Content-Type', contentType)
          .header('Cache-Control', 'private, max-age=300');
        return reply.send(Readable.fromWeb(resp.body as never));
      } catch {
        return reply.code(404).send({ error: 'Thumbnail gagal dimuat.' });
      }
    }
  );

  // Stream photo or video for in-app Preview (supports HTTP Range for video seeking + HEIC/HEIF transcode via Drive)
  app.get(
    '/api/drive/files/:fileId/stream',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      try {
        const meta = await getDriveFileMetadata(fileId);
        const isHeic =
          /heic|heif/i.test(meta.mimeType) || /\.(heic|heif)$/i.test(meta.name);

        // Chrome/Edge/Firefox cannot natively render raw HEIC in <img>; serve Google Drive's high-res JPEG/PNG render
        if (isHeic && meta.thumbnailLink) {
          const hiResUrl = meta.thumbnailLink.replace(/=s\d+$/, '=s2048');
          const thumbResp = await fetch(hiResUrl, {
            headers: { Authorization: `Bearer ${meta.accessToken}` },
          });
          if (thumbResp.ok && thumbResp.body) {
            reply
              .header('Content-Type', thumbResp.headers.get('content-type') ?? 'image/jpeg')
              .header('Cache-Control', 'private, max-age=300');
            return reply.send(Readable.fromWeb(thumbResp.body as never));
          }
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${meta.accessToken}`,
        };
        if (request.headers.range) {
          headers['Range'] = request.headers.range;
        }

        const resp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
          { headers }
        );

        if (!resp.ok && resp.status !== 206) {
          return reply.code(resp.status).send({ error: 'Gagal streaming file dari Google Drive.' });
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
    }
  );

  // Single file download (attachment)
  app.get(
    '/api/drive/files/:fileId/download',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      try {
        const meta = await getDriveFileMetadata(fileId);
        const resp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
          {
            headers: { Authorization: `Bearer ${meta.accessToken}` },
          }
        );

        if (!resp.ok || !resp.body) {
          return reply.code(resp.status).send({ error: 'Gagal mengunduh file dari Google Drive.' });
        }

        const safeName = meta.name.replace(/["\r\n]/g, '_');
        reply
          .header('Content-Type', meta.mimeType)
          .header('Content-Disposition', `attachment; filename="${safeName}"`);
        const contentLength = resp.headers.get('content-length');
        if (contentLength) reply.header('Content-Length', contentLength);

        return reply.send(Readable.fromWeb(resp.body as never));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal mengunduh file.';
        return reply.code(502).send({ error: msg });
      }
    }
  );

  // Multiple file download streamed directly as a ZIP archive
  app.post(
    '/api/drive/download-zip',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = zipSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Pilih minimal 1 file untuk diunduh.' });
      }

      const archive = createArchive('zip', { store: true }); // store=true (no re-compression, super fast for photos/videos!)
      const zipName = `tgr-drive-bundle-${Date.now()}.zip`;

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
      });

      archive.pipe(reply.raw);

      try {
        const usedNames = new Set<string>();
        for (const fileId of parsed.data.fileIds) {
          const meta = await getDriveFileMetadata(fileId);
          const resp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
            {
              headers: { Authorization: `Bearer ${meta.accessToken}` },
            }
          );
          if (!resp.ok || !resp.body) continue;

          let entryName = meta.name;
          let dup = 1;
          while (usedNames.has(entryName)) {
            entryName = `${dup++}_${meta.name}`;
          }
          usedNames.add(entryName);

          archive.append(Readable.fromWeb(resp.body as never), { name: entryName });
        }

        await archive.finalize();
      } catch (err) {
        archive.abort();
        reply.raw.end();
        request.log.error(err);
      }
    }
  );
}
