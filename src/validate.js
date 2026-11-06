import { badRequest } from './errors.js';

export const TITLE_MAX = 200;
export const TAG_MAX_COUNT = 10;
export const TAG_MAX_LEN = 30;

export const SORT_KEYS = Object.freeze(['due', 'created', 'category']);
export const STATUS_KEYS = Object.freeze(['all', 'active', 'completed']);
export const DEFAULT_SORT = 'created';
export const DEFAULT_STATUS = 'all';

/** PATCH 只認呢四個欄位，其餘 key 一律忽略（ADR-004）。 */
export const PATCH_FIELDS = Object.freeze(['title', 'is_done', 'due_at', 'tags']);

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseTitle(value) {
  if (typeof value !== 'string') throw badRequest('標題必須是文字');
  const title = value.trim();
  if (title.length === 0) throw badRequest('標題不可為空');
  if (title.length > TITLE_MAX) throw badRequest(`標題不可超過 ${TITLE_MAX} 字`);
  return title;
}

export function parseDueAt(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('到期日格式必須是 YYYY-MM-DD');
  const raw = value.trim();
  if (raw === '') return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw badRequest('到期日格式必須是 YYYY-MM-DD');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw badRequest('到期日不是有效日期');
  }
  return raw;
}

export function parseTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('標籤必須是陣列');

  const seen = new Set();
  const tags = [];
  for (const item of value) {
    if (typeof item !== 'string') throw badRequest('每個標籤都必須是文字');
    const tag = item.trim();
    if (tag.length === 0) throw badRequest('標籤不可為空');
    if (tag.length > TAG_MAX_LEN) throw badRequest(`每個標籤不可超過 ${TAG_MAX_LEN} 字`);
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > TAG_MAX_COUNT) throw badRequest(`最多 ${TAG_MAX_COUNT} 個標籤`);
  return tags;
}

export function parseIsDone(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw badRequest('is_done 只接受 true / false');
}

export function parseCreateBody(body) {
  if (!isPlainObject(body)) throw badRequest('請求內容必須是 JSON 物件');
  return {
    title: parseTitle(body.title),
    due_at: parseDueAt(body.due_at),
    tags: parseTags(body.tags),
  };
}

export function parsePatchBody(body) {
  if (!isPlainObject(body)) throw badRequest('請求內容必須是 JSON 物件');

  const fields = {};
  if (Object.prototype.hasOwnProperty.call(body, 'title')) fields.title = parseTitle(body.title);
  if (Object.prototype.hasOwnProperty.call(body, 'is_done')) fields.is_done = parseIsDone(body.is_done);
  if (Object.prototype.hasOwnProperty.call(body, 'due_at')) fields.due_at = parseDueAt(body.due_at);
  if (Object.prototype.hasOwnProperty.call(body, 'tags')) fields.tags = parseTags(body.tags);

  if (Object.keys(fields).length === 0) throw badRequest('沒有可更新的欄位');
  return fields;
}

/**
 * 查詢參數一律白名單 + fallback，唔會拋錯（垃圾值只會退返預設）。
 * tag 唔係欄名，只做格式校驗，之後必定 .bind()。
 */
export function parseListQuery(params) {
  const sortRaw = (params.get('sort') ?? '').trim().toLowerCase();
  const statusRaw = (params.get('status') ?? '').trim().toLowerCase();

  const sort = SORT_KEYS.includes(sortRaw) ? sortRaw : DEFAULT_SORT;
  const status = STATUS_KEYS.includes(statusRaw) ? statusRaw : DEFAULT_STATUS;

  let tag = params.get('tag');
  if (tag !== null) {
    tag = tag.trim();
    if (tag === '' || tag.length > TAG_MAX_LEN) tag = null;
  }

  return { sort, status, tag };
}
