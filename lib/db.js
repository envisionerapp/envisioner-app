import { neon } from '@neondatabase/serverless';

export function getDb() {
  return neon(process.env.DATABASE_URL);
}

// AI briefing cache table (separate from your existing briefings table)
export async function ensureBriefingsTable(sql) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS ai_briefings (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        score INTEGER DEFAULT 50,
        summary TEXT,
        metrics JSONB DEFAULT '[]',
        actions JSONB DEFAULT '[]',
        generated_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
      )
    `;
  } catch (e) {
    // Ignore - table might exist
  }
}

// Get cached AI briefing
export async function getBriefing(sql, userId) {
  try {
    const results = await sql`
      SELECT * FROM ai_briefings
      WHERE user_id = ${userId}
      AND expires_at > NOW()
      ORDER BY generated_at DESC
      LIMIT 1
    `;
    return results[0] || null;
  } catch (e) {
    return null;
  }
}

// Save AI briefing
export async function saveBriefing(sql, userId, briefing) {
  try {
    await sql`
      INSERT INTO ai_briefings (user_id, score, summary, metrics, actions, generated_at, expires_at)
      VALUES (
        ${userId},
        ${briefing.score},
        ${briefing.summary},
        ${JSON.stringify(briefing.metrics)},
        ${JSON.stringify(briefing.actions)},
        NOW(),
        NOW() + INTERVAL '24 hours'
      )
      ON CONFLICT (user_id) DO UPDATE SET
        score = ${briefing.score},
        summary = ${briefing.summary},
        metrics = ${JSON.stringify(briefing.metrics)},
        actions = ${JSON.stringify(briefing.actions)},
        generated_at = NOW(),
        expires_at = NOW() + INTERVAL '24 hours'
    `;
  } catch (e) {
    console.error('Failed to save briefing:', e.message);
  }
}

// Get user data for AI analysis - using your actual schema
export async function getUserData(sql, userId) {
  // Get user and resolve actual user_id
  let user = { email: userId, name: userId.split('@')[0] };
  let resolvedUserId = userId;
  try {
    const users = await sql`
      SELECT * FROM users WHERE email = ${userId} OR user_id = ${userId} LIMIT 1
    `;
    if (users[0]) {
      user = users[0];
      // Use the user_id from the database for all subsequent queries
      resolvedUserId = users[0].user_id || users[0].email || userId;
      console.log(`[DB] Resolved userId: ${userId} -> ${resolvedUserId}`);
    }
  } catch (e) {
    console.log(`[DB] User lookup failed for ${userId}:`, e.message);
  }

  // Get campaigns for this user (try both original and resolved userId)
  let campaigns = [];
  try {
    campaigns = await sql`
      SELECT * FROM campaigns WHERE user_id = ${resolvedUserId} OR user_id = ${userId}
    `;
  } catch (e) {}

  // Get influencers with their stats and content timing
  // Build list of possible user IDs to check
  const userIds = [userId];
  if (resolvedUserId && resolvedUserId !== userId) {
    userIds.push(resolvedUserId);
  }
  console.log(`[DB] Querying influencers for userIds: ${JSON.stringify(userIds)}`);

  let influencers = [];
  try {
    // First get base influencers
    const baseInfluencers = await sql`
      SELECT * FROM influencers
      WHERE user_id = ANY(${userIds})
    `;
    console.log(`[DB] Found ${baseInfluencers.length} base influencers for userIds: ${JSON.stringify(userIds)}`);

    // Then get deliverable stats separately
    const influencerIds = baseInfluencers.map(i => i.id);
    let deliverableStats = [];
    if (influencerIds.length > 0) {
      try {
        deliverableStats = await sql`
          SELECT
            influencer_id,
            SUM(COALESCE(views, 0)) as total_views,
            SUM(COALESCE(likes, 0)) as total_likes,
            COUNT(*) as content_count,
            MIN(COALESCE(post_date, created_at)) as first_post_date,
            MAX(COALESCE(post_date, created_at)) as last_post_date
          FROM deliverables
          WHERE influencer_id = ANY(${influencerIds})
          GROUP BY influencer_id
        `;
      } catch (e) {
        console.error(`[DB] Deliverable stats query failed:`, e.message);
      }
    }

    // Merge stats into influencers
    const statsMap = {};
    for (const stat of deliverableStats) {
      statsMap[stat.influencer_id] = stat;
    }

    influencers = baseInfluencers.map(i => ({
      ...i,
      total_views: statsMap[i.id]?.total_views || 0,
      total_likes: statsMap[i.id]?.total_likes || 0,
      content_count: statsMap[i.id]?.content_count || 0,
      first_post_date: statsMap[i.id]?.first_post_date || null,
      last_post_date: statsMap[i.id]?.last_post_date || null,
    }));

    console.log(`[DB] Final influencers with stats: ${influencers.length}`);
  } catch (e) {
    console.error(`[DB] Influencers query failed for ${userId}:`, e.message);
  }

  // Get creator metrics for richer data
  let creatorMetrics = [];
  try {
    creatorMetrics = await sql`
      SELECT * FROM creator_metrics WHERE user_id = ${resolvedUserId} OR user_id = ${userId}
    `;
  } catch (e) {}

  // Merge creator metrics into influencers
  const metricsMap = {};
  for (const m of creatorMetrics) {
    metricsMap[m.influencer_id] = m;
  }

  influencers = influencers.map(i => ({
    ...i,
    cpa: metricsMap[i.id]?.cpa || null,
    cpc: metricsMap[i.id]?.cpc || null,
    cpm: metricsMap[i.id]?.cpm || null,
  }));

  // Get recent content stats for trend analysis
  let recentStats = [];
  try {
    recentStats = await sql`
      SELECT * FROM stats_history_content
      WHERE (user_id = ${resolvedUserId} OR user_id = ${userId})
      AND recorded_at > NOW() - INTERVAL '7 days'
      ORDER BY recorded_at DESC
    `;
  } catch (e) {}

  // Get recent conversion stats
  let conversionStats = [];
  try {
    conversionStats = await sql`
      SELECT * FROM stats_history_redtrack
      WHERE (user_id = ${resolvedUserId} OR user_id = ${userId})
      AND recorded_at > NOW() - INTERVAL '7 days'
      ORDER BY recorded_at DESC
    `;
  } catch (e) {}

  // Calculate totals
  const totals = {
    campaigns: campaigns.length,
    influencers: influencers.length,
    totalSpent: influencers.reduce((sum, i) => sum + (Number(i.price) || 0), 0),
    totalConversions: influencers.reduce((sum, i) => sum + (Number(i.total_conversions) || Number(i.conversions) || 0), 0),
    totalViews: influencers.reduce((sum, i) => sum + (Number(i.total_views) || Number(i.views) || 0), 0),
    totalClicks: influencers.reduce((sum, i) => sum + (Number(i.clicks) || 0), 0),
  };

  // Find issues - creators with no deliverables (paid but no content after 7+ days)
  const noContent = influencers.filter(i => {
    const daysSinceAdded = i.created_at ? Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000) : 0;
    return (Number(i.price) > 0) && (Number(i.content_count) === 0) && (daysSinceAdded >= 7);
  });

  // Find underperformers - HAS content but no conversions (flag immediately)
  const noConversions = influencers.filter(i => {
    if (Number(i.content_count) === 0) return false;
    const conversions = Number(i.total_conversions) || Number(i.conversions) || 0;
    return (Number(i.price) > 0) && (conversions === 0);
  });

  // Top performers by conversions
  const topPerformers = influencers
    .filter(i => (Number(i.total_conversions) || Number(i.conversions) || 0) > 0)
    .sort((a, b) => (Number(b.total_conversions) || Number(b.conversions) || 0) - (Number(a.total_conversions) || Number(a.conversions) || 0))
    .slice(0, 5);

  // Platform breakdown
  const platforms = {};
  for (const inf of influencers) {
    const url = (inf.channel_url || '').toLowerCase();
    let platform = 'Other';
    if (url.includes('youtube')) platform = 'YouTube';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';
    else if (url.includes('twitch')) platform = 'Twitch';
    else if (url.includes('kick')) platform = 'Kick';

    if (!platforms[platform]) {
      platforms[platform] = { count: 0, spent: 0, conversions: 0, views: 0, clicks: 0 };
    }
    platforms[platform].count++;
    platforms[platform].spent += Number(inf.price) || 0;
    platforms[platform].conversions += Number(inf.total_conversions) || Number(inf.conversions) || 0;
    platforms[platform].views += Number(inf.total_views) || Number(inf.views) || 0;
    platforms[platform].clicks += Number(inf.clicks) || 0;
  }

  // Trend analysis from historical data (legacy)
  const trends = analyzeTrends(recentStats, conversionStats);

  // Comprehensive historical trends (weekly, monthly, yearly)
  const historicalTrends = await calculateHistoricalTrends(sql, userIds);

  return {
    user,
    campaigns,
    influencers,
    totals,
    noContent,
    noConversions,
    topPerformers,
    platforms,
    recentStats,
    conversionStats,
    trends,
    historicalTrends,
  };
}

// Analyze trends from historical data (legacy - kept for compatibility)
function analyzeTrends(contentStats, conversionStats) {
  const trends = {
    viewsGrowing: false,
    conversionsGrowing: false,
    topGrowingContent: null,
    alerts: [],
  };

  if (contentStats.length < 2) return trends;

  // Group by content and calculate growth
  const contentGrowth = {};
  for (const stat of contentStats) {
    const key = stat.content_id;
    if (!contentGrowth[key]) {
      contentGrowth[key] = {
        name: stat.influencer_name,
        title: stat.content_title,
        url: stat.content_url,
        stats: [],
      };
    }
    contentGrowth[key].stats.push({
      views: stat.views,
      recorded_at: stat.recorded_at,
    });
  }

  // Find fastest growing content
  for (const [id, content] of Object.entries(contentGrowth)) {
    if (content.stats.length >= 2) {
      const sorted = content.stats.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
      const oldest = sorted[0].views;
      const newest = sorted[sorted.length - 1].views;
      const growth = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;

      if (growth > 100) {
        trends.alerts.push({
          type: 'viral',
          message: `${content.name}'s content grew ${Math.round(growth)}% in views`,
          content: content.title,
        });
      }

      content.growth = growth;
    }
  }

  // Find top growing
  const sorted = Object.values(contentGrowth)
    .filter(c => c.growth > 0)
    .sort((a, b) => b.growth - a.growth);

  if (sorted[0]) {
    trends.topGrowingContent = sorted[0];
  }

  return trends;
}

