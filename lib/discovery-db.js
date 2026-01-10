// Discovery Database Functions
// Handles user preferences, access levels, and performance data for discovery AI

import { getDb } from './db';

/**
 * Ensure discovery columns exist in users table
 */
export async function ensureDiscoveryColumns(sql) {
  try {
    await sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS discovery_access_level VARCHAR(20) DEFAULT 'basic',
      ADD COLUMN IF NOT EXISTS preferred_platforms JSONB DEFAULT '["TikTok", "YouTube", "Twitch", "Kick", "Instagram"]',
      ADD COLUMN IF NOT EXISTS preferred_regions JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS preferred_languages JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS target_cpa DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS monthly_budget DECIMAL(12,2),
      ADD COLUMN IF NOT EXISTS min_followers INTEGER,
      ADD COLUMN IF NOT EXISTS max_followers INTEGER,
      ADD COLUMN IF NOT EXISTS preferred_tags JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS discovery_preferences_updated_at TIMESTAMP
    `;
  } catch (e) {
    // Columns might already exist
    console.log('[Discovery] ensureDiscoveryColumns:', e.message);
  }

  try {
    await sql`
      ALTER TABLE influencers
      ADD COLUMN IF NOT EXISTS discovery_creator_id VARCHAR(255)
    `;
  } catch (e) {
    console.log('[Discovery] ensureDiscoveryColumns (influencers):', e.message);
  }
}

/**
 * Get user's discovery preferences
 */
export async function getUserDiscoveryPreferences(sql, userId) {
  try {
    // Get user record with preferences
    const users = await sql`
      SELECT
        user_id,
        email,
        name,
        discovery_access_level,
        preferred_platforms,
        preferred_regions,
        preferred_languages,
        target_cpa,
        monthly_budget,
        min_followers,
        max_followers,
        preferred_tags,
        discovery_preferences_updated_at
      FROM users
      WHERE email = ${userId} OR user_id = ${userId}
      LIMIT 1
    `;

    if (!users[0]) {
      return getDefaultPreferences();
    }

    const user = users[0];
    return {
      accessLevel: user.discovery_access_level || 'basic',
      platforms: user.preferred_platforms || ['TikTok', 'YouTube', 'Twitch', 'Kick', 'Instagram'],
      regions: user.preferred_regions || [],
      languages: user.preferred_languages || [],
      targetCpa: user.target_cpa || null,
      monthlyBudget: user.monthly_budget || null,
      followerRange: {
        min: user.min_followers || null,
        max: user.max_followers || null,
      },
      preferredTags: user.preferred_tags || [],
      lastUpdated: user.discovery_preferences_updated_at,
    };
  } catch (e) {
    console.error('[Discovery] Failed to get user preferences:', e.message);
    return getDefaultPreferences();
  }
}

function getDefaultPreferences() {
  return {
    accessLevel: 'basic',
    platforms: ['TikTok', 'YouTube', 'Twitch', 'Kick', 'Instagram'],
    regions: [],
    languages: [],
    targetCpa: null,
    monthlyBudget: null,
    followerRange: { min: null, max: null },
    preferredTags: [],
    lastUpdated: null,
  };
}

/**
 * Get user's access level for discovery features
 */
export async function getUserAccessLevel(sql, userId) {
  try {
    const users = await sql`
      SELECT discovery_access_level, subscription_tier
      FROM users
      WHERE email = ${userId} OR user_id = ${userId}
      LIMIT 1
    `;

    if (!users[0]) return 'basic';

    // Access levels: basic, pro, enterprise
    // Determines what discovery features are available
    return users[0].discovery_access_level || mapSubscriptionToAccess(users[0].subscription_tier);
  } catch (e) {
    return 'basic';
  }
}

function mapSubscriptionToAccess(tier) {
  const mapping = {
    'free': 'basic',
    'starter': 'basic',
    'pro': 'pro',
    'business': 'pro',
    'enterprise': 'enterprise',
  };
  return mapping[tier?.toLowerCase()] || 'basic';
}

/**
 * Get access level capabilities
 */
export function getAccessCapabilities(level) {
  const capabilities = {
    basic: {
      searchLimit: 20,
      canViewLive: true,
      canViewPerformance: false,
      canExport: false,
      canSeeContactInfo: false,
      aiRecommendations: 'limited',
      similarCreatorLimit: 3,
    },
    pro: {
      searchLimit: 100,
      canViewLive: true,
      canViewPerformance: true,
      canExport: true,
      canSeeContactInfo: true,
      aiRecommendations: 'full',
      similarCreatorLimit: 10,
    },
    enterprise: {
      searchLimit: -1, // unlimited
      canViewLive: true,
      canViewPerformance: true,
      canExport: true,
      canSeeContactInfo: true,
      aiRecommendations: 'full',
      similarCreatorLimit: -1,
    },
  };
  return capabilities[level] || capabilities.basic;
}

/**
 * Get user's past performance data for AI learning
 */
export async function getUserPerformanceHistory(sql, userId) {
  try {
    // Get all influencers with their performance metrics
    const influencers = await sql`
      SELECT
        i.id,
        i.influencer as name,
        i.channel_url,
        i.price,
        i.total_conversions,
        i.conversions,
        i.clicks,
        i.campaign_id,
        c.name as campaign_name,
        cm.cpa,
        cm.cpc,
        cm.roi
      FROM influencers i
      LEFT JOIN campaigns c ON c.id = i.campaign_id
      LEFT JOIN creator_metrics cm ON cm.influencer_id = i.id
      WHERE i.user_id = ${userId}
        AND (i.total_conversions > 0 OR i.conversions > 0)
      ORDER BY COALESCE(i.total_conversions, i.conversions, 0) DESC
    `;

    // Categorize by performance
    const topPerformers = [];
    const goodPerformers = [];
    const underperformers = [];

    for (const inf of influencers) {
      const conversions = Number(inf.total_conversions) || Number(inf.conversions) || 0;
      const spent = Number(inf.price) || 0;
      const cpa = conversions > 0 ? spent / conversions : null;
      const platform = detectPlatform(inf.channel_url);

      const performerData = {
        id: inf.id,
        name: inf.name,
        platform,
        conversions,
        spent,
        cpa,
        roi: inf.roi,
        campaign: inf.campaign_name,
      };

      // Categorize based on CPA (lower is better)
      if (cpa !== null && cpa < 30) {
        topPerformers.push(performerData);
      } else if (cpa !== null && cpa < 60) {
        goodPerformers.push(performerData);
      } else if (conversions > 0) {
        underperformers.push(performerData);
      }
    }

    // Analyze patterns from top performers
    const patterns = analyzePerformancePatterns(topPerformers);

    return {
      topPerformers: topPerformers.slice(0, 10),
      goodPerformers: goodPerformers.slice(0, 10),
      underperformers: underperformers.slice(0, 5),
      patterns,
      totalAnalyzed: influencers.length,
    };
  } catch (e) {
    console.error('[Discovery] Failed to get performance history:', e.message);
    return {
      topPerformers: [],
      goodPerformers: [],
      underperformers: [],
      patterns: null,
      totalAnalyzed: 0,
    };
  }
}

function detectPlatform(url) {
  if (!url) return 'Unknown';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube')) return 'YouTube';
  if (lowerUrl.includes('tiktok')) return 'TikTok';
  if (lowerUrl.includes('twitch')) return 'Twitch';
  if (lowerUrl.includes('kick')) return 'Kick';
  if (lowerUrl.includes('instagram')) return 'Instagram';
  return 'Other';
}

function analyzePerformancePatterns(topPerformers) {
  if (topPerformers.length < 3) return null;

  // Analyze platform distribution
  const platformCounts = {};
  let totalSpent = 0;
  let totalConversions = 0;

  for (const p of topPerformers) {
    platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1;
    totalSpent += p.spent;
    totalConversions += p.conversions;
  }

  // Find best performing platform
  const bestPlatform = Object.entries(platformCounts)
    .sort((a, b) => b[1] - a[1])[0];

  return {
    bestPlatform: bestPlatform ? bestPlatform[0] : null,
    platformDistribution: platformCounts,
    avgSpendOnTopPerformers: Math.round(totalSpent / topPerformers.length),
    avgConversions: Math.round(totalConversions / topPerformers.length),
    avgCpa: totalConversions > 0 ? Math.round(totalSpent / totalConversions) : null,
  };
}

/**
 * Find creators similar to user's top performers
 * Returns criteria for the Discovery API search
 */
export async function getSimilarCreatorCriteria(sql, userId) {
  const performance = await getUserPerformanceHistory(sql, userId);

  if (performance.topPerformers.length === 0) {
    return null;
  }

  const patterns = performance.patterns;
  if (!patterns) return null;

  // Build search criteria based on top performer patterns
  return {
    preferredPlatforms: Object.keys(patterns.platformDistribution)
      .filter(p => p !== 'Unknown' && p !== 'Other'),
    suggestedBudget: {
      min: Math.round(patterns.avgSpendOnTopPerformers * 0.5),
      max: Math.round(patterns.avgSpendOnTopPerformers * 1.5),
    },
    targetCpa: patterns.avgCpa,
    basedOn: performance.topPerformers.slice(0, 3).map(p => p.name),
  };
}

/**
 * Get discovery statistics for a user
 */
export async function getUserDiscoveryStats(sql, userId) {
  try {
    const stats = await sql`
      SELECT
        COUNT(DISTINCT i.id) as total_creators_used,
        COUNT(DISTINCT CASE WHEN i.discovery_creator_id IS NOT NULL THEN i.id END) as from_discovery,
        AVG(CASE WHEN i.discovery_creator_id IS NOT NULL THEN
          COALESCE(i.total_conversions, i.conversions, 0)
        END) as avg_discovery_conversions,
        AVG(CASE WHEN i.discovery_creator_id IS NULL THEN
          COALESCE(i.total_conversions, i.conversions, 0)
        END) as avg_other_conversions
      FROM influencers i
      WHERE i.user_id = ${userId}
    `;

    return stats[0] || {
      total_creators_used: 0,
      from_discovery: 0,
      avg_discovery_conversions: null,
      avg_other_conversions: null,
    };
  } catch (e) {
    console.error('[Discovery] Failed to get user stats:', e.message);
    return {
      total_creators_used: 0,
      from_discovery: 0,
      avg_discovery_conversions: null,
      avg_other_conversions: null,
    };
  }
}

/**
 * Save user discovery preferences
 */
export async function saveUserDiscoveryPreferences(sql, userId, preferences) {
  try {
    await sql`
      UPDATE users SET
        preferred_platforms = ${preferences.platforms || null},
        preferred_regions = ${preferences.regions || null},
        preferred_languages = ${preferences.languages || null},
        target_cpa = ${preferences.targetCpa || null},
        monthly_budget = ${preferences.monthlyBudget || null},
        min_followers = ${preferences.followerRange?.min || null},
        max_followers = ${preferences.followerRange?.max || null},
        preferred_tags = ${preferences.preferredTags || null},
        discovery_preferences_updated_at = NOW()
      WHERE email = ${userId} OR user_id = ${userId}
    `;
    return true;
  } catch (e) {
    console.error('[Discovery] Failed to save preferences:', e.message);
    return false;
  }
}
