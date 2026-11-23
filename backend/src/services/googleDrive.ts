import { google } from 'googleapis';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

export interface DriveIntegrationRow {
  id: number;
  google_email: string;
  encrypted_refresh_token: string;
  target_folder_id: string;
  updated_at: string;
}

export function createOAuthClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      'GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET belum diisi di backend/.env'
    );
  }
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export function generateGoogleAuthUrl(state?: string): string {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  });
}

export async function handleOAuthCallback(code: string) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'Google tidak mengembalikan refresh_token. Cabut akses app di akun Google lalu coba otorisasi ulang.'
    );
  }

  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email ?? 'fototgr@gmail.com';

  const encryptedToken = encryptSecret(tokens.refresh_token);

  const existing = await query<DriveIntegrationRow>(
    'SELECT * FROM drive_integration WHERE id = 1'
  );
  const targetFolderId =
    existing.rows[0]?.target_folder_id || env.GOOGLE_DEFAULT_FOLDER_ID;

  await query(
    `INSERT INTO drive_integration (id, google_email, encrypted_refresh_token, target_folder_id, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id)
     DO UPDATE SET
       google_email = EXCLUDED.google_email,
       encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       updated_at = NOW()`,
    [email, encryptedToken, targetFolderId]
  );

  return { email, targetFolderId };
}

export async function getDriveConfig(): Promise<DriveIntegrationRow | null> {
  const res = await query<DriveIntegrationRow>(
    'SELECT * FROM drive_integration WHERE id = 1'
  );
  return res.rows[0] ?? null;
}

export async function getAuthenticatedDriveContext() {
  const cfg = await getDriveConfig();
  if (!cfg || !cfg.encrypted_refresh_token) {
    throw new Error(
      'Akun Google Drive fototgr@gmail.com belum dihubungkan oleh Admin.'
    );
  }

  const refreshToken = decryptSecret(cfg.encrypted_refresh_token);
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const accessTokenResp = await oauth2Client.getAccessToken();
  const accessToken = accessTokenResp.token;
  if (!accessToken) {
    throw new Error('Gagal mendapatkan Google Drive access token.');
  }

  return {
    oauth2Client,
    accessToken,
    email: cfg.google_email,
    targetFolderId: cfg.target_folder_id || env.GOOGLE_DEFAULT_FOLDER_ID,
  };
}

export async function getDriveStorageQuota() {
  const { oauth2Client, email, targetFolderId } =
    await getAuthenticatedDriveContext();
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const about = await drive.about.get({
    fields: 'storageQuota,user(emailAddress,displayName)',
  });

  const quota = about.data.storageQuota;
  const limitBytes = quota?.limit ? Number(quota.limit) : 5 * 1024 ** 4; // 5 TB fallback
  const usageBytes = quota?.usage ? Number(quota.usage) : 0;
  const availableBytes = Math.max(0, limitBytes - usageBytes);

  return {
    connected: true,
    email: about.data.user?.emailAddress ?? email,
    targetFolderId,
    limitBytes,
    usageBytes,
    availableBytes,
  };
}

export async function initResumableUploadSession(params: {
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploaderUsername: string;
  originHeader?: string;
  folderId?: string;
}) {
  const { accessToken, targetFolderId: globalFolderId } =
    await getAuthenticatedDriveContext();
  const destinationFolderId = params.folderId?.trim() || globalFolderId;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': params.mimeType,
    'X-Upload-Content-Length': String(params.fileSize),
  };

  // Forward browser Origin so Google Drive returns CORS headers for direct upload
  if (params.originHeader) {
    headers['Origin'] = params.originHeader;
  }

  const body = JSON.stringify({
    name: params.fileName,
    parents: [destinationFolderId],
    description: `Uploaded by: @${params.uploaderUsername} via tgr-drive`,
  });

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers,
      body,
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    if (resp.status === 403 && errText.includes('userRateLimitExceeded')) {
      throw new Error(
        'Batas upload harian Google Drive (750 GB / 24 jam) telah tercapai. Coba lagi nanti.'
      );
    }
    throw new Error(
      `Gagal inisiasi Google Drive Resumable Upload (${resp.status}): ${errText}`
    );
  }

  const uploadUri = resp.headers.get('location');
  if (!uploadUri) {
    throw new Error('Google Drive tidak mengembalikan Location upload URI.');
  }

  return { uploadUri, targetFolderId: destinationFolderId };
}

