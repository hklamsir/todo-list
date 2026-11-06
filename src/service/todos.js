import { notFound, serverError } from '../errors.js';
import { countTodos, deleteTodo, insertTodo, listTags, listTodos, updateTodo } from '../repo/todos.js';

/**
 * 業務層：唔知 HTTP，只收 userId + 已校驗嘅資料。
 * 所有寫入都係單一 statement；寫完由 controller 重新拉清單（唔做 optimistic update）。
 */
export async function getTodos(db, userId, query) {
  const data = await listTodos(db, { userId, ...query });
  const tags = await listTags(db, userId);
  const counts = await countTodos(db, userId);
  return { data, meta: { tags, counts } };
}

export async function createTodo(db, userId, payload) {
  const row = await insertTodo(db, {
    id: crypto.randomUUID(),
    userId,
    title: payload.title,
    due_at: payload.due_at,
    tags: payload.tags,
  });
  if (!row) throw serverError('建立待辦失敗');
  return row;
}

export async function patchTodo(db, userId, id, fields) {
  const row = await updateTodo(db, { id, userId, fields });
  if (!row) throw notFound();
  return row;
}

export async function removeTodo(db, userId, id) {
  const deleted = await deleteTodo(db, { id, userId });
  if (!deleted) throw notFound();
  return true;
}
