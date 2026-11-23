import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudUpload,
  Download,
  Eye,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  List,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AdminUserRow,
  api,
  DriveItem,
  DriveStatus,
  formatBytes,
  UploadHistoryItem,
  UserProfile,
} from './lib/api';
import { runChunkedUpload, UploadTaskState } from './lib/resumableUploader';

type Tab = 'drive' | 'history' | 'admin';
type TypeFilter = 'all' | 'folder' | 'photo' | 'video';
type SortField = 'name' | 'modifiedTime' | 'size';
type SortDir = 'asc' | 'desc';

interface Breadcrumb {
  id: string;
  name: string;
}

function isImageDriveItem(item: DriveItem): boolean {
  return (
    item.mimeType.startsWith('image/') ||
    /\.(heic|heif|jpg|jpeg|png|webp|gif)$/i.test(item.name)
  );
}

function isVideoDriveItem(item: DriveItem): boolean {
  return (
    item.mimeType.startsWith('video/') ||
    /\.(mp4|mov|webm|mkv|3gp|avi)$/i.test(item.name)
  );
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('drive');

  // Login form state (empty by default)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // User self-service profile edit modal
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    username: '',
    currentPassword: '',
    newPassword: '',
  });
  const [profileErr, setProfileErr] = useState('');
  const [profileOk, setProfileOk] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  // Google Drive Explorer state
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([
    { id: '', name: 'DRIVE GLOBAL' },
  ]);
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [driveQuota, setDriveQuota] = useState<{
    email: string;
    limitBytes: number;
    usageBytes: number;
  } | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveErr, setDriveErr] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zipBusy, setZipBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);

  // Right-side Info Panel (Google Drive "i" inspector)
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [inspectedItem, setInspectedItem] = useState<DriveItem | null>(null);

  // New folder & Rename modal state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<DriveItem | null>(null);
  const [renameInput, setRenameInput] = useState('');

  // Preview Lightbox state
  const [previewFile, setPreviewFile] = useState<DriveItem | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showPreviewInfo, setShowPreviewInfo] = useState(false);

  // Upload Queue Drawer state
  const [tasks, setTasks] = useState<UploadTaskState[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const controllersRef = useRef<
    Map<string, { paused: boolean; cancelled: boolean; abortController: AbortController }>
  >(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // History state
  const [historyItems, setHistoryItems] = useState<UploadHistoryItem[]>([]);
  const [historyStats, setHistoryStats] = useState({ totalFiles: 0, totalBytes: 0, successFiles: 0 });
  const [historyFilter, setHistoryFilter] = useState<'all' | 'video' | 'photo' | 'failed'>('all');
  const [historyLoading, setHistoryLoading] = useState(false);

  // Admin state
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [adminLogs, setAdminLogs] = useState<UploadHistoryItem[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [folderInput, setFolderInput] = useState('');
  const [adminMsg, setAdminMsg] = useState('');
  const [newUser, setNewUser] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'user' as 'user' | 'admin',
  });

  const activeCrumb = breadcrumbs[breadcrumbs.length - 1];
  const activeFolderId = activeCrumb?.id || undefined;

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setBootLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (tab === 'drive') loadDriveFolder(activeFolderId, searchQuery);
    if (tab === 'history') loadHistory();
    if (tab === 'admin' && user.role === 'admin') loadAdminData();
  }, [user, tab, activeFolderId, historyFilter]);

  // Filtered + Sorted Drive Items (Google Drive behavior: folders first, then files, both sorted!)
  const filteredAndSorted = useMemo(() => {
    const filtered = driveItems.filter((item) => {
      if (typeFilter === 'folder') return item.isFolder;
      if (typeFilter === 'photo') return !item.isFolder && isImageDriveItem(item);
      if (typeFilter === 'video') return !item.isFolder && isVideoDriveItem(item);
      return true;
    });

    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Keep folders grouped at top like Google Drive
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      if (sortField === 'name') {
        return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) * mult;
      }
      if (sortField === 'size') {
        return (a.size - b.size) * mult;
      }
      const timeA = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const timeB = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return (timeA - timeB) * mult;
    });
  }, [driveItems, typeFilter, sortField, sortDir]);

  const folders = useMemo(
    () => filteredAndSorted.filter((i) => i.isFolder),
    [filteredAndSorted]
  );
  const mediaFiles = useMemo(
    () => filteredAndSorted.filter((i) => !i.isFolder),
    [filteredAndSorted]
  );

  // Keyboard navigation inside Preview Lightbox Modal (Esc, ArrowLeft, ArrowRight)
  useEffect(() => {
    if (!previewFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewFile(null);
      } else if (e.key === 'ArrowRight') {
        navigatePreview(1);
      } else if (e.key === 'ArrowLeft') {
        navigatePreview(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewFile, mediaFiles]);

  function openPreview(file: DriveItem) {
    setPreviewFile(file);
    setPreviewZoom(1);
    setShowPreviewInfo(false);
    setInspectedItem(file);
  }

  function navigatePreview(delta: number) {
    if (!previewFile || mediaFiles.length <= 1) return;
    const idx = mediaFiles.findIndex((f) => f.id === previewFile.id);
    if (idx === -1) return;
    const nextIdx = (idx + delta + mediaFiles.length) % mediaFiles.length;
    setPreviewFile(mediaFiles[nextIdx]);
    setPreviewZoom(1);
  }

  function handleSortHeaderClick(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  }

  async function loadDriveFolder(folderId?: string, search?: string) {
    setDriveLoading(true);
    setDriveErr('');
    try {
      const res = await api.driveFiles({ folderId, search });
      setDriveItems(res.files);
      setDriveQuota({
        email: res.quota.email,
        limitBytes: res.quota.limitBytes,
        usageBytes: res.quota.usageBytes,
      });
      if (!breadcrumbs[0].id && res.rootFolderId) {
        setBreadcrumbs([{ id: res.rootFolderId, name: 'DRIVE GLOBAL' }]);
      }
      setSelectedIds(new Set());
    } catch (err) {
      setDriveErr(err instanceof Error ? err.message : 'Gagal memuat isi folder Google Drive.');
    } finally {
      setDriveLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const params =
        historyFilter === 'video'
          ? { type: 'video' }
          : historyFilter === 'photo'
            ? { type: 'photo' }
            : historyFilter === 'failed'
              ? { status: 'failed' }
              : undefined;
      const res = await api.history(params);
      setHistoryItems(res.items);
      setHistoryStats(res.stats);
    } catch {
      // ignore transient error
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadAdminData() {
    setAdminLoading(true);
    try {
      const [status, usersRes, logsRes] = await Promise.all([
        api.adminDriveStatus(),
        api.adminUsers(),
        api.adminUploads(),
      ]);
      setDriveStatus(status);
      setFolderInput(status.targetFolderId);
      setAdminUsers(usersRes.users);
      setAdminLogs(logsRes.items);
    } catch (err) {
      setAdminMsg(err instanceof Error ? err.message : 'Gagal memuat data admin');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr('');
    setLoginBusy(true);
    try {
      const loggedIn = await api.login(username, password);
      setUser(loggedIn);
      setTab('drive');
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : 'Login gagal');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    setLogoutBusy(true);
    try {
      await api.logout();
    } finally {
      setUser(null);
      setTasks([]);
      setDriveItems([]);
      setUsername('');
      setPassword('');
      setLoginErr('');
      setLogoutBusy(false);
    }
  }

  function openProfileModal() {
    if (!user) return;
    setProfileForm({
      displayName: user.displayName,
      username: user.username,
      currentPassword: '',
      newPassword: '',
    });
    setProfileErr('');
    setProfileOk('');
    setShowProfileModal(true);
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileErr('');
    setProfileOk('');
    setProfileBusy(true);
    try {
      const payload: {
        displayName?: string;
        username?: string;
        currentPassword?: string;
        newPassword?: string;
      } = {};
      if (profileForm.displayName.trim()) payload.displayName = profileForm.displayName.trim();
      if (profileForm.username.trim()) payload.username = profileForm.username.trim();
      if (profileForm.newPassword.trim()) {
        payload.currentPassword = profileForm.currentPassword;
        payload.newPassword = profileForm.newPassword;
      }

      const updatedUser = await api.updateProfile(payload);
      setUser(updatedUser);
      setProfileForm((p) => ({ ...p, currentPassword: '', newPassword: '' }));
      setProfileOk('Profil berhasil diperbarui!');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Gagal memperbarui profil.');
    } finally {
      setProfileBusy(false);
    }
  }

  function openFolder(folder: DriveItem) {
    setSearchQuery('');
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  function jumpToBreadcrumb(index: number) {
    setSearchQuery('');
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await api.createFolder(newFolderName.trim(), activeFolderId);
      setNewFolderName('');
      setShowNewFolder(false);
      loadDriveFolder(activeFolderId, searchQuery);
    } catch (err) {
      setDriveErr(err instanceof Error ? err.message : 'Gagal membuat folder.');
    }
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renameTarget || !renameInput.trim()) return;
    try {
      await api.renameDriveItem(renameTarget.id, renameInput.trim());
      setRenameTarget(null);
      setRenameInput('');
      loadDriveFolder(activeFolderId, searchQuery);
    } catch (err) {
      setDriveErr(err instanceof Error ? err.message : 'Gagal mengganti nama.');
    }
  }

  async function handleTrashSingle(item: DriveItem) {
    if (!window.confirm(`Pindahkan "${item.name}" ke Sampah Google Drive?`)) return;
    try {
      await api.trashDriveItem(item.id);
      if (previewFile?.id === item.id) setPreviewFile(null);
      if (inspectedItem?.id === item.id) setInspectedItem(null);
      loadDriveFolder(activeFolderId, searchQuery);
    } catch (err) {
      setDriveErr(err instanceof Error ? err.message : 'Gagal menghapus item.');
    }
  }

  async function handleTrashSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Pindahkan ${ids.length} file terpilih ke Sampah Google Drive?`)) return;
    try {
      await Promise.all(ids.map((id) => api.trashDriveItem(id)));
      setSelectedIds(new Set());
      loadDriveFolder(activeFolderId, searchQuery);
    } catch (err) {
      setDriveErr(err instanceof Error ? err.message : 'Gagal menghapus file terpilih.');
    }
  }

  function toggleSelect(fileId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  function selectAllFiles() {
    const fileOnly = mediaFiles.map((f) => f.id);
    if (selectedIds.size === fileOnly.length && fileOnly.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(fileOnly));
    }
  }

  async function handleMultiDownload() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      window.open(api.getDownloadUrl(ids[0]), '_blank');
      return;
    }
    setZipBusy(true);
    try {
      await api.downloadZip(ids);
    } catch (err) {
      setDriveErr(err instanceof Error ? err.message : 'Gagal download multiple ZIP.');
    } finally {
      setZipBusy(false);
    }
  }

  function enqueueAndStartFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const targetId = activeFolderId;
    const targetName = activeCrumb?.name || 'DRIVE GLOBAL';

    const added: UploadTaskState[] = Array.from(fileList).map((file) => ({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      folderId: targetId,
      folderName: targetName,
      offset: 0,
      status: 'queued',
      speedBps: 0,
    }));

    setTasks((prev) => [...added, ...prev]);
    setDrawerOpen(true);
    added.forEach((t) => startTask(t));
  }

  function startTask(target: UploadTaskState) {
    const ctl = { paused: false, cancelled: false, abortController: new AbortController() };
    controllersRef.current.set(target.localId, ctl);

    runChunkedUpload(
      target,
      () => controllersRef.current.get(target.localId) ?? ctl,
      (patch) => {
        setTasks((prev) =>
          prev.map((t) => (t.localId === target.localId ? { ...t, ...patch } : t))
        );
      },
      () => {
        loadDriveFolder(activeFolderId, searchQuery);
      }
    );
  }

  function pauseTask(localId: string) {
    const ctl = controllersRef.current.get(localId);
    if (ctl) {
      ctl.paused = true;
      ctl.abortController.abort();
    }
  }

  function cancelTask(localId: string) {
    const ctl = controllersRef.current.get(localId);
    if (ctl) {
      ctl.cancelled = true;
      ctl.abortController.abort();
    } else {
      setTasks((prev) => prev.filter((t) => t.localId !== localId));
    }
  }

  async function handleConnectOAuth() {
    setAdminMsg('');
    try {
      const { url } = await api.adminOAuthUrl();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setAdminMsg(err instanceof Error ? err.message : 'Gagal membuat OAuth URL');
    }
  }

  async function handleSaveFolder() {
    setAdminMsg('');
    try {
      await api.adminSetFolder(folderInput);
      setAdminMsg('Folder ID global berhasil disimpan!');
      loadAdminData();
    } catch (err) {
      setAdminMsg(err instanceof Error ? err.message : 'Gagal menyimpan Folder ID');
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setAdminMsg('');
    try {
      await api.adminCreateUser(newUser);
      setNewUser({ username: '', displayName: '', password: '', role: 'user' });
      setAdminMsg('User baru berhasil ditambahkan ke database!');
      loadAdminData();
    } catch (err) {
      setAdminMsg(err instanceof Error ? err.message : 'Gagal membuat user');
    }
  }

  async function handleToggleActive(u: AdminUserRow) {
    await api.adminUpdateUser(u.id, { isActive: !u.is_active });
    loadAdminData();
  }

  const PRELOADER_LOGO_URL =
    'https://tgrcampaign.com/media_library/images/727eb552dbf5eea8a9cba1ec482eacf6.png';

  const renderFullscreenPreloader = (label: string) => (
    <div className="tgr-preloader-overlay">
      <div className="tgr-preloader-box">
        <img src={PRELOADER_LOGO_URL} alt="TGR Logo" className="tgr-preloader-logo" />
        <div className="tgr-preloader-track">
          <div className="tgr-preloader-bar" />
        </div>
        <div className="mono" style={{ fontSize: 12, fontWeight: 800, textAlign: 'center' }}>
          {label}
        </div>
      </div>
    </div>
  );

  if (bootLoading) {
    return renderFullscreenPreloader('MEMUAT TGR DRIVE...');
  }

  // ==================== LOGIN SCREEN ====================
  if (!user) {
    return (
      <div className="login-grid">
        {loginBusy && renderFullscreenPreloader('MEMVERIFIKASI AKUN...')}
        <div
          style={{
            background: 'var(--cobalt)',
            color: '#000000',
            padding: '48px 40px',
            borderRight: '4px solid #000000',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 28,
          }}
        >
          <div>
            <span className="sticker" style={{ background: 'var(--tangerine)', color: '#000' }}>
              ★ DOCUMENTATION TGR EVENT'S
            </span>
            <h1 style={{ fontSize: 'clamp(38px, 5.8vw, 68px)', lineHeight: 1.02, margin: '28px 0 18px' }}>
              TGR DRIVE
            </h1>
            <p style={{ fontWeight: 700, fontSize: 17, maxWidth: 520 }}>
              Dokumentasi event TGR ada disini, jangan lupa login untuk upload keseruanmu!
              Sesuaikan folder dan upload dokumentasi keseruan team TGR!
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span className="sticker" style={{ background: 'var(--mint)', color: '#000' }}>
              ⚡ TGR
            </span>
            <span className="sticker" style={{ background: 'var(--magenta)', color: '#000' }}>
              ▶ Documentation
            </span>
            <span className="sticker" style={{ background: 'var(--lime)', color: '#000' }}>
              • Event's
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', placeItems: 'center', padding: 28 }}>
          <form onSubmit={handleLogin} className="max-card" style={{ width: '100%', maxWidth: 440, padding: 32 }}>
            <span className="pill" style={{ background: '#000', color: 'var(--lime)' }}>
              TGR DRIVE
            </span>
            <h2 style={{ fontSize: 30, margin: '14px 0 6px' }}>MASUK AKUN TIM</h2>
            <p style={{ margin: '0 0 22px', color: 'var(--muted)', fontSize: 13, fontWeight: 700 }}>
              Login dengan Username & Password yang benar.
            </p>

            {loginErr && (
              <div
                style={{
                  background: '#FFE5EC',
                  border: '3px solid #000',
                  padding: '10px 14px',
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {loginErr}
              </div>
            )}

            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 6 }}>USERNAME</label>
            <input
              className="max-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Masukkan username"
              autoComplete="username"
              required
              style={{ marginBottom: 16 }}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 6 }}>PASSWORD</label>
            <input
              className="max-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan password"
              autoComplete="current-password"
              required
              style={{ marginBottom: 22 }}
            />

            <button type="submit" disabled={loginBusy} className="max-btn btn-lime" style={{ width: '100%' }}>
              {loginBusy ? 'MEMVERIFIKASI...' : 'MASUK KE TGR Dashboard ->'}
            </button>

            <div
              style={{
                marginTop: 18,
                background: '#000',
                color: 'var(--mint)',
                padding: '10px 12px',
                fontSize: 11,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <ShieldCheck size={16} /> DB AUTH • AES-256 TOKEN • DIRECT DRIVE 5TB
            </div>
          </form>
        </div>
      </div>
    );
  }

  const quotaPct = driveQuota
    ? Math.min(100, Math.round((driveQuota.usageBytes / Math.max(1, driveQuota.limitBytes)) * 100))
    : 0;
  const previewIndex = previewFile ? mediaFiles.findIndex((f) => f.id === previewFile.id) : -1;

  return (
    <div
      className="app-shell"
      onClick={() => showNewMenu && setShowNewMenu(false)}
      onDragOver={(e) => {
        e.preventDefault();
        if (tab === 'drive') setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (tab === 'drive') enqueueAndStartFiles(e.dataTransfer.files);
      }}
    >
      {/* Hidden File & Camera Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          enqueueAndStartFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          enqueueAndStartFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Fullscreen Blurred Preloader across ALL pages (Drive, History, Admin, Profile, ZIP, Logout) */}
      {(driveLoading || historyLoading || adminLoading || zipBusy || profileBusy || logoutBusy) &&
        renderFullscreenPreloader(
          logoutBusy
            ? 'KELUAR DARI SESI...'
            : zipBusy
              ? 'MENYIAPKAN ARSIP ZIP...'
              : profileBusy
                ? 'MENYIMPAN PROFIL...'
                : historyLoading
                  ? 'MEMUAT RIWAYAT UNGGAHAN...'
                  : adminLoading
                    ? 'MEMUAT ADMIN CENTER...'
                    : 'MEMUAT ISI TGR DRIVE...'
        )}

      {/* Full-Screen Drag & Drop Overlay */}
      {isDragging && (
        <div className="drive-drop-overlay">
          <div className="max-card" style={{ padding: 36, textAlign: 'center', background: '#FFFFFF' }}>
            <CloudUpload size={48} />
            <h2 style={{ margin: '12px 0 6px', fontSize: 28 }}>LEPAS FILE UNTUK UPLOAD!</h2>
            <div className="mono" style={{ fontWeight: 800 }}>
              Tujuan: 📁 {activeCrumb?.name} (Ukuran Unlimited)
            </div>
          </div>
        </div>
      )}

      {/* ==================== GOOGLE DRIVE LEFT SIDEBAR ==================== */}
      <aside className="sidebar">
        <div
          style={{
            background: '#000000',
            color: 'var(--lime)',
            padding: '12px 14px',
            fontWeight: 800,
            fontSize: 20,
            border: '3px solid #000000',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <HardDrive size={22} /> TGR DRIVE
        </div>

        {/* Google Drive "+ Baru" Popover Button */}
        <div className="new-menu-popover" onClick={(e) => e.stopPropagation()}>
          <button
            className="max-btn btn-magenta"
            style={{ width: '100%', padding: '14px 16px', fontSize: 14 }}
            onClick={() => setShowNewMenu((v) => !v)}
          >
            <Plus size={18} /> BARU
          </button>

          {showNewMenu && (
            <div className="new-menu-dropdown">
              <button
                className="new-menu-item"
                onClick={() => {
                  setTab('drive');
                  setShowNewFolder(true);
                  setShowNewMenu(false);
                }}
              >
                <FolderPlus size={16} /> Folder Baru
              </button>
              <button
                className="new-menu-item"
                onClick={() => {
                  setTab('drive');
                  setShowNewMenu(false);
                  fileInputRef.current?.click();
                }}
              >
                <CloudUpload size={16} /> Upload File (Multi)
              </button>
              <button
                className="new-menu-item"
                onClick={() => {
                  setTab('drive');
                  setShowNewMenu(false);
                  cameraInputRef.current?.click();
                }}
              >
                <Camera size={16} /> Ambil dari Kamera
              </button>
            </div>
          )}
        </div>

        <button
          className={`max-btn ${tab === 'drive' ? 'btn-cobalt' : 'btn-ink'}`}
          style={{ justifyContent: 'flex-start' }}
          onClick={() => setTab('drive')}
        >
          <FolderOpen size={18} /> DRIVE GLOBAL
        </button>

        <button
          className={`max-btn ${tab === 'history' ? 'btn-mint' : 'btn-ink'}`}
          style={{ justifyContent: 'flex-start' }}
          onClick={() => setTab('history')}
        >
          <History size={18} /> RIWAYAT SAYA
        </button>

        {user.role === 'admin' && (
          <button
            className={`max-btn ${tab === 'admin' ? 'btn-tangerine' : 'btn-ink'}`}
            style={{ justifyContent: 'flex-start' }}
            onClick={() => setTab('admin')}
          >
            <Settings size={18} /> ADMIN CENTER
          </button>
        )}

        {/* Storage Meter */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="max-card-sm" style={{ background: '#FFFFFF', padding: 14 }}>
            <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>
              PENYIMPANAN (5TB PRO)
            </div>
            <div className="progress-track" style={{ height: 14, margin: '8px 0' }}>
              <div className="progress-fill" style={{ width: `${Math.max(4, quotaPct)}%`, background: 'var(--cobalt)' }} />
            </div>
            <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
              {driveQuota
                ? `${formatBytes(driveQuota.usageBytes)} dari ${formatBytes(driveQuota.limitBytes)}`
                : 'fototgr@gmail.com'}
            </div>
          </div>

          <div className="max-card-sm" style={{ background: '#000000', color: '#FFFFFF', padding: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{user.displayName}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--lime)', fontWeight: 700 }}>
              @{user.username} • {user.role.toUpperCase()}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button
                onClick={openProfileModal}
                className="max-btn btn-lime"
                style={{ padding: '6px 8px', fontSize: 10, flex: 1 }}
              >
                <Pencil size={12} /> PROFIL
              </button>
              <button
                onClick={handleLogout}
                className="max-btn btn-magenta"
                style={{ padding: '6px 8px', fontSize: 10, flex: 1 }}
              >
                <LogOut size={12} /> KELUAR
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ==================== MAIN AREA ==================== */}
      <div className="main-area">
        {/* Top Search, View Mode & Info Inspector Bar */}
        <header className="topbar">
          <form
            className="drive-search-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              setTab('drive');
              loadDriveFolder(activeFolderId, searchQuery);
            }}
          >
            <Search size={18} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Telusuri di TGR Drive (nama foto, video, folder)..."
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  loadDriveFolder(activeFolderId, '');
                }}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2 }}
              >
                <X size={16} />
              </button>
            )}
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {tab === 'drive' && (
              <>
                <button
                  className={`max-btn ${viewMode === 'list' ? 'btn-lime' : 'btn-ink'}`}
                  style={{ padding: '8px 10px' }}
                  title="Tampilan Daftar (List)"
                  onClick={() => setViewMode('list')}
                >
                  <List size={16} /> LIST
                </button>
                <button
                  className={`max-btn ${viewMode === 'grid' ? 'btn-lime' : 'btn-ink'}`}
                  style={{ padding: '8px 10px' }}
                  title="Tampilan Grid"
                  onClick={() => setViewMode('grid')}
                >
                  <LayoutGrid size={16} /> GRID
                </button>
                <button
                  className={`max-btn ${showInfoPanel ? 'btn-cobalt' : 'btn-ink'}`}
                  style={{ padding: '8px 10px' }}
                  title="Lihat Detail Info"
                  onClick={() => setShowInfoPanel((v) => !v)}
                >
                  <Info size={16} />
                </button>
                <button
                  className="max-btn btn-mint"
                  style={{ padding: '8px 10px' }}
                  title="Muat Ulang"
                  onClick={() => loadDriveFolder(activeFolderId, searchQuery)}
                >
                  <RefreshCw size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="pill"
              style={{ background: 'var(--violet)', color: '#000', cursor: 'pointer' }}
              onClick={openProfileModal}
              title="Edit Nama, Username & Password"
            >
              <Pencil size={11} /> @{user.username}
            </button>
          </div>
        </header>

        <main className="page-content">
          {/* ==================== TAB 1: GOOGLE DRIVE EXPLORER ==================== */}
          {tab === 'drive' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Breadcrumb + Upload-to-Current-Folder Bar */}
              <div className="drive-breadcrumb-bar">
                <div className="drive-crumbs">
                  {breadcrumbs.map((b, idx) => (
                    <React.Fragment key={`${b.id}-${idx}`}>
                      <button
                        className={`drive-crumb-btn ${idx === breadcrumbs.length - 1 ? 'active' : ''}`}
                        onClick={() => jumpToBreadcrumb(idx)}
                      >
                        📁 {b.name}
                      </button>
                      {idx < breadcrumbs.length - 1 && <ChevronRight size={16} />}
                    </React.Fragment>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="max-btn btn-lime"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <CloudUpload size={15} /> UPLOAD KE SINI
                  </button>
                  <button
                    className="max-btn btn-magenta"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera size={15} /> KAMERA
                  </button>
                  <button
                    className="max-btn btn-cobalt"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                    onClick={() => setShowNewFolder((v) => !v)}
                  >
                    <FolderPlus size={15} /> FOLDER BARU
                  </button>
                </div>
              </div>

              {/* Google Drive Style Filter & Sorting Toolbar */}
              <div className="drive-filter-bar">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 800, marginRight: 4 }}>
                    TIPE:
                  </span>
                  {(['all', 'folder', 'photo', 'video'] as const).map((tf) => (
                    <button
                      key={tf}
                      className={`drive-crumb-btn ${typeFilter === tf ? 'active' : ''}`}
                      onClick={() => setTypeFilter(tf)}
                    >
                      {tf === 'all'
                        ? `SEMUA (${driveItems.length})`
                        : tf === 'folder'
                          ? '📁 FOLDER'
                          : tf === 'photo'
                            ? '🖼 FOTO'
                            : '🎬 VIDEO'}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 800 }}>
                    URUTKAN:
                  </span>
                  <select
                    className="drive-select"
                    value={sortField}
                    onChange={(e) => setSortField(e.target.value as SortField)}
                  >
                    <option value="modifiedTime">TERAKHIR DIUBAH</option>
                    <option value="name">NAMA</option>
                    <option value="size">UKURAN FILE</option>
                  </select>
                  <button
                    className="max-btn btn-ink"
                    style={{ padding: '7px 10px', fontSize: 11 }}
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    title="Ubah Arah Urutan"
                  >
                    {sortDir === 'asc' ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}
                    {sortDir === 'asc' ? 'ASC' : 'DESC'}
                  </button>
                  {mediaFiles.length > 0 && (
                    <button className="drive-crumb-btn" onClick={selectAllFiles}>
                      {selectedIds.size === mediaFiles.length ? '☑ BATAL PILIH' : '☐ PILIH SEMUA'}
                    </button>
                  )}
                </div>
              </div>

              {/* Inline Create Sub-Folder Form */}
              {showNewFolder && (
                <form
                  onSubmit={handleCreateFolder}
                  className="max-card-sm"
                  style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', background: 'var(--lime)' }}
                >
                  <input
                    className="max-input"
                    style={{ flex: 1, minWidth: 200 }}
                    placeholder={`Nama folder baru di dalam "${activeCrumb?.name}"...`}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    autoFocus
                    required
                  />
                  <button type="submit" className="max-btn btn-ink">
                    BUAT FOLDER
                  </button>
                  <button type="button" className="max-btn btn-magenta" onClick={() => setShowNewFolder(false)}>
                    BATAL
                  </button>
                </form>
              )}

              {/* Inline Rename Form */}
              {renameTarget && (
                <form
                  onSubmit={handleRenameSubmit}
                  className="max-card-sm"
                  style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', background: 'var(--violet)' }}
                >
                  <input
                    className="max-input"
                    style={{ flex: 1, minWidth: 200 }}
                    value={renameInput}
                    onChange={(e) => setRenameInput(e.target.value)}
                    autoFocus
                    required
                  />
                  <button type="submit" className="max-btn btn-lime">
                    SIMPAN NAMA
                  </button>
                  <button type="button" className="max-btn btn-magenta" onClick={() => setRenameTarget(null)}>
                    BATAL
                  </button>
                </form>
              )}

              {/* Multi-Select Action Bar */}
              {selectedIds.size > 0 && (
                <div
                  className="max-card-sm"
                  style={{
                    background: 'var(--cobalt)',
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div className="mono" style={{ fontWeight: 800, fontSize: 14 }}>
                    ✓ {selectedIds.size} FILE DIPILIH
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="max-btn btn-lime"
                      style={{ padding: '8px 14px', fontSize: 12 }}
                      disabled={zipBusy}
                      onClick={handleMultiDownload}
                    >
                      <Download size={15} />{' '}
                      {zipBusy
                        ? 'MENYIAPKAN ZIP...'
                        : selectedIds.size === 1
                          ? 'DOWNLOAD FILE'
                          : `DOWNLOAD ${selectedIds.size} FILE (ZIP)`}
                    </button>
                    <button
                      className="max-btn btn-magenta"
                      style={{ padding: '8px 12px', fontSize: 12 }}
                      onClick={handleTrashSelected}
                    >
                      <Trash2 size={15} /> HAPUS ({selectedIds.size})
                    </button>
                    <button
                      className="max-btn btn-ink"
                      style={{ padding: '8px 12px', fontSize: 12 }}
                      onClick={() => setSelectedIds(new Set())}
                    >
                      <X size={15} /> BATAL
                    </button>
                  </div>
                </div>
              )}

              {driveErr && (
                <div className="max-card-sm" style={{ background: '#FFE5EC', padding: 16, fontWeight: 800 }}>
                  ⚠ {driveErr}
                  {user.role === 'admin' && (
                    <button
                      className="max-btn btn-lime"
                      style={{ marginLeft: 12, padding: '6px 10px', fontSize: 11 }}
                      onClick={() => setTab('admin')}
                    >
                      BUKA ADMIN CENTER
                    </button>
                  )}
                </div>
              )}

              {/* MAIN EXPLORER + OPTIONAL RIGHT INFO PANEL */}
              <div className={`drive-workspace-split ${showInfoPanel ? 'with-info' : ''}`}>
                <div>
                  {driveLoading ? (
                    <div className="max-card-sm" style={{ padding: 40, textAlign: 'center', fontWeight: 800 }}>
                      MEMUAT ISI FOLDER GOOGLE DRIVE (fototgr@gmail.com)...
                    </div>
                  ) : filteredAndSorted.length === 0 ? (
                    <div className="max-card" style={{ padding: 44, textAlign: 'center', background: '#FFFFFF' }}>
                      <CloudUpload size={42} />
                      <h3 style={{ margin: '12px 0 6px' }}>TIDAK ADA FILE / FOLDER DI SINI</h3>
                      <p style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 18 }}>
                        Tarik & lepas foto/video ke layar ini, atau klik tombol Upload untuk langsung mengisi{' '}
                        <strong>{activeCrumb?.name}</strong>.
                      </p>
                      <button className="max-btn btn-lime" onClick={() => fileInputRef.current?.click()}>
                        <Plus size={16} /> PILIH FOTO / VIDEO UNLIMITED
                      </button>
                    </div>
                  ) : viewMode === 'list' ? (
                    /* ==================== GOOGLE DRIVE LIST VIEW (FOLDERS + FILES) ==================== */
                    <div className="drive-list-table">
                      <div className="drive-list-row header-row">
                        <span />
                        <span />
                        <button className="drive-sort-th" onClick={() => handleSortHeaderClick('name')}>
                          NAMA {sortField === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                        <span className="drive-list-hide-sm mono" style={{ fontSize: 12 }}>UPLOADER BY</span>
                        <span className="drive-list-hide-sm mono" style={{ fontSize: 12 }}>TIPE</span>
                        <button className="drive-sort-th" onClick={() => handleSortHeaderClick('size')}>
                          UKURAN {sortField === 'size' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                        <button
                          className="drive-sort-th drive-list-hide-sm"
                          onClick={() => handleSortHeaderClick('modifiedTime')}
                        >
                          DIUBAH {sortField === 'modifiedTime' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                        <span className="drive-list-hide-sm mono" style={{ fontSize: 12 }}>AKSI</span>
                      </div>

                      {filteredAndSorted.map((item) => {
                        const checked = selectedIds.has(item.id);
                        const isVideo = item.mimeType.startsWith('video/');
                        const isImage = item.mimeType.startsWith('image/');
                        return (
                          <div
                            key={item.id}
                            className={`drive-list-row ${checked ? 'selected' : ''}`}
                            onClick={() => setInspectedItem(item)}
                          >
                            <div>
                              {!item.isFolder ? (
                                <button
                                  className={`drive-select-box ${checked ? 'checked' : ''}`}
                                  style={{ position: 'static' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSelect(item.id);
                                  }}
                                >
                                  {checked && <Check size={14} strokeWidth={3} />}
                                </button>
                              ) : (
                                <Folder size={20} fill="#FFE600" />
                              )}
                            </div>

                            {/* Mini Thumbnail in List View */}
                            <div
                              style={{
                                width: 38,
                                height: 38,
                                border: '2px solid #000',
                                background: item.isFolder ? '#FFE600' : '#141414',
                                display: 'grid',
                                placeItems: 'center',
                                overflow: 'hidden',
                                cursor: 'pointer',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (item.isFolder) openFolder(item);
                                else openPreview(item);
                              }}
                            >
                              {item.isFolder ? (
                                <FolderOpen size={18} />
                              ) : item.hasThumbnail ? (
                                <img
                                  src={api.getThumbnailUrl(item.id)}
                                  alt={item.name}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  loading="lazy"
                                />
                              ) : isVideo ? (
                                <Film size={16} color="#FFE600" />
                              ) : (
                                <ImageIcon size={16} color="#00E676" />
                              )}
                            </div>

                            <div
                              style={{
                                cursor: 'pointer',
                                wordBreak: 'break-word',
                                lineHeight: 1.3,
                              }}
                              title={item.name}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (item.isFolder) openFolder(item);
                                else openPreview(item);
                              }}
                            >
                              {item.name}
                            </div>

                            <span className="drive-list-hide-sm mono" style={{ fontSize: 11, color: '#000' }}>
                              {item.uploadedBy ? `@${item.uploadedBy}` : '—'}
                            </span>

                            <span className="drive-list-hide-sm">
                              <span
                                className="pill"
                                style={{
                                  background: item.isFolder
                                    ? 'var(--lime)'
                                    : isVideo
                                      ? 'var(--cobalt)'
                                      : 'var(--mint)',
                                  color: '#000',
                                }}
                              >
                                {item.isFolder ? 'FOLDER' : isVideo ? 'VIDEO' : isImage ? 'FOTO' : 'FILE'}
                              </span>
                            </span>

                            <span className="mono">{item.isFolder ? '—' : formatBytes(item.size)}</span>

                            <span className="mono drive-list-hide-sm" style={{ fontSize: 11 }}>
                              {item.modifiedTime
                                ? new Date(item.modifiedTime).toLocaleDateString('id-ID')
                                : '-'}
                            </span>

                            <div className="drive-list-hide-sm" style={{ display: 'flex', gap: 5 }}>
                              {!item.isFolder && (
                                <>
                                  <button
                                    className="max-btn btn-lime"
                                    style={{ padding: '5px 7px' }}
                                    title="Preview"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPreview(item);
                                    }}
                                  >
                                    <Eye size={13} />
                                  </button>
                                  <a
                                    href={api.getDownloadUrl(item.id)}
                                    className="max-btn btn-mint"
                                    style={{ padding: '5px 7px', textDecoration: 'none' }}
                                    title="Download"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Download size={13} />
                                  </a>
                                </>
                              )}
                              <button
                                className="max-btn btn-cobalt"
                                style={{ padding: '5px 7px' }}
                                title="Ganti Nama"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenameTarget(item);
                                  setRenameInput(item.name);
                                }}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                className="max-btn btn-magenta"
                                style={{ padding: '5px 7px' }}
                                title="Hapus ke Sampah"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTrashSingle(item);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* ==================== GOOGLE DRIVE GRID VIEW ==================== */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                      {folders.length > 0 && (
                        <div>
                          <div className="mono" style={{ fontSize: 12, fontWeight: 800, marginBottom: 10 }}>
                            FOLDER ({folders.length})
                          </div>
                          <div className="drive-folder-grid">
                            {folders.map((folder) => (
                              <div
                                key={folder.id}
                                className="drive-folder-card"
                                style={{
                                  flexDirection: 'column',
                                  alignItems: 'stretch',
                                  gap: 8,
                                }}
                                onClick={() => openFolder(folder)}
                              >
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                                    <Folder size={22} fill="#FFE600" style={{ flexShrink: 0, marginTop: 2 }} />
                                    <span style={{ wordBreak: 'break-word', lineHeight: 1.3 }}>
                                      {folder.name}
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                    <button
                                      className="drive-crumb-btn"
                                      style={{ padding: '3px 5px' }}
                                      title="Ganti Nama"
                                      onClick={() => {
                                        setRenameTarget(folder);
                                        setRenameInput(folder.name);
                                      }}
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      className="drive-crumb-btn"
                                      style={{ padding: '3px 5px', background: 'var(--magenta)' }}
                                      title="Hapus"
                                      onClick={() => handleTrashSingle(folder)}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                                  Uploader by: {folder.uploadedBy ? `@${folder.uploadedBy}` : '—'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {mediaFiles.length > 0 && (
                        <div>
                          <div className="mono" style={{ fontSize: 12, fontWeight: 800, marginBottom: 10 }}>
                            FILE ({mediaFiles.length})
                          </div>
                          <div className="drive-file-grid">
                            {mediaFiles.map((file) => {
                              const isVideo = file.mimeType.startsWith('video/');
                              const isImage = file.mimeType.startsWith('image/');
                              const checked = selectedIds.has(file.id);
                              return (
                                <div
                                  key={file.id}
                                  className={`drive-file-card ${checked ? 'selected' : ''}`}
                                  onClick={() => setInspectedItem(file)}
                                >
                                  <div
                                    className="drive-thumb-box"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPreview(file);
                                    }}
                                  >
                                    <div
                                      className={`drive-select-box ${checked ? 'checked' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleSelect(file.id);
                                      }}
                                    >
                                      {checked && <Check size={16} strokeWidth={3} />}
                                    </div>

                                    <span
                                      className="pill"
                                      style={{
                                        position: 'absolute',
                                        top: 8,
                                        right: 8,
                                        background: isVideo ? 'var(--cobalt)' : 'var(--mint)',
                                        color: '#000',
                                        zIndex: 3,
                                      }}
                                    >
                                      {isVideo ? '▶ VIDEO' : isImage ? 'FOTO' : 'FILE'}
                                    </span>

                                    {file.hasThumbnail ? (
                                      <img
                                        src={api.getThumbnailUrl(file.id)}
                                        alt={file.name}
                                        loading="lazy"
                                      />
                                    ) : isVideo ? (
                                      <Film size={44} color="#FFE600" />
                                    ) : (
                                      <ImageIcon size={44} color="#00E676" />
                                    )}
                                  </div>

                                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div
                                      style={{
                                        fontWeight: 800,
                                        fontSize: 13,
                                        wordBreak: 'break-word',
                                        lineHeight: 1.35,
                                      }}
                                      title={file.name}
                                    >
                                      {file.name}
                                    </div>
                                    <div className="mono" style={{ fontSize: 11, fontWeight: 800, color: '#000' }}>
                                      Uploader by: {file.uploadedBy ? `@${file.uploadedBy}` : '—'}
                                    </div>
                                    <div
                                      className="mono"
                                      style={{
                                        fontSize: 11,
                                        color: 'var(--muted)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                      }}
                                    >
                                      <span>{formatBytes(file.size)}</span>
                                      <span>
                                        {file.modifiedTime
                                          ? new Date(file.modifiedTime).toLocaleDateString('id-ID')
                                          : ''}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 5 }}>
                                      <button
                                        className="max-btn btn-lime"
                                        style={{ flex: 1, padding: '6px 8px', fontSize: 11 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openPreview(file);
                                        }}
                                      >
                                        <Eye size={13} /> PREVIEW
                                      </button>
                                      <a
                                        href={api.getDownloadUrl(file.id)}
                                        className="max-btn btn-mint"
                                        style={{ padding: '6px 8px', fontSize: 11, textDecoration: 'none' }}
                                        title="Download"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <Download size={13} />
                                      </a>
                                      <button
                                        className="max-btn btn-cobalt"
                                        style={{ padding: '6px 8px', fontSize: 11 }}
                                        title="Ganti Nama"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRenameTarget(file);
                                          setRenameInput(file.name);
                                        }}
                                      >
                                        <Pencil size={13} />
                                      </button>
                                      <button
                                        className="max-btn btn-magenta"
                                        style={{ padding: '6px 8px', fontSize: 11 }}
                                        title="Hapus ke Sampah"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleTrashSingle(file);
                                        }}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* RIGHT-SIDE GOOGLE DRIVE INFO INSPECTOR PANEL (ⓘ) */}
                {showInfoPanel && (
                  <aside className="drive-info-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: 16 }}>ⓘ DETAIL INFO</h3>
                      <button
                        className="drive-crumb-btn"
                        onClick={() => setShowInfoPanel(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {!inspectedItem ? (
                      <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Klik file atau folder untuk melihat detail informasi, ukuran, dan metadata pengunggah.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            height: 150,
                            border: '3px solid #000',
                            background: inspectedItem.isFolder ? 'var(--lime)' : '#141414',
                            display: 'grid',
                            placeItems: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          {inspectedItem.isFolder ? (
                            <FolderOpen size={48} />
                          ) : inspectedItem.hasThumbnail ? (
                            <img
                              src={api.getThumbnailUrl(inspectedItem.id)}
                              alt={inspectedItem.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Film size={42} color="#FFE600" />
                          )}
                        </div>

                        <div style={{ fontWeight: 800, fontSize: 15, wordBreak: 'break-all' }}>
                          {inspectedItem.name}
                        </div>

                        <div className="mono" style={{ fontSize: 11, display: 'grid', gap: 6 }}>
                          <div><strong>TIPE:</strong> {inspectedItem.mimeType}</div>
                          <div><strong>UKURAN:</strong> {inspectedItem.isFolder ? 'Folder' : formatBytes(inspectedItem.size)}</div>
                          <div>
                            <strong>DIUBAH:</strong>{' '}
                            {inspectedItem.modifiedTime
                              ? new Date(inspectedItem.modifiedTime).toLocaleString('id-ID')
                              : '-'}
                          </div>
                          <div><strong>LOKASI:</strong> {activeCrumb?.name}</div>
                          {inspectedItem.description && (
                            <div style={{ background: 'var(--cream)', border: '2px solid #000', padding: 8 }}>
                              <strong>DESKRIPSI:</strong>
                              <br />
                              {inspectedItem.description}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {!inspectedItem.isFolder && (
                            <>
                              <button className="max-btn btn-lime" onClick={() => openPreview(inspectedItem)}>
                                <Eye size={15} /> BUKA PREVIEW
                              </button>
                              <a
                                href={api.getDownloadUrl(inspectedItem.id)}
                                className="max-btn btn-mint"
                                style={{ textDecoration: 'none' }}
                              >
                                <Download size={15} /> DOWNLOAD FILE
                              </a>
                            </>
                          )}
                          <button
                            className="max-btn btn-cobalt"
                            onClick={() => {
                              setRenameTarget(inspectedItem);
                              setRenameInput(inspectedItem.name);
                            }}
                          >
                            <Pencil size={15} /> GANTI NAMA
                          </button>
                          <button
                            className="max-btn btn-magenta"
                            onClick={() => handleTrashSingle(inspectedItem)}
                          >
                            <Trash2 size={15} /> HAPUS KE SAMPAH
                          </button>
                        </div>
                      </>
                    )}
                  </aside>
                )}
              </div>
            </div>
          )}

          {/* ==================== TAB 2: HISTORY ==================== */}
          {tab === 'history' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="max-card-sm" style={{ background: 'var(--cobalt)', padding: 18 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>TOTAL FILE SAYA</div>
                  <div style={{ fontSize: 30, fontWeight: 800 }}>{historyStats.totalFiles}</div>
                </div>
                <div className="max-card-sm" style={{ background: 'var(--magenta)', padding: 18 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>TOTAL VOLUME</div>
                  <div style={{ fontSize: 30, fontWeight: 800 }}>{formatBytes(historyStats.totalBytes)}</div>
                </div>
                <div className="max-card-sm" style={{ background: 'var(--mint)', padding: 18 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>BERHASIL MASUK DRIVE</div>
                  <div style={{ fontSize: 30, fontWeight: 800 }}>{historyStats.successFiles} ✓</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {(['all', 'video', 'photo', 'failed'] as const).map((f) => (
                  <button
                    key={f}
                    className={`max-btn ${historyFilter === f ? 'btn-ink' : 'btn-lime'}`}
                    style={{ padding: '8px 14px', fontSize: 12 }}
                    onClick={() => setHistoryFilter(f)}
                  >
                    {f === 'all' ? 'SEMUA' : f === 'video' ? 'VIDEO' : f === 'photo' ? 'FOTO' : 'GAGAL'}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                {historyItems.length === 0 ? (
                  <div className="max-card-sm" style={{ padding: 24, fontWeight: 700, color: 'var(--muted)' }}>
                    Belum ada riwayat unggahan.
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <div
                      key={item.id}
                      className="max-card-sm"
                      style={{
                        padding: 16,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{item.original_filename}</div>
                        <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {formatBytes(Number(item.file_size_bytes))} •{' '}
                          {new Date(item.created_at).toLocaleString('id-ID')}
                        </div>
                      </div>
                      <span
                        className="pill"
                        style={{
                          background:
                            item.status === 'success'
                              ? 'var(--mint)'
                              : item.status === 'failed'
                                ? 'var(--magenta)'
                                : 'var(--tangerine)',
                          color: '#000',
                        }}
                      >
                        {item.status === 'success' ? '✓ TGR-GLOBAL DRIVE' : item.status.toUpperCase()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ==================== TAB 3: ADMIN CONTROL CENTER ==================== */}
          {tab === 'admin' && user.role === 'admin' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {adminMsg && (
                <div className="max-card-sm" style={{ background: 'var(--lime)', padding: 14, fontWeight: 800 }}>
                  {adminMsg}
                </div>
              )}

              <div className="kpi-grid">
                <div className="max-card-sm" style={{ background: 'var(--cobalt)', padding: 18 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>KAPASITAS GOOGLE PRO 5TB</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {driveStatus ? `${formatBytes(driveStatus.usageBytes)} / ${formatBytes(driveStatus.limitBytes)}` : '...'}
                  </div>
                </div>
                <div className="max-card-sm" style={{ background: 'var(--magenta)', padding: 18 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>KUOTA HARIAN (750 GB/24J)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {driveStatus ? `${formatBytes(driveStatus.dailyBytes)} / 750 GB` : '...'}
                  </div>
                </div>
                <div className="max-card-sm" style={{ background: 'var(--lime)', padding: 18 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>USER DATABASE AKTIF</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {adminUsers.filter((u) => u.is_active).length} / {adminUsers.length} USER
                  </div>
                </div>
                <div className="max-card-sm" style={{ background: 'var(--mint)', padding: 18 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>STATUS OAUTH2</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {driveStatus?.connected ? 'CONNECTED ✓' : 'BELUM CONNECT'}
                  </div>
                </div>
              </div>

              <div className="admin-mid-grid">
                <div className="max-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <h3 style={{ margin: 0 }}>INTEGRASI GOOGLE DRIVE (OAUTH2)</h3>
                  <div
                    className="mono"
                    style={{
                      background: '#000',
                      color: driveStatus?.connected ? 'var(--mint)' : 'var(--tangerine)',
                      padding: 12,
                      fontWeight: 800,
                      fontSize: 12,
                    }}
                  >
                    ● {driveStatus?.connected ? 'CONNECTED' : 'PERLU OTORISASI'}: {driveStatus?.email ?? 'fototgr@gmail.com'}
                  </div>

                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 11, fontWeight: 800, marginBottom: 6 }}>
                      GLOBAL TARGET FOLDER ID
                    </label>
                    <input
                      className="max-input"
                      value={folderInput}
                      onChange={(e) => setFolderInput(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="max-btn btn-lime" onClick={handleSaveFolder}>
                      <FolderOpen size={16} /> SIMPAN FOLDER ID
                    </button>
                    <button className="max-btn btn-magenta" onClick={handleConnectOAuth}>
                      <RefreshCw size={16} /> {driveStatus?.connected ? 'RE-AUTH OAUTH2' : 'HUBUNGKAN fototgr@gmail.com'}
                    </button>
                  </div>
                </div>

                <div className="max-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <h3 style={{ margin: 0 }}>MANAJEMEN USER DATABASE</h3>
                  <form onSubmit={handleCreateUser} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input
                      className="max-input"
                      placeholder="Username"
                      value={newUser.username}
                      onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                      required
                    />
                    <input
                      className="max-input"
                      placeholder="Nama Tampilan"
                      value={newUser.displayName}
                      onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                      required
                    />
                    <input
                      className="max-input"
                      type="password"
                      placeholder="Password (min 6)"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      required
                    />
                    <button type="submit" className="max-btn btn-lime">
                      <UserPlus size={16} /> + TAMBAH USER
                    </button>
                  </form>

                  <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                    {adminUsers.map((u) => (
                      <div
                        key={u.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 12px',
                          border: '3px solid #000',
                          background: u.is_active ? 'var(--cream)' : '#FFE5EC',
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        <div>
                          @{u.username} ({u.display_name}) • {u.role.toUpperCase()} • {u.upload_count} file
                        </div>
                        <button
                          className={`pill ${u.is_active ? 'btn-mint' : 'btn-magenta'}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleToggleActive(u)}
                        >
                          {u.is_active ? 'AKTIF ✓' : 'NONAKTIF'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="max-card" style={{ background: '#000', color: '#fff', padding: 22 }}>
                <h3 style={{ margin: '0 0 14px', color: 'var(--lime)' }}>
                  LOG UNGGAHAN GLOBAL (SEMUA USER → fototgr@gmail.com)
                </h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {adminLogs.length === 0 ? (
                    <div style={{ opacity: 0.75, fontSize: 13 }}>Belum ada aktivitas upload tercatat.</div>
                  ) : (
                    adminLogs.map((log) => (
                      <div
                        key={log.id}
                        className="mono"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 10,
                          padding: '10px 14px',
                          background: '#161616',
                          border: '2px solid #333',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        <span>
                          @{log.username} — {log.original_filename} ({formatBytes(Number(log.file_size_bytes))})
                        </span>
                        <span style={{ color: log.status === 'success' ? 'var(--mint)' : 'var(--tangerine)' }}>
                          {log.status.toUpperCase()} {log.drive_file_id ? `• ${log.drive_file_id}` : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ==================== GOOGLE DRIVE FLOATING UPLOAD QUEUE DRAWER ==================== */}
      {tasks.length > 0 && (
        <div className="drive-upload-drawer">
          <div
            style={{
              background: '#000',
              color: 'var(--lime)',
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
            }}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <span className="mono">
              ▲ UPLOAD QUEUE ({tasks.filter((t) => t.status === 'success').length}/{tasks.length})
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {drawerOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTasks([]);
                }}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
                title="Tutup antrean"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {drawerOpen && (
            <div style={{ maxHeight: 300, overflowY: 'auto', padding: 12, display: 'grid', gap: 10 }}>
              {tasks.map((t) => {
                const pct = t.file.size ? Math.min(100, Math.round((t.offset / t.file.size) * 100)) : 0;
                return (
                  <div
                    key={t.localId}
                    style={{
                      border: '3px solid #000',
                      padding: 10,
                      background:
                        t.status === 'success'
                          ? 'var(--mint)'
                          : t.status === 'failed'
                            ? '#FFE5EC'
                            : 'var(--cream)',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 12, wordBreak: 'break-all' }}>{t.file.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', margin: '2px 0 6px' }}>
                      📁 {t.folderName} • {formatBytes(t.file.size)}
                      {t.speedBps > 0 ? ` • ${formatBytes(t.speedBps)}/s` : ''}
                    </div>
                    <div className="progress-track" style={{ height: 14, marginBottom: 6 }}>
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontWeight: 800 }}>
                      <span className="mono">{pct}% • {t.status.toUpperCase()}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(t.status === 'paused' || t.status === 'failed') && (
                          <button
                            className="max-btn btn-tangerine"
                            style={{ padding: '4px 8px', fontSize: 10 }}
                            onClick={() => startTask(t)}
                          >
                            <Play size={11} /> RESUME
                          </button>
                        )}
                        {t.status === 'uploading' && (
                          <button
                            className="max-btn btn-tangerine"
                            style={{ padding: '4px 8px', fontSize: 10 }}
                            onClick={() => pauseTask(t.localId)}
                          >
                            <Pause size={11} />
                          </button>
                        )}
                        {t.status !== 'success' && (
                          <button
                            className="max-btn btn-magenta"
                            style={{ padding: '4px 8px', fontSize: 10 }}
                            onClick={() => cancelTask(t.localId)}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    {t.error && (
                      <div style={{ marginTop: 4, fontSize: 11, color: '#B00020', fontWeight: 700 }}>{t.error}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== GOOGLE DRIVE LIGHTBOX PREVIEW MODAL XL (PHOTO & VIDEO) ==================== */}
      {previewFile && (
        <div className="preview-backdrop" onClick={() => setPreviewFile(null)}>
          <div className="preview-modal-xl" onClick={(e) => e.stopPropagation()}>
            <div className="preview-topbar">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {previewFile.name}
              </div>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
                {previewIndex >= 0 ? `${previewIndex + 1} / ${mediaFiles.length} • ` : ''}
                {formatBytes(previewFile.size)} • {previewFile.mimeType}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isImageDriveItem(previewFile) && (
                <>
                  <button
                    className="max-btn btn-ink"
                    style={{ padding: '8px 10px', fontSize: 12 }}
                    onClick={() => setPreviewZoom((z) => Math.max(0.5, z - 0.25))}
                    title="Zoom Out"
                  >
                    <ZoomOut size={15} />
                  </button>
                  <button
                    className="max-btn btn-ink"
                    style={{ padding: '8px 10px', fontSize: 12 }}
                    onClick={() => setPreviewZoom((z) => Math.min(3, z + 0.25))}
                    title="Zoom In"
                  >
                    <ZoomIn size={15} />
                  </button>
                </>
              )}
              <button
                className={`max-btn ${showPreviewInfo ? 'btn-cobalt' : 'btn-ink'}`}
                style={{ padding: '8px 10px', fontSize: 12 }}
                onClick={() => setShowPreviewInfo((v) => !v)}
                title="Detail File"
              >
                <Info size={15} />
              </button>
              <a
                href={api.getDownloadUrl(previewFile.id)}
                className="max-btn btn-mint"
                style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none' }}
              >
                <Download size={15} /> DOWNLOAD
              </a>
              <button
                className="max-btn btn-magenta"
                style={{ padding: '8px 12px', fontSize: 12 }}
                onClick={() => setPreviewFile(null)}
              >
                <X size={16} /> TUTUP
              </button>
            </div>
          </div>

            <div className="preview-stage">
            {mediaFiles.length > 1 && (
              <>
                <button
                  className="max-btn btn-lime preview-nav-btn left"
                  onClick={() => navigatePreview(-1)}
                  title="Sebelumnya (←)"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  className="max-btn btn-lime preview-nav-btn right"
                  onClick={() => navigatePreview(1)}
                  title="Berikutnya (→)"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}

            {isVideoDriveItem(previewFile) ? (
              <video
                key={previewFile.id}
                src={api.getStreamUrl(previewFile.id)}
                controls
                autoPlay
                playsInline
              />
            ) : isImageDriveItem(previewFile) ? (
              <img
                key={previewFile.id}
                src={api.getStreamUrl(previewFile.id)}
                alt={previewFile.name}
                style={{
                  transform: `scale(${previewZoom})`,
                  transition: 'transform 0.15s ease',
                }}
              />
            ) : (
              <div className="max-card" style={{ padding: 28, textAlign: 'center' }}>
                <h3>PREVIEW TIDAK DIDUKUNG UNTUK FORMAT INI</h3>
                <a
                  href={api.getDownloadUrl(previewFile.id)}
                  className="max-btn btn-lime"
                  style={{ textDecoration: 'none' }}
                >
                  <Download size={16} /> DOWNLOAD FILE
                </a>
              </div>
            )}

            {showPreviewInfo && (
              <div
                className="max-card-sm"
                style={{
                  position: 'absolute',
                  right: 16,
                  bottom: 16,
                  width: 300,
                  padding: 14,
                  background: '#FFF8E7',
                  zIndex: 20,
                }}
              >
                <div className="mono" style={{ fontSize: 11, display: 'grid', gap: 5 }}>
                  <div><strong>NAMA:</strong> {previewFile.name}</div>
                  <div><strong>UKURAN:</strong> {formatBytes(previewFile.size)}</div>
                  <div><strong>TIPE:</strong> {previewFile.mimeType}</div>
                  <div>
                    <strong>DIUBAH:</strong>{' '}
                    {previewFile.modifiedTime
                      ? new Date(previewFile.modifiedTime).toLocaleString('id-ID')
                      : '-'}
                  </div>
                  {previewFile.description && (
                    <div><strong>INFO:</strong> {previewFile.description}</div>
                  )}
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      {/* ==================== EDIT PROFIL MODAL (NAMA, USERNAME, PASSWORD) ==================== */}
      {showProfileModal && (
        <div className="preview-backdrop" onClick={() => setShowProfileModal(false)}>
          <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 22 }}>EDIT PROFIL AKUN</h3>
              <button
                className="max-btn btn-magenta"
                style={{ padding: '6px 10px' }}
                onClick={() => setShowProfileModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            {profileErr && (
              <div
                style={{
                  background: '#FFE5EC',
                  border: '3px solid #000',
                  padding: '10px 12px',
                  fontWeight: 800,
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                ⚠ {profileErr}
              </div>
            )}

            {profileOk && (
              <div
                style={{
                  background: 'var(--mint)',
                  border: '3px solid #000',
                  padding: '10px 12px',
                  fontWeight: 800,
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                ✓ {profileOk}
              </div>
            )}

            <form onSubmit={handleProfileSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="mono" style={{ display: 'block', fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
                  NAMA TAMPILAN (HARUS UNIK DI DATABASE)
                </label>
                <input
                  className="max-input"
                  value={profileForm.displayName}
                  onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="mono" style={{ display: 'block', fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
                  USERNAME (HARUS UNIK DI DATABASE)
                </label>
                <input
                  className="max-input"
                  value={profileForm.username}
                  onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
                  required
                />
              </div>

              <div style={{ borderTop: '3px solid #000', paddingTop: 12 }}>
                <div className="mono" style={{ fontSize: 11, fontWeight: 800, marginBottom: 10 }}>
                  GANTI PASSWORD (OPSIONAL — KOSONGKAN JIKA TIDAK INGIN UBAH)
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <input
                    className="max-input"
                    type="password"
                    placeholder="Password saat ini"
                    value={profileForm.currentPassword}
                    onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })}
                  />
                  <input
                    className="max-input"
                    type="password"
                    placeholder="Password baru (min 6 karakter)"
                    value={profileForm.newPassword}
                    onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button type="submit" disabled={profileBusy} className="max-btn btn-lime" style={{ flex: 1 }}>
                  {profileBusy ? 'MENYIMPAN...' : 'SIMPAN PERUBAHAN'}
                </button>
                <button
                  type="button"
                  className="max-btn btn-ink"
                  onClick={() => setShowProfileModal(false)}
                >
                  TUTUP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MOBILE BOTTOM NAV (ANDROID / iOS) ==================== */}
      <nav className="mobile-bottom-nav">
        <button
          className={`max-btn ${tab === 'drive' ? 'btn-cobalt' : 'btn-ink'}`}
          style={{ padding: '10px 6px', fontSize: 11 }}
          onClick={() => setTab('drive')}
        >
          <FolderOpen size={15} /> DRIVE
        </button>
        <button
          className={`max-btn ${tab === 'history' ? 'btn-mint' : 'btn-ink'}`}
          style={{ padding: '10px 6px', fontSize: 11 }}
          onClick={() => setTab('history')}
        >
          <CheckCircle2 size={15} /> RIWAYAT
        </button>
        {user.role === 'admin' ? (
          <button
            className={`max-btn ${tab === 'admin' ? 'btn-tangerine' : 'btn-ink'}`}
            style={{ padding: '10px 6px', fontSize: 11 }}
            onClick={() => setTab('admin')}
          >
            <Settings size={15} /> ADMIN
          </button>
        ) : (
          <button
            className="max-btn btn-magenta"
            style={{ padding: '10px 6px', fontSize: 11 }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus size={15} /> UPLOAD
          </button>
        )}
      </nav>
    </div>
  );
}
