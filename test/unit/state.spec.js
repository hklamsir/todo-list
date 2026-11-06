import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  SORTS,
  STATUSES,
  buildQuery,
  loadPrefs,
  normalizeSort,
  normalizeStatus,
  savePrefs,
} from '../../public/lib/state.js';

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

describe('normalizeSort / normalizeStatus', () => {
  it('只放行白名單值', () => {
    for (const v of SORTS) expect(normalizeSort(v)).toBe(v);
    for (const v of STATUSES) expect(normalizeStatus(v)).toBe(v);
  });

  it('未知值／大小寫不符 fallback', () => {
    expect(normalizeSort('DROP TABLE')).toBe('due');
    expect(normalizeSort('')).toBe('due');
    expect(normalizeSort(null)).toBe('due');
    expect(normalizeStatus('ACTIVE')).toBe('active');
    expect(normalizeStatus(undefined)).toBe('active');
  });
});

describe('loadPrefs', () => {
  it('冇存過用預設', () => {
    expect(loadPrefs(fakeStorage())).toEqual(DEFAULT_PREFS);
  });

  it('讀返之前存嘅值', () => {
    const s = fakeStorage({ 'todo.sort': 'created', 'todo.status': 'completed' });
    expect(loadPrefs(s)).toEqual({ sort: 'created', status: 'completed' });
  });

  it('被改壞嘅 localStorage 值一律 fallback（ADR-004）', () => {
    const s = fakeStorage({ 'todo.sort': '"; DROP TABLE todos;--', 'todo.status': 'guest' });
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });

  it('storage 拋錯都唔會爆', () => {
    const broken = {
      getItem() {
        throw new Error('SecurityError');
      },
    };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
  });
});

describe('savePrefs', () => {
  it('只寫 sort / status，唔寫 tag', () => {
    const s = fakeStorage();
    savePrefs(s, { sort: 'category', status: 'all', tag: '工作' });
    expect(s.dump()).toEqual({ 'todo.sort': 'category', 'todo.status': 'all' });
  });

  it('寫入前再驗白名單', () => {
    const s = fakeStorage();
    savePrefs(s, { sort: 'evil', status: 'evil' });
    expect(s.dump()).toEqual({ 'todo.sort': DEFAULT_PREFS.sort, 'todo.status': DEFAULT_PREFS.status });
  });

  it('storage 拋錯都唔會爆', () => {
    const broken = {
      setItem() {
        throw new Error('QuotaExceeded');
      },
    };
    expect(() => savePrefs(broken, { sort: 'due', status: 'active' })).not.toThrow();
  });
});

describe('buildQuery', () => {
  it('永遠帶 sort / status', () => {
    expect(buildQuery({ sort: 'due', status: 'active' })).toBe('?sort=due&status=active');
  });

  it('有 tag 才加，並做 URL encode', () => {
    expect(buildQuery({ sort: 'due', status: 'all' }, '工作')).toBe('?sort=due&status=all&tag=%E5%B7%A5%E4%BD%9C');
  });

  it('空 tag 視為無', () => {
    expect(buildQuery({ sort: 'due', status: 'all' }, '')).toBe('?sort=due&status=all');
    expect(buildQuery({ sort: 'due', status: 'all' }, null)).toBe('?sort=due&status=all');
  });

  it('傳入未經正規化嘅值都會被覆寫成合法值', () => {
    expect(buildQuery({ sort: 'evil', status: 'guest' })).toBe('?sort=due&status=active');
  });
});
