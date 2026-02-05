-- Migration: Initialize D1 Read Replica Schema
-- This schema mirrors the Durable Object schema but adds room_id for multi-tenancy
-- Purpose: Enable horizontal scaling for read operations by using distributed D1

-- Tasks table with room_id for multi-tenancy
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    room_id TEXT NOT NULL,
    PRIMARY KEY (id, room_id)
);

-- Create index for efficient queries by room_id
CREATE INDEX IF NOT EXISTS idx_tasks_room_id ON tasks(room_id);

-- Create index for status filtering
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_room_status ON tasks(room_id, status);
