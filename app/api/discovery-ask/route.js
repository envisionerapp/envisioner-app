import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  ensureDiscoveryColumns,
  getUserDiscoveryPreferences,
  getUserAccessLevel,
  getAccessCapabilities,
  getUserPerformanceHistory,
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

export async function POST(request) {
  try {
    const { user, question, context } = await request.json();

    if (!user || !question) {
      return NextResponse.json(
        { success: false, error: 'User and question required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const sql = getDb();

    // Ensure discovery columns exist
    await ensureDiscoveryColumns(sql);

    // Get user data in parallel
    const [preferences, accessLevel, performanceHistory] = await Promise.all([
      getUserDiscoveryPreferences(sql, user),
      getUserAccessLevel(sql, user),
      getUserPerformanceHistory(sql, user),
    ]);

    const capabilities = getAccessCapabilities(accessLevel);

    // Generate AI answer based on user's data
    const answer = await generateDiscoveryAnswer({
      question,
      context,
      preferences,
      capabilities,
      performanceHistory,
    });

    return NextResponse.json({
      success: true,
      answer,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[Discovery Ask] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function generateDiscoveryAnswer(data) {
  const {
    question,
    context,
    preferences,
    capabilities,
    performanceHistory,
  } = data;

  // Top performers context
  let topPerformersContext = '';
  if (performanceHistory.topPerformers.length > 0) {
    topPerformersContext = `\nTOP PERFORMERS (lowest CPA, most conversions):\n` +
      performanceHistory.topPerformers.slice(0, 10).map((p, i) => {
        return `${i + 1}. ${p.name} (${p.platform}): ${p.conversions} conversions, $${p.spent} spent, $${p.cpa?.toFixed(2) || 'N/A'} CPA`;
      }).join('\n');
  }

  // Good performers context
  let goodPerformersContext = '';
  if (performanceHistory.goodPerformers.length > 0) {
    goodPerformersContext = `\nGOOD PERFORMERS (moderate CPA):\n` +
      performanceHistory.goodPerformers.slice(0, 5).map((p, i) => {
        return `${i + 1}. ${p.name} (${p.platform}): ${p.conversions} conversions, $${p.cpa?.toFixed(2) || 'N/A'} CPA`;
      }).join('\n');
  }

  // Underperformers context
  let underperformersContext = '';
  if (performanceHistory.underperformers.length > 0) {
    underperformersContext = `\nUNDERPERFORMERS (high CPA, needs review):\n` +
      performanceHistory.underperformers.slice(0, 5).map((p, i) => {
        return `${i + 1}. ${p.name} (${p.platform}): ${p.conversions} conversions, $${p.spent} spent, $${p.cpa?.toFixed(2) || 'N/A'} CPA`;
      }).join('\n');
  }

  // Performance patterns
  let patternsContext = '';
  if (performanceHistory.patterns) {
    const p = performanceHistory.patterns;
    patternsContext = `\nSUCCESS PATTERNS FROM YOUR DATA:
- Best performing platform: ${p.bestPlatform || 'Unknown'}
- Platform breakdown: ${Object.entries(p.platformDistribution || {}).map(([k, v]) => `${k}: ${v} creators`).join(', ')}
- Avg CPA on top performers: $${p.avgCpa || 'N/A'}
- Avg spend per top performer: $${p.avgSpendOnTopPerformers || 'N/A'}
- Avg conversions per top performer: ${p.avgConversions || 'N/A'}`;
  }

  const prompt = `You are an AI discovery assistant helping a user understand their influencer marketing performance and find patterns for discovering new creators.

USER ACCESS: ${capabilities.aiRecommendations === 'full' ? 'Pro (full data access)' : 'Basic'}

USER PREFERENCES:
- Preferred platforms: ${preferences.platforms?.join(', ') || 'All'}
- Target regions: ${preferences.regions?.join(', ') || 'Not set'}
- Target CPA: ${preferences.targetCpa ? `$${preferences.targetCpa}` : 'Not set'}
- Monthly budget: ${preferences.monthlyBudget ? `$${preferences.monthlyBudget}` : 'Not set'}

PERFORMANCE DATA:
- Total creators analyzed: ${performanceHistory.totalAnalyzed}
- Top performers: ${performanceHistory.topPerformers.length}
- Good performers: ${performanceHistory.goodPerformers.length}
- Underperformers: ${performanceHistory.underperformers.length}
${topPerformersContext}
${goodPerformersContext}
${underperformersContext}
${patternsContext}

NAVIGATION LINKS (use when helpful):
- [Influencers](https://app.envisioner.io/influencers): View all creators
- [Top Performers](https://app.envisioner.io/influencers?sort=conversions): Sort by conversions
- [By CPA](https://app.envisioner.io/influencers?sort=cpa): Sort by cost per acquisition
- [Campaigns](https://app.envisioner.io/campaigns): View campaigns
- [Settings](https://app.envisioner.io/settings): Update preferences

---

QUESTION: ${question}

GUIDELINES:
- Reference specific creators by name when relevant
- Use actual numbers from their data (CPA, conversions, spend)
- Identify patterns (which platforms work, typical spend levels)
- Give actionable recommendations based on their success patterns
- If they ask about finding new creators, suggest criteria based on what works for them
- 2-4 sentences, be direct and specific
- Link to relevant pages when helpful

Answer:`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.text?.trim() || "I couldn't process that question. Try asking differently.";
  } catch (error) {
    console.error('[Discovery Ask] AI error:', error);
    return "Sorry, I couldn't process that question right now. Try again later.";
  }
}
