import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureBenchmarkTables, refreshBenchmarks, getBenchmarks } from '@/lib/benchmarks';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// GET: Retrieve benchmarks OR refresh if called by Vercel cron
// Protected - only internal calls allowed
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform');
  const tier = searchParams.get('tier');

  // Check if this is a Vercel cron call
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  // Check for internal API calls (from briefing route on same origin)
  const isInternal = request.headers.get('x-internal-request') === process.env.INTERNAL_SECRET;

  // Block external access (only cron and internal allowed)
  if (!isVercelCron && !isInternal) {
    return NextResponse.json(
      { success: false, error: 'Not authorized' },
      { status: 403, headers: corsHeaders }
    );
  }

  try {
    const sql = getDb();
    await ensureBenchmarkTables(sql);

    // If cron job, refresh benchmarks first
    if (isVercelCron) {
      console.log('Cron: Refreshing benchmarks...');
      await refreshBenchmarks(sql);
      console.log('Cron: Benchmarks refreshed');
    }

    const benchmarks = await getBenchmarks(sql, platform, tier);

    return NextResponse.json({
      success: true,
      benchmarks,
      context: {
        platform: platform || 'all',
        tier: tier || 'all',
        refreshed: isVercelCron,
      }
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Benchmark error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

// POST: Manual refresh (requires auth)
export async function POST(request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const sql = getDb();
    await ensureBenchmarkTables(sql);
    await refreshBenchmarks(sql);

    const benchmarks = await getBenchmarks(sql);

    return NextResponse.json({
      success: true,
      message: 'Benchmarks refreshed successfully',
      benchmarks,
      refreshed_at: new Date().toISOString(),
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Benchmark refresh error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