export async function listDriveFolderContents(params: {
  folderId?: string;
  search?: string;
}) {
  const { oauth2Client, targetFolderId: rootFolderId } =
    await getAuthenticatedDriveContext();
  const activeFolderId = params.folderId?.trim() || rootFolderId;
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const qParts = [`'${activeFolderId.replace(/'/g, "\\'")}' in parents`, 'trashed = false'];
  if (params.search?.trim()) {
    const escaped = params.search.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${escaped}'`);
  }

  const res = await drive.files.list({
    q: qParts.join(' and '),
    fields:
      'files(id, name, mimeType, size, modifiedTime, thumbnailLink, iconLink, description, parents)',
    orderBy: 'folder,modifiedTime desc',
    pageSize: 200,
  });

  const rawFiles = res.data.files ?? [];
  const fileIds = rawFiles.map((f) => f.id).filter((id): id is string => Boolean(id));

  // Lookup uploader username from upload_logs DB as fallback/authoritative source
  const dbUploaderMap = new Map<string, string>();
  if (fileIds.length > 0) {
    const logRes = await query<{ drive_file_id: string; username: string }>(
      `SELECT l.drive_file_id, u.username
       FROM upload_logs l
       JOIN users u ON u.id = l.user_id
       WHERE l.drive_file_id = ANY($1::text[])`,
      [fileIds]
    );
    for (const row of logRes.rows) {
      dbUploaderMap.set(row.drive_file_id, row.username);
    }
  }

  const files = rawFiles.map((f) => {
    const id = f.id ?? '';
    const desc = f.description ?? null;
    let uploadedBy = dbUploaderMap.get(id) ?? null;
    if (!uploadedBy && desc) {
      const m = desc.match(/(?:Uploaded|Created)\s+by:\s*@?([a-zA-Z0-9._-]+)/i);
      if (m) uploadedBy = m[1];
    }
    return {
      id,
      name: f.name ?? 'Untitled',
      mimeType: f.mimeType ?? 'application/octet-stream',
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      size: f.size ? Number(f.size) : 0,
      modifiedTime: f.modifiedTime ?? null,
      hasThumbnail: Boolean(f.thumbnailLink),
      description: desc,
      uploadedBy,
    };
  });

  return {
    rootFolderId,
    activeFolderId,
    files,
  };
}

export async function createDriveSubFolder(
  name: string,
  parentFolderId?: string,
  creatorUsername?: string
) {
  const { oauth2Client, targetFolderId: rootFolderId } =
    await getAuthenticatedDriveContext();
  const parentId = parentFolderId?.trim() || rootFolderId;
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
      description: creatorUsername
        ? `Created by: @${creatorUsername} via tgr-drive`
        : undefined,
    },
    fields: 'id, name, mimeType, modifiedTime, description',
  });

  return {
    id: res.data.id ?? '',
    name: res.data.name ?? name,
    mimeType: 'application/vnd.google-apps.folder',
    isFolder: true,
    size: 0,
    modifiedTime: res.data.modifiedTime ?? new Date().toISOString(),
    uploadedBy: creatorUsername ?? null,
  };
}

export async function getDriveFileMetadata(fileId: string) {
  const { oauth2Client, accessToken } = await getAuthenticatedDriveContext();
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, thumbnailLink',
  });
  return {
    id: res.data.id ?? fileId,
    name: res.data.name ?? 'file',
    mimeType: res.data.mimeType ?? 'application/octet-stream',
    size: res.data.size ? Number(res.data.size) : 0,
    thumbnailLink: res.data.thumbnailLink ?? null,
    accessToken,
  };
}

export async function renameDriveItem(fileId: string, newName: string) {
  const { oauth2Client } = await getAuthenticatedDriveContext();
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const res = await drive.files.update({
    fileId,
    requestBody: { name: newName },
    fields: 'id, name, modifiedTime',
  });
  return res.data;
}

export async function trashDriveItem(fileId: string) {
  const { oauth2Client } = await getAuthenticatedDriveContext();
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
  });
  return { ok: true };
}
