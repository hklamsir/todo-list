import { authenticate } from './auth.js';
import { loadConfig } from './config.js';
import { errorResponse, methodNotAllowed, notFound } from './errors.js';
import { handleTodoById, handleTodos } from './http/todos.js';
import { logEvent } from './log.js';

/** 釘死版本；SRI 於執行時由 Worker 實計（唔寫死任何 hash）。 */
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const SDK_ORIGIN = 'https://cdn.jsdelivr.net';

export default {
  async fetch(request, env) {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const trace = { requestId, method: request.method, path: url.pathname };

    let userId;
    let response;

    try {
      trace.userId = undefined;

      if (request.method === 'OPTIONS') {
        response = new Response(null, {
          status: 204,
          headers: { allow: 'GET, POST, PATCH, DELETE, OPTIONS' },
        });
      } else if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        // 所有 /api/* 一律先驗 JWT（連 404 都唔例外），唔洩漏路由存在與否。
        const session = await authenticate(request, env);
        userId = session.sub;
        response = await routeApi(request, env, url, session.sub);
      } else {
        response = await routeStatic(request, env, url);
      }
    } catch (err) {
      response = errorResponse(err);
      if (!err?.status || err.status >= 500) {
        logEvent('error', 'request_failed', { ...trace, error: err?.message ?? String(err) });
      }
    }

    const secured = withSecurityHeaders(response);

    logEvent('info', 'request', {
      ...trace,
      userId,
      status: secured.status,
      durationMs: Date.now() - started,
    });

    return secured;
  },
};

async function routeApi(request, env, url, userId) {
  if (url.pathname === '/api/todos' || url.pathname === '/api/todos/') {
    return handleTodos(request, env, url, userId);
  }

  const match = /^\/api\/todos\/([^/]+)\/?$/.exec(url.pathname);
  if (match) {
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      throw notFound();
    }
    return handleTodoById(request, env, id, userId);
  }

  throw notFound();
}

async function routeStatic(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw methodNotAllowed();

  const wantsHtml = url.pathname === '/' || url.pathname === '/index.html';
  if (wantsHtml) return renderIndex(request, env);

  return env.ASSETS.fetch(request);
}

/**
 * index.html 由 Worker 注入：publishable key 同 SDK 標籤都唔寫死喺靜態檔。
 * SRI 每次 isolate 首次需要時實算一次，之後 cache。
 */
async function renderIndex(request, env) {
  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url).toString()));
  if (!assetResponse.ok) return assetResponse;

  const html = await assetResponse.text();
  const nonce = crypto.randomUUID().replace(/-/g, '');

  let config = null;
  let configError = null;
  try {
    config = loadConfig(env);
  } catch (err) {
    configError = err.message;
  }

  let bootstrap = '';
  if (config) {
    const sdkTag = await sdkScriptTag();
    const payload = {
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      sdkReady: Boolean(sdkTag),
    };
    bootstrap =
      `<script nonce="${nonce}">window.__APP_CONFIG__=${serializeForScript(payload)};</script>` +
      (sdkTag ?? '');
  } else {
    bootstrap = `<script nonce="${nonce}">window.__APP_CONFIG__=${serializeForScript({ configError })};</script>`;
  }

  const body = html.replace('<!--APP_BOOTSTRAP-->', bootstrap);

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': buildCsp(config, nonce),
    },
  });
}

let sdkTagCache = null;

function sdkScriptTag() {
  if (!sdkTagCache) {
    sdkTagCache = (async () => {
      try {
        const res = await fetch(SDK_URL, { cf: { cacheTtl: 86400, cacheEverything: true } });
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-384', bytes);
        return `<script src="${SDK_URL}" integrity="sha384-${toBase64(new Uint8Array(digest))}" crossorigin="anonymous" defer></script>`;
      } catch {
        return null;
      }
    })();
  }

  return sdkTagCache.then((tag) => {
    if (!tag) sdkTagCache = null; // 失敗唔快取，下個請求重試
    return tag;
  });
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildCsp(config, nonce) {
  const connectSrc = ["'self'", config?.origin].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' ${SDK_ORIGIN} 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'same-origin');
  headers.set('x-frame-options', 'DENY');
  headers.set('permissions-policy', 'geolocation=(), microphone=(self), camera=()');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
