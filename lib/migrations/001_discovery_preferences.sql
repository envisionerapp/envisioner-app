-- Migration: Add discovery preferences columns to users table
-- Run this migration to enable discovery AI features

-- Add discovery access level
ALTER TABLE users ADD COLUMN IF NOT EXISTS discovery_access_level VARCHAR(20) DEFAULT 'basic';

-- Add platform preferences (stored as JSON array)
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_platforms JSONB DEFAULT '["TikTok", "YouTube", "Twitch", "Kick", "Instagram"]';

-- Add region preferences (stored as JSON array of country codes)
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_regions JSONB DEFAULT '[]';

-- Add language preferences (stored as JSON array)
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_languages JSONB DEFAULT '[]';

-- Add target CPA (cost per acquisition goal)
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_cpa DECIMAL(10,2);

-- Add monthly budget for creator spend
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_budget DECIMAL(12,2);

-- Add follower range preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS min_followers INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_followers INTEGER;

-- Add preferred tags/categories (stored as JSON array)
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_tags JSONB DEFAULT '[]';

-- Add timestamp for when preferences were last updated
ALTER TABLE users ADD COLUMN IF NOT EXISTS discovery_preferences_updated_at TIMESTAMP;

-- Add discovery_creator_id to influencers table to track which came from discovery
ALTER TABLE influencers ADD COLUMN IF NOT EXISTS discovery_creator_id VARCHAR(255);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_influencers_discovery_creator ON influencers(discovery_creator_id) WHERE discovery_creator_id IS NOT NULL;

-- Create index for access level queries
CREATE INDEX IF NOT EXISTS idx_users_discovery_access ON users(discovery_access_level);
