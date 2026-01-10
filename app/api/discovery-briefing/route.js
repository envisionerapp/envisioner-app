import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  ensureDiscoveryColumns,
  getUserDiscoveryPreferences,
  getUserAccessLevel,
  getAccessCapabilities,
  getUserPerformanceHistory,
  getSimilarCreatorCriteria,
  getUserDiscoveryStats,
} from '@/lib/discovery-db';
import {
  getDiscoveryStats,
  getLiveCreators,
  searchDiscoveryCreators,
} from '@/lib/discovery-client';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user');

  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'User required' },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const sql = getDb();

    // Ensure discovery columns exist
    await ensureDiscoveryColumns(sql);

    // Get user data in parallel
    const [preferences, accessLevel, performanceHistory, discoveryStats, userStats] = await Promise.all([
      getUserDiscoveryPreferences(sql, userId),
      getUserAccessLevel(sql, userId),
      getUserPerformanceHistory(sql, userId),
      getDiscoveryStats().catch(() => null),
      getUserDiscoveryStats(sql, userId),
    ]);

    const capabilities = getAccessCapabilities(accessLevel);

    // Get similar creator criteria if user has performance data
    const similarCriteria = await getSimilarCreatorCriteria(sql, userId);

    // Get live creators if available
    let liveCreators = [];
    if (capabilities.canViewLive && discoveryStats?.data?.liveNow > 0) {
      try {
        const liveData = await getLiveCreators({
          platform: preferences.platforms?.[0],
          limit: 5,
        });
        liveCreators = liveData?.data?.live || [];
      } catch (e) {
        console.error('[Discovery Briefing] Failed to get live creators:', e.message);
      }
    }

    // Get AI-powered recommendations
    let recommendations = [];
    if (similarCriteria && capabilities.canViewPerformance) {
      try {
        const searchResults = await searchDiscoveryCreators({
          platforms: similarCriteria.preferredPlatforms,
          hasPerformanceData: true,
          limit: capabilities.similarCreatorLimit,
        });
        recommendations = searchResults?.data?.creators || [];
      } catch (e) {
        console.error('[Discovery Briefing] Failed to get recommendations:', e.message);
      }
    }

    // Generate AI summary
    const summary = await generateDiscoverySummary({
      preferences,
      performanceHistory,
      discoveryStats: discoveryStats?.data,
      userStats,
      liveCreators,
      recommendations,
      similarCriteria,
      capabilities,
    });

    // Build action cards
    const actions = generateDiscoveryActions({
      preferences,
      performanceHistory,
      discoveryStats: discoveryStats?.data,
      liveCreators,
      recommendations,
      similarCriteria,
      capabilities,
    });

    // Generate suggested prompts
    const suggestedPrompts = generateDiscoveryPrompts({
      preferences,
      performanceHistory,
      hasLive: liveCreators.length > 0,
    });

    // Build metrics
    const metrics = [
      {
        label: 'Database',
        value: discoveryStats?.data?.totalCreators?.toLocaleString() || '50K+',
      },
      {
        label: 'Live Now',
        value: discoveryStats?.data?.liveNow?.toString() || '0',
      },
      {
        label: 'Your Matches',
        value: recommendations.length.toString(),
      },
    ];

    return NextResponse.json({
      success: true,
      briefing: {
        summary,
        metrics,
        actions,
        suggestedPrompts,
        accessLevel,
        capabilities,
      },
      data: {
        preferences,
        performanceHistory: capabilities.canViewPerformance ? performanceHistory : null,
        liveCreators,
        recommendations: capabilities.canViewPerformance ? recommendations : [],
        similarCriteria,
      },
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[Discovery Briefing] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function generateDiscoverySummary(data) {
  const {
    preferences,
    performanceHistory,
    discoveryStats,
    userStats,
    liveCreators,
    recommendations,
    similarCriteria,
    capabilities,
  } = data;

  const hasPerformanceData = performanceHistory.topPerformers.length > 0;
  const hasPreferences = preferences.platforms?.length > 0 || preferences.regions?.length > 0;

  // Build context for AI
  const prompt = `You are an influencer marketing discovery assistant. Generate a brief 2-3 bullet point summary for a user exploring creator discovery.

USER CONTEXT:
- Access level: ${capabilities.aiRecommendations === 'full' ? 'Pro/Enterprise' : 'Basic'}
- Has performance history: ${hasPerformanceData ? 'Yes' : 'No'}
- Top performers: ${performanceHistory.topPerformers.slice(0, 3).map(p => `${p.name} (${p.platform})`).join(', ') || 'None yet'}
- Best performing platform: ${performanceHistory.patterns?.bestPlatform || 'Unknown'}
- Average CPA of top performers: ${performanceHistory.patterns?.avgCpa ? `$${performanceHistory.patterns.avgCpa}` : 'N/A'}

PREFERENCES:
- Preferred platforms: ${preferences.platforms?.join(', ') || 'All'}
- Target regions: ${preferences.regions?.join(', ') || 'Global'}
- Target CPA: ${preferences.targetCpa ? `$${preferences.targetCpa}` : 'Not set'}
- Budget: ${preferences.monthlyBudget ? `$${preferences.monthlyBudget}/month` : 'Not set'}

DISCOVERY DATABASE:
- Total creators: ${discoveryStats?.totalCreators?.toLocaleString() || '50,000+'}
- Currently live: ${discoveryStats?.liveNow || 0}
- Creators with performance data: ${discoveryStats?.performance?.creatorsWithData || 0}

CURRENT MATCHES:
- Live creators matching preferences: ${liveCreators.length}
- AI-recommended similar creators: ${recommendations.length}
${similarCriteria ? `- Based on your top performers: ${similarCriteria.basedOn?.join(', ')}` : ''}

RULES:
- Write 2-3 SHORT bullet points (under 15 words each)
- Focus on actionable discovery insights
- If user has top performers, suggest finding similar creators
- If creators are live, mention the opportunity
- Be specific with numbers and platform names
- Format: "• [insight]" on each line

Examples:
• 12 Twitch streamers live now match your iGaming criteria
• Found 8 creators similar to GamerPro with proven $22 CPA
• Your best results come from TikTok - 15 new matches available

Write ONLY the bullets:`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.text?.trim() || buildFallbackDiscoverySummary(data);
  } catch (error) {
    console.error('[Discovery] AI summary error:', error);
    return buildFallbackDiscoverySummary(data);
  }
}

function buildFallbackDiscoverySummary(data) {
  const { discoveryStats, liveCreators, recommendations, performanceHistory } = data;
  const bullets = [];

  if (liveCreators.length > 0) {
    bullets.push(`• ${liveCreators.length} creators are live now matching your criteria`);
  }

  if (recommendations.length > 0 && performanceHistory.topPerformers.length > 0) {
    bullets.push(`• Found ${recommendations.length} creators similar to your top performers`);
  }

  if (discoveryStats?.totalCreators) {
    bullets.push(`• ${discoveryStats.totalCreators.toLocaleString()} creators in database ready to explore`);
  }

  return bullets.join('\n') || '• Start discovering creators that match your campaign goals';
}

function generateDiscoveryActions(data) {
  const {
    preferences,
    performanceHistory,
    discoveryStats,
    liveCreators,
    recommendations,
    similarCriteria,
    capabilities,
  } = data;

  const actions = [];

  // Live creators action
  if (liveCreators.length > 0) {
    const topLive = liveCreators[0];
    actions.push({
      id: 'discovery_live',
      type: 'discovery',
      priority: 'high',
      title: `${liveCreators.length} creators are live now`,
      description: `${topLive.displayName || topLive.name} streaming with ${topLive.currentViewers?.toLocaleString() || 'N/A'} viewers`,
      options: [
        {
          label: 'View live',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/discovery?filter=live' },
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'discovery_live' },
        },
      ],
    });
  }

  // Similar creators action
  if (recommendations.length > 0 && similarCriteria) {
    actions.push({
      id: 'discovery_similar',
      type: 'discovery',
      priority: 'medium',
      title: `${recommendations.length} creators similar to your top performers`,
      description: `Based on ${similarCriteria.basedOn?.slice(0, 2).join(', ')}. Target CPA: $${similarCriteria.targetCpa || 'N/A'}`,
      options: [
        {
          label: 'View matches',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/discovery?filter=similar' },
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'discovery_similar' },
        },
      ],
    });
  }

  // Performance data opportunity
  if (capabilities.canViewPerformance && discoveryStats?.performance?.creatorsWithData > 0) {
    actions.push({
      id: 'discovery_proven',
      type: 'discovery',
      priority: 'low',
      title: 'Proven creators available',
      description: `${discoveryStats.performance.creatorsWithData} creators with verified performance data`,
      options: [
        {
          label: 'Browse proven',
          action: 'navigate',
          variant: 'secondary',
          params: { url: 'https://app.envisioner.io/discovery?filter=proven' },
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'discovery_proven' },
        },
      ],
    });
  }

  // Setup preferences if not configured
  if (!preferences.targetCpa && !preferences.regions?.length) {
    actions.push({
      id: 'discovery_setup',
      type: 'setup',
      priority: 'medium',
      title: 'Set your discovery preferences',
      description: 'Configure target CPA, regions, and platforms for better recommendations',
      options: [
        {
          label: 'Configure',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/settings/discovery' },
        },
        {
          label: 'Later',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'discovery_setup' },
        },
      ],
    });
  }

  return actions;
}

function generateDiscoveryPrompts(data) {
  const { preferences, performanceHistory, hasLive } = data;
  const prompts = [];

  if (performanceHistory.topPerformers.length > 0) {
    const topName = performanceHistory.topPerformers[0].name;
    prompts.push(`Find creators similar to ${topName}`);
  }

  if (hasLive) {
    prompts.push('Show me who is live right now');
  }

  if (preferences.platforms?.length > 0) {
    prompts.push(`Best ${preferences.platforms[0]} creators for iGaming`);
  }

  prompts.push('Who has the lowest CPA?');
  prompts.push('Recommend creators for my budget');

  return prompts.slice(0, 3);
}
