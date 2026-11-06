/**
 * 型別化錯誤：HTTP 層只認 status + 對外訊息，內部細節唔會漏出去。
 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const unauthorized = () => new HttpError(401, 'Unauthorized');
export const notFound = () => new HttpError(404, 'Not Found');
export const methodNotAllowed = () => new HttpError(405, 'Method Not Allowed');
export const serverError = (message = 'Internal Server Error') => new HttpError(500, message);

/** 統一錯誤結構：{"error":"..."}，401/404 都係 JSON。 */
export function errorResponse(err) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : 'Internal Server Error';
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 讀 JSON body；壞 JSON → 400，唔會變成 500。 */
export async function readJson(request) {
  const text = await request.text();
  if (!text) throw badRequest('請求內容不可為空');
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('請求內容不是有效 JSON');
  }
}
