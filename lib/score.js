// Calculate overall health score (0-100) using dynamic benchmarks

export function calculateScore(data, benchmarks = null) {
  const { totals, noContent, noConversions, platforms, influencers } = data;

  // No data = neutral score
  if (influencers.length === 0) {
    return { score: 50, issues: [], breakdown: {}, benchmarkComparison: null };
  }

  // Check if we have real benchmark data
  const hasBenchmarkData = benchmarks?.sample_size > 0;

  // Use dynamic thresholds from benchmarks, or defaults
  const thresholds = hasBenchmarkData ? getDynamicThresholds(benchmarks) : getDefaultThresholds();

  let score = 100;
  const issues = [];
  const insights = [];

  // Calculate user metrics
  const cpa = totals.totalConversions > 0 ? totals.totalSpent / totals.totalConversions : null;
  const contentDeliveryRate = influencers.length > 0
    ? ((influencers.length - noContent.length) / influencers.length) * 100
    : 100;
  const viewsPerDollar = totals.totalSpent > 0 ? totals.totalViews / totals.totalSpent : 0;

  // 1. CPA Performance (max -30 points)
  if (cpa !== null && totals.totalSpent > 500) {
    if (cpa > thresholds.cpaCritical) {
      score -= 30;
      issues.push(hasBenchmarkData
        ? `CPA ($${cpa.toFixed(2)}) is 2x above benchmark ($${thresholds.cpaGood})`
        : `CPA ($${cpa.toFixed(2)}) is very high`);
    } else if (cpa > thresholds.cpaConcern) {
      score -= 20;
      issues.push(hasBenchmarkData
        ? `CPA ($${cpa.toFixed(2)}) above 75th percentile benchmark`
        : `CPA ($${cpa.toFixed(2)}) is high`);
    } else if (cpa > thresholds.cpaGood) {
      score -= 10;
      issues.push(`CPA ($${cpa.toFixed(2)}) could be improved`);
    } else if (cpa <= thresholds.cpaExcellent) {
      insights.push(hasBenchmarkData ? `Excellent CPA - top 25% performance` : `Strong CPA performance`);
    }
  } else if (totals.totalSpent > 500 && totals.totalConversions === 0) {
    score -= 30;
    issues.push('No conversions despite significant spend');
  }

  // 2. Content Delivery (max -25 points)
  if (noContent.length > 0) {
    if (contentDeliveryRate < thresholds.contentDeliveryPoor) {
      score -= 25;
      issues.push(`Only ${contentDeliveryRate.toFixed(0)}% of creators delivered content`);
    } else if (contentDeliveryRate < thresholds.contentDeliveryGood) {
      const penalty = Math.min(15, Math.round((thresholds.contentDeliveryGood - contentDeliveryRate) / 2));
      score -= penalty;
      issues.push(`${noContent.length} creators haven't delivered yet`);
    }
  }

  // 3. Spend Efficiency (max -20 points)
  const wastedSpend = noConversions.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const wasteRatio = totals.totalSpent > 0 ? wastedSpend / totals.totalSpent : 0;

  if (wasteRatio > 0.5) {
    score -= 20;
    issues.push('More than half of spend has zero conversions');
  } else if (wasteRatio > 0.3) {
    score -= 15;
    issues.push('Significant spend with no conversions');
  } else if (wasteRatio > 0.1) {
    score -= 10;
  }

  // 4. Platform Diversification (max -15 points)
  const platformCount = Object.keys(platforms).length;
  const convertingPlatforms = Object.values(platforms).filter(p => p.conversions > 0).length;

  if (platformCount > 1 && convertingPlatforms === 1) {
    score -= 10;
    issues.push('Only one platform is converting');
  } else if (platformCount > 2 && convertingPlatforms === 0) {
    score -= 15;
    issues.push('No platforms are converting');
  }

  // 5. Activity (max -10 points)
  if (influencers.length < 3 && totals.campaigns > 0) {
    score -= 5;
    issues.push('Few creators tracked');
  }

  // Ensure score is between 0 and 100
  score = Math.max(0, Math.min(100, score));

  // Build benchmark comparison object
  const benchmarkComparison = benchmarks ? {
    cpa: cpa !== null ? {
      value: cpa,
      benchmark: benchmarks.cpa_p50,
      percentile: cpa <= benchmarks.cpa_p25 ? 'top25'
        : cpa <= benchmarks.cpa_p50 ? 'top50'
        : cpa <= benchmarks.cpa_p75 ? 'bottom50'
        : 'bottom25',
      rating: cpa <= benchmarks.cpa_p50 ? 'good' : cpa <= benchmarks.cpa_p75 ? 'average' : 'poor'
    } : null,
    contentDelivery: {
      value: contentDeliveryRate,
      benchmark: benchmarks.content_delivery_rate_p50 || 80,
      rating: contentDeliveryRate >= (benchmarks.content_delivery_rate_p50 || 80) ? 'good' : 'below'
    },
    viewsPerDollar: viewsPerDollar > 0 ? {
      value: viewsPerDollar,
      benchmark: benchmarks.views_per_dollar_p50,
      rating: viewsPerDollar >= (benchmarks.views_per_dollar_p50 || 200) ? 'good' : 'below'
    } : null,
    sampleSize: benchmarks.sample_size || 0
  } : null;

  return {
    score,
    issues,
    insights,
    breakdown: {
      cpa: cpa?.toFixed(2) || null,
      cpaBenchmark: thresholds.cpaGood,
      contentDeliveryRate: contentDeliveryRate.toFixed(0),
      contentDeliveryBenchmark: thresholds.contentDeliveryGood,
      wasteRatio: (wasteRatio * 100).toFixed(0),
      convertingPlatforms,
      totalPlatforms: platformCount,
      viewsPerDollar: viewsPerDollar.toFixed(0),
    },
    benchmarkComparison,
    thresholds
  };
}

// Dynamic thresholds from aggregate benchmarks
function getDynamicThresholds(benchmarks) {
  return {
    // CPA thresholds from percentiles
    cpaExcellent: Number(benchmarks.cpa_p25) || 15,
    cpaGood: Number(benchmarks.cpa_p50) || 30,
    cpaConcern: Number(benchmarks.cpa_p75) || 60,
    cpaCritical: (Number(benchmarks.cpa_p50) || 30) * 2,

    // Content delivery from benchmark
    contentDeliveryGood: Number(benchmarks.content_delivery_rate_p50) || 80,
    contentDeliveryPoor: (Number(benchmarks.content_delivery_rate_p50) || 80) * 0.6,

    // Days to flag no content
    contentDeadlineDays: Math.ceil((100 - (Number(benchmarks.content_delivery_rate_p50) || 80)) / 10) + 7,

    // Views efficiency
    viewsPerDollarGood: Number(benchmarks.views_per_dollar_p50) || 200,
  };
}

// Fallback thresholds when no benchmark data
function getDefaultThresholds() {
  return {
    cpaExcellent: 15,
    cpaGood: 30,
    cpaConcern: 60,
    cpaCritical: 60,
    contentDeliveryGood: 80,
    contentDeliveryPoor: 50,
    contentDeadlineDays: 7,
    viewsPerDollarGood: 200,
  };
}

export function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}
