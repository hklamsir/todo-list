import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LANG,
  VOICE_LANGS,
  createVoiceInput,
  getSpeechCtor,
  insertTranscript,
  isSpeechSupported,
  mapVoiceError,
} from '../../public/lib/voice.js';

describe('isSpeechSupported / getSpeechCtor', () => {
  it('兩種前綴都認', () => {
    const standard = { SpeechRecognition: class {} };
    const prefixed = { webkitSpeechRecognition: class {} };
    expect(isSpeechSupported(standard)).toBe(true);
    expect(isSpeechSupported(prefixed)).toBe(true);
    expect(getSpeechCtor(prefixed)).toBe(prefixed.webkitSpeechRecognition);
  });

  it('冇 API（Firefox / iOS Chrome）一律 false，唔會 throw', () => {
    expect(isSpeechSupported({})).toBe(false);
    expect(isSpeechSupported(undefined)).toBe(false);
    expect(getSpeechCtor({})).toBeNull();
  });
});

describe('insertTranscript', () => {
  const base = { value: '', start: 0, end: 0, maxLength: 200 };

  it('空輸入框直接填入，游標在字尾', () => {
    expect(insertTranscript('買牛奶', base)).toEqual({ value: '買牛奶', caret: 3 });
  });

  it('游標在字尾時接住原有文字，中文唔加空格', () => {
    expect(insertTranscript('買牛奶', { ...base, value: '今日', start: 2, end: 2 })).toEqual({
      value: '今日買牛奶',
      caret: 5,
    });
  });

  it('游標在中間時插入，前後文字都保留', () => {
    expect(insertTranscript('生果', { ...base, value: '買文具', start: 1, end: 1 })).toEqual({
      value: '買生果文具',
      caret: 3,
    });
  });

  it('有選取範圍時取代選取內容', () => {
    expect(insertTranscript('生果', { ...base, value: '買文具', start: 1, end: 3 })).toEqual({
      value: '買生果',
      caret: 3,
    });
  });

  it('英文／數字前後補一個空格，唔會黏埋', () => {
    expect(insertTranscript('ADR', { ...base, value: '覆核', start: 2, end: 2 })).toEqual({
      value: '覆核 ADR',
      caret: 6,
    });
    expect(insertTranscript('call', { ...base, value: 'then dad', start: 0, end: 0 })).toEqual({
      value: 'call then dad',
      caret: 4,
    });
  });

  it('已有空格時唔會補兩個', () => {
    expect(insertTranscript('ADR', { ...base, value: '覆核 ', start: 3, end: 3 })).toEqual({
      value: '覆核 ADR',
      caret: 6,
    });
  });

  it('超過 maxLength 即截斷，游標停在截斷位', () => {
    expect(insertTranscript('買牛奶飲品', { ...base, value: '今日', start: 2, end: 2, maxLength: 5 })).toEqual({
      value: '今日買牛奶',
      caret: 5,
    });
  });

  it('截斷唔會切爛 surrogate pair（emoji）', () => {
    const out = insertTranscript('😀😀😀', { ...base, maxLength: 2 });
    expect(out.value).toBe('😀');
    expect([...out.value]).toHaveLength(1);
  });

  it('空字串／undefined 原值不變', () => {
    expect(insertTranscript('', { ...base, value: '原句', start: 2, end: 2 })).toEqual({ value: '原句', caret: 2 });
    expect(insertTranscript(undefined, { ...base, value: '原句', start: 2, end: 2 })).toEqual({ value: '原句', caret: 2 });
    expect(insertTranscript('   ', { ...base, value: '原句', start: 2, end: 2 })).toEqual({ value: '原句', caret: 2 });
  });

  it('start / end 超界會 clamp，唔會爆', () => {
    expect(insertTranscript('好', { ...base, value: '今日', start: 99, end: 99 })).toEqual({ value: '今日好', caret: 3 });
    expect(insertTranscript('好', { ...base, value: '今日', start: -5, end: -5 })).toEqual({ value: '好今日', caret: 1 });
    expect(insertTranscript('好', { ...base, value: '今日', start: 2, end: 1 })).toEqual({ value: '今日好', caret: 3 });
  });

  it('預設語言係 zh-HK，可切 zh-CN / en-US', () => {
    expect(DEFAULT_LANG).toBe('zh-HK');
    expect(VOICE_LANGS).toEqual(['zh-HK', 'zh-CN', 'en-US']);
  });
});

