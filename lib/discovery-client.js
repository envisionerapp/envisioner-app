// Discovery Client for Envisioner
// Connects Envisioner to Envisioner Discovery service for influencer discovery

const DISCOVERY_API_BASE = process.env.DISCOVERY_API_URL || 'http://localhost:5001';

/**
 * Search for creators in the Discovery database
 */
export async function searchDiscoveryCreators(params) {
  const {
    platforms,
    regions,
    tags,
    minFollowers,
    maxFollowers,
    minViewers,
    isLive,
    language,
    minIgamingScore,
    hasPerformanceData,
    limit = 20,
    offset = 0
  } = params;

  const response = await fetch(`${DISCOVERY_API_BASE}/api/discovery/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platforms,
      regions,
      tags,
      minFollowers,
      maxFollowers,
      minViewers,
      isLive,
      language,
      minIgamingScore,
      hasPerformanceData,
      limit,
      offset
    })
  });

  if (!response.ok) {
    throw new Error(`Discovery search failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get AI-powered creator recommendations
 */
export async function getDiscoveryRecommendations(criteria) {
  const { campaignType, budget, targetRegion, preferPlatform } = criteria;

  const response = await fetch(`${DISCOVERY_API_BASE}/api/discovery/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaignType,
      budget,
      targetRegion,
      preferPlatform
    })
  });

  if (!response.ok) {
    throw new Error(`Discovery recommendations failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get detailed creator info
 */
export async function getDiscoveryCreator(creatorId) {
  const response = await fetch(`${DISCOVERY_API_BASE}/api/discovery/creator/${creatorId}`);

  if (!response.ok) {
    throw new Error(`Discovery creator fetch failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get currently live creators
 */
export async function getLiveCreators(params = {}) {
  const { platform, region, limit = 20 } = params;
  const queryParams = new URLSearchParams();
  if (platform) queryParams.set('platform', platform);
  if (region) queryParams.set('region', region);
  if (limit) queryParams.set('limit', limit.toString());

  const response = await fetch(`${DISCOVERY_API_BASE}/api/discovery/live?${queryParams}`);

  if (!response.ok) {
    throw new Error(`Discovery live fetch failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get Discovery database statistics
 */
export async function getDiscoveryStats() {
  const response = await fetch(`${DISCOVERY_API_BASE}/api/discovery/stats`);

  if (!response.ok) {
    throw new Error(`Discovery stats fetch failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Sync performance data back to Discovery
 */
export async function syncPerformanceToDiscovery(data) {
  const {
    discoveryCreatorId,
    envisionerInfluencerId,
    envisionerCampaignId,
    conversions,
    spent,
    cpa,
    roi,
    campaignStatus
  } = data;

  const response = await fetch(`${DISCOVERY_API_BASE}/api/performance-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      discoveryCreatorId,
      envisionerInfluencerId,
      envisionerCampaignId,
      conversions,
      spent,
      cpa,
      roi,
      campaignStatus
    })
  });

  if (!response.ok) {
    throw new Error(`Performance sync failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Bulk sync performance data
 */
export async function bulkSyncPerformanceToDiscovery(updates) {
  const response = await fetch(`${DISCOVERY_API_BASE}/api/performance-sync/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates })
  });

  if (!response.ok) {
    throw new Error(`Bulk performance sync failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Generate discovery action card for the briefing
 */
export async function generateDiscoveryAction(userData) {
  try {
    // Get discovery stats
    const stats = await getDiscoveryStats();

    // Check if there are interesting discoveries to suggest
    if (stats.data.liveNow > 0) {
      // Get live creators that might be relevant
      const liveData = await getLiveCreators({ limit: 5 });

      if (liveData.data.live.length > 0) {
        const topLive = liveData.data.live[0];
        return {
          id: 'discovery_live_creators',
          type: 'discovery',
          priority: 'low',
          icon: 'discover',
          title: `${liveData.data.count} creators are live now`,
          description: `Top: ${topLive.displayName} with ${topLive.currentViewers?.toLocaleString() || 'N/A'} viewers. Explore new talent for your campaigns.`,
          options: [
            {
              label: 'Browse live',
              action: 'navigate',
              variant: 'primary',
              params: { url: '/discovery?filter=live' }
            },
            {
              label: 'Dismiss',
              action: 'dismiss',
              variant: 'ghost',
              params: { action_id: 'discovery_live_creators' }
            }
          ]
        };
      }
    }

    // If no live, suggest based on top performers
    if (stats.data.performance.creatorsWithData > 0) {
      return {
        id: 'discovery_proven_creators',
        type: 'discovery',
        priority: 'low',
        icon: 'discover',
        title: 'Proven creators available',
        description: `${stats.data.performance.creatorsWithData} creators with performance data. Avg CPA: $${stats.data.performance.avgCpa?.toFixed(2) || 'N/A'}`,
        options: [
          {
            label: 'View creators',
            action: 'navigate',
            variant: 'primary',
            params: { url: '/discovery?filter=proven' }
          },
          {
            label: 'Dismiss',
            action: 'dismiss',
            variant: 'ghost',
            params: { action_id: 'discovery_proven_creators' }
          }
        ]
      };
    }

    return null;
  } catch (error) {
    console.error('Error generating discovery action:', error);
    return null;
  }
}

/**
 * Generate discovery suggestions for AI prompt
 */
export function getDiscoverySuggestions() {
  return [
    'Find creators similar to my top performers',
    'Show me live streamers right now',
    'Discover new iGaming creators',
    'Who are the top performers in Brazil?'
  ];
}