// Calculate comprehensive historical trends
export async function calculateHistoricalTrends(sql, userIds) {
  const trends = {
    weekly: { conversions: null, views: null, spend: null, cpa: null },
    monthly: { conversions: null, views: null, spend: null, cpa: null },
    yearly: { conversions: null, views: null, spend: null, cpa: null },
    creatorMomentum: { rising: [], cooling: [], stalled: [] },
    contentMomentum: { growing: [], plateaued: [] },
    summary: '',
  };

  try {
    // Get historical snapshots from stats_history_redtrack (conversions/clicks)
    const conversionHistory = await sql`
      SELECT
        DATE(recorded_at) as date,
        SUM(COALESCE(conversions, 0)) as total_conversions,
        SUM(COALESCE(clicks, 0)) as total_clicks,
        SUM(COALESCE(cost, 0)) as total_cost
      FROM stats_history_redtrack
      WHERE user_id = ANY(${userIds})
      GROUP BY DATE(recorded_at)
      ORDER BY date DESC
    `;

    // Get historical snapshots from stats_history_content (views/likes)
    const contentHistory = await sql`
      SELECT
        DATE(recorded_at) as date,
        SUM(COALESCE(views, 0)) as total_views,
        SUM(COALESCE(likes, 0)) as total_likes
      FROM stats_history_content
      WHERE user_id = ANY(${userIds})
      GROUP BY DATE(recorded_at)
      ORDER BY date DESC
    `;

    // Get per-influencer historical data for momentum analysis
    const influencerHistory = await sql`
      SELECT
        influencer_id,
        influencer_name,
        DATE(recorded_at) as date,
        SUM(COALESCE(conversions, 0)) as conversions,
        SUM(COALESCE(clicks, 0)) as clicks
      FROM stats_history_redtrack
      WHERE user_id = ANY(${userIds})
        AND recorded_at > NOW() - INTERVAL '30 days'
      GROUP BY influencer_id, influencer_name, DATE(recorded_at)
      ORDER BY date DESC
    `;

    // Calculate period comparisons
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now - 60 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);
    const twoYearsAgo = new Date(now - 730 * 24 * 60 * 60 * 1000);

    // Helper to sum metrics in date range
    const sumInRange = (data, startDate, endDate, field) => {
      return data
        .filter(d => {
          const date = new Date(d.date);
          return date >= startDate && date <= endDate;
        })
        .reduce((sum, d) => sum + (Number(d[field]) || 0), 0);
    };

    // Calculate weekly comparison (this week vs last week)
    const thisWeekConv = sumInRange(conversionHistory, weekAgo, now, 'total_conversions');
    const lastWeekConv = sumInRange(conversionHistory, twoWeeksAgo, weekAgo, 'total_conversions');
    const thisWeekViews = sumInRange(contentHistory, weekAgo, now, 'total_views');
    const lastWeekViews = sumInRange(contentHistory, twoWeeksAgo, weekAgo, 'total_views');
    const thisWeekSpend = sumInRange(conversionHistory, weekAgo, now, 'total_cost');
    const lastWeekSpend = sumInRange(conversionHistory, twoWeeksAgo, weekAgo, 'total_cost');

    trends.weekly = {
      conversions: calculateChange(thisWeekConv, lastWeekConv),
      views: calculateChange(thisWeekViews, lastWeekViews),
      spend: calculateChange(thisWeekSpend, lastWeekSpend),
      cpa: calculateCpaChange(thisWeekSpend, thisWeekConv, lastWeekSpend, lastWeekConv),
      current: { conversions: thisWeekConv, views: thisWeekViews, spend: thisWeekSpend },
      previous: { conversions: lastWeekConv, views: lastWeekViews, spend: lastWeekSpend },
    };

    // Calculate monthly comparison (this month vs last month)
    const thisMonthConv = sumInRange(conversionHistory, monthAgo, now, 'total_conversions');
    const lastMonthConv = sumInRange(conversionHistory, twoMonthsAgo, monthAgo, 'total_conversions');
    const thisMonthViews = sumInRange(contentHistory, monthAgo, now, 'total_views');
    const lastMonthViews = sumInRange(contentHistory, twoMonthsAgo, monthAgo, 'total_views');
    const thisMonthSpend = sumInRange(conversionHistory, monthAgo, now, 'total_cost');
    const lastMonthSpend = sumInRange(conversionHistory, twoMonthsAgo, monthAgo, 'total_cost');

    trends.monthly = {
      conversions: calculateChange(thisMonthConv, lastMonthConv),
      views: calculateChange(thisMonthViews, lastMonthViews),
      spend: calculateChange(thisMonthSpend, lastMonthSpend),
      cpa: calculateCpaChange(thisMonthSpend, thisMonthConv, lastMonthSpend, lastMonthConv),
      current: { conversions: thisMonthConv, views: thisMonthViews, spend: thisMonthSpend },
      previous: { conversions: lastMonthConv, views: lastMonthViews, spend: lastMonthSpend },
    };

    // Calculate yearly comparison (this year vs last year)
    const thisYearConv = sumInRange(conversionHistory, yearAgo, now, 'total_conversions');
    const lastYearConv = sumInRange(conversionHistory, twoYearsAgo, yearAgo, 'total_conversions');
    const thisYearViews = sumInRange(contentHistory, yearAgo, now, 'total_views');
    const lastYearViews = sumInRange(contentHistory, twoYearsAgo, yearAgo, 'total_views');
    const thisYearSpend = sumInRange(conversionHistory, yearAgo, now, 'total_cost');
    const lastYearSpend = sumInRange(conversionHistory, twoYearsAgo, yearAgo, 'total_cost');

    trends.yearly = {
      conversions: calculateChange(thisYearConv, lastYearConv),
      views: calculateChange(thisYearViews, lastYearViews),
      spend: calculateChange(thisYearSpend, lastYearSpend),
      cpa: calculateCpaChange(thisYearSpend, thisYearConv, lastYearSpend, lastYearConv),
      current: { conversions: thisYearConv, views: thisYearViews, spend: thisYearSpend },
      previous: { conversions: lastYearConv, views: lastYearViews, spend: lastYearSpend },
    };

    // Calculate creator momentum (who's rising, cooling, stalled)
    const creatorStats = {};
    for (const row of influencerHistory) {
      if (!creatorStats[row.influencer_id]) {
        creatorStats[row.influencer_id] = {
          name: row.influencer_name,
          thisWeek: 0,
          lastWeek: 0,
          lastConversionDate: null,
        };
      }
      const date = new Date(row.date);
      if (date >= weekAgo) {
        creatorStats[row.influencer_id].thisWeek += Number(row.conversions) || 0;
      } else if (date >= twoWeeksAgo) {
        creatorStats[row.influencer_id].lastWeek += Number(row.conversions) || 0;
      }
      if (Number(row.conversions) > 0 && (!creatorStats[row.influencer_id].lastConversionDate || date > creatorStats[row.influencer_id].lastConversionDate)) {
        creatorStats[row.influencer_id].lastConversionDate = date;
      }
    }

    for (const [id, stats] of Object.entries(creatorStats)) {
      const change = calculateChange(stats.thisWeek, stats.lastWeek);
      const daysSinceConversion = stats.lastConversionDate
        ? Math.floor((now - stats.lastConversionDate) / (24 * 60 * 60 * 1000))
        : null;

      if (change.percent > 20 && stats.thisWeek > 0) {
        trends.creatorMomentum.rising.push({
          name: stats.name,
          change: change.percent,
          thisWeek: stats.thisWeek,
          lastWeek: stats.lastWeek,
        });
      } else if (change.percent < -30 && stats.lastWeek > 0) {
        trends.creatorMomentum.cooling.push({
          name: stats.name,
          change: change.percent,
          thisWeek: stats.thisWeek,
          lastWeek: stats.lastWeek,
        });
      } else if (daysSinceConversion !== null && daysSinceConversion > 7 && stats.lastWeek > 0) {
        trends.creatorMomentum.stalled.push({
          name: stats.name,
          daysSinceConversion,
          lastWeek: stats.lastWeek,
        });
      }
    }

    // Sort by impact
    trends.creatorMomentum.rising.sort((a, b) => b.change - a.change);
    trends.creatorMomentum.cooling.sort((a, b) => a.change - b.change);
    trends.creatorMomentum.stalled.sort((a, b) => b.daysSinceConversion - a.daysSinceConversion);

    // Limit to top 5 each
    trends.creatorMomentum.rising = trends.creatorMomentum.rising.slice(0, 5);
    trends.creatorMomentum.cooling = trends.creatorMomentum.cooling.slice(0, 5);
    trends.creatorMomentum.stalled = trends.creatorMomentum.stalled.slice(0, 5);

    // Generate trend summary
    trends.summary = generateTrendSummary(trends);

  } catch (e) {
    console.error('[Trends] Failed to calculate historical trends:', e.message);
  }

  return trends;
}

