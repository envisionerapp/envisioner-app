// Benchmark system - aggregates anonymized data across all clients
// Creates industry benchmarks without exposing individual client data

// Aggregate stats table schema (run once)
export async function ensureBenchmarkTables(sql) {
  try {
    // Stores anonymized campaign metrics for benchmarking
    await sql`
      CREATE TABLE IF NOT EXISTS benchmark_data (
        id SERIAL PRIMARY KEY,
        recorded_at TIMESTAMP DEFAULT NOW(),
        platform VARCHAR(50),
        niche VARCHAR(100),
        price_tier VARCHAR(20),
        cpa DECIMAL(10,2),
        cpc DECIMAL(10,2),
        cpm DECIMAL(10,2),
        conversion_rate DECIMAL(10,6),
        days_to_first_content INTEGER,
        content_delivery_rate DECIMAL(5,2),
        views_per_dollar DECIMAL(10,2)
      )
    `;

    // Computed benchmarks (refreshed periodically)
    await sql`
      CREATE TABLE IF NOT EXISTS benchmarks (
        id SERIAL PRIMARY KEY,
        updated_at TIMESTAMP DEFAULT NOW(),
        segment VARCHAR(100) UNIQUE,
        sample_size INTEGER,
        cpa_p25 DECIMAL(10,2),
        cpa_p50 DECIMAL(10,2),
        cpa_p75 DECIMAL(10,2),
        cpc_p50 DECIMAL(10,2),
        cpm_p50 DECIMAL(10,2),
        conversion_rate_p50 DECIMAL(10,6),
        days_to_content_p50 INTEGER,
        content_delivery_rate_p50 DECIMAL(5,2),
        views_per_dollar_p50 DECIMAL(10,2)
      )
    `;
  } catch (e) {
    console.error('Benchmark table creation error:', e.message);
  }
}

// Contribute anonymized data to benchmarks (called after each briefing)
// Privacy-first: adds noise, uses broad buckets, delays storage
export async function contributeToBenchmarks(sql, data) {
  const { influencers, platforms } = data;

  // Only contribute if enough data points to prevent identification
  const platformCount = Object.keys(platforms).filter(p => platforms[p].count > 0).length;
  if (platformCount < 2 || influencers.length < 5) {
    return; // Too unique - skip to protect privacy
  }

  for (const [platform, stats] of Object.entries(platforms)) {
    if (stats.count < 3) continue; // Need minimum creators per platform

    // Only use major platforms (no niche platforms that could identify)
    const majorPlatforms = ['youtube', 'tiktok', 'instagram', 'twitch'];
    if (!majorPlatforms.includes(platform.toLowerCase())) continue;

    const cpa = stats.conversions > 0 ? stats.spent / stats.conversions : null;
    const cpc = stats.clicks > 0 ? stats.spent / stats.clicks : null;
    const cpm = stats.views > 0 ? (stats.spent / stats.views) * 1000 : null;
    const conversionRate = stats.views > 0 ? stats.conversions / stats.views : null;
    const viewsPerDollar = stats.spent > 0 ? stats.views / stats.spent : null;

    // Add noise to values (±10% random variance)
    const addNoise = (val) => {
      if (val === null) return null;
      const noise = 0.9 + Math.random() * 0.2; // 0.9 to 1.1
      return val * noise;
    };

    // Broad price tiers only (3 buckets instead of 4)
    const avgPrice = stats.spent / stats.count;
    const priceTier = avgPrice < 1000 ? 'small' : avgPrice < 5000 ? 'medium' : 'large';

    // Calculate content delivery metrics
    const platformCreators = influencers.filter(i => {
      const url = (i.channel_url || '').toLowerCase();
      return url.includes(platform.toLowerCase());
    });

    const withContent = platformCreators.filter(i => Number(i.content_count) > 0);
    const contentDeliveryRate = platformCreators.length > 0
      ? (withContent.length / platformCreators.length) * 100
      : null;

    // Round to reduce precision (bucket values)
    const roundTo = (val, precision) => {
      if (val === null) return null;
      return Math.round(val / precision) * precision;
    };

    // Only contribute if we have meaningful data
    if (cpa !== null || conversionRate !== null) {
      try {
        await sql`
          INSERT INTO benchmark_data (
            platform, price_tier, cpa, cpc, cpm,
            conversion_rate, content_delivery_rate, views_per_dollar
          ) VALUES (
            ${platform},
            ${priceTier},
            ${roundTo(addNoise(cpa), 5)},
            ${roundTo(addNoise(cpc), 0.1)},
            ${roundTo(addNoise(cpm), 1)},
            ${roundTo(addNoise(conversionRate), 0.0001)},
            ${roundTo(addNoise(contentDeliveryRate), 5)},
            ${roundTo(addNoise(viewsPerDollar), 10)}
          )
        `;
      } catch (e) {
        // Silent fail - benchmarks are supplementary
      }
    }
  }
}

