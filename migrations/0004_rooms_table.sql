-- Rooms table for tracking user databases
-- Solves the "Lost Rooms" problem by maintaining a registry of all user rooms
-- Note: Timestamps are stored as INTEGER in milliseconds (Date.now()) for consistency with auth tables
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, -- room_id (e.g., "my-production-db")
    user_id TEXT NOT NULL,
    name TEXT NOT NULL, -- Display name
    created_at INTEGER NOT NULL, -- Timestamp in milliseconds
    last_accessed_at INTEGER, -- Timestamp in milliseconds
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- Index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_rooms_user ON rooms(user_id);

-- Index for sorting by last accessed
CREATE INDEX IF NOT EXISTS idx_rooms_last_accessed ON rooms(user_id, last_accessed_at DESC);

-- Plan limits table for controlling room creation
CREATE TABLE IF NOT EXISTS plan_limits (
    user_id TEXT PRIMARY KEY,
    max_rooms INTEGER NOT NULL DEFAULT 3, -- Free tier: 3 rooms
    plan_tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'pro', 'enterprise'
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
