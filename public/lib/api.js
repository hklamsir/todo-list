/** 型別化 API 客戶端：統一帶 Bearer、401 自動刷新重試一次、錯誤轉成人話。 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function createApi({ baseUrl = '', getToken, onUnauthorized, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));

  async function request(path, { method = 'GET', body, retried = false } = {}) {
    const token = await getToken?.();
    if (!token) throw new ApiError(401, '登入已失效，請重新登入');

    const headers = { authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch {
      throw new ApiError(0, '網絡連線失敗，請檢查連線後再試');
    }

    if (response.status === 401) {
      if (!retried && onUnauthorized) {
        const recovered = await onUnauthorized();
        if (recovered) return request(path, { method, body, retried: true });
      }
      throw new ApiError(401, '登入已失效，請重新登入');
    }

    if (!response.ok) {
      let message = `請求失敗（${response.status}）`;
      try {
        const payload = await response.json();
        if (payload && typeof payload.error === 'string') message = payload.error;
      } catch {
        // 非 JSON 錯誤回應：保留預設文案
      }
      throw new ApiError(response.status, message);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  return {
    list: (query = '') => request(`/api/todos${query}`),
    create: (payload) => request('/api/todos', { method: 'POST', body: payload }),
    update: (id, patch) => request(`/api/todos/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    remove: (id) => request(`/api/todos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
