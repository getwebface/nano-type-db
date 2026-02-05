-- Migration: API Keys for Developer Authentication
-- Purpose: Enable developers to use API keys for external app authentication

CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,           -- The key itself (e.g. "nk_live_...")
    user_id TEXT NOT NULL,         -- The developer who owns it
    name TEXT,                     -- e.g. "Production Website"
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    scopes TEXT DEFAULT 'read,write' -- Permissions
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