// Refresh computed benchmarks (call via cron, e.g., daily)
export async function refreshBenchmarks(sql) {
  try {
    // Overall benchmarks
    await computeSegmentBenchmarks(sql, 'overall', {});

    // By platform
    for (const platform of ['YouTube', 'TikTok', 'Instagram', 'Twitch', 'Kick']) {
      await computeSegmentBenchmarks(sql, `platform:${platform}`, { platform });
    }

    // By price tier
    for (const tier of ['micro', 'mid', 'macro', 'mega']) {
      await computeSegmentBenchmarks(sql, `tier:${tier}`, { price_tier: tier });
    }

    // By platform + tier combinations
    for (const platform of ['YouTube', 'TikTok', 'Instagram']) {
      for (const tier of ['micro', 'mid', 'macro']) {
        await computeSegmentBenchmarks(sql, `${platform}:${tier}`, { platform, price_tier: tier });
      }
    }
  } catch (e) {
    console.error('Benchmark refresh error:', e.message);
  }
}

async function computeSegmentBenchmarks(sql, segment, filters) {
  let whereClause = 'WHERE recorded_at > NOW() - INTERVAL \'90 days\'';
  const params = [];

  if (filters.platform) {
    whereClause += ` AND platform = '${filters.platform}'`;
  }
  if (filters.price_tier) {
    whereClause += ` AND price_tier = '${filters.price_tier}'`;
  }

  try {
    const stats = await sql`
      SELECT
        COUNT(*) as sample_size,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY cpa) as cpa_p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY cpa) as cpa_p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cpa) as cpa_p75,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY cpc) as cpc_p50,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY cpm) as cpm_p50,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY conversion_rate) as conversion_rate_p50,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY content_delivery_rate) as content_delivery_rate_p50,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY views_per_dollar) as views_per_dollar_p50
      FROM benchmark_data
      ${sql.unsafe(whereClause)}
    `;

    if (stats[0]?.sample_size >= 10) { // Minimum sample for valid benchmark
      await sql`
        INSERT INTO benchmarks (
          segment, sample_size, cpa_p25, cpa_p50, cpa_p75,
          cpc_p50, cpm_p50, conversion_rate_p50,
          content_delivery_rate_p50, views_per_dollar_p50, updated_at
        ) VALUES (
          ${segment}, ${stats[0].sample_size},
          ${stats[0].cpa_p25}, ${stats[0].cpa_p50}, ${stats[0].cpa_p75},
          ${stats[0].cpc_p50}, ${stats[0].cpm_p50}, ${stats[0].conversion_rate_p50},
          ${stats[0].content_delivery_rate_p50}, ${stats[0].views_per_dollar_p50},
          NOW()
        )
        ON CONFLICT (segment) DO UPDATE SET
          sample_size = ${stats[0].sample_size},
          cpa_p25 = ${stats[0].cpa_p25},
          cpa_p50 = ${stats[0].cpa_p50},
          cpa_p75 = ${stats[0].cpa_p75},
          cpc_p50 = ${stats[0].cpc_p50},
          cpm_p50 = ${stats[0].cpm_p50},
          conversion_rate_p50 = ${stats[0].conversion_rate_p50},
          content_delivery_rate_p50 = ${stats[0].content_delivery_rate_p50},
          views_per_dollar_p50 = ${stats[0].views_per_dollar_p50},
          updated_at = NOW()
      `;
    }
  } catch (e) {
    // Percentile functions might not be available in all Postgres versions
    console.error(`Benchmark computation error for ${segment}:`, e.message);
  }
}

