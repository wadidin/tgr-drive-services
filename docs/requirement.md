# Requirements — Aplikasi Upload Foto & Video ke Google Drive (`tgr-drive`)

| Atribut | Detail |
| :--- | :--- |
| **Nama Produk** | TGR Drive Uploader (`tgr-drive`) |
| **Versi** | 1.1 |
| **Tanggal** | 23 November 2026 |
| **Platform Target** | Multiplatform (Web, Android, iOS) |
| **Akun Drive Tujuan** | `fototgr@gmail.com` — Google Pro 5 TB (1 Folder Global) |
| **Dokumen Terkait** | [design.md](file:///d:/tgr-drive/docs/design.md) · [task.md](file:///d:/tgr-drive/docs/task.md) |

---

## 1. Latar Belakang & Tujuan

### 1.1 Latar Belakang
Pengguna perlu mengumpulkan dokumentasi foto dan video (termasuk video berukuran sangat besar) ke dalam satu folder terpusat pada akun Google Drive `fototgr@gmail.com` tanpa harus login menggunakan akun Google pribadi dan tanpa membagikan kredensial `fototgr@gmail.com`.

### 1.2 Solusi
Aplikasi multiplatform (**Web, Android, iOS**) dengan login menggunakan **username dan password** yang tersimpan di **database aplikasi**. Seluruh otorisasi Google Drive dikelola di sisi server, dan unggahan dilakukan langsung ke satu folder tujuan di `fototgr@gmail.com` dengan dukungan ukuran file **unlimited**.

### 1.3 Metrik Keberhasilan (KPI)
| Tujuan | Metrik | Target |
| :--- | :--- | :--- |
| Akses cepat tanpa akun Google | Waktu dari buka aplikasi hingga mulai upload | < 30 detik |
| Keandalan unggah foto & video | Tingkat keberhasilan (*upload success rate*) | ≥ 98% |
| Ukuran file tanpa batas | Kemampuan unggah file besar tanpa timeout/crash | Unlimited (mengikuti kapasitas 5 TB `fototgr@gmail.com`, batas 5 TB/file, & kuota harian 750 GB/hari Google Drive) |
| Keamanan kredensial | Kebocoran token/password `fototgr@gmail.com` ke klien | 0 insiden (100% server-side) |
| Paritas multiplatform | Fitur inti identik di Web, Android, dan iOS | 100% |

---

## 2. Peran Pengguna (User Roles)

| Peran | Deskripsi | Hak Akses |
| :--- | :--- | :--- |
| **Uploader (`user`)** | Pengguna yang diberikan akun oleh Admin untuk mengunggah dokumentasi foto/video. | Login, pilih & upload foto/video, lihat progress, pause/resume/retry, lihat riwayat unggahannya sendiri. |
| **Admin (`admin`)** | Pengelola aplikasi dan akun Google Drive `fototgr@gmail.com`. | Semua akses Uploader + kelola user database (CRUD, reset password, aktif/nonaktif), hubungkan/re-authorize OAuth `fototgr@gmail.com`, atur 1 Folder ID tujuan, pantau sisa kuota & log semua user. |

---

## 3. Ruang Lingkup (Scope)

### 3.1 In-Scope (MVP)
- Aplikasi multiplatform: **Web, Android, dan iOS**.
- Login dengan `username` & `password` dari database (tanpa registrasi mandiri).
- Upload foto & video (*single* dan *batch multi-upload*) ukuran **unlimited**.
- *Chunked resumable upload* (progress real-time, pause, resume, cancel, retry).
- Validasi format foto & video.
- Seluruh file masuk ke **1 folder Google Drive yang sama** di `fototgr@gmail.com`.
- Riwayat unggahan per user.
- Panel Admin (manajemen user, integrasi OAuth `fototgr@gmail.com`, monitoring kuota & log).

### 3.2 Out-of-Scope (Di Luar MVP)
- Registrasi akun mandiri (*self-registration*).
- Login Google OAuth untuk *end-user*.
- Pembuatan atau pemilihan sub-folder oleh user.
- Editing foto/video (crop, filter, trim, kompresi paksa).
- Hapus/kelola file Google Drive langsung oleh Uploader.

---

## 4. Kebutuhan Fungsional (Functional Requirements)

### FR-01: Autentikasi & Manajemen Sesi
- **FR-01.1:** Pengguna login menggunakan `username` dan `password` yang terdaftar di database aplikasi.
- **FR-01.2:** Password wajib disimpan dalam bentuk hash yang aman (`argon2` atau `bcrypt`).
- **FR-01.3:** Sistem menerbitkan token sesi (JWT Access Token + Refresh Token).
- **FR-01.4:** Endpoint login dibatasi (*rate limiting*, maks. 5 percobaan gagal per 15 menit per IP/username).
- **FR-01.5:** Pengguna dapat melakukan *Logout* kapan saja.
- **FR-01.6:** Akun dengan `is_active = false` ditolak saat login dan sesi aktifnya segera tidak berlaku.

**Acceptance Criteria:**
- Kredensial valid mengarahkan pengguna ke halaman utama upload.
- Kredensial salah menampilkan pesan generik (*"Username atau password salah"*).
- Akun nonaktif tidak dapat mengakses endpoint upload maupun riwayat.

---

### FR-02: Pemilihan & Validasi Foto/Video
- **FR-02.1:** Mendukung pemilihan file lintas platform:
  - **Android & iOS:** Galeri foto/video native (multi-select) dan kamera langsung.
  - **Web:** Tombol pilih file, *drag-and-drop*, serta akses kamera/galeri pada browser mobile.
- **FR-02.2:** Mendukung antrean banyak file sekaligus (*batch upload*) campuran foto dan video.
- **FR-02.3:** Menampilkan pratinjau (*thumbnail*), nama file, ukuran file, dan tombol hapus dari antrean sebelum upload dimulai.
- **FR-02.4:** Validasi format file (di sisi klien dan diverifikasi ulang di backend):
  - **Foto:** `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`
  - **Video:** `.mp4`, `.mov`, `.webm`, `.mkv`, `.3gp`, `.avi`
- **FR-02.5:** **Tidak ada batas ukuran file buatan aplikasi** (*unlimited*). Sistem hanya memeriksa kecukupan sisa kuota penyimpanan `fototgr@gmail.com` sebelum upload dimulai.

**Acceptance Criteria:**
- File di luar format foto/video yang diizinkan ditolak dengan pesan error yang jelas.
- Video berukuran besar (misal > 2 GB) dapat dipilih dan masuk antrean tanpa error batas ukuran.

---

### FR-03: Upload ke Google Drive (`fototgr@gmail.com`)
- **FR-03.1:** Seluruh kredensial `fototgr@gmail.com` hanya berada di backend dan tidak pernah dikirim ke klien.
- **FR-03.2:** Unggahan menggunakan metode *resumable chunked upload* agar stabil untuk file berukuran besar.
- **FR-03.3:** Menampilkan progress bar *real-time* (persentase, kecepatan, estimasi waktu sisa) untuk setiap file.
- **FR-03.4:** Pengguna dapat melakukan **Pause**, **Resume** (melanjutkan dari byte terakhir), **Cancel**, dan **Retry** pada file yang gagal tanpa mengulang file yang sudah sukses.
- **FR-03.5:** Seluruh file dari semua user otomatis masuk ke **1 folder Google Drive global** milik `fototgr@gmail.com`.
- **FR-03.6:** Metadata `description` file di Google Drive mencantumkan identitas pengunggah (`Uploaded by: <username> via tgr-drive`).

**Acceptance Criteria:**
- File yang berstatus "Berhasil" di aplikasi langsung terlihat di folder tujuan `fototgr@gmail.com`.
- Ketika koneksi internet terputus di tengah upload, upload dapat dilanjutkan (*resume*) tanpa mengulang dari 0%.

---

### FR-04: Riwayat Unggahan (Upload History)
- **FR-04.1:** Pengguna dapat melihat daftar file yang pernah diunggah (nama file, tipe, ukuran, tanggal/waktu, status).
- **FR-04.2:** Uploader hanya dapat melihat riwayat unggahannya sendiri.

**Acceptance Criteria:**
- Riwayat unggahan User A tidak pernah muncul di akun User B.

---

### FR-05: Panel Admin & Integrasi Google Drive
- **FR-05.1:** Admin dapat membuat, mengubah (nama/role), mereset password, serta mengaktifkan/menonaktifkan akun user di database.
- **FR-05.2:** Admin dapat menghubungkan (otorisasi OAuth2) dan melakukan *re-authorize* akun `fototgr@gmail.com` dari Panel Admin.
- **FR-05.3:** Admin dapat mengatur `target_folder_id` (1 folder global) di halaman pengaturan.
- **FR-05.4:** Admin dapat melihat sisa kuota penyimpanan `fototgr@gmail.com` dan log unggahan seluruh user (dengan filter user, tanggal, dan status).

**Acceptance Criteria:**
- User biasa (`role = user`) mendapat respon `403 Forbidden` jika mencoba mengakses fitur/endpoint Admin.

---

## 5. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| Kategori | Spesifikasi |
| :--- | :--- |
| **Keamanan** | Wajib HTTPS/TLS; password di-hash; OAuth2 `refresh_token` dienkripsi di database; kredensial Google tidak pernah terekspos ke klien; *Upload Session URI* berlaku hanya untuk 1 file spesifik. |
| **Performa & Memori** | File dibaca per *chunk* (stream dari storage perangkat) sehingga upload file multi-GB tidak menyebabkan *Out of Memory (OOM)* di HP maupun browser. |
| **Reliabilitas** | Mendukung *resume* saat jaringan terputus; di Android/iOS mendukung mekanisme upload yang tahan saat layar terkunci (*background upload*). |
| **Kuota & Monitoring** | Pengecekan kuota `fototgr@gmail.com` sebelum inisiasi upload agar user mendapat peringatan jelas jika kapasitas Drive penuh. |
