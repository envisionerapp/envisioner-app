import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  ensureDiscoveryColumns,
  getUserDiscoveryPreferences,
  getUserAccessLevel,
  getAccessCapabilities,
  getUserPerformanceHistory,
  getSimilarCreatorCriteria,
} from '@/lib/discovery-db';
import {
  getDiscoveryStats,
  getLiveCreators,
  searchDiscoveryCreators,
  getDiscoveryRecommendations,
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

    // Analyze question intent and fetch relevant data
    const questionData = await fetchRelevantData(question, preferences, capabilities);

    // Generate AI answer
    const answer = await generateDiscoveryAnswer({
      question,
      context,
      preferences,
      capabilities,
      performanceHistory,
      questionData,
    });

    // Include search results if relevant
    const response = {
      success: true,
      answer,
    };

    // Add creator results for certain queries
    if (questionData.creators && questionData.creators.length > 0) {
      response.creators = questionData.creators.slice(0, capabilities.searchLimit);
    }

    if (questionData.liveCreators && questionData.liveCreators.length > 0) {
      response.liveCreators = questionData.liveCreators;
    }

    return NextResponse.json(response, { headers: corsHeaders });

  } catch (error) {
    console.error('[Discovery Ask] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function fetchRelevantData(question, preferences, capabilities) {
  const lowerQ = question.toLowerCase();
  const data = {
    creators: [],
    liveCreators: [],
    stats: null,
    searchPerformed: false,
  };

  try {
    // Check for live-related queries
    if (lowerQ.includes('live') || lowerQ.includes('streaming') || lowerQ.includes('now')) {
      const liveData = await getLiveCreators({
        platform: extractPlatform(question) || preferences.platforms?.[0],
        limit: 10,
      });
      data.liveCreators = liveData?.data?.live || [];
      data.searchPerformed = true;
    }

    // Check for search queries
    if (
      lowerQ.includes('find') ||
      lowerQ.includes('search') ||
      lowerQ.includes('show') ||
      lowerQ.includes('recommend') ||
      lowerQ.includes('similar') ||
      lowerQ.includes('best') ||
      lowerQ.includes('top') ||
      lowerQ.includes('who')
    ) {
      const searchParams = buildSearchParams(question, preferences);

      if (capabilities.canViewPerformance && lowerQ.includes('proven')) {
        searchParams.hasPerformanceData = true;
      }

      const searchResults = await searchDiscoveryCreators({
        ...searchParams,
        limit: capabilities.searchLimit,
      });
      data.creators = searchResults?.data?.creators || [];
      data.searchPerformed = true;
    }

    // Get general stats for context
    const stats = await getDiscoveryStats();
    data.stats = stats?.data || null;

  } catch (e) {
    console.error('[Discovery Ask] Data fetch error:', e.message);
  }

  return data;
}

function extractPlatform(question) {
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes('youtube')) return 'YouTube';
  if (lowerQ.includes('tiktok')) return 'TikTok';
  if (lowerQ.includes('twitch')) return 'Twitch';
  if (lowerQ.includes('kick')) return 'Kick';
  if (lowerQ.includes('instagram')) return 'Instagram';
  return null;
}

function extractRegion(question) {
  const lowerQ = question.toLowerCase();
  const regions = {
    'brazil': 'BR', 'brasil': 'BR',
    'latam': 'LATAM', 'latin america': 'LATAM',
    'mexico': 'MX', 'méxico': 'MX',
    'spain': 'ES', 'españa': 'ES',
    'portugal': 'PT',
    'argentina': 'AR',
    'chile': 'CL',
    'colombia': 'CO',
    'peru': 'PE',
    'usa': 'US', 'united states': 'US',
    'canada': 'CA',
    'uk': 'GB', 'united kingdom': 'GB',
    'germany': 'DE',
    'france': 'FR',
  };

  for (const [name, code] of Object.entries(regions)) {
    if (lowerQ.includes(name)) return code;
  }
  return null;
}

function buildSearchParams(question, preferences) {
  const params = {};

  // Extract platform from question or use preferences
  const platform = extractPlatform(question);
  if (platform) {
    params.platforms = [platform];
  } else if (preferences.platforms?.length > 0) {
    params.platforms = preferences.platforms;
  }

  // Extract region
  const region = extractRegion(question);
  if (region) {
    params.regions = [region];
  } else if (preferences.regions?.length > 0) {
    params.regions = preferences.regions;
  }

  // Extract follower/viewer criteria from question
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes('big') || lowerQ.includes('large') || lowerQ.includes('major')) {
    params.minFollowers = 100000;
  } else if (lowerQ.includes('small') || lowerQ.includes('micro') || lowerQ.includes('nano')) {
    params.maxFollowers = 50000;
  }

  // Check for iGaming context
  if (lowerQ.includes('igaming') || lowerQ.includes('gambling') || lowerQ.includes('casino') || lowerQ.includes('betting')) {
    params.minIgamingScore = 50;
  }

  return params;
}

