import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { generateKeyPairSync } from 'node:crypto';

/**
 * 測試環境不靠任何 mocking 庫：
 * - ES256 金鑰喺 Node 側生成一次，公開 JWK 用 outboundService 當 JWKS 回傳，
 *   私鑰以 binding 傳入 workerd，令測試可以簽真 token（同一條 key，簽名驗證係真跑）。
 * - migrations 由 readD1Migrations 讀入，beforeAll 用 applyD1Migrations 落本地 D1。
 */
const SUPABASE_URL = 'https://test.supabase.co';
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key-1',
  alg: 'ES256',
  use: 'sig',
};
const privateJwk = privateKey.export({ format: 'jwk' });

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SUPABASE_URL,
          SUPABASE_ANON_KEY: 'test-anon-key',
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          TEST_PRIVATE_JWK: privateJwk,
        },
        outboundService(request) {
          const url = new URL(request.url);
          if (url.origin === SUPABASE_URL && url.pathname === JWKS_PATH) {
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response('unexpected outbound request', { status: 502 });
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.spec.js'],
  },
});
