import { NextResponse } from 'next/server';
import { getDb, ensureBriefingsTable, getBriefing, saveBriefing, getUserData } from '@/lib/db';
import { calculateScore, formatNumber } from '@/lib/score';
import { detectActions } from '@/lib/actions';
import { ensureBenchmarkTables, getBenchmarks, contributeToBenchmarks } from '@/lib/benchmarks';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// CORS headers
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
  const forceRefresh = searchParams.get('refresh') === 'true';
  const currentPage = searchParams.get('page') || '';

  if (!userId) {
    return NextResponse.json({ success: false, error: 'User required' }, { status: 400, headers: corsHeaders });
  }

  try {
    const sql = getDb();
    await ensureBriefingsTable(sql);
    await ensureBenchmarkTables(sql);

    // Get benchmarks for scoring context
    const benchmarks = await getBenchmarks(sql);

    // Check for cached briefing (skip if refresh=true)
    let briefing = forceRefresh ? null : await getBriefing(sql, userId);

    if (briefing) {
      // Always regenerate fresh actions based on current data and benchmarks
      const data = await getUserData(sql, userId);
      console.log(`[Briefing] Cached briefing found for ${userId}. Fresh data: ${data.influencers?.length || 0} influencers`);
      const freshActions = detectActions(data, benchmarks);
      console.log(`[Briefing] Fresh actions generated: ${freshActions.length} actions, types: ${freshActions.map(a => a.type).join(', ')}`);

      // Generate fresh prompts based on current page
      const suggestedPrompts = await generatePrompts(data, currentPage);

      return NextResponse.json({
        success: true,
        cached: true,
        briefing: {
          score: briefing.score,
          summary: briefing.summary,
          metrics: briefing.metrics,
          actions: freshActions,
          suggestedPrompts,
        },
        benchmarks: {
          cpa_p50: benchmarks.cpa_p50,
          sample_size: benchmarks.sample_size,
        },
      }, { headers: corsHeaders });
    }

    // Generate new briefing
    const data = await getUserData(sql, userId);
    briefing = await generateBriefing(sql, userId, data, benchmarks, currentPage);

    if (briefing) {
      await saveBriefing(sql, userId, briefing);

      // Contribute anonymized data to benchmarks (async, non-blocking)
      contributeToBenchmarks(sql, data).catch(e => console.error('Benchmark contribution error:', e.message));
    }

    return NextResponse.json({
      success: true,
      cached: false,
      briefing,
      benchmarks: {
        cpa_p50: benchmarks.cpa_p50,
        sample_size: benchmarks.sample_size,
      },
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Briefing error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

async function generateBriefing(sql, userId, data, benchmarks, currentPage = '') {
  const { user, totals, noContent, noConversions, topPerformers, platforms, influencers } = data;

  // Calculate score with benchmark context
  const scoreResult = calculateScore(data, benchmarks);
  const score = scoreResult.score;

  // Build metrics
  const metrics = [
    { label: 'Spent', value: `$${totals.totalSpent.toLocaleString()}` },
    { label: 'Conversions', value: totals.totalConversions.toString() },
    { label: 'Views', value: formatNumber(totals.totalViews) },
  ];

  // If no data, return onboarding briefing with actionable cards
  if (influencers.length === 0) {
    return {
      score: 50,
      summary: `Welcome to Envisioner. Add your first creator to start tracking performance and get personalized insights.`,
      metrics: [
        { label: 'Creators', value: '0' },
        { label: 'Campaigns', value: '0' },
        { label: 'Spent', value: '$0' },
      ],
      actions: [
        {
          id: 'onboarding_add_creator',
          type: 'onboarding',
          priority: 'high',
          icon: 'plus',
          title: 'Add your first creator',
          description: 'Start tracking influencer performance and get AI insights.',
          options: [
            { label: 'Add creator', action: 'navigate', variant: 'primary', params: { url: '/influencers' } },
            { label: 'Dismiss', action: 'dismiss', variant: 'ghost', params: { action_id: 'onboarding_add_creator' } }
          ]
        }
      ],
      suggestedPrompts: ['How do I add my first creator?', 'What can Envisioner track?', 'How does the health score work?'],
    };
  }

  // Generate AI summary with benchmark context
  const summary = await generateSummary(data, scoreResult, benchmarks);

  // Detect actionable recommendations with benchmark thresholds
  const actions = detectActions(data, benchmarks);

  // Generate AI-powered prompts based on data and current page
  const suggestedPrompts = await generatePrompts(data, currentPage);

  return {
    score,
    summary,
    metrics,
    actions,
    suggestedPrompts,
  };
}

async function generateSummary(data, scoreResult, benchmarks) {
  const { user, totals, noContent, noConversions, topPerformers, platforms, influencers, historicalTrends } = data;
  const name = user?.name?.split(' ')[0] || 'there';

  // Calculate advanced metrics
  const cpa = totals.totalConversions > 0 ? (totals.totalSpent / totals.totalConversions).toFixed(2) : null;
  const conversionRate = totals.totalViews > 0 ? ((totals.totalConversions / totals.totalViews) * 100).toFixed(3) : null;
  const avgSpendPerCreator = influencers.length > 0 ? Math.round(totals.totalSpent / influencers.length) : 0;
  const creatorsWithContent = influencers.length - noContent.length;
  const contentDeliveryRate = influencers.length > 0 ? Math.round((creatorsWithContent / influencers.length) * 100) : 0;
  const wastedSpend = noConversions.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const pendingSpend = noContent.reduce((sum, i) => sum + (Number(i.price) || 0), 0);

  // Benchmark comparisons - only use if we have real data
  const hasBenchmarkData = benchmarks?.sample_size > 0;
  const cpaBenchmark = hasBenchmarkData ? benchmarks.cpa_p50 : null;
  const cpaPerformance = (cpa && cpaBenchmark) ? (Number(cpa) < cpaBenchmark ? 'below benchmark (good)' : 'above benchmark') : null;
  const deliveryBenchmark = hasBenchmarkData ? benchmarks.content_delivery_rate_p50 : null;

  // Platform analysis
  const platformAnalysis = Object.entries(platforms).map(([p, s]) => {
    const platformCPA = s.conversions > 0 ? (s.spent / s.conversions).toFixed(2) : 'N/A';
    const platformCR = s.views > 0 ? ((s.conversions / s.views) * 100).toFixed(3) : '0';
    return `${p}: $${s.spent} spent, ${s.conversions} conv, CPA $${platformCPA}, CR ${platformCR}%`;
  }).join('\n');

  // Find best and worst
  const platformsByEfficiency = Object.entries(platforms)
    .filter(([_, s]) => s.conversions > 0)
    .sort((a, b) => (a[1].spent / a[1].conversions) - (b[1].spent / b[1].conversions));
  const bestPlatform = platformsByEfficiency[0];
  const worstPlatform = platformsByEfficiency[platformsByEfficiency.length - 1];

  // Build trends section
  const trendsSection = buildTrendsSection(historicalTrends);

  // Build benchmark section only if we have real data
  const benchmarkSection = hasBenchmarkData ? `
INDUSTRY BENCHMARKS (from ${benchmarks.sample_size} campaigns):
- CPA benchmark (median): $${cpaBenchmark}
- Your CPA vs benchmark: ${cpaPerformance}
- Content delivery benchmark: ${deliveryBenchmark}%
- Your delivery vs benchmark: ${contentDeliveryRate}% (${contentDeliveryRate >= deliveryBenchmark ? 'meets standard' : 'below standard'})` : '';

  const prompt = `You are a senior influencer marketing strategist analyzing a client's campaign data${hasBenchmarkData ? ' against INDUSTRY BENCHMARKS' : ''} and HISTORICAL TRENDS. Think step by step about what the data reveals, then provide a sharp executive insight.

CLIENT: ${name}

RAW METRICS (CURRENT SNAPSHOT):
- Total invested: $${totals.totalSpent.toLocaleString()}
- Total conversions: ${totals.totalConversions}
- Total views: ${formatNumber(totals.totalViews)}
- Active creators: ${influencers.length}

CALCULATED METRICS:
- Cost per acquisition (CPA): ${cpa ? `$${cpa}` : 'No conversions yet'}
- View-to-conversion rate: ${conversionRate ? `${conversionRate}%` : 'N/A'}
- Average spend per creator: $${avgSpendPerCreator}
- Content delivery rate: ${contentDeliveryRate}% (${creatorsWithContent}/${influencers.length} delivered)

${trendsSection}
${benchmarkSection}

MONEY AT RISK:
- Pending content (paid, no posts): $${pendingSpend.toLocaleString()} across ${noContent.length} creators
- Underperforming (paid, has content, no conversions): $${wastedSpend.toLocaleString()} across ${noConversions.length} creators

PLATFORM BREAKDOWN:
${platformAnalysis || 'No platform data'}

EFFICIENCY ANALYSIS:
- Most efficient platform: ${bestPlatform ? `${bestPlatform[0]} ($${(bestPlatform[1].spent / bestPlatform[1].conversions).toFixed(2)} CPA)` : 'N/A'}
- Least efficient platform: ${worstPlatform && platformsByEfficiency.length > 1 ? `${worstPlatform[0]} ($${(worstPlatform[1].spent / worstPlatform[1].conversions).toFixed(2)} CPA)` : 'N/A'}

TOP PERFORMERS:
${topPerformers.slice(0, 3).map((i, idx) => `${idx + 1}. ${i.influencer}: ${i.total_conversions} conversions`).join('\n') || 'None yet'}

HEALTH SCORE: ${scoreResult.score}/100
ISSUES DETECTED: ${scoreResult.issues.join(', ') || 'None'}

---

ANALYSIS FRAMEWORK:
1. What's the TREND? (improving, declining, or flat week-over-week)
2. Who's rising or cooling off? (creator momentum)
3. What's the biggest opportunity or risk RIGHT NOW?${hasBenchmarkData ? '\n4. How does performance compare to industry benchmark?' : ''}

Based on this analysis, write 2-3 SHORT bullet points:
- Each bullet is ONE line max (under 12 words)
- PRIORITIZE trend insights (e.g., "Conversions up 40% this week")
- Include creator momentum when relevant${hasBenchmarkData ? '\n- Include benchmark comparisons if significantly above/below' : ''}
- Be direct, no fluff
- Format: "• [insight]" on each line

Example format:
• Conversions up 40% week-over-week, momentum building
• CPA down to $14 (-25%)${hasBenchmarkData ? ', beating benchmark by 50%' : ''}
• GamerPro cooling off: 12 conv last week → 3 this week

Write ONLY the bullets, nothing else.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.text?.trim() || buildFallbackSummary(data, scoreResult, benchmarks);
  } catch (error) {
    console.error('AI summary error:', error);
    return buildFallbackSummary(data, scoreResult, benchmarks);
  }
}

function buildTrendsSection(historicalTrends) {
  if (!historicalTrends) return 'PERFORMANCE TRENDS:\nNo historical data available yet.';

  const { weekly, monthly, yearly, creatorMomentum } = historicalTrends;
  const lines = ['PERFORMANCE TRENDS:'];

  // Weekly trends
  if (weekly?.conversions) {
    const convDir = weekly.conversions.direction === 'up' ? '↑' : weekly.conversions.direction === 'down' ? '↓' : '→';
    const cpaDir = weekly.cpa?.direction === 'improving' ? '↓ (better)' : weekly.cpa?.direction === 'worsening' ? '↑ (worse)' : '→';
    lines.push(`Weekly (vs last week):`);
    lines.push(`  - Conversions: ${weekly.conversions.previous} → ${weekly.conversions.current} (${convDir} ${weekly.conversions.percent > 0 ? '+' : ''}${weekly.conversions.percent}%)`);
    if (weekly.cpa?.current !== null) {
      lines.push(`  - CPA: $${weekly.cpa.previous || 'N/A'} → $${weekly.cpa.current} (${cpaDir} ${weekly.cpa.percent > 0 ? '+' : ''}${weekly.cpa.percent}%)`);
    }
    if (weekly.views) {
      const viewsDir = weekly.views.direction === 'up' ? '↑' : weekly.views.direction === 'down' ? '↓' : '→';
      lines.push(`  - Views: ${viewsDir} ${weekly.views.percent > 0 ? '+' : ''}${weekly.views.percent}%`);
    }
  }

  // Monthly trends
  if (monthly?.conversions && (monthly.conversions.current > 0 || monthly.conversions.previous > 0)) {
    const convDir = monthly.conversions.direction === 'up' ? '↑' : monthly.conversions.direction === 'down' ? '↓' : '→';
    lines.push(`Monthly (vs last month):`);
    lines.push(`  - Conversions: ${convDir} ${monthly.conversions.percent > 0 ? '+' : ''}${monthly.conversions.percent}%`);
    if (monthly.cpa?.current !== null) {
      const cpaDir = monthly.cpa.direction === 'improving' ? '↓ (better)' : monthly.cpa.direction === 'worsening' ? '↑ (worse)' : '→';
      lines.push(`  - CPA: ${cpaDir} ${monthly.cpa.percent > 0 ? '+' : ''}${monthly.cpa.percent}%`);
    }
  }

  // Yearly trends
  if (yearly?.conversions && (yearly.conversions.current > 0 || yearly.conversions.previous > 0)) {
    const convDir = yearly.conversions.direction === 'up' ? '↑' : yearly.conversions.direction === 'down' ? '↓' : '→';
    lines.push(`Year-over-year:`);
    lines.push(`  - Conversions: ${convDir} ${yearly.conversions.percent > 0 ? '+' : ''}${yearly.conversions.percent}%`);
    if (yearly.cpa?.current !== null && yearly.cpa?.previous !== null) {
      const cpaDir = yearly.cpa.direction === 'improving' ? '↓ (better)' : yearly.cpa.direction === 'worsening' ? '↑ (worse)' : '→';
      lines.push(`  - CPA: ${cpaDir} ${yearly.cpa.percent > 0 ? '+' : ''}${yearly.cpa.percent}%`);
    }
  }

  // Creator momentum
  if (creatorMomentum) {
    if (creatorMomentum.rising?.length > 0) {
      lines.push(`\nCREATOR MOMENTUM - Rising:`);
      creatorMomentum.rising.slice(0, 3).forEach(c => {
        lines.push(`  - ${c.name}: ${c.lastWeek} → ${c.thisWeek} conv (+${c.change}%)`);
      });
    }
    if (creatorMomentum.cooling?.length > 0) {
      lines.push(`\nCREATOR MOMENTUM - Cooling off:`);
      creatorMomentum.cooling.slice(0, 3).forEach(c => {
        lines.push(`  - ${c.name}: ${c.lastWeek} → ${c.thisWeek} conv (${c.change}%)`);
      });
    }
    if (creatorMomentum.stalled?.length > 0) {
      lines.push(`\nCREATOR MOMENTUM - Stalled (no recent conversions):`);
      creatorMomentum.stalled.slice(0, 3).forEach(c => {
        lines.push(`  - ${c.name}: last conversion ${c.daysSinceConversion} days ago`);
      });
    }
  }

  return lines.join('\n');
}

function buildFallbackSummary(data, scoreResult, benchmarks) {
  const { totals, noContent, topPerformers, platforms } = data;
  const hasBenchmarkData = benchmarks?.sample_size > 0;
  const cpaBenchmark = hasBenchmarkData ? benchmarks.cpa_p50 : null;

  if (totals.totalConversions === 0 && totals.totalSpent > 0) {
    return `You've spent $${totals.totalSpent.toLocaleString()} but haven't gotten any conversions yet. ${noContent.length > 0 ? `${noContent.length} creators still haven't posted content.` : 'Check if your tracking is set up correctly.'}`;
  }

  if (totals.totalConversions > 0) {
    const cpa = Math.round(totals.totalSpent / totals.totalConversions);
    const bestPlatform = Object.entries(platforms)
      .filter(([_, s]) => s.conversions > 0)
      .sort((a, b) => b[1].conversions - a[1].conversions)[0];

    // Only include benchmark comparison if we have real data
    let cpaLine = `• $${cpa} CPA`;
    if (cpaBenchmark) {
      const vsBenchmark = cpa < cpaBenchmark ? `${Math.round((1 - cpa/cpaBenchmark) * 100)}% below benchmark` : `${Math.round((cpa/cpaBenchmark - 1) * 100)}% above benchmark`;
      cpaLine += ` - ${vsBenchmark}`;
    }

    return `${cpaLine}\n• ${totals.totalConversions} conversions from ${data.influencers.length} creators${bestPlatform ? `\n• ${bestPlatform[0]} is your best platform` : ''}`;
  }

  return `You're tracking ${data.influencers.length} creators across ${data.campaigns.length} campaigns with ${formatNumber(totals.totalViews)} total views.`;
}

async function generatePrompts(data, currentPage) {
  const { totals, noContent, noConversions, topPerformers, platforms, influencers, campaigns } = data;

  // Build context about user's data
  const cpa = totals.totalConversions > 0 ? (totals.totalSpent / totals.totalConversions).toFixed(2) : null;
  const hasConversions = totals.totalConversions > 0;
  const hasNoContent = noContent.length > 0;
  const hasUnderperformers = noConversions.length > 0;
  const topCreator = topPerformers[0]?.influencer || null;
  const platformList = Object.keys(platforms).join(', ');
  const bestPlatform = Object.entries(platforms)
    .filter(([_, s]) => s.conversions > 0)
    .sort((a, b) => (a[1].spent / a[1].conversions) - (b[1].spent / b[1].conversions))[0]?.[0] || null;

  // Determine page context
  let pageContext = 'dashboard';
  if (currentPage.includes('influencer')) pageContext = 'influencers list';
  else if (currentPage.includes('campaign')) pageContext = 'campaigns list';
  else if (currentPage.includes('deliverable')) pageContext = 'deliverables/content list';
  else if (currentPage.includes('postback')) pageContext = 'conversion tracking setup';
  else if (currentPage.includes('subscription')) pageContext = 'billing/subscription';
  else if (currentPage.includes('faq')) pageContext = 'FAQ/settings';

  const prompt = `Generate exactly 3 short questions a user would ask an AI assistant about their influencer marketing data.

USER'S CURRENT PAGE: ${pageContext}

USER'S DATA:
- ${influencers.length} creators across ${campaigns.length} campaigns
- $${totals.totalSpent.toLocaleString()} spent, ${totals.totalConversions} conversions
- CPA: ${cpa ? `$${cpa}` : 'no conversions yet'}
- Platforms: ${platformList || 'none'}
- Best platform: ${bestPlatform || 'N/A'}
- Top creator: ${topCreator || 'N/A'}
- ${noContent.length} creators haven't posted yet
- ${noConversions.length} creators have content but no conversions

RULES:
1. Questions must be relevant to the PAGE they're on
2. Questions should reference their ACTUAL data (names, numbers, platforms)
3. Each question under 10 words
4. No generic questions - be specific to their situation
5. Format: one question per line, no numbering or bullets

Examples for influencers page with TikTok data:
Why is [creator name] underperforming?
Should I book more TikTok creators?
Who has the best ROI?

Write 3 questions:`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text?.trim() || '';
    const prompts = text.split('\n').filter(line => line.trim() && !line.match(/^\d+[\.\)]/)).slice(0, 3);

    if (prompts.length >= 3) {
      return prompts;
    }
  } catch (error) {
    console.error('AI prompts error:', error);
  }

  // Fallback prompts based on data
  const fallback = [];
  if (hasNoContent) fallback.push(`Why haven't ${noContent.length} creators posted yet?`);
  if (!hasConversions && totals.totalSpent > 0) fallback.push('Why am I not getting conversions?');
  if (bestPlatform) fallback.push(`Should I invest more in ${bestPlatform}?`);
  if (topCreator) fallback.push(`Should I book more with ${topCreator}?`);
  fallback.push('What should I focus on today?');
  fallback.push('Which creators have the best ROI?');

  return fallback.slice(0, 3);
}
