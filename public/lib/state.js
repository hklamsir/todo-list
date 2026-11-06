/** 前端偏好狀態：白名單、localStorage 讀寫、查詢字串組裝。純函數 + 可注入 storage。 */

export const SORTS = Object.freeze(['due', 'created', 'category']);
export const STATUSES = Object.freeze(['all', 'active', 'completed']);
export const DEFAULT_PREFS = Object.freeze({ sort: 'due', status: 'active' });

const SORT_KEY = 'todo.sort';
const STATUS_KEY = 'todo.status';

export function normalizeSort(value) {
  return SORTS.includes(value) ? value : DEFAULT_PREFS.sort;
}

export function normalizeStatus(value) {
  return STATUSES.includes(value) ? value : DEFAULT_PREFS.status;
}

/** localStorage 嘅值都當作不可信，讀完即刻過白名單（ADR-004）。 */
export function loadPrefs(storage) {
  try {
    return {
      sort: normalizeSort(storage?.getItem(SORT_KEY)),
      status: normalizeStatus(storage?.getItem(STATUS_KEY)),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage, prefs) {
  try {
    storage?.setItem(SORT_KEY, normalizeSort(prefs?.sort));
    storage?.setItem(STATUS_KEY, normalizeStatus(prefs?.status));
  } catch {
    // 私隱模式或 quota 爆：靜靜地放棄持久化，唔影響操作
  }
}

/** tag 唔持久化，只係 query 參數。 */
export function buildQuery(prefs, tag) {
  const params = new URLSearchParams();
  params.set('sort', normalizeSort(prefs?.sort));
  params.set('status', normalizeStatus(prefs?.status));
  if (typeof tag === 'string' && tag.trim() !== '') params.set('tag', tag.trim());
  return `?${params.toString()}`;
}