function calculateChange(current, previous) {
  if (previous === 0 && current === 0) return { percent: 0, direction: 'flat', current, previous };
  if (previous === 0) return { percent: 100, direction: 'up', current, previous };
  const percent = Math.round(((current - previous) / previous) * 100);
  return {
    percent,
    direction: percent > 5 ? 'up' : percent < -5 ? 'down' : 'flat',
    current,
    previous,
  };
}

function calculateCpaChange(currentSpend, currentConv, previousSpend, previousConv) {
  const currentCpa = currentConv > 0 ? currentSpend / currentConv : null;
  const previousCpa = previousConv > 0 ? previousSpend / previousConv : null;

  if (currentCpa === null && previousCpa === null) return { percent: 0, direction: 'flat', current: null, previous: null };
  if (previousCpa === null) return { percent: 0, direction: 'new', current: currentCpa, previous: null };
  if (currentCpa === null) return { percent: -100, direction: 'lost', current: null, previous: previousCpa };

  const percent = Math.round(((currentCpa - previousCpa) / previousCpa) * 100);
  return {
    percent,
    direction: percent < -5 ? 'improving' : percent > 5 ? 'worsening' : 'stable',
    current: Math.round(currentCpa * 100) / 100,
    previous: Math.round(previousCpa * 100) / 100,
  };
}

