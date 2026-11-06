/**
 * 資料存取層：只負責 SQL，唔知 HTTP，唔做業務判斷。
 * 每個查詢都帶 user_id = ?（ownership 下推，ADR-004）。
 */

export const COLUMNS = 'id, title, is_done, due_at, tags, created_at, updated_at';

/** 排序白名單；已完成置底由外層 ORDER BY is_done ASC 統一處理。
 *  rowid DESC 做 tie-breaker：同一秒建立嘅列都有穩定次序（created_at 只有秒精度）。 */
export const SORT_SQL = Object.freeze({
  due: "CASE WHEN due_at IS NULL OR due_at = '' THEN 1 ELSE 0 END ASC, due_at ASC, rowid DESC",
  created: 'created_at DESC, rowid DESC',
  category:
    "json_extract(CASE WHEN json_valid(tags) THEN tags ELSE '[]' END, '$[0]') ASC, created_at DESC, rowid DESC",
});

/** 狀態白名單：null 代表唔加條件。值一定要係 0/1，唔會由用戶輸入。 */
export const STATUS_SQL = Object.freeze({ all: null, active: 0, completed: 1 });

const TAGS_EXPR = "CASE WHEN json_valid(todos.tags) THEN todos.tags ELSE '[]' END";

export function buildListSql({ userId, sort, status, tag }) {
  const where = ['user_id = ?'];
  const params = [userId];

  const statusValue = STATUS_SQL[status] ?? STATUS_SQL.all;
  if (statusValue !== null) {
    where.push('is_done = ?');
    params.push(statusValue);
  }

  if (tag) {
    where.push(
      `EXISTS (SELECT 1 FROM json_each(${TAGS_EXPR}) AS je WHERE je.value = ?)`,
    );
    params.push(tag);
  }

  const order = SORT_SQL[sort] ?? SORT_SQL.created;
  const sql = `SELECT ${COLUMNS} FROM todos WHERE ${where.join(' AND ')} ORDER BY is_done ASC, ${order}`;
  return { sql, params };
}

/** 分類下拉選項 ＝ 自己 todos 嘅 tags 聯集（唔查 global 詞表，ADR-002）。 */
export function buildTagsSql(userId) {
  return {
    sql: `SELECT DISTINCT je.value AS tag FROM todos, json_each(${TAGS_EXPR}) AS je
          WHERE todos.user_id = ? AND typeof(je.value) = 'text' AND je.value <> ''
          ORDER BY je.value ASC`,
    params: [userId],
  };
}

function parseTagsJson(raw) {
  if (typeof raw !== 'string') return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item) => typeof item === 'string');
  } catch {
    return [];
  }
}

export function rowToTodo(row) {
  return {
    id: row.id,
    title: row.title,
    is_done: row.is_done === 1 || row.is_done === true,
    due_at: row.due_at ?? null,
    tags: parseTagsJson(row.tags),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listTodos(db, query) {
  const { sql, params } = buildListSql(query);
  const { results } = await db.prepare(sql).bind(...params).all();
  return results.map(rowToTodo);
}

/** 進度摘要用：唔受 status 篩選影響，永遠係自己全部待辦嘅計數。 */
export function buildCountsSql(userId) {
  return {
    sql: 'SELECT COUNT(*) AS total, COALESCE(SUM(is_done), 0) AS done FROM todos WHERE user_id = ?',
    params: [userId],
  };
}

export async function listTags(db, userId) {
  const { sql, params } = buildTagsSql(userId);
  const { results } = await db.prepare(sql).bind(...params).all();
  return results.map((row) => row.tag);
}

export async function countTodos(db, userId) {
  const { sql, params } = buildCountsSql(userId);
  const { results } = await db.prepare(sql).bind(...params).all();
  const row = results[0] ?? { total: 0, done: 0 };
  return { total: Number(row.total) || 0, done: Number(row.done) || 0 };
}

export async function insertTodo(db, { id, userId, title, due_at, tags }) {
  const sql = `INSERT INTO todos (id, user_id, title, due_at, tags)
               VALUES (?, ?, ?, ?, ?)
               RETURNING ${COLUMNS}`;
  const { results } = await db
    .prepare(sql)
    .bind(id, userId, title, due_at, JSON.stringify(tags))
    .all();
  return results.length ? rowToTodo(results[0]) : null;
}

/** 只 iterate 白名單欄位，SET 片段固定次序，值一律 bind。 */
export async function updateTodo(db, { id, userId, fields }) {
  const sets = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(fields, 'title')) {
    sets.push('title = ?');
    params.push(fields.title);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'is_done')) {
    sets.push('is_done = ?');
    params.push(fields.is_done);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'due_at')) {
    sets.push('due_at = ?');
    params.push(fields.due_at);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'tags')) {
    sets.push('tags = ?');
    params.push(JSON.stringify(fields.tags));
  }

  if (sets.length === 0) return null;

  const sql = `UPDATE todos SET ${sets.join(', ')}, updated_at = datetime('now')
               WHERE id = ? AND user_id = ?
               RETURNING ${COLUMNS}`;
  const result = await db.prepare(sql).bind(...params, id, userId).all();
  if (!result.results.length || result.meta.changes === 0) return null;
  return rowToTodo(result.results[0]);
}

export async function deleteTodo(db, { id, userId }) {
  const result = await db
    .prepare('DELETE FROM todos WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  return result.meta.changes > 0;
}
