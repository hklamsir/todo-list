import { createRemoteJWKSet, jwtVerify } from 'jose';
import { loadConfig } from './config.js';
import { unauthorized } from './errors.js';

/**
 * Worker 完全無狀態：只用 jose + JWKS 驗 ES256，唔連 Supabase DB、唔寫 session。
 * JWKS 快取喺 isolate 內（jose 自己會 cache），key 用 url + apikey 區分。
 */
const jwksCache = new Map();

function getJwks(config) {
  const cacheKey = `${config.jwksUrl}|${config.supabaseAnonKey}`;
  let jwks = jwksCache.get(cacheKey);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
      headers: { apikey: config.supabaseAnonKey },
      timeoutDuration: 5000,
      cooldownDuration: 30000,
    });
    jwksCache.set(cacheKey, jwks);
  }
  return jwks;
}

export function extractBearer(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * 驗證 Bearer token，回 { sub }。
 * 任何失敗（缺 token、簽章錯、過期、issuer/aud 不符）一律 401，唔會透露原因。
 */
export async function authenticate(request, env) {
  const config = loadConfig(env);
  const token = extractBearer(request.headers.get('authorization'));
  if (!token) throw unauthorized();

  try {
    const { payload } = await jwtVerify(token, getJwks(config), {
      issuer: config.issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
      clockTolerance: 5,
    });

    const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!sub) throw unauthorized();
    return { sub };
  } catch {
    throw unauthorized();
  }
}
