-- Migration: Add vector_status column to tasks
-- Purpose: Track status of vector embedding generation (pending/indexed/failed)
-- This allows retry jobs to identify tasks that need re-indexing

-- Add vector_status column if it doesn't exist
ALTER TABLE tasks ADD COLUMN vector_status TEXT DEFAULT 'pending';

-- Create index for efficient querying of pending vectors
CREATE INDEX IF NOT EXISTS idx_tasks_vector_status ON tasks(vector_status);
