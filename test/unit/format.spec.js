import { describe, expect, it } from 'vitest';
import { formatDue, summarize, tagUnion, todayISO } from '../../public/lib/format.js';

const TODAY = '2026-11-06';

describe('todayISO', () => {
  it('用本機日期，補零成 YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(todayISO(new Date(2026, 10, 20, 0, 1))).toBe('2026-11-20');
  });
});

describe('formatDue', () => {
  it('無期限', () => {
    expect(formatDue(null, TODAY)).toEqual({ text: '無期限', tone: 'none' });
    expect(formatDue('', TODAY)).toEqual({ text: '無期限', tone: 'none' });
    expect(formatDue('2026-13-99', TODAY)).toEqual({ text: '無期限', tone: 'none' });
  });

  it('今日 / 明日', () => {
    expect(formatDue('2026-11-06', TODAY)).toEqual({ text: '今日', tone: 'today' });
    expect(formatDue('2026-11-07', TODAY)).toEqual({ text: '明日', tone: 'soon' });
  });

  it('逾期按日數計', () => {
    expect(formatDue('2026-11-05', TODAY)).toEqual({ text: '逾期 1 日', tone: 'overdue' });
    expect(formatDue('2026-10-27', TODAY)).toEqual({ text: '逾期 10 日', tone: 'overdue' });
  });

  it('其他日期顯示 MM-DD', () => {
    expect(formatDue('2026-11-20', TODAY)).toEqual({ text: '11-20', tone: 'normal' });
    expect(formatDue('2027-01-03', TODAY)).toEqual({ text: '01-03', tone: 'normal' });
  });
});

describe('summarize', () => {
  it('計總數、未完成、已完成同百分比', () => {
    const todos = [
      { is_done: false },
      { is_done: false },
      { is_done: false },
      { is_done: true },
    ];
    expect(summarize(todos)).toEqual({ total: 4, active: 3, done: 1, percent: 25 });
  });

  it('空清單唔會 NaN', () => {
    expect(summarize([])).toEqual({ total: 0, active: 0, done: 0, percent: 0 });
  });
});

describe('tagUnion', () => {
  it('去重、排序、忽略非陣列同空字串', () => {
    const todos = [
      { tags: ['工作', '急'] },
      { tags: ['急', '個人'] },
      { tags: [] },
      { tags: null },
      {},
    ];
    expect(tagUnion(todos)).toEqual(['個人', '工作', '急']);
  });
});
