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
    const [preferences, accessLevel, performanceHistory, userStats] = await Promise.all([
      getUserDiscoveryPreferences(sql, userId),
      getUserAccessLevel(sql, userId),
      getUserPerformanceHistory(sql, userId),
      getUserDiscoveryStats(sql, userId),
    ]);

    const capabilities = getAccessCapabilities(accessLevel);

    // Get similar creator criteria if user has performance data
    const similarCriteria = await getSimilarCreatorCriteria(sql, userId);

    // Generate AI summary based on user's performance data
    const summary = await generateDiscoverySummary({
      preferences,
      performanceHistory,
      userStats,
      similarCriteria,
      capabilities,
    });

    // Build action cards based on user data
    const actions = generateDiscoveryActions({
      preferences,
      performanceHistory,
      similarCriteria,
      capabilities,
    });

    // Generate suggested prompts
    const suggestedPrompts = generateDiscoveryPrompts({
      preferences,
      performanceHistory,
    });

    // Build metrics from user's actual data
    const metrics = [
      {
        label: 'Creators',
        value: userStats.total_creators_used?.toString() || '0',
      },
      {
        label: 'Top Performers',
        value: performanceHistory.topPerformers.length.toString(),
      },
      {
        label: 'Avg CPA',
        value: performanceHistory.patterns?.avgCpa ? `$${performanceHistory.patterns.avgCpa}` : '-',
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
    userStats,
    similarCriteria,
    capabilities,
  } = data;

  const hasPerformanceData = performanceHistory.topPerformers.length > 0;

  // Build context for AI
  const prompt = `You are an influencer marketing discovery assistant. Generate a brief 2-3 bullet point summary to help a user find new creators based on their past performance.

USER CONTEXT:
- Access level: ${capabilities.aiRecommendations === 'full' ? 'Pro/Enterprise' : 'Basic'}
- Total creators worked with: ${userStats.total_creators_used || 0}
- Has performance history: ${hasPerformanceData ? 'Yes' : 'No'}

${hasPerformanceData ? `TOP PERFORMERS:
${performanceHistory.topPerformers.slice(0, 5).map(p => `- ${p.name} (${p.platform}): ${p.conversions} conversions, $${p.cpa?.toFixed(2) || 'N/A'} CPA`).join('\n')}

SUCCESS PATTERNS:
- Best platform: ${performanceHistory.patterns?.bestPlatform || 'Unknown'}
- Average CPA on top performers: $${performanceHistory.patterns?.avgCpa || 'N/A'}
- Average spend per top performer: $${performanceHistory.patterns?.avgSpendOnTopPerformers || 'N/A'}` : 'No performance data yet - user is new.'}

PREFERENCES:
- Preferred platforms: ${preferences.platforms?.join(', ') || 'All'}
- Target regions: ${preferences.regions?.join(', ') || 'Not set'}
- Target CPA: ${preferences.targetCpa ? `$${preferences.targetCpa}` : 'Not set'}
- Budget: ${preferences.monthlyBudget ? `$${preferences.monthlyBudget}/month` : 'Not set'}

RULES:
- Write 2-3 SHORT bullet points (under 15 words each)
- Focus on insights from their performance data
- If user has top performers, highlight what's working
- If user is new, encourage setting up preferences
- Be specific with names, platforms, and numbers
- Format: "• [insight]" on each line

Examples for user with data:
• Your TikTok creators average $18 CPA - focus discovery there
• GamerPro pattern: 50K-100K followers converts best for you
• Consider expanding to Kick - similar audience to your top Twitch performers

Examples for new user:
• Set your target CPA and preferred platforms to get started
• Add your first campaign to unlock AI-powered recommendations

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
  const { performanceHistory, preferences } = data;
  const bullets = [];

  if (performanceHistory.topPerformers.length > 0) {
    const bestPlatform = performanceHistory.patterns?.bestPlatform;
    if (bestPlatform) {
      bullets.push(`• Your best results come from ${bestPlatform} creators`);
    }
    if (performanceHistory.patterns?.avgCpa) {
      bullets.push(`• Top performers average $${performanceHistory.patterns.avgCpa} CPA`);
    }
  } else {
    bullets.push('• Add campaigns to unlock AI-powered discovery insights');
  }

  if (!preferences.targetCpa) {
    bullets.push('• Set your target CPA in preferences for better recommendations');
  }

  return bullets.join('\n') || '• Start tracking campaigns to get personalized discovery insights';
}

function generateDiscoveryActions(data) {
  const {
    preferences,
    performanceHistory,
    similarCriteria,
    capabilities,
  } = data;

  const actions = [];

  // Insight about top performers
  if (performanceHistory.topPerformers.length >= 3 && similarCriteria) {
    actions.push({
      id: 'discovery_pattern',
      type: 'insight',
      priority: 'high',
      title: `Your winning formula: ${similarCriteria.preferredPlatforms?.[0] || 'Unknown'} creators`,
      description: `Based on ${similarCriteria.basedOn?.slice(0, 2).join(', ')}. Avg spend: $${similarCriteria.suggestedBudget?.min}-${similarCriteria.suggestedBudget?.max}`,
      options: [
        {
          label: 'View top performers',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/influencers?sort=conversions' },
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'discovery_pattern' },
        },
      ],
    });
  }

  // Underperformers to review
  if (performanceHistory.underperformers.length > 0) {
    actions.push({
      id: 'discovery_underperformers',
      type: 'warning',
      priority: 'medium',
      title: `${performanceHistory.underperformers.length} creators need review`,
      description: 'These creators have high CPA - consider pausing or replacing them',
      options: [
        {
          label: 'Review creators',
          action: 'navigate',
          variant: 'secondary',
          params: { url: 'https://app.envisioner.io/influencers?sort=cpa&order=desc' },
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'discovery_underperformers' },
        },
      ],
    });
  }

  // Setup preferences if not configured
  if (!preferences.targetCpa && !preferences.regions?.length) {
    actions.push({
      id: 'discovery_setup',
      type: 'setup',
      priority: performanceHistory.topPerformers.length === 0 ? 'high' : 'medium',
      title: 'Set your discovery preferences',
      description: 'Configure target CPA, regions, and platforms for better insights',
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

  // Encourage adding more creators if few exist
  if (performanceHistory.totalAnalyzed < 5) {
    actions.push({
      id: 'discovery_add_more',
      type: 'suggestion',
      priority: 'low',
      title: 'Add more creators for better insights',
      description: 'AI recommendations improve with more performance data',
      options: [
        {
          label: 'Add creator',
          action: 'navigate',
          variant: 'secondary',
          params: { url: 'https://app.envisioner.io/influencers/new' },
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'discovery_add_more' },
        },
      ],
    });
  }

  return actions;
}

function generateDiscoveryPrompts(data) {
  const { preferences, performanceHistory } = data;
  const prompts = [];

  if (performanceHistory.topPerformers.length > 0) {
    const topName = performanceHistory.topPerformers[0].name;
    prompts.push(`Why is ${topName} performing well?`);
    prompts.push('What do my top performers have in common?');
  }

  if (performanceHistory.underperformers.length > 0) {
    prompts.push('Why are some creators underperforming?');
  }

  if (performanceHistory.patterns?.bestPlatform) {
    prompts.push(`Should I focus more on ${performanceHistory.patterns.bestPlatform}?`);
  }

  prompts.push('What type of creators should I look for?');
  prompts.push('How can I improve my CPA?');

  return prompts.slice(0, 3);
}
