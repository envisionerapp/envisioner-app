import { NextResponse } from 'next/server';
import { getDb, ensureBriefingsTable, saveBriefing, getUserData } from '@/lib/db';
import { calculateScore, formatNumber } from '@/lib/score';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// This endpoint is called by the cron job to pre-generate briefings
export async function GET(request) {
  // Verify cron secret (optional security)
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sql = getDb();
    await ensureBriefingsTable(sql);

    // Get all users with activity
    const users = await sql`
      SELECT DISTINCT user_id FROM influencers
      WHERE user_id IS NOT NULL
    `;

    const results = [];

    for (const row of users) {
      try {
        const briefing = await generateBriefing(sql, row.user_id);
        await saveBriefing(sql, row.user_id, briefing);
        results.push({ user: row.user_id, success: true });
      } catch (err) {
        console.error(`Failed to generate briefing for ${row.user_id}:`, err);
        results.push({ user: row.user_id, success: false, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      generated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });

  } catch (error) {
    console.error('Generate error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function generateBriefing(sql, userId) {
  const data = await getUserData(sql, userId);
  const { user, totals, noContent, noConversions, topPerformers, platforms, influencers } = data;

  const scoreResult = calculateScore(data);
  const score = scoreResult.score;

  const metrics = [
    { label: 'Spent', value: `$${totals.totalSpent.toLocaleString()}` },
    { label: 'Conversions', value: totals.totalConversions.toString() },
    { label: 'Views', value: formatNumber(totals.totalViews) },
  ];

  if (influencers.length === 0) {
    return {
      score: 50,
      summary: `Welcome to Envisioner. Add your first creator to start tracking performance.`,
      metrics: [
        { label: 'Creators', value: '0' },
        { label: 'Campaigns', value: '0' },
        { label: 'Spent', value: '$0' },
      ],
      actions: [
        { text: 'Add your first creator', reason: 'Start tracking performance', button: 'Add creator' },
      ],
    };
  }

  const summary = await generateSummary(data, scoreResult);
  const actions = buildActions(data);

  return {
    score,
    summary,
    metrics,
    actions,
  };
}

async function generateSummary(data, scoreResult) {
  const { user, totals, noContent, topPerformers, platforms } = data;
  const name = user?.name?.split(' ')[0] || 'there';

  const platformSummary = Object.entries(platforms)
    .map(([p, s]) => `${p}: $${s.spent}, ${s.conversions} conv`)
    .join('; ');

  const prompt = `Write a 2-3 sentence briefing for ${name} about their influencer marketing.

DATA:
- Spent: $${totals.totalSpent.toLocaleString()}
- Conversions: ${totals.totalConversions}
- Views: ${formatNumber(totals.totalViews)}
- Score: ${scoreResult.score}/100
- No content yet: ${noContent.length} creators
- Top performer: ${topPerformers[0]?.influencer || 'none'}
- Platforms: ${platformSummary}

Be direct and specific. Focus on the most important issue or win. 2-3 sentences max.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0]?.text?.trim() || buildFallbackSummary(data);
  } catch {
    return buildFallbackSummary(data);
  }
}

function buildFallbackSummary(data) {
  const { totals, noContent } = data;
  if (totals.totalConversions > 0) {
    const cpa = Math.round(totals.totalSpent / totals.totalConversions);
    return `${totals.totalConversions} conversions at $${cpa} CPA. ${noContent.length > 0 ? `${noContent.length} creators haven't posted yet.` : ''}`;
  }
  return `$${totals.totalSpent.toLocaleString()} spent across ${data.influencers.length} creators. ${noContent.length > 0 ? `${noContent.length} still need to post.` : ''}`;
}

function buildActions(data) {
  const { noContent, platforms, totals, noConversions } = data;
  const actions = [];

  if (noContent.length > 0) {
    actions.push({
      text: `Get content from ${noContent[0].influencer}`,
      reason: `$${noContent[0].price} paid, no posts`,
      button: 'Remind',
    });
  }

  const winning = Object.entries(platforms)
    .filter(([_, s]) => s.conversions > 0)
    .sort((a, b) => b[1].conversions - a[1].conversions)[0];

  if (winning) {
    actions.push({
      text: `Find more ${winning[0]} creators`,
      reason: 'Your best platform',
      button: 'Find',
    });
  }

  if (noConversions.length > 0 && actions.length < 3) {
    actions.push({
      text: 'Review underperformers',
      reason: `${noConversions.length} with no conversions`,
      button: 'Review',
    });
  }

  return actions.slice(0, 3);
}
