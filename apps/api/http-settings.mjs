const contentPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https://image.tmdb.org https://s4.anilist.co https://archive.org https://*.archive.org https://uploads.mangadex.org; media-src 'self' blob: https://archive.org https://*.archive.org https://upload.wikimedia.org; connect-src 'self' https://opensubtitles-v3.strem.io https://subs5.strem.io https://subs.bright67.online https://uploads.mangadex.org https://*.mangadex.network; frame-src https://cinesrc.st https://ani.pm https://animeembed.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export const publicOrigin = process.env.AFTERFRAME_ORIGIN ? new URL(process.env.AFTERFRAME_ORIGIN) : null;
if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.href !== `${publicOrigin.origin}/`)) {
  throw new Error('AFTERFRAME_ORIGIN must be an HTTPS origin.');
}

export function applySecurityHeaders(response) {
  response.setHeader('content-security-policy', contentPolicy);
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  if (publicOrigin) response.setHeader('strict-transport-security', 'max-age=31536000');
}
