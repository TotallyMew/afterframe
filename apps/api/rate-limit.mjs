/** @type {Map<string, { count: number; resetAt: number }>} */
const buckets = new Map();
const MAX_KEYS = 10_000;

function evictExpiredOrOldest(now) {
  if (buckets.size < MAX_KEYS) return;
  for (const [entryKey, entry] of buckets) {
    if (now >= entry.resetAt) buckets.delete(entryKey);
  }
  if (buckets.size >= MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
}

/**
 * @param {string} scope
 * @param {string} clientIp
 * @param {{ limit: number; windowMs: number }} policy
 * @param {number} [now]
 * @returns {{ allowed: boolean; remaining: number; retryAfterSeconds: number }}
 */
export function checkRateLimit(scope, clientIp, policy, now = Date.now()) {
  if (process.env.AFTERFRAME_RATE_LIMIT === 'off') {
    return { allowed: true, remaining: policy.limit, retryAfterSeconds: 0 };
  }
  const key = `${scope}:${clientIp || 'unknown'}`;
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    evictExpiredOrOldest(now);
    buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
    return { allowed: true, remaining: Math.max(0, policy.limit - 1), retryAfterSeconds: 0 };
  }
  if (existing.count >= policy.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  existing.count += 1;
  return { allowed: true, remaining: Math.max(0, policy.limit - existing.count), retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
