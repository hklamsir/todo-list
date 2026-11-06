import { env } from 'cloudflare:test';
import { SignJWT, exportJWK, generateKeyPair, importJWK } from 'jose';

export const TEST_SUPABASE_URL = 'https://test.supabase.co';
export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;
export const TEST_AUDIENCE = 'authenticated';

/** 測試私鑰由 vitest.config.js 生成並以 binding 傳入。 */
async function privateKey() {
  return importJWK(env.TEST_PRIVATE_JWK, 'ES256');
}

/**
 * 簽一枚符合 Supabase 格式的 access token。
 * opts.audience 可傳 array，覆蓋「aud 相容 string 或 array」嘅不變量。
 */
export async function signToken(sub, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(opts.payload ?? { role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' })
    .setIssuer(opts.issuer ?? TEST_ISSUER)
    .setSubject(sub)
    .setAudience(opts.audience ?? TEST_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresIn ?? 3600))
    .sign(await privateKey());
}

/** 用「另一條」未被 JWKS 收錄嘅 key 簽，模擬偽造 token。 */
export async function signForgedToken(sub) {
  const { privateKey: forged } = await generateKeyPair('ES256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuer(TEST_ISSUER)
    .setSubject(sub)
    .setAudience(TEST_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(forged);
}

/** 供需要自行組 JWKS 嘅測試使用。 */
export async function exportedPublicJwk() {
  const { publicKey } = await generateKeyPair('ES256');
  return exportJWK(publicKey);
}
