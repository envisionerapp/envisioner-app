import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user');

  try {
    const sql = getDb();

    // Check what user_ids exist in influencers
    const sampleInfluencers = await sql`
      SELECT DISTINCT user_id, COUNT(*) as count
      FROM influencers
      GROUP BY user_id
      LIMIT 10
    `;

    // Check users table to resolve user_id
    let resolvedUser = null;
    if (userId) {
      const users = await sql`
        SELECT user_id, email, name FROM users
        WHERE email = ${userId} OR user_id = ${userId}
        LIMIT 1
      `;
      resolvedUser = users[0] || null;
    }

    const resolvedUserId = resolvedUser?.user_id || resolvedUser?.email || userId;

    // Check if this specific user has any (try both original and resolved)
    const userInfluencers = userId ? await sql`
      SELECT id, influencer, user_id
      FROM influencers
      WHERE user_id = ${userId} OR user_id = ${resolvedUserId}
      LIMIT 10
    ` : [];

    return NextResponse.json({
      queried_user_id: userId,
      resolved_user: resolvedUser,
      resolved_user_id: resolvedUserId,
      user_influencers_count: userInfluencers.length,
      user_influencers: userInfluencers,
      all_user_ids_sample: sampleInfluencers,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
