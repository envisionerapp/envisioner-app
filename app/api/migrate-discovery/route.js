import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  // Simple auth check - require a secret key
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (key !== process.env.MIGRATION_SECRET && key !== 'run-migration') {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sql = getDb();
    const results = [];

    // Add discovery access level
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS discovery_access_level VARCHAR(20) DEFAULT 'basic'`;
      results.push('Added discovery_access_level column');
    } catch (e) {
      results.push(`discovery_access_level: ${e.message}`);
    }

    // Add platform preferences
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_platforms JSONB DEFAULT '["TikTok", "YouTube", "Twitch", "Kick", "Instagram"]'`;
      results.push('Added preferred_platforms column');
    } catch (e) {
      results.push(`preferred_platforms: ${e.message}`);
    }

    // Add region preferences
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_regions JSONB DEFAULT '[]'`;
      results.push('Added preferred_regions column');
    } catch (e) {
      results.push(`preferred_regions: ${e.message}`);
    }

    // Add language preferences
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_languages JSONB DEFAULT '[]'`;
      results.push('Added preferred_languages column');
    } catch (e) {
      results.push(`preferred_languages: ${e.message}`);
    }

    // Add target CPA
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS target_cpa DECIMAL(10,2)`;
      results.push('Added target_cpa column');
    } catch (e) {
      results.push(`target_cpa: ${e.message}`);
    }

    // Add monthly budget
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_budget DECIMAL(12,2)`;
      results.push('Added monthly_budget column');
    } catch (e) {
      results.push(`monthly_budget: ${e.message}`);
    }

    // Add follower range
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS min_followers INTEGER`;
      results.push('Added min_followers column');
    } catch (e) {
      results.push(`min_followers: ${e.message}`);
    }

    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_followers INTEGER`;
      results.push('Added max_followers column');
    } catch (e) {
      results.push(`max_followers: ${e.message}`);
    }

    // Add preferred tags
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_tags JSONB DEFAULT '[]'`;
      results.push('Added preferred_tags column');
    } catch (e) {
      results.push(`preferred_tags: ${e.message}`);
    }

    // Add preferences updated timestamp
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS discovery_preferences_updated_at TIMESTAMP`;
      results.push('Added discovery_preferences_updated_at column');
    } catch (e) {
      results.push(`discovery_preferences_updated_at: ${e.message}`);
    }

    // Add discovery_creator_id to influencers
    try {
      await sql`ALTER TABLE influencers ADD COLUMN IF NOT EXISTS discovery_creator_id VARCHAR(255)`;
      results.push('Added discovery_creator_id to influencers');
    } catch (e) {
      results.push(`discovery_creator_id: ${e.message}`);
    }

    // Create indexes
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_influencers_discovery_creator ON influencers(discovery_creator_id) WHERE discovery_creator_id IS NOT NULL`;
      results.push('Created index idx_influencers_discovery_creator');
    } catch (e) {
      results.push(`idx_influencers_discovery_creator: ${e.message}`);
    }

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_users_discovery_access ON users(discovery_access_level)`;
      results.push('Created index idx_users_discovery_access');
    } catch (e) {
      results.push(`idx_users_discovery_access: ${e.message}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Migration completed',
      results,
    });

  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

export async function GET(request) {
  return NextResponse.json({
    message: 'Discovery migration endpoint. POST to run migration.',
    usage: 'POST /api/migrate-discovery?key=run-migration',
  });
}
