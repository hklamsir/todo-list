import { describe, expect, it } from 'vitest';
import { SORT_SQL, STATUS_SQL, buildListSql, buildTagsSql, rowToTodo } from '../../src/repo/todos.js';

const base = { userId: 'user-a', sort: 'due', status: 'all', tag: null };

describe('buildListSql', () => {
  it('每條查詢都帶 user_id = ? 並 bind', () => {
    const { sql, params } = buildListSql(base);
    expect(sql).toContain('WHERE user_id = ?');
    expect(params[0]).toBe('user-a');
    expect(sql).not.toContain('user-a');
  });

  it('已完成一律置底', () => {
    for (const sort of ['due', 'created', 'category']) {
      const { sql } = buildListSql({ ...base, sort });
      expect(sql).toContain('ORDER BY is_done ASC');
    }
  });

  it('sort=due 用到期日排序，NULL 排最後', () => {
    const { sql } = buildListSql({ ...base, sort: 'due' });
    expect(sql).toContain(SORT_SQL.due);
    expect(SORT_SQL.due).toContain('due_at IS NULL');
  });

  it('未知 sort fallback 做 created，且唔會將輸入拼入 SQL', () => {
    const { sql } = buildListSql({ ...base, sort: 'title; DROP TABLE todos' });
    expect(sql).not.toContain('DROP');
    expect(sql).toContain(SORT_SQL.created);
  });

  it('status 用 bind，唔拼字面值', () => {
    expect(buildListSql({ ...base, status: 'active' }).params).toEqual(['user-a', 0]);
    expect(buildListSql({ ...base, status: 'completed' }).params).toEqual(['user-a', 1]);
    expect(buildListSql({ ...base, status: 'all' }).params).toEqual(['user-a']);
    expect(buildListSql({ ...base, status: 'bogus' }).params).toEqual(['user-a']);
  });

  it('tag 用 json_each 篩選並 bind', () => {
    const { sql, params } = buildListSql({ ...base, tag: "工作' OR 1=1--" });
    expect(sql).toContain('json_each');
    expect(sql).not.toContain('OR 1=1');
    expect(params).toEqual(['user-a', "工作' OR 1=1--"]);
  });

  it('status 同 tag 同時存在時 params 次序穩定', () => {
    const { params } = buildListSql({ ...base, status: 'active', tag: '工作' });
    expect(params).toEqual(['user-a', 0, '工作']);
  });

  it('白名單 map 已 freeze', () => {
    expect(Object.isFrozen(SORT_SQL)).toBe(true);
    expect(Object.isFrozen(STATUS_SQL)).toBe(true);
  });
});

describe('buildTagsSql', () => {
  it('只查自己嘅 tags 聯集，並過濾髒 JSON', () => {
    const { sql, params } = buildTagsSql('user-a');
    expect(sql).toContain('user_id = ?');
    expect(sql).toContain('json_valid');
    expect(sql).toContain('DISTINCT');
    expect(params).toEqual(['user-a']);
  });
});

describe('rowToTodo', () => {
  it('tags 由 JSON 字串解成 array', () => {
    const row = {
      id: 'i1',
      title: '交課程計劃書',
      is_done: 0,
      due_at: '2026-11-20',
      tags: '["工作","急"]',
      created_at: '2026-11-05 01:00:00',
      updated_at: '2026-11-05 01:00:00',
    };
    expect(rowToTodo(row)).toEqual({
      id: 'i1',
      title: '交課程計劃書',
      is_done: false,
      due_at: '2026-11-20',
      tags: ['工作', '急'],
      created_at: '2026-11-05 01:00:00',
      updated_at: '2026-11-05 01:00:00',
    });
  });

  it('髒 tags 一律降級成空 array', () => {
    expect(rowToTodo({ ...{}, id: 'x', title: 't', is_done: 1, due_at: null, tags: 'oops' }).tags).toEqual([]);
    expect(rowToTodo({ id: 'x', title: 't', is_done: 1, due_at: null, tags: '{"a":1}' }).tags).toEqual([]);
    expect(rowToTodo({ id: 'x', title: 't', is_done: 1, due_at: null, tags: null }).tags).toEqual([]);
  });
});
