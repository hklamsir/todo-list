import { jsonResponse, methodNotAllowed, notFound, readJson } from '../errors.js';
import { createTodo, getTodos, patchTodo, removeTodo } from '../service/todos.js';
import { parseCreateBody, parseListQuery, parsePatchBody } from '../validate.js';

/** 控制器：只做「解析請求 → 呼叫 service → 格式化回應」，唔含業務邏輯。 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function handleTodos(request, env, url, userId) {
  switch (request.method) {
    case 'GET': {
      const query = parseListQuery(url.searchParams);
      return jsonResponse(await getTodos(env.DB, userId, query));
    }
    case 'POST': {
      const payload = parseCreateBody(await readJson(request));
      const row = await createTodo(env.DB, userId, payload);
      return jsonResponse({ data: row }, 201);
    }
    default:
      throw methodNotAllowed();
  }
}

export async function handleTodoById(request, env, id, userId) {
  if (!ID_PATTERN.test(id)) throw notFound();

  switch (request.method) {
    case 'PATCH': {
      const fields = parsePatchBody(await readJson(request));
      const row = await patchTodo(env.DB, userId, id, fields);
      return jsonResponse({ data: row });
    }
    case 'DELETE': {
      await removeTodo(env.DB, userId, id);
      return jsonResponse({ success: true });
    }
    default:
      throw methodNotAllowed();
  }
}
