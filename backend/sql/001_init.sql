-- TGR Drive — Initial PostgreSQL Schema (Aiven Cloud defaultdb)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'user')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS upload_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_filename TEXT NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  drive_file_id VARCHAR(128),
  status VARCHAR(16) NOT NULL CHECK (status IN ('initiated', 'success', 'failed', 'cancelled')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_upload_logs_user_created
  ON upload_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upload_logs_status_created
  ON upload_logs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS drive_integration (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_email VARCHAR(255) NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  target_folder_id VARCHAR(128) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) UNIQUE NOT NULL,
  drive_item_id VARCHAR(128) NOT NULL,
  item_name TEXT NOT NULL,
  is_folder BOOLEAN NOT NULL DEFAULT FALSE,
  mime_type VARCHAR(128) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_shares_token
  ON public_shares (token) WHERE is_active = TRUE;

-- Default global target folder (fototgr@gmail.com)
INSERT INTO drive_integration (id, google_email, encrypted_refresh_token, target_folder_id)
VALUES (1, 'fototgr@gmail.com', '', '1KiXQuXQwrk_geD5gvAYRRDjIzHrL9mma')
ON CONFLICT (id) DO NOTHING;
