-- Migration: Add user_id to tasks for Row Level Security
-- Purpose: Track which user created each task for permission filtering

ALTER TABLE tasks ADD COLUMN user_id TEXT;

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_room_user ON tasks(room_id, user_id);
