/** 純函數：日期顯示、進度摘要、標籤聯集。無 DOM 依賴，兩邊（app / 測試）都用得。 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

/** 本機日期 → YYYY-MM-DD（唔做時區轉換，同 DB 一致）。 */
export function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseISODate(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return utc;
}

export function formatDue(dueAt, today = todayISO()) {
  const target = parseISODate(dueAt);
  const base = parseISODate(today);
  if (target === null || base === null) return { text: '無期限', tone: 'none' };

  const days = Math.round((target - base) / MS_PER_DAY);
  if (days < 0) return { text: `逾期 ${Math.abs(days)} 日`, tone: 'overdue' };
  if (days === 0) return { text: '今日', tone: 'today' };
  if (days === 1) return { text: '明日', tone: 'soon' };

  const text = dueAt.trim().slice(5);
  return { text, tone: 'normal' };
}

export function summarize(todos) {
  const list = Array.isArray(todos) ? todos : [];
  const total = list.length;
  const done = list.filter((todo) => todo && todo.is_done).length;
  return {
    total,
    done,
    active: total - done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

export function tagUnion(todos) {
  const set = new Set();
  for (const todo of Array.isArray(todos) ? todos : []) {
    if (!todo || !Array.isArray(todo.tags)) continue;
    for (const tag of todo.tags) {
      if (typeof tag === 'string' && tag.trim() !== '') set.add(tag);
    }
  }
  return [...set].sort();
}
