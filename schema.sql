-- Ejecuta este archivo UNA VEZ en tu base de datos de Neon.
-- En el panel de Neon: Project -> SQL Editor -> pega esto -> Run.

CREATE TABLE IF NOT EXISTS sessions (
  id                   SERIAL PRIMARY KEY,
  code                 VARCHAR(12) UNIQUE NOT NULL,
  password_hash        TEXT NOT NULL,
  creator_device_hash  TEXT NOT NULL,
  creator_ip_hash      TEXT NOT NULL,
  joiner_device_hash   TEXT,
  status               VARCHAR(20) NOT NULL DEFAULT 'waiting', -- waiting | active | closed | expired
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender      VARCHAR(10) NOT NULL,          -- 'creator' | 'joiner'
  msg_type    VARCHAR(10) NOT NULL DEFAULT 'text', -- 'text' | 'gif'
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
CREATE INDEX IF NOT EXISTS idx_sessions_creator_time ON sessions(creator_device_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ip_time ON sessions(creator_ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, created_at);
