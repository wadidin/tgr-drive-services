# Implementation Tasks — `tgr-drive`

| Atribut | Detail |
| :--- | :--- |
| **Nama Produk** | TGR Drive Uploader (`tgr-drive`) |
| **Dokumen Terkait** | [requirement.md](file:///d:/tgr-drive/docs/requirement.md) · [design.md](file:///d:/tgr-drive/docs/design.md) |

---

## Phase 1: Setup Proyek & Infrastruktur
- [ ] **1.1** Inisialisasi struktur repositori (`backend/` untuk Node.js TypeScript, `app/` untuk Flutter multiplatform Web/Android/iOS).
- [ ] **1.2** Setup proyek Google Cloud Console: aktifkan **Google Drive API**, konfigurasi **OAuth Consent Screen (Production)** untuk akun `fototgr@gmail.com`, dan buat OAuth2 Client ID & Secret.
- [ ] **1.3** Setup database **PostgreSQL** dan konfigurasi ORM (Prisma / Drizzle) dengan skema tabel `users`, `upload_logs`, dan `drive_integration`.
- [ ] **1.4** Buat konfigurasi environment (`.env.example`) dan utilitas enkripsi `AES-256-GCM` untuk menyimpan `refresh_token` Google.
- [ ] **1.5** Buat *seeder* akun Admin awal di database.

---

## Phase 2: Backend — Autentikasi & Manajemen User (`FR-01`, `FR-05`)
- [ ] **2.1** Implementasi hashing password (`argon2`/`bcrypt`) dan middleware JWT Access + Refresh Token (HTTP-only Cookie untuk Web, Bearer Token untuk Mobile).
- [ ] **2.2** Buat endpoint autentikasi: `POST /api/auth/login` (dengan *rate limiting* 5x/15 menit), `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`.
- [ ] **2.3** Implementasi middleware RBAC (`requireAuth`, `requireAdmin`, dan pengecekan `is_active = true`).
- [ ] **2.4** Buat endpoint manajemen user Admin: `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id` (edit, nonaktifkan, reset password).

---

## Phase 3: Backend — Integrasi Google Drive & Direct Upload (`FR-02`, `FR-03`, `FR-04`, `FR-05`)
- [ ] **3.1** Buat endpoint OAuth2 Admin: `GET /api/admin/drive/oauth-url` dan `GET /api/admin/drive/oauth-callback` untuk otorisasi `fototgr@gmail.com` dan simpan `encrypted_refresh_token`.
- [ ] **3.2** Implementasi service Google Drive: auto-refresh `access_token`, pengecekan sisa kuota (`about.get`), serta endpoint `GET /api/admin/drive/status` dan `PATCH /api/admin/drive/folder`.
- [ ] **3.3** Buat endpoint `POST /api/uploads/init`:
  - Validasi whitelist MIME type & ekstensi foto/video.
  - Verifikasi sisa kuota `fototgr@gmail.com` >= `fileSize`.
  - Inisiasi Google Drive Resumable Upload Session ke 1 `target_folder_id` global dengan metadata `description` berisi username pengunggah.
  - Teruskan header `Origin` dari klien Web agar mendukung CORS direct upload.
  - Catat status `initiated` ke `upload_logs` dan kembalikan `{ uploadId, uploadUri }`.
- [ ] **3.4** Buat endpoint `POST /api/uploads/:id/complete` dan `POST /api/uploads/:id/fail` untuk memperbarui status `upload_logs`.
- [ ] **3.5** Buat endpoint riwayat unggahan: `GET /api/uploads/history` (milik user sendiri) dan `GET /api/admin/uploads` (semua user dengan filter).

---

## Phase 4: Frontend Multiplatform Flutter — Uploader (`FR-01` – `FR-04`)
- [ ] **4.1** Setup proyek Flutter untuk target **Web, Android, dan iOS**, termasuk konfigurasi permission kamera & galeri (`AndroidManifest.xml`, `Info.plist`).
- [ ] **4.2** Implementasi halaman **Login** (`username` & `password`), manajemen state sesi, *auto-refresh* token, dan penyimpanan token aman (`flutter_secure_storage` untuk mobile / cookie untuk web).
- [ ] **4.3** Implementasi halaman **Upload**:
  - Picker foto/video multi-select (galeri & kamera di Android/iOS; file picker & *drag-and-drop* di Web).
  - Validasi format foto/video di klien + daftar antrean dengan pratinjau *thumbnail* dan ukuran file.
- [ ] **4.4** Implementasi **Chunked Resumable Upload Engine** (8–16 MB per chunk):
  - Baca file secara *streaming* per chunk (aman untuk video multi-GB tanpa OOM).
  - Tampilkan progress bar, kecepatan upload, dan estimasi waktu sisa per file.
  - Dukungan tombol **Pause**, **Resume** (query offset via `308 Resume Incomplete`), **Cancel**, dan **Retry**.
- [ ] **4.5** Implementasi halaman **Riwayat Unggahan** milik user yang sedang login.

---

## Phase 5: Frontend Multiplatform Flutter — Panel Admin (`FR-05`)
- [ ] **5.1** Implementasi halaman **Manajemen User** (daftar user, tambah user, edit, reset password, toggle aktif/nonaktif).
- [ ] **5.2** Implementasi halaman **Pengaturan Google Drive** (status koneksi `fototgr@gmail.com`, tombol hubungkan/re-authorize OAuth, input `target_folder_id` global, indikator sisa kuota penyimpanan).
- [ ] **5.3** Implementasi halaman **Log Unggahan Global** (tabel/daftar log semua user dengan filter user, status, dan tanggal).

---

## Phase 6: Testing, Hardening & Deployment
- [ ] **6.1** Unit & integration test backend (auth, RBAC, enkripsi token, validasi format file, mock Google Drive resumable init).
- [ ] **6.2** Pengujian end-to-end di **Web, Android, dan iOS**:
  - Upload batch campuran foto & video.
  - Uji upload video berukuran besar (> 2 GB) dan verifikasi penggunaan memori tetap rendah.
  - Uji simulasi koneksi putus -> *resume* berhasil tanpa mengulang dari 0%.
  - Verifikasi seluruh file masuk ke 1 folder global `fototgr@gmail.com` dengan metadata pengunggah.
- [ ] **6.3** Setup deployment: deploy Backend API + PostgreSQL (HTTPS wajib), hosting Flutter Web, serta build rilis Android (APK/AAB) dan iOS (IPA).
