import { serverError } from './errors.js';

/** 集中配置：全部由環境變數提供，缺漏即快速失敗（唔會靜靜地行錯）。 */
export function loadConfig(env) {
  const url = typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim().replace(/\/+$/, '') : '';
  const anonKey = typeof env?.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.trim() : '';

  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (missing.length) throw serverError(`缺少環境變數：${missing.join(', ')}`);

  let origin;
  try {
    origin = new URL(url);
  } catch {
    throw serverError('SUPABASE_URL 不是有效網址');
  }
  if (origin.protocol !== 'https:') throw serverError('SUPABASE_URL 必須是 https');

  return {
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    origin: origin.origin,
    issuer: `${url}/auth/v1`,
    jwksUrl: `${url}/auth/v1/.well-known/jwks.json`,
  };
}
