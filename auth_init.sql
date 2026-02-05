CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE TABLE session (
    id TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id)
);

CREATE TABLE account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id),
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
);

-- API Keys table (for external app access)
-- Enhanced with expiration support for production security
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, -- nk_live_{uuid}
    user_id TEXT NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    expires_at INTEGER, -- Timestamp when key expires (null = no expiration)
    scopes TEXT, -- JSON array of allowed scopes (e.g., '["read", "write"]')
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- Index for faster API key lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at);
