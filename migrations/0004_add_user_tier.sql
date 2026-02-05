-- Migration: Add user tier for subscription management
-- Purpose: Enable free/pro tier distinction for feature gating

ALTER TABLE user ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';
