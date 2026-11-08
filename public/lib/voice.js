/**
 * 語音輸入的純邏輯層：插入文字、錯誤映射、狀態機。
 * 唔 import 任何 DOM，所以可以直接單元測試；DOM 接線喺 app.js。
 * 決策見 ADR-007、功能見 spec §3.7。
 */

export const VOICE_LANGS = Object.freeze(['zh-HK', 'zh-CN', 'en-US']);
export const DEFAULT_LANG = 'zh-HK';
export const TITLE_MAX = 200;

const ALNUM = /[A-Za-z0-9]/;

const ERROR_MESSAGES = Object.freeze({
  'not-allowed': '已拒絕麥克風權限，請喺瀏覽器設定開啟',
  'service-not-allowed': '已拒絕麥克風權限，請喺瀏覽器設定開啟',
  'no-speech': '聽唔到聲音，再試一次',
  'audio-capture': '搵唔到麥克風，請檢查裝置',
  network: '語音辨識需要連線，請檢查網絡',
  aborted: null,
});

export function getSpeechCtor(scope = globalThis) {
  if (!scope) return null;
  const ctor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  return typeof ctor === 'function' ? ctor : null;
}

export function isSpeechSupported(scope = globalThis) {
  return getSpeechCtor(scope) !== null;
}

/** 錯誤碼 → 中文提示；`aborted` 回 null（用戶自己取消，唔彈錯）。 */
export function mapVoiceError(code) {
  if (Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code];
  return '語音輸入失敗，請再試一次';
}

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/** 截斷但唔切爛 surrogate pair（emoji 唔會變怪字）。 */
function truncate(str, max) {
  if (str.length <= max) return str;
  let cut = str.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/**
 * 把轉寫插入現有文字：保留原文、取代選取範圍、英文數字自動補空格、超長截斷。
 * 回 { value, caret }，caret 係 UTF-16 offset（同 input.setSelectionRange 一致）。
 */
export function insertTranscript(text, { value = '', start = null, end = null, maxLength = TITLE_MAX } = {}) {
  const base = typeof value === 'string' ? value : '';
  const insert = typeof text === 'string' ? text.trim() : '';

  const rawStart = start === null || start === undefined ? base.length : Math.trunc(start);
  const rawEnd = end === null || end === undefined ? rawStart : Math.trunc(end);
  const from = clamp(rawStart, 0, base.length);
  const to = clamp(rawEnd, from, base.length);

  if (insert === '') {
    return { value: base, caret: clamp(end === null || end === undefined ? from : to, 0, base.length) };
  }

  const prefix = base.slice(0, from);
  const suffix = base.slice(to);

  // 英文／數字同前後文字黏住會難讀，所以自動補一個空格；中文則保持緊貼。
  const padBefore = prefix !== '' && !/\s$/.test(prefix) && ALNUM.test(insert[0]);
  const padAfter = suffix !== '' && !/^\s/.test(suffix) && ALNUM.test(insert[insert.length - 1]);

  const left = `${prefix}${padBefore ? ' ' : ''}`;
  const combined = `${left}${insert}${padAfter ? ' ' : ''}${suffix}`;
  const caret = left.length + insert.length;

  return {
    value: truncate(combined, maxLength),
    caret: Math.min(caret, maxLength),
  };
}

/**
 * 語音 session 狀態機：idle ↔ listening。
 * 單句模式（continuous=false），一句 final 就收工，唔做自動重連（ADR-007）。
 */
export function createVoiceInput({ ctor, lang = DEFAULT_LANG, onState, onInterim, onFinal, onError } = {}) {
  let state = 'idle';
  let instance = null;
  let currentLang = lang;

  const isSupported = () => typeof ctor === 'function';

  function setState(next) {
    if (state === next) return;
    state = next;
    onState?.(next);
  }

  function readResults(event) {
    let interim = '';
    let finalText = '';
    const from = event?.resultIndex ?? 0;
    const results = event?.results ?? [];

    for (let i = from; i < results.length; i += 1) {
      const result = results[i];
      const transcript = result?.[0]?.transcript ?? '';
      if (result?.isFinal) finalText += transcript;
      else interim += transcript;
    }
    return { interim, finalText };
  }

  function start(options = {}) {
    if (!isSupported() || state === 'listening') return false;

    currentLang = options.lang ?? currentLang;
    instance = new ctor();
    instance.lang = currentLang;
    instance.continuous = false;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onresult = (event) => {
      const { interim, finalText } = readResults(event);
      if (interim) onInterim?.(interim);
      if (finalText) {
        onFinal?.(finalText);
        setState('idle');
      }
    };

    instance.onerror = (event) => {
      const message = mapVoiceError(event?.error);
      setState('idle');
      if (message) onError?.(message);
    };

    instance.onend = () => {
      instance = null;
      setState('idle');
    };

    instance.start();
    setState('listening');
    return true;
  }

  function stop() {
    if (instance) {
      try {
        instance.stop();
      } catch {
        // 已經停止：唔需要處理
      }
    }
    setState('idle');
  }

  function toggle(options) {
    if (state === 'listening') {
      stop();
      return false;
    }
    return start(options);
  }

  return {
    start,
    stop,
    toggle,
    isSupported,
    getState: () => state,
    getLang: () => currentLang,
    setLang: (next) => {
      if (VOICE_LANGS.includes(next)) currentLang = next;
      return currentLang;
    },
  };
}
