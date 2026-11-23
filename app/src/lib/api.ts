export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number;
  modifiedTime: string | null;
  hasThumbnail: boolean;
  description: string | null;
  uploadedBy: string | null;
}

export interface DriveListingResponse {
  rootFolderId: string;
  activeFolderId: string;
  files: DriveItem[];
  quota: {
    connected: boolean;
    email: string;
    limitBytes: number;
    usageBytes: number;
    availableBytes: number;
  };
}

export interface PublicShareInfo {
  id?: string;
  token: string;
  drive_item_id?: string;
  driveItemId?: string;
  item_name?: string;
  itemName?: string;
  is_folder?: boolean;
  isFolder?: boolean;
  mime_type?: string;
}

export interface PublicShareResponse {
  share: {
    token: string;
    isFolder: boolean;
    itemName: string;
    driveItemId: string;
  };
  activeFolderId?: string;
  file?: DriveItem;
  files: DriveItem[];
}

export interface UploadHistoryItem {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: string;
  drive_file_id: string | null;
  status: 'initiated' | 'success' | 'failed' | 'cancelled';
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  username?: string;
  display_name?: string;
}

export interface DriveStatus {
  connected: boolean;
  email: string;
  targetFolderId: string;
  oauthConfigured: boolean;
  error?: string;
  limitBytes: number;
  usageBytes: number;
  availableBytes: number;
  dailyBytes: number;
  dailyLimitBytes: number;
}

export interface AdminUserRow {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  upload_count: number;
  total_bytes: string;
  created_at: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'tgr_access_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function withAuthQuery(path: string): string {
  const token = getStoredToken();
  if (!token) return `${API_BASE}${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };

  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `Request gagal (${res.status})`);
  }
  return data as T;
}

export const api = {
  login: async (username: string, password: string) => {
    const res = await request<{ accessToken: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setStoredToken(res.accessToken);
    return res.user;
  },
  logout: async () => {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredToken(null);
  },
  me: () => request<{ user: UserProfile }>('/api/auth/me'),
  updateProfile: async (payload: {
    displayName?: string;
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => {
    const res = await request<{ accessToken: string; user: UserProfile }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (res.accessToken) setStoredToken(res.accessToken);
    return res.user;
  },

  // Google Drive Explorer (Global Folder & Sub-folders)
  driveFiles: (params?: { folderId?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.folderId) qs.set('folderId', params.folderId);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<DriveListingResponse>(`/api/drive/files${suffix}`);
  },
  createFolder: (name: string, parentFolderId?: string) =>
    request<{ folder: DriveItem }>('/api/drive/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentFolderId }),
    }),
  renameDriveItem: (fileId: string, name: string) =>
    request<{ ok: boolean }>(`/api/drive/files/${encodeURIComponent(fileId)}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  trashDriveItem: (fileId: string) =>
    request<{ ok: boolean }>(`/api/drive/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    }),
  createShare: (payload: {
    driveItemId: string;
    itemName: string;
    isFolder: boolean;
    mimeType: string;
  }) =>
    request<{ share: PublicShareInfo }>('/api/shares', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeShare: (token: string) =>
    request<{ ok: boolean }>(`/api/shares/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    }),
  getPublicShare: async (token: string, folderId?: string): Promise<PublicShareResponse> => {
    const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
    const res = await fetch(`${API_BASE}/api/public/share/${encodeURIComponent(token)}${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Link share tidak valid atau sudah dinonaktifkan.');
    return data as PublicShareResponse;
  },
  getPublicThumbnailUrl: (token: string, fileId: string) =>
    `${API_BASE}/api/public/share/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/thumbnail`,
  getPublicStreamUrl: (token: string, fileId: string) =>
    `${API_BASE}/api/public/share/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/stream`,
  getPublicDownloadUrl: (token: string, fileId: string) =>
    `${API_BASE}/api/public/share/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/download`,
  downloadPublicZip: async (token: string, fileIds: string[]) => {
    const res = await fetch(
      `${API_BASE}/api/public/share/${encodeURIComponent(token)}/download-zip`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Gagal mengunduh ZIP.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tgr-share-${fileIds.length}-files.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  getThumbnailUrl: (fileId: string) => withAuthQuery(`/api/drive/files/${encodeURIComponent(fileId)}/thumbnail`),
  getStreamUrl: (fileId: string) => withAuthQuery(`/api/drive/files/${encodeURIComponent(fileId)}/stream`),
  getDownloadUrl: (fileId: string) => withAuthQuery(`/api/drive/files/${encodeURIComponent(fileId)}/download`),
  downloadZip: async (fileIds: string[]) => {
    const token = getStoredToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/api/drive/download-zip`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ fileIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Gagal mengunduh ZIP.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tgr-drive-${fileIds.length}-files.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Direct Resumable Upload (supports uploading into any active sub-folder!)
  initUpload: (payload: {
    fileName: string;
    mimeType: string;
    fileSize: number;
    folderId?: string;
  }) =>
    request<{ uploadId: string; uploadUri: string; targetFolderId: string }>('/api/uploads/init', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  completeUpload: (uploadId: string, driveFileId: string) =>
    request<{ ok: boolean }>(`/api/uploads/${uploadId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ driveFileId }),
    }),

  failUpload: (uploadId: string, status: 'failed' | 'cancelled', errorMessage?: string) =>
    request<{ ok: boolean }>(`/api/uploads/${uploadId}/fail`, {
      method: 'POST',
      body: JSON.stringify({ status, errorMessage }),
    }),

  history: (params?: { type?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{
      items: UploadHistoryItem[];
      stats: { totalFiles: number; totalBytes: number; successFiles: number };
    }>(`/api/uploads/history${suffix}`);
  },

  adminUsers: () => request<{ users: AdminUserRow[] }>('/api/admin/users'),
  adminCreateUser: (payload: {
    username: string;
    password: string;
    displayName: string;
    role: 'admin' | 'user';
  }) =>
    request<{ user: AdminUserRow }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminUpdateUser: (
    id: string,
    payload: { displayName?: string; role?: 'admin' | 'user'; isActive?: boolean; password?: string }
  ) =>
    request<{ user: AdminUserRow }>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  adminDriveStatus: () => request<DriveStatus>('/api/admin/drive/status'),
  adminOAuthUrl: () => request<{ url: string }>('/api/admin/drive/oauth-url'),
  adminSetFolder: (targetFolderId: string) =>
    request<{ ok: boolean; targetFolderId: string }>('/api/admin/drive/folder', {
      method: 'PATCH',
      body: JSON.stringify({ targetFolderId }),
    }),
  adminUploads: () => request<{ items: UploadHistoryItem[] }>('/api/admin/uploads'),
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(val >= 100 ? 0 : 2)} ${units[idx]}`;
}
