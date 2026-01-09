import { NextResponse } from 'next/server';
import { getDb, getUserData } from '@/lib/db';
import { getActionMessage } from '@/lib/actions';
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
    const { user, action, params } = await request.json();

    if (!user || !action) {
      return NextResponse.json(
        { success: false, error: 'User and action required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const sql = getDb();
    const result = await executeAction(sql, user, action, params);

    return NextResponse.json({
      success: true,
      action,
      result,
      message: getActionMessage(action, { params, ...result }),
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Action error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function executeAction(sql, userId, action, params) {
  switch (action) {
    case 'send_reminder':
      return await generateReminder(sql, userId, params);

    case 'extend_deadline':
      return await extendDeadline(sql, params);

    case 'schedule_call':
      return {
        type: 'calendar',
        url: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Call%20with%20${encodeURIComponent(params.influencer_name)}&details=Follow%20up%20on%20content%20delivery`,
      };

    case 'find_similar':
      return await findSimilarCreators(sql, userId, params);

    case 'find_similar_creator':
      return await findSimilarToCreator(sql, userId, params);

    case 'book_content':
      return {
        type: 'navigate',
        url: `/deliverables?influencer=${params.influencer_id}&action=add`,
      };

    case 'navigate':
      return {
        type: 'navigate',
        url: params.url,
        filter: params.filter || null,
      };

    case 'dismiss':
      return await dismissAction(sql, userId, params);

    case 'bulk_reminder':
      return await sendBulkReminders(sql, userId, params);

    case 'pause_underperformers':
      return {
        type: 'confirmation',
        message: `Pausing ${params.influencer_ids.length} underperforming creators. They won't appear in active lists.`,
        requiresConfirmation: true,
      };

    case 'increase_budget':
      return {
        type: 'suggestion',
        message: `Consider allocating 20-30% more budget to ${params.platform}. Based on current CPA, this could yield significant additional conversions.`,
      };

    case 'auto_organize':
      return await suggestCampaignOrganization(sql, userId);

    case 'import_csv':
      return {
        type: 'navigate',
        url: '/influencers?action=import',
      };

    case 'help':
      return {
        type: 'help',
        topic: params.topic,
        content: getHelpContent(params.topic),
      };

    default:
      return { type: 'unknown', message: 'Action not recognized' };
  }
}

// Generate personalized reminder message
async function generateReminder(sql, userId, params) {
  const data = await getUserData(sql, userId);
  const creator = data.influencers.find(i => i.id === params.influencer_id);

  if (!creator) {
    return { type: 'error', message: 'Creator not found' };
  }

  const daysSincePaid = creator.created_at
    ? Math.floor((Date.now() - new Date(creator.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 'a few';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Write a brief, friendly but professional reminder message to an influencer named ${creator.influencer} who was paid $${creator.price} ${daysSincePaid} days ago but hasn't delivered their content yet.

Keep it:
- Professional but warm
- Direct about the ask (content delivery)
- Under 100 words
- No subject line, just the message body

Message:`
      }],
    });

    return {
      type: 'reminder',
      template: response.content[0]?.text?.trim(),
      creator: {
        name: creator.influencer,
        price: creator.price,
        channel: creator.channel_url,
      },
    };
  } catch (error) {
    return {
      type: 'reminder',
      template: `Hi ${creator.influencer},\n\nHope you're doing well! Just checking in on the content we discussed. We paid $${creator.price} and are excited to see what you create.\n\nCould you share an update on the timeline? Let us know if you need anything from our side.\n\nThanks!`,
      creator: {
        name: creator.influencer,
        price: creator.price,
      },
    };
  }
}

// Extend deadline for a creator
async function extendDeadline(sql, params) {
  const newDeadline = new Date();
  newDeadline.setDate(newDeadline.getDate() + (params.days || 7));

  // In a real implementation, this would update the database
  return {
    type: 'deadline_extended',
    influencer_id: params.influencer_id,
    new_deadline: newDeadline.toISOString().split('T')[0],
    days_extended: params.days || 7,
  };
}

// Find similar creators based on platform
async function findSimilarCreators(sql, userId, params) {
  const data = await getUserData(sql, userId);

  // Get top performers from this platform
  const platformCreators = data.influencers
    .filter(i => {
      const url = (i.channel_url || '').toLowerCase();
      return url.includes(params.platform.toLowerCase());
    })
    .sort((a, b) => (b.total_conversions || 0) - (a.total_conversions || 0));

  const topPerformer = platformCreators[0];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Based on this top-performing ${params.platform} creator profile:
Name: ${topPerformer?.influencer || 'N/A'}
Conversions: ${topPerformer?.total_conversions || 0}
Views: ${topPerformer?.total_views || 0}
Price: $${topPerformer?.price || 0}

Suggest 3 types of similar creators to look for on ${params.platform}. For each:
- Niche/category
- Follower range to target
- Content style that converts

Format as brief bullet points.`
      }],
    });

    return {
      type: 'recommendations',
      platform: params.platform,
      suggestions: response.content[0]?.text?.trim(),
      reference_creator: topPerformer?.influencer,
    };
  } catch (error) {
    return {
      type: 'recommendations',
      platform: params.platform,
      suggestions: `Look for ${params.platform} creators with:\n- Similar audience demographics to your top performers\n- Engagement rates above 3%\n- Content style that matches your brand`,
    };
  }
}

// Find creators similar to a specific one
async function findSimilarToCreator(sql, userId, params) {
  const data = await getUserData(sql, userId);
  const creator = data.influencers.find(i => i.id === params.influencer_id);

  if (!creator) {
    return { type: 'error', message: 'Creator not found' };
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `This influencer is performing exceptionally well:
Name: ${creator.influencer}
Platform: ${creator.channel_url || 'Unknown'}
Conversions: ${creator.total_conversions}
Views: ${creator.total_views}
Price: $${creator.price}

Suggest how to find 3 similar creators. Include:
- What makes this creator effective (hypothesis)
- Search criteria for finding similar creators
- Platforms/tools to use

Brief bullet points.`
      }],
    });

    return {
      type: 'similar_creator_search',
      original: creator.influencer,
      suggestions: response.content[0]?.text?.trim(),
    };
  } catch (error) {
    return {
      type: 'similar_creator_search',
      original: creator.influencer,
      suggestions: `To find creators similar to ${creator.influencer}:\n- Search same platform with similar follower count\n- Look for overlapping audience interests\n- Check creator marketplaces filtered by niche`,
    };
  }
}

// Dismiss an action (store in user preferences)
async function dismissAction(sql, userId, params) {
  // In a real implementation, this would store dismissed actions in the database
  // For now, we'll return success and rely on frontend to handle
  return {
    type: 'dismissed',
    action_id: params.action_id,
  };
}

// Send bulk reminders
async function sendBulkReminders(sql, userId, params) {
  const count = params.influencer_ids?.length || 0;

  return {
    type: 'bulk_action',
    count,
    message: `Ready to send reminders to ${count} creator${count !== 1 ? 's' : ''}. Would you like to customize the message or use the default template?`,
  };
}

// Suggest campaign organization
async function suggestCampaignOrganization(sql, userId) {
  const data = await getUserData(sql, userId);

  // Group influencers by platform
  const byPlatform = {};
  data.influencers.forEach(i => {
    const url = (i.channel_url || '').toLowerCase();
    let platform = 'Other';
    if (url.includes('youtube')) platform = 'YouTube';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';
    else if (url.includes('twitch')) platform = 'Twitch';

    if (!byPlatform[platform]) byPlatform[platform] = [];
    byPlatform[platform].push(i);
  });

  const suggestions = Object.entries(byPlatform)
    .filter(([_, creators]) => creators.length > 0)
    .map(([platform, creators]) => ({
      name: `${platform} Campaign`,
      count: creators.length,
      creators: creators.map(c => c.influencer),
    }));

  return {
    type: 'organization_suggestions',
    suggestions,
    message: `I can organize your ${data.influencers.length} creators into ${suggestions.length} campaigns by platform. Want me to create these?`,
  };
}

// Help content
function getHelpContent(topic) {
  const content = {
    getting_started: `
**Getting Started with Envisioner**

1. **Add Creators**: Go to Influencers and add your first creator with their channel URL and deal terms.

2. **Track Deliverables**: When creators post, add their content as deliverables to track views and performance.

3. **Log Conversions**: Connect your tracking to log conversions attributed to each creator.

4. **Get Insights**: Check your AI briefing daily for personalized recommendations.
    `,
    default: 'Visit our help center for more information.',
  };

  return content[topic] || content.default;
}
