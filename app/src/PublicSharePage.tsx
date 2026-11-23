import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  Eye,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  List,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api, DriveItem, formatBytes } from './lib/api';

type TypeFilter = 'all' | 'folder' | 'photo' | 'video';
type SortField = 'name' | 'modifiedTime' | 'size';
type SortDir = 'asc' | 'desc';

const PRELOADER_LOGO_URL =
  'https://tgrcampaign.com/media_library/images/727eb552dbf5eea8a9cba1ec482eacf6.png';

function isImageItem(item: DriveItem): boolean {
  return (
    item.mimeType.startsWith('image/') ||
    /\.(heic|heif|jpg|jpeg|png|webp|gif)$/i.test(item.name)
  );
}

function isVideoItem(item: DriveItem): boolean {
  return (
    item.mimeType.startsWith('video/') ||
    /\.(mp4|mov|webm|mkv|3gp|avi)$/i.test(item.name)
  );
}

export default function PublicSharePage({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isFolderShare, setIsFolderShare] = useState(true);
  const [singleFile, setSingleFile] = useState<DriveItem | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<DriveItem[]>([]);

  // Only allowed controls: Refresh, Grid/List, Sorting, Filter, Preview
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Preview Modal XL state
  const [previewFile, setPreviewFile] = useState<DriveItem | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showPreviewInfo, setShowPreviewInfo] = useState(false);

  const activeFolderId = breadcrumbs[breadcrumbs.length - 1]?.id || undefined;

  async function loadShare(folderId?: string) {
    setLoading(true);
    setError('');
    try {
      const res = await api.getPublicShare(token, folderId);
      setIsFolderShare(res.share.isFolder);
      if (!res.share.isFolder && res.file) {
        setSingleFile(res.file);
        setItems([]);
      } else {
        setSingleFile(null);
        setItems(res.files);
        if (breadcrumbs.length === 0) {
          setBreadcrumbs([{ id: res.share.driveItemId, name: res.share.itemName }]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link share tidak dapat dibuka.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShare(activeFolderId);
  }, [token, activeFolderId]);

  const filteredAndSorted = useMemo(() => {
    const filtered = items.filter((item) => {
      if (typeFilter === 'folder') return item.isFolder;
      if (typeFilter === 'photo') return !item.isFolder && isImageItem(item);
      if (typeFilter === 'video') return !item.isFolder && isVideoItem(item);
      return true;
    });

    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      if (sortField === 'name') {
        return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) * mult;
      }
      if (sortField === 'size') return (a.size - b.size) * mult;
      const tA = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const tB = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return (tA - tB) * mult;
    });
  }, [items, typeFilter, sortField, sortDir]);

  const folders = useMemo(() => filteredAndSorted.filter((i) => i.isFolder), [filteredAndSorted]);
  const mediaFiles = useMemo(() => filteredAndSorted.filter((i) => !i.isFolder), [filteredAndSorted]);

  useEffect(() => {
    if (!previewFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewFile(null);
      else if (e.key === 'ArrowRight') navigatePreview(1);
      else if (e.key === 'ArrowLeft') navigatePreview(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewFile, mediaFiles]);

  function navigatePreview(delta: number) {
    if (!previewFile || mediaFiles.length <= 1) return;
    const idx = mediaFiles.findIndex((f) => f.id === previewFile.id);
    if (idx === -1) return;
    setPreviewFile(mediaFiles[(idx + delta + mediaFiles.length) % mediaFiles.length]);
    setPreviewZoom(1);
  }

  function handleSortHeader(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  }

  const previewIndex = previewFile ? mediaFiles.findIndex((f) => f.id === previewFile.id) : -1;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Fullscreen Blurred Preloader */}
      {loading && (
        <div className="tgr-preloader-overlay">
          <div className="tgr-preloader-box">
            <img src={PRELOADER_LOGO_URL} alt="TGR Logo" className="tgr-preloader-logo" />
            <div className="tgr-preloader-track">
              <div className="tgr-preloader-bar" />
            </div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 800 }}>
              MEMUAT SHARED DRIVE...
            </div>
          </div>
        </div>
      )}

      {/* Read-Only Public Topbar */}
      <header className="topbar" style={{ background: '#FFE600' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              background: '#000',
              color: 'var(--lime)',
              padding: '8px 12px',
              fontWeight: 800,
              fontSize: 16,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <HardDrive size={18} /> TGR DRIVE
          </div>
          <span className="pill" style={{ background: '#FFFFFF', color: '#000' }}>
            👁 PREVIEW
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {isFolderShare && (
            <>
              <button
                className={`max-btn ${viewMode === 'list' ? 'btn-cobalt' : 'btn-ink'}`}
                style={{ padding: '8px 10px' }}
                onClick={() => setViewMode('list')}
              >
                <List size={15} /> LIST
              </button>
              <button
                className={`max-btn ${viewMode === 'grid' ? 'btn-cobalt' : 'btn-ink'}`}
                style={{ padding: '8px 10px' }}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid size={15} /> GRID
              </button>
            </>
          )}
          <button
            className="max-btn btn-mint"
            style={{ padding: '8px 12px' }}
            onClick={() => loadShare(activeFolderId)}
            title="Refresh"
          >
            <RefreshCw size={15} /> REFRESH
          </button>
        </div>
      </header>

      <main className="page-content" style={{ margin: '0 auto', maxWidth: 1280, paddingBottom: 48 }}>
        {error ? (
          <div className="max-card" style={{ padding: 36, background: '#FFE5EC', textAlign: 'center' }}>
            <h2 style={{ marginTop: 0 }}>LINK SHARE TIDAK TERSEDIA</h2>
            <p style={{ fontWeight: 700 }}>{error}</p>
          </div>
        ) : !isFolderShare && singleFile ? (
          /* ==================== SINGLE SHARED FILE VIEW (NO LOGIN, PREVIEW ONLY) ==================== */
          <div className="preview-modal-xl" style={{ margin: '0 auto', width: '100%' }}>
            <div className="preview-topbar">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, wordBreak: 'break-word' }}>{singleFile.name}</div>
                <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
                  {formatBytes(singleFile.size)} • {singleFile.mimeType}
                  {singleFile.uploadedBy ? ` • Uploader by: @${singleFile.uploadedBy}` : ''}
                </div>
              </div>
              {isImageItem(singleFile) && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="max-btn btn-ink"
                    style={{ padding: '8px 10px' }}
                    onClick={() => setPreviewZoom((z) => Math.max(0.5, z - 0.25))}
                  >
                    <ZoomOut size={15} />
                  </button>
                  <button
                    className="max-btn btn-ink"
                    style={{ padding: '8px 10px' }}
                    onClick={() => setPreviewZoom((z) => Math.min(3, z + 0.25))}
                  >
                    <ZoomIn size={15} />
                  </button>
                </div>
              )}
            </div>
            <div className="preview-stage">
              {isVideoItem(singleFile) ? (
                <video
                  src={api.getPublicStreamUrl(token, singleFile.id)}
                  controls
                  autoPlay
                  playsInline
                />
              ) : isImageItem(singleFile) ? (
                <img
                  src={api.getPublicStreamUrl(token, singleFile.id)}
                  alt={singleFile.name}
                  style={{ transform: `scale(${previewZoom})`, transition: 'transform 0.15s ease' }}
                />
              ) : (
                <div className="max-card" style={{ padding: 24 }}>
                  Format file ini tidak mendukung preview langsung.
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ==================== SHARED FOLDER VIEW (READ-ONLY: LIST/GRID + SORT + REFRESH + PREVIEW) ==================== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Scoped Breadcrumb */}
            <div className="drive-breadcrumb-bar">
              <div className="drive-crumbs">
                {breadcrumbs.map((b, idx) => (
                  <React.Fragment key={`${b.id}-${idx}`}>
                    <button
                      className={`drive-crumb-btn ${idx === breadcrumbs.length - 1 ? 'active' : ''}`}
                      onClick={() => setBreadcrumbs((prev) => prev.slice(0, idx + 1))}
                    >
                      📁 {b.name}
                    </button>
                    {idx < breadcrumbs.length - 1 && <ChevronRight size={16} />}
                  </React.Fragment>
                ))}
              </div>
              <span className="mono" style={{ fontSize: 11, fontWeight: 800 }}>
                SHARED FOLDER • PREVIEW
              </span>
            </div>

            {/* Filter & Sorting Bar */}
            <div className="drive-filter-bar">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 800 }}>TIPE:</span>
                {(['all', 'folder', 'photo', 'video'] as const).map((tf) => (
                  <button
                    key={tf}
                    className={`drive-crumb-btn ${typeFilter === tf ? 'active' : ''}`}
                    onClick={() => setTypeFilter(tf)}
                  >
                    {tf === 'all' ? `SEMUA (${items.length})` : tf === 'folder' ? '📁 FOLDER' : tf === 'photo' ? '🖼 FOTO' : '🎬 VIDEO'}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 800 }}>URUTKAN:</span>
                <select
                  className="drive-select"
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                >
                  <option value="name">NAMA</option>
                  <option value="modifiedTime">TERAKHIR DIUBAH</option>
                  <option value="size">UKURAN FILE</option>
                </select>
                <button
                  className="max-btn btn-ink"
                  style={{ padding: '7px 10px', fontSize: 11 }}
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                >
                  {sortDir === 'asc' ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}
                  {sortDir === 'asc' ? 'ASC' : 'DESC'}
                </button>
              </div>
            </div>

            {filteredAndSorted.length === 0 ? (
              <div className="max-card" style={{ padding: 40, textAlign: 'center', fontWeight: 800 }}>
                Folder ini kosong.
              </div>
            ) : viewMode === 'list' ? (
              <div className="drive-list-table">
                <div
                  className="drive-list-row header-row"
                  style={{ gridTemplateColumns: '44px 1fr 140px 84px 96px 116px 96px' }}
                >
                  <span />
                  <button className="drive-sort-th" onClick={() => handleSortHeader('name')}>
                    NAMA {sortField === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <span className="drive-list-hide-sm mono" style={{ fontSize: 12 }}>UPLOADER BY</span>
                  <span className="drive-list-hide-sm mono" style={{ fontSize: 12 }}>TIPE</span>
                  <button className="drive-sort-th" onClick={() => handleSortHeader('size')}>
                    UKURAN {sortField === 'size' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <button className="drive-sort-th drive-list-hide-sm" onClick={() => handleSortHeader('modifiedTime')}>
                    DIUBAH {sortField === 'modifiedTime' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <span className="drive-list-hide-sm mono" style={{ fontSize: 12 }}>PREVIEW</span>
                </div>

                {filteredAndSorted.map((item) => {
                  const isVid = isVideoItem(item);
                  const isImg = isImageItem(item);
                  return (
                    <div
                      key={item.id}
                      className="drive-list-row"
                      style={{ gridTemplateColumns: '44px 1fr 140px 84px 96px 116px 96px', cursor: 'pointer' }}
                      onClick={() => {
                        if (item.isFolder) setBreadcrumbs((prev) => [...prev, { id: item.id, name: item.name }]);
                        else {
                          setPreviewFile(item);
                          setPreviewZoom(1);
                        }
                      }}
                    >
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          border: '2px solid #000',
                          background: item.isFolder ? '#FFE600' : '#141414',
                          display: 'grid',
                          placeItems: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {item.isFolder ? (
                          <FolderOpen size={18} />
                        ) : item.hasThumbnail ? (
                          <img
                            src={api.getPublicThumbnailUrl(token, item.id)}
                            alt={item.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                          />
                        ) : isVid ? (
                          <Film size={16} color="#FFE600" />
                        ) : (
                          <ImageIcon size={16} color="#00E676" />
                        )}
                      </div>
                      <div style={{ wordBreak: 'break-word', lineHeight: 1.3 }}>{item.name}</div>
                      <span className="drive-list-hide-sm mono" style={{ fontSize: 11 }}>
                        {item.uploadedBy ? `@${item.uploadedBy}` : '—'}
                      </span>
                      <span className="drive-list-hide-sm">
                        <span
                          className="pill"
                          style={{
                            background: item.isFolder ? 'var(--lime)' : isVid ? 'var(--cobalt)' : 'var(--mint)',
                            color: '#000',
                          }}
                        >
                          {item.isFolder ? 'FOLDER' : isVid ? 'VIDEO' : isImg ? 'FOTO' : 'FILE'}
                        </span>
                      </span>
                      <span className="mono">{item.isFolder ? '—' : formatBytes(item.size)}</span>
                      <span className="mono drive-list-hide-sm" style={{ fontSize: 11 }}>
                        {item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString('id-ID') : '-'}
                      </span>
                      <div className="drive-list-hide-sm">
                        {!item.isFolder && (
                          <button className="max-btn btn-lime" style={{ padding: '5px 8px', fontSize: 11 }}>
                            <Eye size={13} /> LIHAT
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
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
                          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                          onClick={() => setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }])}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                            <Folder size={22} fill="#FFE600" style={{ flexShrink: 0, marginTop: 2 }} />
                            <span className="drive-item-title">{folder.name}</span>
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
                        const isVid = isVideoItem(file);
                        const isImg = isImageItem(file);
                        return (
                          <div key={file.id} className="drive-file-card">
                            <div
                              className="drive-thumb-box"
                              onClick={() => {
                                setPreviewFile(file);
                                setPreviewZoom(1);
                              }}
                            >
                              <span
                                className="pill"
                                style={{
                                  position: 'absolute',
                                  top: 8,
                                  right: 8,
                                  background: isVid ? 'var(--cobalt)' : 'var(--mint)',
                                  color: '#000',
                                  zIndex: 3,
                                }}
                              >
                                {isVid ? '▶ VIDEO' : isImg ? 'FOTO' : 'FILE'}
                              </span>
                              {file.hasThumbnail ? (
                                <img
                                  src={api.getPublicThumbnailUrl(token, file.id)}
                                  alt={file.name}
                                  loading="lazy"
                                />
                              ) : isVid ? (
                                <Film size={44} color="#FFE600" />
                              ) : (
                                <ImageIcon size={44} color="#00E676" />
                              )}
                            </div>

                            <div className="drive-card-body">
                              <div className="drive-item-title" title={file.name}>
                                {file.name}
                              </div>
                              <div className="mono" style={{ fontSize: 11, fontWeight: 800 }}>
                                Uploader by: {file.uploadedBy ? `@${file.uploadedBy}` : '—'}
                              </div>
                              <div className="mono drive-card-meta-row">
                                <span>{formatBytes(file.size)}</span>
                              </div>
                              <div className="drive-card-actions">
                                <button
                                  className="max-btn btn-lime"
                                  style={{ flex: 1, padding: '7px 10px', fontSize: 11 }}
                                  onClick={() => {
                                    setPreviewFile(file);
                                    setPreviewZoom(1);
                                  }}
                                >
                                  <Eye size={13} /> PREVIEW
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
        )}
      </main>

      {/* Public Lightbox Preview Modal XL (No Download/Edit/Delete) */}
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
                  {formatBytes(previewFile.size)}
                  {previewFile.uploadedBy ? ` • @${previewFile.uploadedBy}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {isImageItem(previewFile) && (
                  <>
                    <button
                      className="max-btn btn-ink"
                      style={{ padding: '8px 10px' }}
                      onClick={() => setPreviewZoom((z) => Math.max(0.5, z - 0.25))}
                    >
                      <ZoomOut size={15} />
                    </button>
                    <button
                      className="max-btn btn-ink"
                      style={{ padding: '8px 10px' }}
                      onClick={() => setPreviewZoom((z) => Math.min(3, z + 0.25))}
                    >
                      <ZoomIn size={15} />
                    </button>
                  </>
                )}
                <button
                  className={`max-btn ${showPreviewInfo ? 'btn-cobalt' : 'btn-ink'}`}
                  style={{ padding: '8px 10px' }}
                  onClick={() => setShowPreviewInfo((v) => !v)}
                >
                  <Info size={15} />
                </button>
                <button
                  className="max-btn btn-magenta"
                  style={{ padding: '8px 12px' }}
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
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <button
                    className="max-btn btn-lime preview-nav-btn right"
                    onClick={() => navigatePreview(1)}
                  >
                    <ChevronRight size={22} />
                  </button>
                </>
              )}

              {isVideoItem(previewFile) ? (
                <video
                  key={previewFile.id}
                  src={api.getPublicStreamUrl(token, previewFile.id)}
                  controls
                  autoPlay
                  playsInline
                />
              ) : isImageItem(previewFile) ? (
                <img
                  key={previewFile.id}
                  src={api.getPublicStreamUrl(token, previewFile.id)}
                  alt={previewFile.name}
                  style={{ transform: `scale(${previewZoom})`, transition: 'transform 0.15s ease' }}
                />
              ) : (
                <div className="max-card" style={{ padding: 24 }}>
                  Format file tidak mendukung preview.
                </div>
              )}

              {showPreviewInfo && (
                <div
                  className="max-card-sm"
                  style={{
                    position: 'absolute',
                    right: 16,
                    bottom: 16,
                    width: 280,
                    padding: 14,
                    background: '#FFF8E7',
                    zIndex: 20,
                  }}
                >
                  <div className="mono" style={{ fontSize: 11, display: 'grid', gap: 5 }}>
                    <div><strong>NAMA:</strong> {previewFile.name}</div>
                    <div><strong>UKURAN:</strong> {formatBytes(previewFile.size)}</div>
                    <div><strong>TIPE:</strong> {previewFile.mimeType}</div>
                    <div><strong>UPLOADER:</strong> {previewFile.uploadedBy ? `@${previewFile.uploadedBy}` : '—'}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
