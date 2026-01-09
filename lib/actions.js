// Action Detection Engine for Envisioner AI
// Detects actionable situations from user data and generates recommendations with alternatives
// Uses aggregate benchmarks to contextualize performance

export function detectActions(data, benchmarks = null) {
  const { noContent, noConversions, topPerformers, platforms, totals, influencers, campaigns } = data;
  const actions = [];

  // Debug logging
  console.log(`[Actions] Detecting actions - influencers: ${influencers?.length || 0}, campaigns: ${campaigns?.length || 0}, noContent: ${noContent?.length || 0}, noConversions: ${noConversions?.length || 0}`);

  // Check if we have real benchmark data
  const hasBenchmarkData = benchmarks?.sample_size > 0;

  // Get dynamic thresholds from benchmarks (only if we have real data)
  const thresholds = hasBenchmarkData ? {
    cpaGood: Number(benchmarks.cpa_p50),
    cpaConcern: Number(benchmarks.cpa_p75),
    contentDeliveryGood: Number(benchmarks.content_delivery_rate_p50) || 80,
  } : {
    cpaGood: null,
    cpaConcern: null,
    contentDeliveryGood: 80,
  };

  // Priority 1: Creators who haven't posted (highest urgency - money at risk)
  if (noContent.length > 0) {
    const creator = noContent[0];
    const daysSincePaid = creator.created_at
      ? Math.floor((Date.now() - new Date(creator.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    actions.push({
      id: `no_content_${creator.id}`,
      type: 'no_content',
      priority: 'high',
      icon: 'alert',
      title: `${creator.influencer} hasn't posted`,
      description: `$${Number(creator.price || 0).toLocaleString()} paid${daysSincePaid ? `, ${daysSincePaid} days ago` : ''}. No content delivered yet.`,
      options: [
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: `no_content_${creator.id}` }
        }
      ]
    });
  }

  // Priority 2: Scale winning platform (with benchmark context if available)
  const platformsByEfficiency = Object.entries(platforms)
    .filter(([_, s]) => s.conversions > 0 && s.spent > 0)
    .map(([name, stats]) => ({
      name,
      ...stats,
      cpa: stats.spent / stats.conversions
    }))
    .sort((a, b) => a.cpa - b.cpa);

  if (platformsByEfficiency.length > 0) {
    const best = platformsByEfficiency[0];
    const creatorCount = best.count;

    // Add benchmark context only if we have real data
    const cpaBenchmarkContext = (hasBenchmarkData && thresholds.cpaGood && best.cpa < thresholds.cpaGood)
      ? ` (${Math.round((1 - best.cpa / thresholds.cpaGood) * 100)}% below benchmark)`
      : '';

    actions.push({
      id: `scale_platform_${best.name.toLowerCase()}`,
      type: 'scale_platform',
      priority: 'medium',
      icon: 'trending',
      title: `${best.name} is your best platform`,
      description: `$${best.cpa.toFixed(2)} CPA${cpaBenchmarkContext} with ${best.conversions} conversions from ${creatorCount} creator${creatorCount !== 1 ? 's' : ''}.`,
      options: [
        {
          label: 'View creators',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/influencers' }
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: `scale_platform_${best.name.toLowerCase()}` }
        }
      ]
    });
  }

  // Priority 3: Underperformers (has content, no conversions) - flag immediately for quick pivots
  const significantUnderperformers = noConversions.filter(i => Number(i.price) >= 500);
  if (significantUnderperformers.length > 0) {
    const totalAtRisk = significantUnderperformers.reduce((sum, i) => sum + Number(i.price || 0), 0);

    actions.push({
      id: 'review_underperformers',
      type: 'underperformers',
      priority: 'high',
      icon: 'warning',
      title: `${significantUnderperformers.length} creator${significantUnderperformers.length !== 1 ? 's' : ''} with no conversions`,
      description: `$${totalAtRisk.toLocaleString()} at risk. Content is live but zero conversions.`,
      options: [
        {
          label: 'Review list',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/influencers' }
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'review_underperformers' }
        }
      ]
    });
  }

  // Priority 4: High CPA alert (only show if we have benchmark data to compare against)
  if (hasBenchmarkData && thresholds.cpaConcern) {
    const highCpaPlatforms = Object.entries(platforms)
      .filter(([_, s]) => s.conversions > 0 && s.spent > 0)
      .map(([name, stats]) => ({
        name,
        ...stats,
        cpa: stats.spent / stats.conversions
      }))
      .filter(p => p.cpa > thresholds.cpaConcern)
      .sort((a, b) => b.cpa - a.cpa);

    if (highCpaPlatforms.length > 0 && !actions.find(a => a.type === 'underperformers')) {
      const worst = highCpaPlatforms[0];
      const overBenchmark = Math.round(((worst.cpa - thresholds.cpaGood) / thresholds.cpaGood) * 100);

      actions.push({
        id: `high_cpa_${worst.name.toLowerCase()}`,
        type: 'high_cpa',
        priority: 'medium',
        icon: 'warning',
        title: `${worst.name} CPA is ${overBenchmark}% above benchmark`,
        description: `$${worst.cpa.toFixed(2)} CPA vs $${thresholds.cpaGood} benchmark. Consider optimization or reallocation.`,
        options: [
          {
            label: 'Review creators',
            action: 'navigate',
            variant: 'primary',
            params: { url: 'https://app.envisioner.io/influencers' }
          },
          {
            label: 'Dismiss',
            action: 'dismiss',
            variant: 'ghost',
            params: { action_id: `high_cpa_${worst.name.toLowerCase()}` }
          }
        ]
      });
    }
  }

  // Priority 5: Double down on top performers
  if (topPerformers.length > 0) {
    const top = topPerformers[0];
    const topCpa = Number(top.price) > 0 && Number(top.total_conversions) > 0
      ? (Number(top.price) / Number(top.total_conversions)).toFixed(2)
      : null;

    // Add benchmark context for top performer only if we have real data
    const performanceContext = (hasBenchmarkData && topCpa && thresholds.cpaGood && Number(topCpa) < thresholds.cpaGood)
      ? ` at $${topCpa} CPA (top 50% performance)`
      : (topCpa ? ` at $${topCpa} CPA` : '');

    actions.push({
      id: `top_performer_${top.id}`,
      type: 'top_performer',
      priority: 'low',
      icon: 'star',
      title: `${top.influencer} is crushing it`,
      description: `${top.total_conversions} conversions${performanceContext}. Consider expanding partnership.`,
      options: [
        {
          label: 'View profile',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/influencers' }
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: `top_performer_${top.id}` }
        }
      ]
    });
  }

  // Priority 6: Empty state - encourage adding creators
  if (influencers.length === 0) {
    actions.push({
      id: 'onboarding_add_creator',
      type: 'onboarding',
      priority: 'high',
      icon: 'plus',
      title: 'Add your first creator',
      description: 'Start tracking influencer performance and get AI insights.',
      options: [
        {
          label: 'Add creator',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/page-to-add-influencer' }
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'onboarding_add_creator' }
        }
      ]
    });
  }

  // Priority 7: No campaigns
  if (campaigns.length === 0 && influencers.length > 0) {
    actions.push({
      id: 'onboarding_add_campaign',
      type: 'onboarding',
      priority: 'medium',
      icon: 'folder',
      title: 'Organize with campaigns',
      description: `You have ${influencers.length} creator${influencers.length !== 1 ? 's' : ''} but no campaigns. Group them by client or project.`,
      options: [
        {
          label: 'Create campaign',
          action: 'navigate',
          variant: 'primary',
          params: { url: 'https://app.envisioner.io/create-campaign' }
        },
        {
          label: 'Dismiss',
          action: 'dismiss',
          variant: 'ghost',
          params: { action_id: 'onboarding_add_campaign' }
        }
      ]
    });
  }

  // Sort by priority and return top 3
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return actions
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 3);
}

