import { createApi } from './lib/api.js';
import { formatDue, tagUnion, todayISO } from './lib/format.js';
import { buildQuery, loadPrefs, savePrefs } from './lib/state.js';
import { DEFAULT_LANG, VOICE_LANGS, createVoiceInput, getSpeechCtor, insertTranscript, isMicrophoneAllowed, mapVoiceError } from './lib/voice.js';

const cfg = window.__APP_CONFIG__ ?? {};

const ICON = {
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const $ = (id) => document.getElementById(id);

const el = {
  boot: $('boot'),
  login: $('login-view'),
  app: $('app-view'),
  editor: $('editor-view'),
  loginBtn: $('login-btn'),
  loginError: $('login-error'),
  kicker: $('head-kicker'),
  sub: $('head-sub'),
  ring: $('ring'),
  ringText: $('ring-text'),
  list: $('list'),
  empty: $('empty'),
  emptyTitle: $('empty-title'),
  emptyHint: $('empty-hint'),
  banner: $('banner'),
  sort: $('sort-select'),
  tag: $('tag-select'),
  addBtn: $('add-btn'),
  signoutBtn: $('signout-btn'),
  seg: document.querySelector('.seg'),
  form: $('todo-form'),
  editorTitle: $('editor-title'),
  editorError: $('editor-error'),
  back: $('editor-back'),
  fTitle: $('f-title'),
  titleWrap: $('title-wrap'),
  voiceBtn: $('voice-btn'),
  voiceLang: $('voice-lang'),
  fDue: $('f-due'),
  fTag: $('f-tag'),
  tagChips: $('tag-chips'),
  tagAdd: $('tag-add'),
  dueClear: $('due-clear'),
  dueHint: $('due-hint'),
  titleHint: $('title-hint'),
  saveBtn: $('save-btn'),
  deleteBtn: $('delete-btn'),
  cancelBtn: $('cancel-btn'),
};

const state = {
  prefs: loadPrefs(safeStorage()),
  tag: '',
  todos: [],
  tags: [],
  counts: { total: 0, done: 0 },
  editingId: null,
  editTags: [],
  busy: false,
  inApp: false,
  client: null,
  api: null,
};

function safeStorage() {
  try {
    const probe = '__todo__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/* ---------------- 語音輸入（ADR-007 / spec §3.7） ---------------- */

const speechCtor = getSpeechCtor(window);
const micPolicy = document.permissionsPolicy || document.featurePolicy;
const micAllowed = isMicrophoneAllowed(micPolicy);
let micPermission = null;
let voiceBase = { value: '', start: 0, end: 0 };

/** 記住麥克風權限狀態，令撳掣嗰刻唔需要 await（保留 user gesture）。 */
async function refreshMicPermission() {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' });
    micPermission = status?.state ?? null;
  } catch {
    micPermission = null;
  }
}

const voice = createVoiceInput({
  ctor: speechCtor,
  lang: DEFAULT_LANG,
  onState: (next) => {
    const listening = next === 'listening';
    el.voiceBtn.classList.toggle('is-listening', listening);
    el.voiceBtn.setAttribute('aria-pressed', String(listening));
    el.voiceBtn.setAttribute('aria-label', listening ? '停止語音輸入' : '用語音輸入標題');
    if (listening) el.titleHint.textContent = '錄音中… 再撳一下停止';
    else updateTitleHint();
  },
  onInterim: (text) => applyVoiceText(text, false),
  onFinal: (text) => applyVoiceText(text, true),
  onError: (message, code) => {
    if (code !== 'not-allowed') {
      showEditorError(message);
      return;
    }
    // 分清「用戶封鎖」同「請求根本冇送到瀏覽器」，提示才有用
    refreshMicPermission().then((permission) => {
      showEditorError(mapVoiceError(code, { permission }));
    });
  },
});

/** interim 只做預覽，final 才把游標推到插入點之後。 */
function applyVoiceText(text, isFinal) {
  if (!text) return;
  const { value, caret } = insertTranscript(text, { ...voiceBase, maxLength: 200 });
  el.fTitle.value = value;
  if (!isFinal) return;

  voiceBase = { value, start: caret, end: caret };
  el.fTitle.focus();
  el.fTitle.setSelectionRange(caret, caret);
}

/* ---------------- 視圖切換 ---------------- */

function show(view) {
  el.boot.hidden = true;
  el.login.hidden = view !== 'login';
  el.app.hidden = view !== 'app';
  el.editor.hidden = view !== 'editor';
}

function showLogin(message) {
  state.inApp = false;
  show('login');
  if (el.login) el.login.hidden = false;
  el.loginError.hidden = !message;
  el.loginError.textContent = message || '';
  el.loginBtn.disabled = Boolean(cfg.configError) || !cfg.sdkReady;
}

async function enterApp() {
  if (state.inApp) return;
  state.inApp = true;
  show('app');
  el.kicker.textContent = `TO DO / ${String(new Date().getDate()).padStart(2, '0')} ${MONTHS[new Date().getMonth()]}`;
  await refresh();
}

/* ---------------- 資料 ---------------- */

async function refresh() {
  setBusy(true);
  try {
    const res = await state.api.list(buildQuery(state.prefs, state.tag));
    state.todos = Array.isArray(res?.data) ? res.data : [];
    state.tags = Array.isArray(res?.meta?.tags) ? res.meta.tags : tagUnion(state.todos);
    state.counts = res?.meta?.counts ?? { total: state.todos.length, done: state.todos.filter((t) => t.is_done).length };
    hideBanner();
    render();
  } catch (err) {
    handleError(err);
  } finally {
    setBusy(false);
  }
}

function handleError(err) {
  const message = err?.message || '發生未知錯誤';
  if (err?.status === 401) {
    showLogin('登入已失效，請重新登入。');
    return;
  }
  showBanner(message);
}

function showBanner(message) {
  el.banner.hidden = !message;
  el.banner.textContent = message || '';
}

function hideBanner() {
  el.banner.hidden = true;
  el.banner.textContent = '';
}

function setBusy(busy) {
  state.busy = busy;
  el.list.classList.toggle('is-busy', busy);
  el.saveBtn.disabled = busy;
  el.deleteBtn.disabled = busy;
  el.addBtn.disabled = busy;
}

/* ---------------- 渲染 ---------------- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function render() {
  const { total, done } = state.counts;
  const active = Math.max(total - done, 0);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  el.sub.textContent = `未完成 ${pad2(active)} ／ 已完成 ${pad2(done)}`;
  el.ring.style.setProperty('--pct', String(percent));
  el.ring.setAttribute('aria-label', `完成進度 ${percent}%`);
  el.ringText.textContent = `${done}/${total}`;

  for (const btn of el.seg.querySelectorAll('[role="tab"]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.status === state.prefs.status));
  }
  el.sort.value = state.prefs.sort;

  renderTagOptions();
  renderList();
}

function renderTagOptions() {
  const tags = state.tags;
  if (state.tag && !tags.includes(state.tag)) state.tag = '';

  el.tag.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '全部';
  el.tag.append(all);

  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    el.tag.append(option);
  }
  el.tag.value = state.tag;
}

function renderList() {
  el.list.innerHTML = '';

  if (state.todos.length === 0) {
    el.empty.hidden = false;
    const doneSomething = state.counts.total > 0;
    if (state.prefs.status === 'active' && doneSomething) {
      el.emptyTitle.textContent = '全部做完，好嘢';
      el.emptyHint.textContent = '切去「已完成」睇返做過啲乜。';
    } else if (state.prefs.status === 'completed') {
      el.emptyTitle.textContent = '仲未完成任何一件';
      el.emptyHint.textContent = '勾選左邊嘅圓圈就會喺度出現。';
    } else {
      el.emptyTitle.textContent = state.tag ? `「${state.tag}」未有項目` : '清單好乾淨';
      el.emptyHint.textContent = '撳下面「新增待辦」開始。';
    }
    return;
  }

  el.empty.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const todo of state.todos) fragment.append(renderItem(todo));
  el.list.append(fragment);
}

function renderItem(todo) {
  const li = document.createElement('li');
  li.className = `item${todo.is_done ? ' is-done' : ''}`;
  li.dataset.id = todo.id;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', String(Boolean(todo.is_done)));
  check.setAttribute('aria-label', `${todo.is_done ? '取消完成' : '標記完成'}：${todo.title}`);

  const box = document.createElement('span');
  box.className = 'check-box';
  box.innerHTML = ICON.check;
  check.append(box);

  const main = document.createElement('div');
  main.className = 'item-main';

  const title = document.createElement('div');
  title.className = 'item-title';
  title.textContent = todo.title;
  title.title = todo.title;

  const meta = document.createElement('div');
  meta.className = 'item-meta';

  const due = formatDue(todo.due_at, todayISO());
  const dueEl = document.createElement('span');
  dueEl.className = `due due--${due.tone}`;
  dueEl.innerHTML = ICON.cal;
  const dueText = document.createElement('span');
  dueText.textContent = due.text;
  dueEl.append(dueText);
  meta.append(dueEl);

  for (const tag of Array.isArray(todo.tags) ? todo.tags : []) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    meta.append(chip);
  }

  main.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'icon-btn';
  edit.dataset.action = 'edit';
  edit.setAttribute('aria-label', `編輯：${todo.title}`);
  edit.innerHTML = ICON.edit;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn';
  remove.dataset.action = 'delete';
  remove.setAttribute('aria-label', `刪除：${todo.title}`);
  remove.innerHTML = ICON.trash;

  actions.append(edit, remove);
  li.append(check, main, actions);
  return li;
}

/* ---------------- 列表操作 ---------------- */

function findTodo(id) {
  return state.todos.find((todo) => todo.id === id) ?? null;
}

async function toggleDone(todo) {
  if (state.busy) return;
  setBusy(true);
  try {
    await state.api.update(todo.id, { is_done: !todo.is_done });
    await refresh();
  } catch (err) {
    handleError(err);
    setBusy(false);
  }
}

async function removeTodo(todo) {
  if (state.busy) return;
  if (!window.confirm(`刪除「${todo.title}」？刪除後無法復原。`)) return;
  setBusy(true);
  try {
    await state.api.remove(todo.id);
    await refresh();
  } catch (err) {
    handleError(err);
    setBusy(false);
  }
}

function startInlineEdit(li, todo) {
  const titleEl = li.querySelector('.item-title');
  if (!titleEl || li.dataset.editing === '1') return;
  li.dataset.editing = '1';

  const input = document.createElement('input');
  input.className = 'item-title-input';
  input.type = 'text';
  input.maxLength = 200;
  input.value = todo.title;
  input.setAttribute('aria-label', '編輯標題');
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;

  const commit = async () => {
    if (settled) return;
    settled = true;
    const next = input.value.trim();
    if (next === '' || next === todo.title) {
      render();
      return;
    }
    setBusy(true);
    try {
      await state.api.update(todo.id, { title: next });
      await refresh();
    } catch (err) {
      handleError(err);
      setBusy(false);
      render();
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      settled = true;
      render();
    }
  });
}

/* ---------------- 編輯器 ---------------- */

function openEditor(todo) {
  voice.stop();
  refreshMicPermission();
  state.editingId = todo ? todo.id : null;
  state.editTags = todo ? [...(todo.tags ?? [])] : [];
  el.editorTitle.textContent = todo ? '編輯待辦' : '新增待辦';
  el.fTitle.value = todo ? todo.title : '';
  el.fDue.value = todo?.due_at ?? '';
  el.fTag.value = '';
  el.editorError.hidden = true;
  el.deleteBtn.hidden = !todo;
  el.deleteBtn.parentElement.classList.toggle('row--single', !todo);

  updateTitleHint();
  updateDueHint();
  renderTagChips();

  show('editor');
  el.fTitle.focus();
}

function closeEditor() {
  voice.stop();
  state.editingId = null;
  state.editTags = [];
  show('app');
}

function renderTagChips() {
  const all = [...new Set([...state.tags, ...state.editTags])].sort();
  el.tagChips.innerHTML = '';

  for (const tag of all) {
    const selected = state.editTags.includes(tag);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-toggle';
    btn.setAttribute('aria-pressed', String(selected));
    btn.dataset.tag = tag;
    if (selected) btn.innerHTML = ICON.check;
    const label = document.createElement('span');
    label.textContent = tag;
    btn.append(label);
    el.tagChips.append(btn);
  }
}

function addTag(raw) {
  const tag = raw.trim();
  if (tag === '') return false;
  if (tag.length > 30) {
    showEditorError('每個標籤最多 30 字');
    return false;
  }
  if (state.editTags.includes(tag)) return false;
  if (state.editTags.length >= 10) {
    showEditorError('最多 10 個標籤');
    return false;
  }
  state.editTags.push(tag);
  el.editorError.hidden = true;
  renderTagChips();
  return true;
}

function showEditorError(message) {
  el.editorError.hidden = !message;
  el.editorError.textContent = message || '';
}

function updateTitleHint() {
  if (voice.getState() === 'listening') return;
  const length = el.fTitle.value.trim().length;
  el.titleHint.textContent = length === 0 ? '1–200 字' : `${length} / 200 字`;
}

function updateDueHint() {
  const value = el.fDue.value;
  const due = formatDue(value, todayISO());
  el.dueHint.textContent = due.tone === 'none' ? '可以留空 · 只用日期，唔計時區' : `${due.text} · 只用日期，唔計時區`;
}

async function submitEditor(event) {
  event.preventDefault();
  if (state.busy) return;

  const title = el.fTitle.value.trim();
  if (title === '') {
    showEditorError('請輸入待辦標題');
    el.fTitle.focus();
    return;
  }
  if (title.length > 200) {
    showEditorError('標題最多 200 字');
    el.fTitle.focus();
    return;
  }

  const payload = {
    title,
    due_at: el.fDue.value || null,
    tags: state.editTags,
  };

  setBusy(true);
  showEditorError('');
  try {
    if (state.editingId) await state.api.update(state.editingId, payload);
    else await state.api.create(payload);
    await refresh();
    closeEditor();
  } catch (err) {
    if (err?.status === 401) {
      closeEditor();
      handleError(err);
      return;
    }
    showEditorError(err?.message || '儲存失敗，請再試一次');
  } finally {
    setBusy(false);
  }
}

async function deleteEditing() {
  if (!state.editingId || state.busy) return;
  if (!window.confirm('刪除這件待辦？刪除後無法復原。')) return;

  setBusy(true);
  try {
    await state.api.remove(state.editingId);
    await refresh();
    closeEditor();
  } catch (err) {
    if (err?.status === 401) {
      closeEditor();
      handleError(err);
      return;
    }
    showEditorError(err?.message || '刪除失敗，請再試一次');
  } finally {
    setBusy(false);
  }
}

/* ---------------- 事件 ---------------- */

function bindEvents() {
  el.loginBtn.addEventListener('click', async () => {
    el.loginBtn.disabled = true;
    const { error } = await state.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) {
      el.loginBtn.disabled = false;
      el.loginError.hidden = false;
      el.loginError.textContent = error.message;
    }
  });

  el.signoutBtn.addEventListener('click', async () => {
    await state.client.auth.signOut();
    showLogin('');
  });

  el.seg.addEventListener('click', (event) => {
    const btn = event.target.closest('[role="tab"]');
    if (!btn) return;
    state.prefs = { ...state.prefs, status: btn.dataset.status };
    savePrefs(safeStorage(), state.prefs);
    render();
    refresh();
  });

  el.sort.addEventListener('change', () => {
    state.prefs = { ...state.prefs, sort: el.sort.value };
    savePrefs(safeStorage(), state.prefs);
    refresh();
  });

  el.tag.addEventListener('change', () => {
    state.tag = el.tag.value;
    refresh();
  });

  el.list.addEventListener('click', (event) => {
    const li = event.target.closest('.item');
    if (!li) return;
    const todo = findTodo(li.dataset.id);
    if (!todo) return;

    // 點標題 → inline 改標題；編輯圖示 → 開完整操作頁（標題／到期日／標籤／刪除）
    if (event.target.closest('.item-title')) {
      startInlineEdit(li, todo);
      return;
    }

    const button = event.target.closest('button');
    if (!button) return;

    if (button.classList.contains('check')) toggleDone(todo);
    else if (button.dataset.action === 'edit') openEditor(todo);
    else if (button.dataset.action === 'delete') removeTodo(todo);
  });

  el.addBtn.addEventListener('click', () => openEditor(null));
  el.back.addEventListener('click', closeEditor);
  el.cancelBtn.addEventListener('click', closeEditor);

  el.form.addEventListener('submit', submitEditor);
  el.deleteBtn.addEventListener('click', deleteEditing);

  el.fTitle.addEventListener('input', updateTitleHint);
  el.fDue.addEventListener('change', updateDueHint);

  // 語音：冇 API 或 Permissions-Policy 封鎖 microphone，都唔顯示掣（唔可以有壞掣）
  if (speechCtor && micAllowed) {
    el.voiceBtn.hidden = false;
    el.voiceLang.hidden = false;
    el.titleWrap.classList.add('has-voice');

    el.voiceBtn.addEventListener('click', () => {
      if (voice.getState() === 'listening') {
        voice.stop();
        return;
      }
      if (micPermission === 'denied') {
        showEditorError(mapVoiceError('not-allowed', { permission: 'denied' }));
        return;
      }
      const start = el.fTitle.selectionStart ?? el.fTitle.value.length;
      const end = el.fTitle.selectionEnd ?? start;
      voiceBase = { value: el.fTitle.value, start, end };
      showEditorError('');
      const lang = VOICE_LANGS.includes(el.voiceLang.value) ? el.voiceLang.value : DEFAULT_LANG;
      voice.start({ lang });
    });

    el.voiceLang.addEventListener('change', () => {
      voice.setLang(el.voiceLang.value);
    });
  } else if (speechCtor && !micAllowed) {
    console.warn('[voice] Permissions-Policy 封鎖了 microphone，麥克風按鈕已隱藏');
  }

  el.dueClear.addEventListener('click', () => {
    el.fDue.value = '';
    updateDueHint();
  });

  el.tagChips.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip-toggle');
    if (!btn) return;
    const tag = btn.dataset.tag;
    if (state.editTags.includes(tag)) state.editTags = state.editTags.filter((item) => item !== tag);
    else if (!addTag(tag)) return;
    el.editorError.hidden = true;
    renderTagChips();
  });

  el.tagAdd.addEventListener('click', () => {
    if (addTag(el.fTag.value)) el.fTag.value = '';
    el.fTag.focus();
  });

  el.fTag.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      if (addTag(el.fTag.value)) el.fTag.value = '';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.editor.hidden) closeEditor();
  });
}

/* ---------------- 啟動 ---------------- */

async function boot() {
  if (cfg.configError) {
    showLogin(`服務未設定：${cfg.configError}`);
    return;
  }
  if (!cfg.sdkReady || !window.supabase?.createClient) {
    showLogin('登入服務未能載入（可能被網絡封鎖）。請重新整理再試。');
    return;
  }

  state.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  state.api = createApi({
    getToken: async () => {
      const { data } = await state.client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    onUnauthorized: async () => {
      const { data, error } = await state.client.auth.refreshSession();
      return !error && Boolean(data?.session);
    },
  });

  bindEvents();

  state.client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      window.setTimeout(() => showLogin(''), 0);
    } else if (event === 'SIGNED_IN' && session) {
      window.setTimeout(() => enterApp(), 0);
    }
  });

  const params = new URLSearchParams(window.location.search);
  const urlError = params.get('error_description') || params.get('error');

  const { data } = await state.client.auth.getSession();
  if (window.location.search) window.history.replaceState(null, '', '/');

  if (data.session) {
    await enterApp();
  } else {
    showLogin(urlError ? `登入未完成：${urlError}` : '');
  }
}

boot();