describe('mapVoiceError', () => {
  it('權限被拒', () => {
    expect(mapVoiceError('not-allowed')).toContain('權限');
    expect(mapVoiceError('service-not-allowed')).toContain('權限');
  });

  it('聽唔到 / 無麥克風 / 無網絡', () => {
    expect(mapVoiceError('no-speech')).toContain('聽唔到');
    expect(mapVoiceError('audio-capture')).toContain('麥克風');
    expect(mapVoiceError('network')).toContain('連線');
  });

  it('aborted 係靜默（回 null），唔彈錯誤', () => {
    expect(mapVoiceError('aborted')).toBeNull();
  });

  it('未知錯誤有通用文案', () => {
    expect(mapVoiceError('boom')).toContain('再試');
    expect(mapVoiceError(undefined)).toContain('再試');
  });
});

function fakeRecognition() {
  class Fake {
    constructor() {
      Fake.last = this;
      this.started = 0;
      this.stopped = 0;
    }
    start() {
      this.started += 1;
      this.onstart?.();
    }
    stop() {
      this.stopped += 1;
      this.onend?.();
    }
  }
  return Fake;
}

function emitResult(instance, { interim = '', final = '' } = {}) {
  const results = [];
  if (interim) results.push(Object.assign([{ transcript: interim }], { isFinal: false }));
  if (final) results.push(Object.assign([{ transcript: final }], { isFinal: true }));
  instance.onresult?.({ resultIndex: 0, results });
}

describe('createVoiceInput', () => {
  const build = () => {
    const Ctor = fakeRecognition();
    const onState = vi.fn();
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const onError = vi.fn();
    const voice = createVoiceInput({ ctor: Ctor, onState, onInterim, onFinal, onError });
    return { Ctor, voice, onState, onInterim, onFinal, onError };
  };

  it('start 會設定單句模式同語言', () => {
    const { Ctor, voice } = build();
    voice.start();
    expect(Ctor.last.lang).toBe('zh-HK');
    expect(Ctor.last.continuous).toBe(false);
    expect(Ctor.last.interimResults).toBe(true);
    expect(Ctor.last.started).toBe(1);
    expect(voice.getState()).toBe('listening');
  });

  it('可指定語言', () => {
    const { Ctor, voice } = build();
    voice.start({ lang: 'en-US' });
    expect(Ctor.last.lang).toBe('en-US');
  });

  it('interim 結果回呼 onInterim，state 仍然 listening', () => {
    const { Ctor, voice, onInterim } = build();
    voice.start();
    emitResult(Ctor.last, { interim: '買' });
    expect(onInterim).toHaveBeenCalledWith('買');
    expect(voice.getState()).toBe('listening');
  });

  it('final 結果回呼 onFinal 之後回 idle', () => {
    const { Ctor, voice, onFinal, onState } = build();
    voice.start();
    emitResult(Ctor.last, { final: '買牛奶' });
    expect(onFinal).toHaveBeenCalledWith('買牛奶');
    expect(onState).toHaveBeenCalledWith('idle');
  });

  it('未 final 的 interim 唔會觸發 onFinal', () => {
    const { Ctor, voice, onFinal, onInterim } = build();
    voice.start();
    emitResult(Ctor.last, { interim: '買牛' });
    expect(onInterim).toHaveBeenCalledWith('買牛');
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('錯誤會映射成中文並回 idle', () => {
    const { Ctor, voice, onError, onState } = build();
    voice.start();
    Ctor.last.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('權限'));
    expect(onState).toHaveBeenCalledWith('idle');
  });

  it('aborted 唔會叫 onError', () => {
    const { Ctor, voice, onError } = build();
    voice.start();
    Ctor.last.onerror?.({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('toggle 可以開同閂', () => {
    const { Ctor, voice } = build();
    voice.toggle();
    expect(voice.getState()).toBe('listening');
    voice.toggle();
    expect(Ctor.last.stopped).toBeGreaterThan(0);
    expect(voice.getState()).toBe('idle');
  });

  it('重複 start 唔會開兩個 session', () => {
    const { Ctor, voice } = build();
    voice.start();
    const first = Ctor.last;
    voice.start();
    expect(Ctor.last).toBe(first);
    expect(first.started).toBe(1);
  });

  it('不支援時 start 安全咁 no-op', () => {
    const voice = createVoiceInput({ ctor: null });
    expect(voice.isSupported()).toBe(false);
    expect(() => voice.start()).not.toThrow();
    expect(voice.getState()).toBe('idle');
  });
});
