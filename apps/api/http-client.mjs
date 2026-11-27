import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateIp } from './http-settings.mjs';

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_CIRCUITS = 100;
const DNS_CACHE_TTL_MS = 60_000;
const MAX_DNS_CACHE = 256;

/** @type {Map<string, { failures: number; openUntil: number }>} */
const circuits = new Map();
/** @type {Map<string, { allowed: boolean; expiresAt: number }>} */
const publicHostCache = new Map();

/**
 * Reject hostnames that are private/reserved IP literals, localhost, or resolve to private/reserved IPs.
 * @param {string} hostname
 */
export async function assertPublicHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw Object.assign(new Error('Refused request to non-public host.'), { statusCode: 400 });
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error('Refused request to private address.'), { statusCode: 400 });
    return;
  }
  const now = Date.now();
  const cached = publicHostCache.get(host);
  if (cached && now < cached.expiresAt) {
    if (!cached.allowed) throw Object.assign(new Error('Refused request to private address.'), { statusCode: 400 });
    return;
  }
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    const blocked = records.some(record => isPrivateIp(record.address));
    if (publicHostCache.size >= MAX_DNS_CACHE) {
      const oldest = publicHostCache.keys().next().value;
      if (oldest) publicHostCache.delete(oldest);
    }
    publicHostCache.set(host, { allowed: !blocked, expiresAt: now + DNS_CACHE_TTL_MS });
    if (blocked) throw Object.assign(new Error('Refused request to private address.'), { statusCode: 400 });
  } catch (error) {
    if (error?.statusCode === 400) throw error;
    // Allow network-layer fetch to handle unresolved hostnames (also preserves offline mocked tests).
  }
}

/**
 * Read a Response body as UTF-8 text while enforcing a strict maximum byte limit.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
export async function readTextWithLimit(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error('Upstream response exceeded size limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Upstream response exceeded size limit.');
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

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
      const response = await fetch(url, { redirect: 'error', ...init, signal });
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
  circuits.delete(hostKey);
  if (circuits.size >= MAX_CIRCUITS) {
    const oldest = circuits.keys().next().value;
    if (oldest) circuits.delete(oldest);
  }
  circuits.set(hostKey, current);
}

export function resetCircuits() {
  circuits.clear();
  publicHostCache.clear();
}