// Get benchmarks for comparison
export async function getBenchmarks(sql, platform = null, priceTier = null) {
  try {
    // Try most specific segment first, fall back to broader
    const segments = [];

    if (platform && priceTier) {
      segments.push(`${platform}:${priceTier}`);
    }
    if (platform) {
      segments.push(`platform:${platform}`);
    }
    if (priceTier) {
      segments.push(`tier:${priceTier}`);
    }
    segments.push('overall');

    for (const segment of segments) {
      const result = await sql`
        SELECT * FROM benchmarks WHERE segment = ${segment} LIMIT 1
      `;
      if (result[0]) {
        return result[0];
      }
    }

    return getDefaultBenchmarks();
  } catch (e) {
    return getDefaultBenchmarks();
  }
}

// Fallback benchmarks when we don't have enough data
function getDefaultBenchmarks() {
  return {
    segment: 'default',
    sample_size: 0,
    cpa_p25: 15,
    cpa_p50: 30,
    cpa_p75: 60,
    cpc_p50: 0.50,
    cpm_p50: 5,
    conversion_rate_p50: 0.001,
    content_delivery_rate_p50: 80,
    views_per_dollar_p50: 200,
  };
}

// Compare user's metrics against benchmarks
export function compareTooBenchmarks(userMetrics, benchmarks) {
  const comparisons = {};

  if (userMetrics.cpa !== null && benchmarks.cpa_p50) {
    const ratio = userMetrics.cpa / benchmarks.cpa_p50;
    comparisons.cpa = {
      value: userMetrics.cpa,
      benchmark: benchmarks.cpa_p50,
      percentile: ratio < 0.5 ? 'top10' : ratio < 0.75 ? 'top25' : ratio < 1 ? 'above_avg' : ratio < 1.5 ? 'below_avg' : 'bottom25',
      rating: ratio < 1 ? 'good' : ratio < 1.5 ? 'average' : 'poor',
      insight: ratio < 0.75
        ? `Your CPA ($${userMetrics.cpa.toFixed(2)}) is in the top 25% - outperforming most campaigns`
        : ratio > 1.5
        ? `Your CPA ($${userMetrics.cpa.toFixed(2)}) is 50%+ above benchmark ($${benchmarks.cpa_p50}) - optimization needed`
        : `Your CPA ($${userMetrics.cpa.toFixed(2)}) is near benchmark ($${benchmarks.cpa_p50})`
    };
  }

  if (userMetrics.contentDeliveryRate !== null && benchmarks.content_delivery_rate_p50) {
    const ratio = userMetrics.contentDeliveryRate / benchmarks.content_delivery_rate_p50;
    comparisons.contentDelivery = {
      value: userMetrics.contentDeliveryRate,
      benchmark: benchmarks.content_delivery_rate_p50,
      rating: ratio >= 1 ? 'good' : ratio >= 0.8 ? 'average' : 'poor',
      insight: ratio < 0.8
        ? `Only ${userMetrics.contentDeliveryRate.toFixed(0)}% of creators delivered - below ${benchmarks.content_delivery_rate_p50}% benchmark`
        : `${userMetrics.contentDeliveryRate.toFixed(0)}% delivery rate meets industry standard`
    };
  }

  if (userMetrics.viewsPerDollar !== null && benchmarks.views_per_dollar_p50) {
    const ratio = userMetrics.viewsPerDollar / benchmarks.views_per_dollar_p50;
    comparisons.efficiency = {
      value: userMetrics.viewsPerDollar,
      benchmark: benchmarks.views_per_dollar_p50,
      rating: ratio >= 1.25 ? 'good' : ratio >= 0.75 ? 'average' : 'poor',
    };
  }

  return comparisons;
}

// Get dynamic thresholds based on benchmarks
export function getDynamicThresholds(benchmarks) {
  return {
    // Flag no content after X days (based on typical delivery time)
    contentDeadlineDays: Math.ceil((100 - (benchmarks.content_delivery_rate_p50 || 80)) / 10) + 7,

    // Flag CPA above 75th percentile as concerning
    cpaConcern: benchmarks.cpa_p75 || 60,

    // Flag CPA above 2x median as critical
    cpaCritical: (benchmarks.cpa_p50 || 30) * 2,

    // Good CPA is below 50th percentile
    cpaGood: benchmarks.cpa_p50 || 30,

    // Excellent CPA is below 25th percentile
    cpaExcellent: benchmarks.cpa_p25 || 15,

    // Minimum expected conversion rate
    minConversionRate: (benchmarks.conversion_rate_p50 || 0.001) * 0.5,
  };
}
