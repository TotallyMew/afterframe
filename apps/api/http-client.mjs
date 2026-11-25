const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** @type {Map<string, { failures: number; openUntil: number }>} */
const circuits = new Map();

/**
 * @param {string | null} header
 * @returns {number | null}
 */
function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5000, Math.round(seconds * 1000));
  const dateMs = Date.parse(header) - Date.now();
  return Number.isFinite(dateMs) && dateMs > 0 ? Math.min(5000, dateMs) : null;
}

/**
 * @param {string | URL} url
 * @param {RequestInit} [init]
 * @param {{
 *   timeoutMs?: number;
 *   retries?: number;
 *   baseDelayMs?: number;
 *   hostKey?: string;
 *   circuitThreshold?: number;
 *   circuitCooldownMs?: number;
 * }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    timeoutMs = 10_000,
    retries = 1,
    baseDelayMs = 250,
    hostKey,
    circuitThreshold = 4,
    circuitCooldownMs = 60_000,
  } = options;

  if (hostKey) {
    const state = circuits.get(hostKey);
    if (state && Date.now() < state.openUntil) {
      throw Object.assign(new Error(`${hostKey} is temporarily unavailable.`), { circuitOpen: true });
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    try {
      const response = await fetch(url, { ...init, signal });
      if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
        const delay = parseRetryAfter(response.headers.get('retry-after')) ?? Math.round(baseDelayMs * (2 ** attempt) + Math.random() * 120);
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (hostKey) {
        if (response.ok || response.status < 500) {
          circuits.delete(hostKey);
        } else {
          recordFailure(hostKey, circuitThreshold, circuitCooldownMs);
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (attempt < retries) {
        const delay = Math.round(baseDelayMs * (2 ** attempt) + Math.random() * 120);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (hostKey) recordFailure(hostKey, circuitThreshold, circuitCooldownMs);
      throw lastError;
    }
  }
  throw lastError;
}

/**
 * @param {string} hostKey
 * @param {number} threshold
 * @param {number} cooldownMs
 */
function recordFailure(hostKey, threshold, cooldownMs) {
  const current = circuits.get(hostKey) || { failures: 0, openUntil: 0 };
  current.failures += 1;
  if (current.failures >= threshold) {
    current.openUntil = Date.now() + cooldownMs;
  }
  circuits.set(hostKey, current);
}

export function resetCircuits() {
  circuits.clear();
}
