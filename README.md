# TGR Drive — 5TB Pro Unlimited Uploader (Neo-Brutalism UI)

Aplikasi multiplatform (**Web, Android, iOS**) untuk mengunggah foto & video berukuran **unlimited** ke satu folder global di **Google Drive `fototgr@gmail.com` (Google Pro 5 TB)** tanpa akun Google, menggunakan login `username` & `password` dari **Aiven PostgreSQL**.

## Struktur Proyek
- `backend/` — Node.js + TypeScript + Fastify + PostgreSQL (`pg`) + Google Drive API v3 (OAuth2 Refresh Token + Direct Resumable Upload).
- `app/` — React + TypeScript + Vite + PWA + Capacitor-ready Multiplatform App (Web, Android, iOS) dengan **Neo-Brutalism UI/UX**.
- `docs/` — [requirement.md](docs/requirement.md), [design.md](docs/design.md), [task.md](docs/task.md), dan [tgr-drive-neobrutalism-ui.figcraft](docs/tgr-drive-neobrutalism-ui.figcraft).

## 1. Jalankan Migrasi & Seeder Aiven PostgreSQL
Pastikan koneksi ke `tgr-drive-tgr-project.k.aivencloud.com:24756` tidak diblokir firewall/Wi-Fi kantor dan IP publik Anda diizinkan di Aiven Console:
```powershell
cd backend
npm run migrate
npm run seed
```
Akun default hasil seeder:
- **Admin:** `admin_tgr` / `AdminTgr123!`
- **Uploader:** `budi_tim` / `BudiTgr123!`
- **Folder Global Default:** `1KiXQuXQwrk_geD5gvAYRRDjIzHrL9mma`

*(Alternatif: Anda juga bisa menjalankan SQL langsung dari `backend/sql/001_init.sql`.)*

## 2. Jalankan Backend API
Isi `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di `backend/.env`, lalu jalankan:
```powershell
cd backend
npm run dev
```
Backend berjalan di `http://localhost:4000` (`GET /api/health`).

## 3. Jalankan Aplikasi Multiplatform (`app/`)
```powershell
cd app
npm run dev
```
Aplikasi Web & Mobile Responsive terbuka di `http://localhost:5173`.

### Packaging ke Android & iOS (Capacitor)
```powershell
cd app
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npm run build
npx cap add android
npx cap add ios
npx cap sync
```
