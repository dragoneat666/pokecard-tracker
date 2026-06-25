// utils/rateLimiter.js
//
// Hard caps for third-party APIs with billing attached but no built-in
// limit controls (e.g. RapidAPI). Two layers of protection:
//   1. Daily cap — persisted in DB, survives restarts, resets at midnight
//   2. Per-minute cap — in-memory sliding window, resets naturally
//
// Both are HARD stops: if either limit would be exceeded, the call is
// refused entirely rather than attempted.

import { query } from '../db.js';

const DAILY_LIMIT = 90;
const PER_MINUTE_LIMIT = 25;

// In-memory sliding window of call timestamps (ms) per API name
const recentCalls = new Map(); // api_name -> array of timestamps

export async function checkAndRecordApiCall(apiName) {
  // ── Per-minute check ────────────────────────────────────────────────────
  const now = Date.now();
  const windowStart = now - 60_000;
  const calls = (recentCalls.get(apiName) || []).filter(t => t > windowStart);

  if (calls.length >= PER_MINUTE_LIMIT) {
    throw new Error(`Rate limit: ${apiName} has hit ${PER_MINUTE_LIMIT} calls in the last minute. Try again shortly.`);
  }

  // ── Daily check ──────────────────────────────────────────────────────────
  const { rows } = await query(
    `SELECT call_count FROM api_usage_log WHERE api_name = $1 AND call_date = CURRENT_DATE`,
    [apiName]
  );
  const todayCount = rows[0]?.call_count || 0;

  if (todayCount >= DAILY_LIMIT) {
    throw new Error(`Rate limit: ${apiName} has hit its daily limit of ${DAILY_LIMIT} calls. Try again tomorrow.`);
  }

  // ── Record this call (both layers) ─────────────────────────────────────
  calls.push(now);
  recentCalls.set(apiName, calls);

  await query(`
    INSERT INTO api_usage_log (api_name, call_date, call_count)
    VALUES ($1, CURRENT_DATE, 1)
    ON CONFLICT (api_name, call_date) DO UPDATE SET call_count = api_usage_log.call_count + 1
  `, [apiName]);

  return { dailyCount: todayCount + 1, dailyLimit: DAILY_LIMIT, minuteCount: calls.length, minuteLimit: PER_MINUTE_LIMIT };
}

export async function getApiUsageToday(apiName) {
  const { rows } = await query(
    `SELECT call_count FROM api_usage_log WHERE api_name = $1 AND call_date = CURRENT_DATE`,
    [apiName]
  );
  return { used: rows[0]?.call_count || 0, limit: DAILY_LIMIT };
}