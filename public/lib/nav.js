/**
 * 瀏覽器上一頁（Android 實體返回鍵／手勢、桌面 Back）的純邏輯層。
 * 唔 import 任何 DOM，所以可以直接單元測試；pushState／popstate 接線喺 app.js。
 * 決策見 ADR-008、功能見 spec §6.2。
 *
 * 背景：三個視圖共用同一份文件（只有 hidden 切換），冇 history 紀錄就等於
 * 「按上一頁 = 卸載文件」，Android 睇落就係直接跳出 app。
 */

/** 視圖標記；寫入 history.state，唔靠 URL（三個視圖都係同一份文件）。 */
export const NAV = Object.freeze({ app: 'app', editor: 'editor', login: 'login' });

export const EXIT_WINDOW_MS = 2000;
export const EXIT_HINT = '再撳一次「返回」離開';

/**
 * 讀 history.state 的視圖。state 內容同 localStorage 一樣當作不可信（ADR-004 的態度），
 * 只放行白名單值；認唔到就回 null，由呼叫方當成「清單頁」處理。
 */
export function readView(state) {
  const view = state?.todoView;
  return view === NAV.app || view === NAV.editor || view === NAV.login ? view : null;
}

/** 砌新的 history.state；冇 id 就唔寫 key，避免 null 混入判斷。 */
export function navState(view, todoId = null) {
  return typeof todoId === 'string' && todoId !== '' ? { todoView: view, todoId } : { todoView: view };
}

/** 由 history.state 讀返編輯中的 id（前進／上一頁返到編輯器時用）。 */
export function readTodoId(state) {
  const id = state?.todoId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * 「連撳兩下才離開」狀態機。
 * press() 回 false = 今次應該攔住並重新武裝；回 true = 已經係第二下，應該放行離開。
 * 用注入的 `now` 而唔直接讀 Date.now()，令時間可以測試。
 */
export function createExitGuard({ windowMs = EXIT_WINDOW_MS } = {}) {
  let armedAt = null;

  return {
    press(now) {
      const leaving = armedAt !== null && now - armedAt <= windowMs;
      armedAt = leaving ? null : now;
      return leaving;
    },
    reset() {
      armedAt = null;
    },
    isArmed: () => armedAt !== null,
  };
}