function generateTrendSummary(trends) {
  const parts = [];

  // Weekly highlights
  if (trends.weekly.conversions.direction === 'up') {
    parts.push(`Conversions up ${trends.weekly.conversions.percent}% this week`);
  } else if (trends.weekly.conversions.direction === 'down') {
    parts.push(`Conversions down ${Math.abs(trends.weekly.conversions.percent)}% this week`);
  }

  if (trends.weekly.cpa.direction === 'improving') {
    parts.push(`CPA improved ${Math.abs(trends.weekly.cpa.percent)}%`);
  } else if (trends.weekly.cpa.direction === 'worsening') {
    parts.push(`CPA worsened ${trends.weekly.cpa.percent}%`);
  }

  // Creator momentum
  if (trends.creatorMomentum.rising.length > 0) {
    parts.push(`${trends.creatorMomentum.rising.length} creator(s) trending up`);
  }
  if (trends.creatorMomentum.cooling.length > 0) {
    parts.push(`${trends.creatorMomentum.cooling.length} creator(s) cooling off`);
  }
  if (trends.creatorMomentum.stalled.length > 0) {
    parts.push(`${trends.creatorMomentum.stalled.length} creator(s) stalled`);
  }

  return parts.join('. ') || 'Insufficient historical data for trend analysis';
}
