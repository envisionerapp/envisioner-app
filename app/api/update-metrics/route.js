import { getDb, ensureUserMetricsColumns, updateUserMetrics, updateAllUserMetrics } from '@/lib/db';

export async function POST(request) {
  try {
    const sql = getDb();
    const { userId } = await request.json().catch(() => ({}));

    // Ensure the columns exist
    await ensureUserMetricsColumns(sql);

    if (userId) {
      // Update specific user
      await updateUserMetrics(sql, userId);
      return Response.json({
        success: true,
        message: `Metrics updated for user: ${userId}`
      });
    } else {
      // Update all users
      const count = await updateAllUserMetrics(sql);
      return Response.json({
        success: true,
        message: `Metrics updated for ${count} users`
      });
    }
  } catch (error) {
    console.error('[API] Update metrics error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sql = getDb();

    // Ensure the columns exist
    await ensureUserMetricsColumns(sql);

    // Update all users
    const count = await updateAllUserMetrics(sql);

    return Response.json({
      success: true,
      message: `Metrics updated for ${count} users`
    });
  } catch (error) {
    console.error('[API] Update metrics error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
