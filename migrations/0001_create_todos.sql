-- 0001_create_todos.sql
-- 單表 todos；tags 以 TEXT 存 JSON array（ADR-002）；只建一個複合索引（ADR-002）

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0 CHECK(is_done IN (0,1)),
  due_at TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_todos_user_done ON todos(user_id, is_done);