// Generate action-specific messages for AI responses
export function getActionMessage(action, result) {
  const messages = {
    send_reminder: (params, result) =>
      `I've drafted a reminder for ${params.influencer_name}. ${result.template ? 'Here\'s a suggested message you can customize.' : 'Ready to send when you are.'}`,

    extend_deadline: (params, result) =>
      `Extended the deadline for ${params.influencer_name} by ${params.days} days. New deadline: ${result.new_deadline || 'TBD'}.`,

    schedule_call: (params, result) =>
      `Opening your calendar to schedule a call with ${params.influencer_name}.`,

    find_similar: (params, result) =>
      `Found ${result.count || 'several'} creators similar to your top ${params.platform} performers.`,

    navigate: (params) =>
      `Taking you to ${params.url}${params.filter ? ` (filtered by ${params.filter})` : ''}.`,

    dismiss: () =>
      `Got it, I won't show this recommendation again.`,

    book_content: (params) =>
      `Let's book more content with ${params.influencer_name}. Opening the deliverables form.`,

    bulk_reminder: (params) =>
      `Sending reminders to ${params.influencer_ids.length} creator${params.influencer_ids.length !== 1 ? 's' : ''}.`,

    default: () =>
      `Action completed successfully.`
  };

  const handler = messages[action] || messages.default;
  return handler(result?.params || {}, result || {});
}
