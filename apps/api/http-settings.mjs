import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const contentPolicy = "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https://image.tmdb.org https://s4.anilist.co https://static.tvmaze.com https://archive.org https://*.archive.org https://uploads.mangadex.org; media-src 'self' blob: https://archive.org https://*.archive.org https://upload.wikimedia.org https://api.emnexanime.site; connect-src 'self' https://api.emnexanime.site https://opensubtitles-v3.strem.io https://subs5.strem.io https://subs.bright67.online https://uploads.mangadex.org; frame-src https://cinesrc.st https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export const publicOrigin = process.env.AFTERFRAME_ORIGIN ? new URL(process.env.AFTERFRAME_ORIGIN) : null;
if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.href !== `${publicOrigin.origin}/`)) {
  throw new Error('AFTERFRAME_ORIGIN must be an HTTPS origin.');
}

export function applySecurityHeaders(response) {
  response.setHeader('content-security-policy', contentPolicy);
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (publicOrigin) response.setHeader('strict-transport-security', 'max-age=31536000');
}

export function negotiateEncoding(acceptEncoding) {
  if (typeof acceptEncoding !== 'string' || !acceptEncoding) return null;
  const lower = acceptEncoding.toLowerCase();
  if (/\bbr\b/.test(lower)) return 'br';
  if (/\bgzip\b/.test(lower)) return 'gzip';
  return null;
}

export async function compressBuffer(buffer, encoding) {
  if (!encoding || buffer.length < 1024) return { buffer, encoding: null };
  try {
    if (encoding === 'br') {
      const compressed = await brotliAsync(buffer, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
      });
      return compressed.length < buffer.length ? { buffer: compressed, encoding: 'br' } : { buffer, encoding: null };
    }
    if (encoding === 'gzip') {
      const compressed = await gzipAsync(buffer, { level: 6 });
      return compressed.length < buffer.length ? { buffer: compressed, encoding: 'gzip' } : { buffer, encoding: null };
    }
  } catch {
    // Fall back to uncompressed response if compression fails.
  }
  return { buffer, encoding: null };
}

export function isPrivateIp(address) {
  if (typeof address !== 'string' || !address) return true;
  const clean = address.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const ip = clean.startsWith('::ffff:') ? clean.slice(7) : clean;
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') return true;
  if (ip.includes(':')) {
    return /^(?:fc|fd|fe[89ab]|ff)/i.test(ip) || /^0*:0*:0*:0*:0*:0*:0*:[01]$/i.test(ip);
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && parts[2] === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}
