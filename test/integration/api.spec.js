import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signForgedToken, signToken, TEST_ISSUER } from '../helpers/jwt.js';

const BASE = 'https://todo.test';
const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// 每個測試由乾淨嘅表開始，避免測試之間互相污染。
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM todos').run();
});

async function call(path, { method = 'GET', sub, token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  const bearer = token ?? (sub ? await signToken(sub) : null);
  if (bearer) h.authorization = `Bearer ${bearer}`;

  const init = { method, headers: h };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await SELF.fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, status: res.status, json, text };
}

const create = (sub, payload) => call('/api/todos', { method: 'POST', sub, body: payload });

describe('認證閘門', () => {
  it('無 Authorization → 401 JSON', async () => {
    const { status, json, res } = await call('/api/todos');
    expect(status).toBe(401);
    expect(json).toEqual({ error: 'Unauthorized' });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('偽造簽章 → 401', async () => {
    const forged = await signForgedToken(USER_A);
    expect((await call('/api/todos', { token: forged })).status).toBe(401);
  });

  it('已過期 → 401', async () => {
    const expired = await signToken(USER_A, { expiresIn: -60 });
    expect((await call('/api/todos', { token: expired })).status).toBe(401);
  });

  it('issuer 不符 → 401', async () => {
    const wrongIss = await signToken(USER_A, { issuer: 'https://evil.example/auth/v1' });
    expect((await call('/api/todos', { token: wrongIss })).status).toBe(401);
  });

  it('格式錯誤嘅 Bearer → 401', async () => {
    expect((await call('/api/todos', { token: 'not-a-jwt' })).status).toBe(401);
    expect((await call('/api/todos', { token: '' })).status).toBe(401);
  });

  it('aud 係 array 都接受（ADR-001 不變量）', async () => {
    const token = await signToken(USER_A, { audience: ['authenticated'] });
    expect((await call('/api/todos', { token })).status).toBe(200);
  });

  it('未知 /api 路由：無 token 401，有 token 404（唔洩漏路由）', async () => {
    expect((await call('/api/nope')).status).toBe(401);
    expect((await call('/api/nope', { sub: USER_A })).status).toBe(404);
  });

  it('issuer 正確時 verifier 有打 JWKS path（見 setup 攔截器）', async () => {
    const token = await signToken(USER_A, { issuer: TEST_ISSUER });
    expect((await call('/api/todos', { token })).status).toBe(200);
  });
});

describe('POST /api/todos', () => {
  it('201 回傳新列，tags 係 array，is_done 係 boolean', async () => {
    const { status, json } = await create(USER_A, {
      title: '  交課程計劃書 ',
      due_at: '2026-11-20',
      tags: ['工作', '急', '工作'],
    });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({
      title: '交課程計劃書',
      due_at: '2026-11-20',
      tags: ['工作', '急'],
      is_done: false,
    });
    expect(json.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.data.created_at).toBeTruthy();
  });

  it('可以唔填 due_at 同 tags', async () => {
    const { status, json } = await create(USER_A, { title: '買文具' });
    expect(status).toBe(201);
    expect(json.data.due_at).toBeNull();
    expect(json.data.tags).toEqual([]);
  });

  it('忽略 body 挾帶嘅 user_id（ownership 只認 JWT sub）', async () => {
    const { json } = await create(USER_A, { title: '我的', user_id: USER_B });
    const seen = await call('/api/todos', { sub: USER_A });
    expect(seen.json.data.map((t) => t.id)).toContain(json.data.id);
    const asB = await call('/api/todos', { sub: USER_B });
    expect(asB.json.data.map((t) => t.id)).not.toContain(json.data.id);
  });

  it('標題空白 → 400', async () => {
    expect((await create(USER_A, { title: '   ' })).status).toBe(400);
    expect((await create(USER_A, {})).status).toBe(400);
  });

  it('標題超 200 字 → 400', async () => {
    expect((await create(USER_A, { title: 'x'.repeat(201) })).status).toBe(400);
  });

  it('tags 非 array / 超 10 個 / 單項超 30 字 → 400', async () => {
    expect((await create(USER_A, { title: 't', tags: '工作' })).status).toBe(400);
    expect((await create(USER_A, { title: 't', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status).toBe(400);
    expect((await create(USER_A, { title: 't', tags: ['x'.repeat(31)] })).status).toBe(400);
  });

  it('due_at 格式錯誤 → 400', async () => {
    expect((await create(USER_A, { title: 't', due_at: '2026-02-30' })).status).toBe(400);
    expect((await create(USER_A, { title: 't', due_at: '20/11/2026' })).status).toBe(400);
  });

  it('非法 JSON body → 400，唔會 500', async () => {
    const res = await SELF.fetch(BASE + '/api/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await signToken(USER_A)}` },
      body: '{oops',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe('GET /api/todos', () => {
  it('只回自己嘅，並帶 meta.tags 聯集', async () => {
    await create(USER_A, { title: 'A1', tags: ['工作'] });
    await create(USER_B, { title: 'B1', tags: ['私人'] });

    const { json } = await call('/api/todos', { sub: USER_A });
    expect(json.data.every((t) => t.title !== 'B1')).toBe(true);
    expect(json.meta.tags).toContain('工作');
    expect(json.meta.tags).not.toContain('私人');
  });

  it('meta.counts 反映全部待辦（唔受 status 篩選影響）', async () => {
    await create(USER_A, { title: '未完成嘅' });
    const done = await create(USER_A, { title: '已完成嘅' });
    await call(`/api/todos/${done.json.data.id}`, { method: 'PATCH', sub: USER_A, body: { is_done: true } });

    const { json } = await call('/api/todos?status=active', { sub: USER_A });
    expect(json.data).toHaveLength(1);
    expect(json.meta.counts).toEqual({ total: 2, done: 1 });
  });

  it('已完成置底（sort=due）', async () => {
    const a = await create(USER_A, { title: 'due-12', due_at: '2026-12-01' });
    const b = await create(USER_A, { title: 'due-11', due_at: '2026-11-10' });
    const c = await create(USER_A, { title: 'no-due' });
    const d = await create(USER_A, { title: 'done-old', due_at: '2026-01-01' });
    await call(`/api/todos/${d.json.data.id}`, { method: 'PATCH', sub: USER_A, body: { is_done: true } });

    const { json } = await call('/api/todos?sort=due&status=all', { sub: USER_A });
    const titles = json.data.map((t) => t.title);
    expect(titles).toEqual(['due-11', 'due-12', 'no-due', 'done-old']);
    expect(json.data.at(-1).is_done).toBe(true);
    expect([a, b, c].length).toBe(3);
  });

  it('sort=category 用 tags 第一個元素，無 tag 排前', async () => {
    await create(USER_A, { title: 'tag-beta', tags: ['beta'] });
    await create(USER_A, { title: 'tag-alpha', tags: ['alpha'] });
    await create(USER_A, { title: 'tag-none' });

    const { json } = await call('/api/todos?sort=category&status=all', { sub: USER_A });
    const titles = json.data.map((t) => t.title).filter((t) => t.startsWith('tag-'));
    expect(titles).toEqual(['tag-none', 'tag-alpha', 'tag-beta']);
  });

  it('sort=created 新建立排前', async () => {
    await create(USER_A, { title: 'first-created' });
    await create(USER_A, { title: 'second-created' });
    const { json } = await call('/api/todos?sort=created&status=all', { sub: USER_A });
    const titles = json.data.map((t) => t.title);
    expect(titles.indexOf('second-created')).toBeLessThan(titles.indexOf('first-created'));
  });

  it('status=active / completed 各自篩選', async () => {
    await create(USER_A, { title: 'keep-open' });
    const done = await create(USER_A, { title: 'mark-done' });
    await call(`/api/todos/${done.json.data.id}`, { method: 'PATCH', sub: USER_A, body: { is_done: true } });

    const active = await call('/api/todos?status=active', { sub: USER_A });
    expect(active.json.data.every((t) => t.is_done === false)).toBe(true);
    expect(active.json.data.map((t) => t.title)).toContain('keep-open');

    const completed = await call('/api/todos?status=completed', { sub: USER_A });
    expect(completed.json.data.every((t) => t.is_done === true)).toBe(true);
    expect(completed.json.data.map((t) => t.title)).toContain('mark-done');
  });

  it('tag 篩選用 json_each，多選 tags 中任一命中即算', async () => {
    await create(USER_A, { title: 'multi-tag', tags: ['工作', '急'] });
    await create(USER_A, { title: 'single-tag', tags: ['個人'] });

    const { json } = await call('/api/todos?status=all&tag=' + encodeURIComponent('急'), { sub: USER_A });
    expect(json.data.map((t) => t.title)).toContain('multi-tag');
    expect(json.data.map((t) => t.title)).not.toContain('single-tag');
  });

  it('惡意 sort 參數只會 fallback，唔會 500 亦唔會注入', async () => {
    const { status, json } = await call('/api/todos?sort=' + encodeURIComponent('title; DROP TABLE todos--'), {
      sub: USER_A,
    });
    expect(status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    // 表仍在
    expect((await call('/api/todos', { sub: USER_A })).status).toBe(200);
  });

  it('惡意 tag 參數只會被 bind，唔會注入', async () => {
    const { status, json } = await call("/api/todos?tag=" + encodeURIComponent("x' OR 1=1 --"), { sub: USER_A });
    expect(status).toBe(200);
    expect(json.data).toEqual([]);
  });
});

describe('PATCH /api/todos/:id', () => {
  it('只改 is_done，其餘欄位不變', async () => {
    const created = await create(USER_A, { title: '只勾選', due_at: '2026-11-20', tags: ['工作'] });
    const id = created.json.data.id;

    const { status, json } = await call(`/api/todos/${id}`, { method: 'PATCH', sub: USER_A, body: { is_done: true } });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ id, title: '只勾選', is_done: true, due_at: '2026-11-20', tags: ['工作'] });
  });

  it('只改 title，is_done 不變', async () => {
    const created = await create(USER_A, { title: '舊標題' });
    const id = created.json.data.id;
    await call(`/api/todos/${id}`, { method: 'PATCH', sub: USER_A, body: { is_done: true } });

    const { json } = await call(`/api/todos/${id}`, { method: 'PATCH', sub: USER_A, body: { title: ' 新標題 ' } });
    expect(json.data).toMatchObject({ title: '新標題', is_done: true });
  });

  it('due_at / tags 可清空', async () => {
    const created = await create(USER_A, { title: 't', due_at: '2026-11-20', tags: ['工作'] });
    const id = created.json.data.id;
    const { json } = await call(`/api/todos/${id}`, { method: 'PATCH', sub: USER_A, body: { due_at: null, tags: [] } });
    expect(json.data.due_at).toBeNull();
    expect(json.data.tags).toEqual([]);
  });

  it('改別人嘅 todo → 404', async () => {
    const created = await create(USER_A, { title: 'A 的' });
    const id = created.json.data.id;
    const { status, json } = await call(`/api/todos/${id}`, { method: 'PATCH', sub: USER_B, body: { title: 'hacked' } });
    expect(status).toBe(404);
    expect(json).toEqual({ error: 'Not Found' });

    const still = await call(`/api/todos?status=all`, { sub: USER_A });
    expect(still.json.data.find((t) => t.id === id).title).toBe('A 的');
  });

  it('不存在的 id → 404', async () => {
    expect((await call('/api/todos/does-not-exist', { method: 'PATCH', sub: USER_A, body: { title: 'x' } })).status).toBe(404);
  });

  it('只有非白名單欄位 → 400，且不會改到任何東西', async () => {
    const created = await create(USER_A, { title: '原標題' });
    const id = created.json.data.id;
    const { status } = await call(`/api/todos/${id}`, {
      method: 'PATCH',
      sub: USER_A,
      body: { user_id: USER_B, id: 'x', created_at: '2000-01-01' },
    });
    expect(status).toBe(400);

    const { json } = await call('/api/todos?status=all', { sub: USER_A });
    expect(json.data.find((t) => t.id === id).title).toBe('原標題');
  });

  it('非法 title 值 → 400', async () => {
    const created = await create(USER_A, { title: 'ok' });
    expect((await call(`/api/todos/${created.json.data.id}`, { method: 'PATCH', sub: USER_A, body: { title: '' } })).status).toBe(400);
  });
});

describe('DELETE /api/todos/:id', () => {
  it('200 硬刪，之後 404', async () => {
    const created = await create(USER_A, { title: '要刪' });
    const id = created.json.data.id;

    const first = await call(`/api/todos/${id}`, { method: 'DELETE', sub: USER_A });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ success: true });

    expect((await call(`/api/todos/${id}`, { method: 'DELETE', sub: USER_A })).status).toBe(404);
    const list = await call('/api/todos?status=all', { sub: USER_A });
    expect(list.json.data.map((t) => t.id)).not.toContain(id);
  });

  it('刪別人嘅 → 404，資料仍在', async () => {
    const created = await create(USER_A, { title: '唔准刪' });
    const id = created.json.data.id;
    expect((await call(`/api/todos/${id}`, { method: 'DELETE', sub: USER_B })).status).toBe(404);

    const list = await call('/api/todos?status=all', { sub: USER_A });
    expect(list.json.data.map((t) => t.id)).toContain(id);
  });
});
