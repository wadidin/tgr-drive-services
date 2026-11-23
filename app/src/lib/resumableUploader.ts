import { api } from './api';

// 16 MB chunk (multiple of 256 KB as required by Google Drive Resumable Upload API)
const CHUNK_SIZE = 16 * 1024 * 1024;

export interface UploadTaskState {
  localId: string;
  file: File;
  folderId?: string;
  folderName?: string;
  uploadId?: string;
  uploadUri?: string;
  offset: number;
  status: 'queued' | 'uploading' | 'paused' | 'success' | 'failed' | 'cancelled';
  speedBps: number;
  error?: string;
  driveFileId?: string;
}

/**
 * Direct Chunked Resumable Upload Engine:
 * Reads slices via File.slice() so multi-GB / unlimited videos never exhaust RAM.
 * Supports uploading to any active folder inside the Global Drive Folder.
 */
export async function runChunkedUpload(
  task: UploadTaskState,
  getSignal: () => { paused: boolean; cancelled: boolean; abortController: AbortController },
  onUpdate: (patch: Partial<UploadTaskState>) => void,
  onSuccess?: () => void
) {
  let uploadId = task.uploadId;
  let uploadUri = task.uploadUri;
  let offset = task.offset;

  try {
    onUpdate({ status: 'uploading', error: undefined });

    if (!uploadUri || !uploadId) {
      const init = await api.initUpload({
        fileName: task.file.name,
        mimeType: task.file.type || 'application/octet-stream',
        fileSize: task.file.size,
        folderId: task.folderId,
      });
      uploadId = init.uploadId;
      uploadUri = init.uploadUri;
      offset = 0;
      onUpdate({ uploadId, uploadUri, offset });
    } else if (offset > 0) {
      // Query Google Drive for exact last received byte before resuming
      const probe = await fetch(uploadUri, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${task.file.size}` },
      });
      if (probe.status === 308) {
        const range = probe.headers.get('Range');
        if (range) {
          const match = range.match(/bytes=0-(\d+)/);
          if (match) offset = Number(match[1]) + 1;
        }
      } else if (probe.status === 200 || probe.status === 201) {
        const json = (await probe.json()) as { id: string };
        await api.completeUpload(uploadId, json.id);
        onUpdate({ status: 'success', offset: task.file.size, driveFileId: json.id, speedBps: 0 });
        onSuccess?.();
        return;
      }
    }

    const total = task.file.size;

    while (offset < total) {
      const ctl = getSignal();
      if (ctl.cancelled) {
        await api.failUpload(uploadId, 'cancelled', 'Dibatalkan pengguna');
        onUpdate({ status: 'cancelled', speedBps: 0 });
        return;
      }
      if (ctl.paused) {
        onUpdate({ status: 'paused', speedBps: 0 });
        return;
      }

      const end = Math.min(offset + CHUNK_SIZE, total);
      const chunk = task.file.slice(offset, end);
      const startTime = performance.now();

      const resp = await fetch(uploadUri, {
        method: 'PUT',
        headers: {
          'Content-Type': task.file.type || 'application/octet-stream',
          'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
        },
        body: chunk,
        signal: ctl.abortController.signal,
      });

      const elapsedSec = Math.max(0.05, (performance.now() - startTime) / 1000);
      const speedBps = (end - offset) / elapsedSec;

      if (resp.status === 308) {
        offset = end;
        onUpdate({ offset, speedBps });
      } else if (resp.status === 200 || resp.status === 201) {
        const json = (await resp.json()) as { id: string };
        await api.completeUpload(uploadId, json.id);
        onUpdate({
          offset: total,
          speedBps: 0,
          status: 'success',
          driveFileId: json.id,
        });
        onSuccess?.();
        return;
      } else {
        const errText = await resp.text();
        throw new Error(`Google Drive error (${resp.status}): ${errText}`);
      }
    }
  } catch (err) {
    const ctl = getSignal();
    if (ctl.cancelled) {
      if (uploadId) await api.failUpload(uploadId, 'cancelled', 'Dibatalkan pengguna').catch(() => {});
      onUpdate({ status: 'cancelled', speedBps: 0 });
      return;
    }
    if (ctl.paused) {
      onUpdate({ status: 'paused', speedBps: 0 });
      return;
    }
    const msg = err instanceof Error ? err.message : 'Koneksi terputus — klik Resume';
    if (uploadId) {
      await api.failUpload(uploadId, 'failed', msg).catch(() => {});
    }
    onUpdate({ status: 'failed', error: msg, speedBps: 0 });
  }
}