async function generateDiscoveryAnswer(data) {
  const {
    question,
    context,
    preferences,
    capabilities,
    performanceHistory,
    questionData,
  } = data;

  // Build creator context from search results
  let creatorsContext = '';
  if (questionData.creators.length > 0) {
    creatorsContext = `\nSEARCH RESULTS (${questionData.creators.length} creators):\n` +
      questionData.creators.slice(0, 10).map((c, i) => {
        const perf = c.performanceData
          ? `CPA: $${c.performanceData.avgCpa?.toFixed(2) || 'N/A'}, ${c.performanceData.totalCampaigns || 0} campaigns`
          : 'No performance data';
        return `${i + 1}. ${c.displayName || c.name} (${c.platform}): ${c.followers?.toLocaleString() || 'N/A'} followers, ${perf}`;
      }).join('\n');
  }

  let liveContext = '';
  if (questionData.liveCreators.length > 0) {
    liveContext = `\nLIVE NOW (${questionData.liveCreators.length} streaming):\n` +
      questionData.liveCreators.slice(0, 5).map((c, i) => {
        return `${i + 1}. ${c.displayName || c.name} (${c.platform}): ${c.currentViewers?.toLocaleString() || 'N/A'} viewers, ${c.category || 'Unknown category'}`;
      }).join('\n');
  }

  // Top performers context
  let topPerformersContext = '';
  if (performanceHistory.topPerformers.length > 0) {
    topPerformersContext = `\nUSER'S TOP PERFORMERS:\n` +
      performanceHistory.topPerformers.slice(0, 5).map((p, i) => {
        return `${i + 1}. ${p.name} (${p.platform}): ${p.conversions} conv, $${p.cpa?.toFixed(2) || 'N/A'} CPA`;
      }).join('\n');
  }

  // Performance patterns
  let patternsContext = '';
  if (performanceHistory.patterns) {
    const p = performanceHistory.patterns;
    patternsContext = `\nUSER'S SUCCESS PATTERNS:
- Best platform: ${p.bestPlatform || 'Unknown'}
- Avg CPA on top performers: $${p.avgCpa || 'N/A'}
- Avg spend per top performer: $${p.avgSpendOnTopPerformers || 'N/A'}`;
  }

  const prompt = `You are an AI discovery assistant for influencer marketing. Help users find and evaluate creators based on their performance data and preferences.

USER ACCESS: ${capabilities.aiRecommendations === 'full' ? 'Pro (can see performance data)' : 'Basic (limited features)'}

USER PREFERENCES:
- Preferred platforms: ${preferences.platforms?.join(', ') || 'All'}
- Target regions: ${preferences.regions?.join(', ') || 'Global'}
- Target CPA: ${preferences.targetCpa ? `$${preferences.targetCpa}` : 'Not set'}
- Monthly budget: ${preferences.monthlyBudget ? `$${preferences.monthlyBudget}` : 'Not set'}
${topPerformersContext}
${patternsContext}

DISCOVERY DATABASE:
- Total creators: ${questionData.stats?.totalCreators?.toLocaleString() || '50,000+'}
- Currently live: ${questionData.stats?.liveNow || 0}
- With performance data: ${questionData.stats?.performance?.creatorsWithData || 0}
${creatorsContext}
${liveContext}

NAVIGATION LINKS (use when relevant):
- [Discovery](https://app.envisioner.io/discovery): Browse all creators
- [Live Creators](https://app.envisioner.io/discovery?filter=live): See who's streaming now
- [Proven Creators](https://app.envisioner.io/discovery?filter=proven): Creators with verified performance
- [Settings](https://app.envisioner.io/settings/discovery): Update discovery preferences

---

QUESTION: ${question}

GUIDELINES:
- Reference specific creators from search results when available
- Compare with user's top performers when relevant ("Similar to [name] who got $X CPA for you")
- Include performance data if user has Pro access
- Be specific: mention names, CPAs, follower counts
- Link to relevant pages
- 2-4 sentences, be direct and actionable
- If suggesting creators, explain WHY they match

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
