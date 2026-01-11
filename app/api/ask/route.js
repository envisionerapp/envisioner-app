import { NextResponse } from 'next/server';
import { getDb, getUserData, getDiscoverySuggestions, getDiscoveryStats } from '@/lib/db';
import { formatNumber } from '@/lib/score';
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

export async function POST(request) {
  try {
    const { user, question, context } = await request.json();

    if (!user || !question) {
      return NextResponse.json({ success: false, error: 'User and question required' }, { status: 400, headers: corsHeaders });
    }

    const sql = getDb();
    const data = await getUserData(sql, user);

    // Get discovery data for questions about new influencers
    const userPlatforms = Object.keys(data.platforms || {});
    const discoverySuggestions = await getDiscoverySuggestions(userPlatforms, [], [], 10);
    const discoveryStats = await getDiscoveryStats();

    const answer = await generateAnswer(data, question, context, discoverySuggestions, discoveryStats);

    return NextResponse.json({
      success: true,
      answer,
      discoverySuggestions: discoverySuggestions.slice(0, 3),
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Ask error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

async function generateAnswer(data, question, context, discoverySuggestions = [], discoveryStats = null) {
  const { user, campaigns, influencers, totals, platforms, noContent, noConversions, topPerformers, historicalTrends } = data;

  // Calculate advanced metrics
  const cpa = totals.totalConversions > 0 ? (totals.totalSpent / totals.totalConversions).toFixed(2) : null;
  const conversionRate = totals.totalViews > 0 ? ((totals.totalConversions / totals.totalViews) * 100).toFixed(3) : null;
  const wastedSpend = noConversions.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const pendingSpend = noContent.reduce((sum, i) => sum + (Number(i.price) || 0), 0);

  // Build creator list with efficiency metrics
  const influencerList = influencers.slice(0, 15).map(i => {
    const platform = getPlatform(i.channel_url);
    const creatorCPA = i.total_conversions > 0 ? `$${(i.price / i.total_conversions).toFixed(2)} CPA` : 'no conversions';
    return `${i.influencer} (${platform}): $${i.price || 0} spent, ${i.total_conversions || 0} conv, ${formatNumber(i.total_views || 0)} views, ${creatorCPA}`;
  }).join('\n');

  const campaignList = campaigns.map(c =>
    `${c.campaign_name} (${c.client}): ${c.influencer_count || 0} creators`
  ).join('\n');

  // Platform analysis with CPA
  const platformList = Object.entries(platforms).map(([p, s]) => {
    const platformCPA = s.conversions > 0 ? `$${(s.spent / s.conversions).toFixed(2)} CPA` : 'no conversions';
    return `${p}: ${s.count} creators, $${s.spent} spent, ${s.conversions} conv, ${platformCPA}`;
  }).join('\n');

  // Find best platform
  const bestPlatform = Object.entries(platforms)
    .filter(([_, s]) => s.conversions > 0)
    .sort((a, b) => (a[1].spent / a[1].conversions) - (b[1].spent / b[1].conversions))[0];

  // Build trends context
  const trendsContext = buildTrendsContext(historicalTrends);

  const prompt = `You are Envisioner, a senior influencer marketing strategist. Answer questions with data-driven insights and trend analysis, not generic advice.

CLIENT: ${user?.name || 'User'}

CURRENT PERFORMANCE:
- Total invested: $${totals.totalSpent.toLocaleString()}
- Total conversions: ${totals.totalConversions}
- Overall CPA: ${cpa ? `$${cpa}` : 'No conversions yet'}
- Conversion rate: ${conversionRate ? `${conversionRate}%` : 'N/A'}
- Views: ${formatNumber(totals.totalViews)}

${trendsContext}

MONEY STATUS:
- Working capital: $${(totals.totalSpent - wastedSpend - pendingSpend).toLocaleString()} (generating conversions)
- At risk (no content): $${pendingSpend.toLocaleString()} across ${noContent.length} creators
- Underperforming (no conversions): $${wastedSpend.toLocaleString()} across ${noConversions.length} creators

CAMPAIGNS:
${campaignList || 'None'}

CREATORS (with efficiency):
${influencerList || 'None'}

PLATFORMS (with CPA):
${platformList || 'None'}
Best performing: ${bestPlatform ? `${bestPlatform[0]} at $${(bestPlatform[1].spent / bestPlatform[1].conversions).toFixed(2)} CPA` : 'N/A'}

PROBLEMS:
- No content yet: ${noContent.map(i => `${i.influencer} ($${i.price})`).join(', ') || 'none'}
- No conversions: ${noConversions.length} creators

TOP PERFORMERS:
${topPerformers.slice(0, 5).map(i => `${i.influencer}: ${i.total_conversions} conversions`).join(', ') || 'None'}

USER CONTEXT:
${context ? `- Currently on: ${context.currentPage || 'Unknown'}
- Viewing: ${context.viewing || 'Nothing specific'}
- Recent pages: ${context.recentPages?.join(' → ') || 'None'}` : 'No context'}

PAGES (link when relevant):
- [Influencers](https://app.envisioner.io/influencers): View and manage creators
- [Campaigns](https://app.envisioner.io/campaigns): Organize creators by client/project
- [Deliverables](https://app.envisioner.io/deliverables): Track content posts
- [Discovery](https://app.envisioner.io/discovery): Find new influencers to work with
- [Conversions Setup](https://app.envisioner.io/postbacks): Setup manual conversion tracking and postbacks
- [Subscription](https://app.envisioner.io/subscription): Billing and plan management
- [FAQ](https://app.envisioner.io/faq): FAQs and account settings (change name, recover password)

${discoverySuggestions.length > 0 ? `
DISCOVERY DATABASE (${discoveryStats?.total_creators?.toLocaleString() || 'thousands of'} verified creators available):
Available influencers matching your profile:
${discoverySuggestions.slice(0, 5).map(s =>
  `- ${s.displayName} (${s.platform}): ${formatNumber(s.followers)} followers, ${s.avgViewers ? formatNumber(s.avgViewers) + ' avg viewers, ' : ''}${s.engagementRate ? s.engagementRate.toFixed(1) + '% engagement' : ''}${s.gamblingCompatible ? ', iGaming compatible' : ''}${s.historicalCpa ? `, historical $${s.historicalCpa} CPA` : ''}`
).join('\n')}
Link: [Explore Discovery](https://app.envisioner.io/discovery)
` : ''}
---

QUESTION: ${question}

Think about what the data AND TRENDS reveal, then answer with:
- Specific numbers and names from the data
- Trend context when relevant (e.g., "up 40% this week", "cooling off")
- Strategic insight (not obvious observations)
- If they're viewing something specific, reference it
- If asking about NEW creators/influencers, suggest from the Discovery database with names
- Link to relevant page if helpful
- 2-4 sentences max

Answer:`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.text?.trim() || "I couldn't process that question. Try asking differently.";
  } catch (error) {
    console.error('AI answer error:', error);
    return "Sorry, I couldn't process that question right now.";
  }
}

function getPlatform(url) {
  if (!url) return 'Other';
  url = url.toLowerCase();
  if (url.includes('youtube')) return 'YouTube';
  if (url.includes('tiktok')) return 'TikTok';
  if (url.includes('instagram')) return 'Instagram';
  if (url.includes('twitch')) return 'Twitch';
  if (url.includes('kick')) return 'Kick';
  return 'Other';
}

function buildTrendsContext(historicalTrends) {
  if (!historicalTrends) return 'TRENDS: No historical data available yet.';

  const { weekly, monthly, yearly, creatorMomentum } = historicalTrends;
  const lines = ['PERFORMANCE TRENDS:'];

  // Weekly
  if (weekly?.conversions) {
    const convTrend = weekly.conversions.direction === 'up' ? `+${weekly.conversions.percent}%` :
                      weekly.conversions.direction === 'down' ? `${weekly.conversions.percent}%` : 'flat';
    const cpaTrend = weekly.cpa?.direction === 'improving' ? `${weekly.cpa.percent}% (improving)` :
                     weekly.cpa?.direction === 'worsening' ? `+${weekly.cpa.percent}% (worsening)` : 'stable';
    lines.push(`Week-over-week: Conversions ${convTrend}, CPA ${weekly.cpa?.current ? `$${weekly.cpa.current}` : 'N/A'} (${cpaTrend})`);
  }

  // Monthly
  if (monthly?.conversions && (monthly.conversions.current > 0 || monthly.conversions.previous > 0)) {
    const convTrend = monthly.conversions.direction === 'up' ? `+${monthly.conversions.percent}%` :
                      monthly.conversions.direction === 'down' ? `${monthly.conversions.percent}%` : 'flat';
    lines.push(`Month-over-month: Conversions ${convTrend}`);
  }

  // Yearly
  if (yearly?.conversions && (yearly.conversions.current > 0 || yearly.conversions.previous > 0)) {
    const convTrend = yearly.conversions.direction === 'up' ? `+${yearly.conversions.percent}%` :
                      yearly.conversions.direction === 'down' ? `${yearly.conversions.percent}%` : 'flat';
    lines.push(`Year-over-year: Conversions ${convTrend}`);
  }

  // Creator momentum
  if (creatorMomentum) {
    if (creatorMomentum.rising?.length > 0) {
      const risingNames = creatorMomentum.rising.slice(0, 3).map(c => `${c.name} (+${c.change}%)`).join(', ');
      lines.push(`Rising creators: ${risingNames}`);
    }
    if (creatorMomentum.cooling?.length > 0) {
      const coolingNames = creatorMomentum.cooling.slice(0, 3).map(c => `${c.name} (${c.change}%)`).join(', ');
      lines.push(`Cooling off: ${coolingNames}`);
    }
    if (creatorMomentum.stalled?.length > 0) {
      const stalledNames = creatorMomentum.stalled.slice(0, 3).map(c => `${c.name} (${c.daysSinceConversion}d since last conv)`).join(', ');
      lines.push(`Stalled: ${stalledNames}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : 'TRENDS: Insufficient historical data';
}
