import { describe, expect, it } from 'vitest';
import {
  TAG_MAX_COUNT,
  TAG_MAX_LEN,
  TITLE_MAX,
  parseCreateBody,
  parseDueAt,
  parseListQuery,
  parsePatchBody,
  parseTags,
  parseTitle,
} from '../../src/validate.js';

const status = (fn) => {
  try {
    fn();
    return 200;
  } catch (err) {
    return err.status;
  }
};

describe('parseTitle', () => {
  it('接受 1 至 200 字並 trim', () => {
    expect(parseTitle('  交課程計劃書  ')).toBe('交課程計劃書');
    expect(parseTitle('a'.repeat(TITLE_MAX))).toHaveLength(TITLE_MAX);
  });

  it('拒絕空字串、純空白、非字串、超長', () => {
    expect(status(() => parseTitle(''))).toBe(400);
    expect(status(() => parseTitle('   '))).toBe(400);
    expect(status(() => parseTitle(null))).toBe(400);
    expect(status(() => parseTitle(123))).toBe(400);
    expect(status(() => parseTitle('a'.repeat(TITLE_MAX + 1)))).toBe(400);
  });
});

describe('parseDueAt', () => {
  it('接受 YYYY-MM-DD，未提供時回 null', () => {
    expect(parseDueAt('2026-11-20')).toBe('2026-11-20');
    expect(parseDueAt(null)).toBeNull();
    expect(parseDueAt(undefined)).toBeNull();
    expect(parseDueAt('')).toBeNull();
    expect(parseDueAt('   ')).toBeNull();
  });

  it('拒絕格式錯誤同不存在的日期', () => {
    expect(status(() => parseDueAt('2026-1-1'))).toBe(400);
    expect(status(() => parseDueAt('20-11-2026'))).toBe(400);
    expect(status(() => parseDueAt('2026-13-01'))).toBe(400);
    expect(status(() => parseDueAt('2026-02-30'))).toBe(400);
    expect(status(() => parseDueAt('2026-11-20T10:00:00Z'))).toBe(400);
    expect(status(() => parseDueAt(20261120))).toBe(400);
  });
});

describe('parseTags', () => {
  it('未提供時回空 array', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags([])).toEqual([]);
  });

  it('trim + Set 去重，保留順序', () => {
    expect(parseTags([' 工作 ', '急', '工作'])).toEqual(['工作', '急']);
  });

  it('拒絕非 array、含非字串、空字串、超長、超過上限', () => {
    expect(status(() => parseTags('工作'))).toBe(400);
    expect(status(() => parseTags({ a: 1 }))).toBe(400);
    expect(status(() => parseTags(['工作', 2]))).toBe(400);
    expect(status(() => parseTags(['工作', '   ']))).toBe(400);
    expect(status(() => parseTags(['x'.repeat(TAG_MAX_LEN + 1)]))).toBe(400);
    expect(status(() => parseTags(Array.from({ length: TAG_MAX_COUNT + 1 }, (_, i) => `t${i}`)))).toBe(400);
  });

  it('去重後仍在 10 個以內就放行', () => {
    const ten = Array.from({ length: TAG_MAX_COUNT }, (_, i) => `t${i}`);
    expect(parseTags([...ten, 't0'])).toHaveLength(TAG_MAX_COUNT);
  });
});

describe('parseCreateBody', () => {
  it('正規化完整 body', () => {
    expect(parseCreateBody({ title: ' 交課程計劃書 ', due_at: '2026-11-20', tags: ['工作', '急'] })).toEqual({
      title: '交課程計劃書',
      due_at: '2026-11-20',
      tags: ['工作', '急'],
    });
  });

  it('忽略 body 挾帶嘅 user_id / id / is_done', () => {
    const out = parseCreateBody({ title: 'x', user_id: 'hacker', id: 'mine', is_done: 1 });
    expect(out).not.toHaveProperty('user_id');
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('is_done');
  });

  it('body 不是物件 → 400', () => {
    expect(status(() => parseCreateBody(null))).toBe(400);
    expect(status(() => parseCreateBody('x'))).toBe(400);
    expect(status(() => parseCreateBody([]))).toBe(400);
  });
});

describe('parsePatchBody', () => {
  it('只收白名單欄位', () => {
    const out = parsePatchBody({ title: ' 新標題 ', is_done: true, user_id: 'hacker', created_at: 'x', id: 'y' });
    expect(out).toEqual({ title: '新標題', is_done: 1 });
  });

  it('is_done 只接受 boolean / 0 / 1，統一轉 0|1', () => {
    expect(parsePatchBody({ is_done: true })).toEqual({ is_done: 1 });
    expect(parsePatchBody({ is_done: false })).toEqual({ is_done: 0 });
    expect(parsePatchBody({ is_done: 0 })).toEqual({ is_done: 0 });
    expect(parsePatchBody({ is_done: 1 })).toEqual({ is_done: 1 });
    expect(status(() => parsePatchBody({ is_done: 'yes' }))).toBe(400);
    expect(status(() => parsePatchBody({ is_done: 2 }))).toBe(400);
  });

  it('due_at 可以設成 null 清空', () => {
    expect(parsePatchBody({ due_at: null })).toEqual({ due_at: null });
    expect(parsePatchBody({ due_at: '2026-11-20' })).toEqual({ due_at: '2026-11-20' });
  });

  it('tags 可以清空成 []', () => {
    expect(parsePatchBody({ tags: [] })).toEqual({ tags: [] });
  });

  it('無任何白名單欄位 → 400', () => {
    expect(status(() => parsePatchBody({}))).toBe(400);
    expect(status(() => parsePatchBody({ user_id: 'x', id: 'y' }))).toBe(400);
    expect(status(() => parsePatchBody(null))).toBe(400);
  });
});

describe('parseListQuery', () => {
  const q = (s) => new URLSearchParams(s);

  it('合法值原樣回傳', () => {
    expect(parseListQuery(q('sort=due&status=active&tag=工作'))).toEqual({
      sort: 'due',
      status: 'active',
      tag: '工作',
    });
  });

  it('未知 sort / status 一律 fallback，唔會拋錯', () => {
    expect(parseListQuery(q('sort=drop;table&status=xxx'))).toEqual({
      sort: 'created',
      status: 'all',
      tag: null,
    });
  });

  it('空 query 用預設值', () => {
    expect(parseListQuery(q(''))).toEqual({ sort: 'created', status: 'all', tag: null });
  });

  it('tag 超過 30 字或空白視為無效 → null', () => {
    expect(parseListQuery(q('tag=' + 'x'.repeat(31)))).toEqual({ sort: 'created', status: 'all', tag: null });
    expect(parseListQuery(q('tag=   '))).toEqual({ sort: 'created', status: 'all', tag: null });
  });

  it('tag 保留原字串（唔做 SQL 拼接）', () => {
    expect(parseListQuery(q("tag=' OR 1=1--")).tag).toBe("' OR 1=1--");
  });
});
