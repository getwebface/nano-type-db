-- Migration: Add permissions table for Row Level Security (RLS)
-- Purpose: Define which user_id can read/write which table in each room

CREATE TABLE permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    can_read INTEGER NOT NULL DEFAULT 0,
    can_write INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE INDEX idx_permissions_user_room ON permissions(user_id, room_id);
CREATE INDEX idx_permissions_room_table ON permissions(room_id, table_name);
