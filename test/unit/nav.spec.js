import { describe, expect, it } from 'vitest';
import {
  EXIT_HINT,
  EXIT_WINDOW_MS,
  NAV,
  createExitGuard,
  navState,
  readTodoId,
  readView,
} from '../../public/lib/nav.js';

describe('readView', () => {
  it('只放行三個白名單視圖', () => {
    expect(readView({ todoView: NAV.app })).toBe('app');
    expect(readView({ todoView: NAV.editor })).toBe('editor');
    expect(readView({ todoView: NAV.login })).toBe('login');
  });

  it('認唔到就回 null（唔信 history.state）', () => {
    for (const bad of [null, undefined, {}, { todoView: 'admin' }, { todoView: 1 }, 'app']) {
      expect(readView(bad)).toBeNull();
    }
  });
});

describe('navState / readTodoId', () => {
  it('有 id 才寫入，冇就唔加 key', () => {
    expect(navState(NAV.editor, 'abc')).toEqual({ todoView: 'editor', todoId: 'abc' });
    expect(navState(NAV.editor, null)).toEqual({ todoView: 'editor' });
    expect(navState(NAV.app)).toEqual({ todoView: 'app' });
  });

  it('空字串／非字串 id 一律當冇', () => {
    expect(navState(NAV.editor, '')).toEqual({ todoView: 'editor' });
    expect(navState(NAV.editor, 42)).toEqual({ todoView: 'editor' });
  });

  it('readTodoId 讀返字串 id，其餘回 null', () => {
    expect(readTodoId({ todoView: 'editor', todoId: 'abc' })).toBe('abc');
    expect(readTodoId({ todoView: 'editor' })).toBeNull();
    expect(readTodoId({ todoView: 'editor', todoId: '' })).toBeNull();
    expect(readTodoId(null)).toBeNull();
  });
});

describe('createExitGuard', () => {
  it('第一下攔住，兩秒內第二下才放行', () => {
    const guard = createExitGuard();
    expect(guard.press(1_000)).toBe(false);
    expect(guard.isArmed()).toBe(true);
    expect(guard.press(1_200)).toBe(true);
    expect(guard.isArmed()).toBe(false);
  });

  it('超過窗口就重新計，唔會放行', () => {
    const guard = createExitGuard();
    expect(guard.press(0)).toBe(false);
    expect(guard.press(EXIT_WINDOW_MS + 1)).toBe(false);
    // 超過窗口後，之前一下唔算數，仍然要再撳多下
    expect(guard.press(EXIT_WINDOW_MS + 500)).toBe(true);
  });

  it('剛好等於窗口視為有效', () => {
    const guard = createExitGuard();
    guard.press(0);
    expect(guard.press(EXIT_WINDOW_MS)).toBe(true);
  });

  it('reset 之後要重新撳兩下（例如登出返登入頁）', () => {
    const guard = createExitGuard();
    guard.press(0);
    guard.reset();
    expect(guard.isArmed()).toBe(false);
    expect(guard.press(10)).toBe(false);
  });

  it('連續三次：只放行第二下，第三下重新武裝', () => {
    const guard = createExitGuard();
    expect(guard.press(0)).toBe(false);
    expect(guard.press(100)).toBe(true);
    expect(guard.press(200)).toBe(false);
    expect(guard.isArmed()).toBe(true);
  });

  it('自訂窗口長度', () => {
    const guard = createExitGuard({ windowMs: 500 });
    guard.press(0);
    expect(guard.press(500)).toBe(true);
    guard.press(1_000);
    expect(guard.press(1_501)).toBe(false);
  });
});

describe('EXIT_HINT', () => {
  it('提示文字講明要撳多一次', () => {
    expect(EXIT_HINT).toContain('再撳一次');
  });
});
