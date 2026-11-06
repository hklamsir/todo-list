# Todo List — 產品與技術規格書（Spec）

**版本**：1.0（設計共識，v1 已實作）　**最後更新**：2026-11-06　**語言**：繁體中文　**狀態**：設計已定稿；第 7 章係文件交付驗收，code 實作見 `README.md` 同 ADR-006

> 本檔只答「做乜」；決策理由見 `ADR.md`，術語定義見 `glossary.md`。三份各自獨立、僅交叉引用，互不複述。
> 改動傳播：改功能先改本檔 → 睇要唔要加／修 ADR → 對返 glossary 用字；改決策先改 ADR，本檔只改引用編號；改用字先改 glossary，再同步三份。

## 1. 專案概述與目標

一個用 Google 帳戶登入嘅個人 Todo List webapp，部署喺 `https://todo.lamsir.workers.dev`。一個畫面、一張表、一次 deploy 就搞掂，唔整會員系統、唔整協作。

核心價值：**極簡**（新增／列出／勾選／改標題／刪除五件事，加 due date 同多選 tags）、**硬性登入**（所有 `/api/*` 無有效 JWT 一律 401，無訪客）、**零 build**（Vanilla JS 靜態檔同源 serve，一次 `wrangler deploy`）。

技術棧：Cloudflare Workers + Static Assets + D1 + 既有 Supabase Auth（Google）+ `jose` 驗 ES256 JWT。理由見 ADR-001、ADR-003；用語見 `glossary.md`。

## 2. 範圍與不做清單

**In Scope**：CRUD 五件事；due date（`YYYY-MM-DD`）；多選 tags；狀態 tab（全部／未完成／已完成）；分類篩選（選項由自己 todos 嘅 tags 聯集產生）；排序切換（到期日／建立時間／分類，偏好記 `localStorage`）；已完成置底。

**Out of Scope**（右欄只落 ADR 編號，唔喺本檔解釋理由）：

| 不做項 | 對應決定 |
|---|---|
| 多清單／資料夾／專案分組、拖曳排序、側欄 | ADR-002 |
| Email OTP／Email + 密碼／其他 OAuth provider／`?token_hash=&type=` | ADR-003 |
| 訪客模式／匿名 session／未登入可讀 | ADR-004 |
| `tags` / `todo_tags` 獨立表、global 詞表 | ADR-002 |
| 到期時間同時區、軟刪除／回收站、圖片／R2／附件 | ADR-002 |
| 多人協作／分享／Realtime／WebSocket | ADR-004 |
| build step（Vite／bundler）、前後端分離網域、Admin 後台 | ADR-003 |
| 助手代做 prod deploy／secrets／Supabase dashboard | ADR-005 |

## 3. 功能需求

**3.1 認證** — UI 只有一個「以 Google 登入」掣（ADR-003）；Supabase JS SDK 行 PKCE、`autoRefreshToken`、token 存 `localStorage`；回呼落 `/?code=...`，只處理 `?code=` 並用 `history.replaceState` 清 URL；每次 `fetch` 前 `getSession()` 拎最新 `access_token` 帶 Bearer；所有 `/api/*` 無有效 JWT 一律 401（ADR-004）；Worker 無狀態，只靠 `jose` + JWKS 驗 ES256，唔連 Postgres、唔寫 Supabase（ADR-001）。

**3.2 CRUD** — 唔做 optimistic update：每次寫入成功後先整表重繪，送出後掣 disable 到回應，失敗顯示錯誤、畫面不變；所有寫入都係單一 D1 statement，延遲極低。

| 動作 | API | 行為 |
|---|---|---|
| 列出（載入／切 tab／排序／分類／任何寫入後） | `GET /api/todos` | 回傳自己嘅 todos，已完成置底 |
| 新增 | `POST /api/todos` | 201，回傳新列 |
| 勾選／取消 | `PATCH /api/todos/:id` | 只改 `is_done`，其餘唔郁 |
| inline 改標題 | `PATCH /api/todos/:id` | 只改 `title`，其餘唔郁 |
| 刪除 | `DELETE /api/todos/:id` | 200，硬刪 |

**3.3 due date** — `due_at` 只存 `YYYY-MM-DD`，UI 用 `<input type="date">`，可留空；前端比對本機日期計「今日／逾期」提示，唔入 DB、唔做時區轉換。

**3.4 多選 tags 同分類篩選** — `tags` 係 JSON array of strings，寫入端校驗（array、每項 string、trim、1–30 字、最多 10 個、`Set` 去重）；篩選用 `json_each()`；分類下拉由**自己 todos 嘅 tags 聯集**產生，唔查 global 詞表（ADR-002）。

**3.5 狀態 tab 同排序** — 已完成一律置底；`sort`／`status` 偏好存 `localStorage`，`tag` 唔持久化；`sort` / `status` **嚴禁直接 interpolate 落 SQL column name**（ADR-004）；「依分類」取 tags 第一個元素做排序鍵。前端 state 範例：`{"sort":"due","status":"active","tag":"工作"}`。

| 參數 | 可選值 | 白名單 |
|---|---|---|
| `sort` | `due` / `created` / `category` | `SORT_SQL` map，未知 fallback `created` |
| `status` | `all` / `active` / `completed` | `STATUS_SQL` map，未知 fallback `all` |
| `tag` | 任意字串 | 唔係欄名，格式校驗後 `.bind()` |

**3.6 ownership** — 每條 SQL 都帶 `WHERE ... AND user_id = ?`，`user_id` 一律取 JWT `sub`，**完全忽略 body 挾帶嘅 `user_id`**；`UPDATE` / `DELETE` 用 `meta.changes === 0` 判定 404，唔先 SELECT 再改（ADR-004）。

## 4. 資料模型（D1 / SQLite）

Cloudflare D1，單表 `todos`；migration 只走 `wrangler d1 execute --file`（ADR-005）。

```sql
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
```

欄位：`id` = `crypto.randomUUID()`；`user_id` = JWT `sub`，唯一身份欄位；`title` 1–200 字；`is_done` 0/1；`due_at` `YYYY-MM-DD` 可 NULL；`tags` JSON array，DEFAULT `'[]'`；`created_at` / `updated_at` 用 `datetime('now')` UTC，PATCH 時更新後者。只建一個複合索引：最左欄 `user_id` 已隔離用戶並承接 `status` tab，唔再加 `idx_todos_user_id` 呢類重複索引。**唔開 `tags` / `todo_tags` 表**，理由見 ADR-002。

## 5. API 規格

`API_BASE = ''`（同源）；所有 `/api/*` 都要 `Authorization: Bearer`，`OPTIONS` 預檢除外；錯誤統一 `{"error":"..."}`，401 都係 JSON；其他 `/api/*` 路由仍先驗 JWT 先回 404。

| Method | Path | Query / Body | 成功 | 錯誤 |
|---|---|---|---|---|
| GET | `/api/todos` | `?sort=&status=&tag=` | `200 {data:[...]}` | 401 |
| POST | `/api/todos` | `{title, due_at?, tags?}` | `201 {data:row}` | 400 / 401 |
| PATCH | `/api/todos/:id` | `{title?, is_done?, due_at?, tags?}` | `200 {data:row}` | 400 / 401 / 404 |
| DELETE | `/api/todos/:id` | — | `200 {success:true}` | 401 / 404 |

範例：`POST` body `{"title":"交課程計劃書","due_at":"2026-11-20","tags":["工作","急"]}`；錯誤 `{"error":"Unauthorized"}`。

`PATCH` 嘅 SET 片段都要白名單，只 iterate `Object.keys(body)` ∩ `PATCH_FIELDS`，其餘 key 直接忽略；`UPDATE todos SET <白名單片段>, updated_at=datetime('now') WHERE id=? AND user_id=?`、`DELETE FROM todos WHERE id=? AND user_id=?`，兩者 `meta.changes === 0` → 404。權限模型見 ADR-004。

## 6. 非功能性需求

**6.1 安全** — 硬性 401；`jose` + `createRemoteJWKSet` 驗 ES256；JWKS path 係 `/auth/v1/.well-known/jwks.json`（**唔係** `/jwks`），要帶 `apikey` header；`aud` 相容 string `'authenticated'` 或 array；issuer `<SUPABASE_URL>/auth/v1`。只信 `sub`，D1 唔存 email / display name / avatar，前端由 Supabase `user` object 顯示。`sort` / `status` / `PATCH` SET 全走白名單 map。Supabase SDK 經 CDN 釘版 + SRI + CSP；**SRI hash 執行時實計，文件同 code 都唔准寫死任何 hash 或 key 值**；publishable key 由 `.dev.vars` 或執行時注入。見 ADR-001、ADR-003、ADR-004。

**6.2 UX** — 一個「以 Google 登入」掣；單頁用 `hidden` 切 `#login-view` / `#app-view`，唔跳頁；`<input type="date">`、今日／逾期提示、狀態 tab、分類下拉、`localStorage` 排序偏好、已完成置底。`*.html` 會被 Cloudflare html_handling 做 307，所有 OAuth redirect 同連結一律 `origin + '/'`。每次 `getSession()` 重拎 token 避免 refresh 後用舊值，`SIGNED_OUT` 回登入頁。

**6.3 部署設定**

| 設定 | 值 |
|---|---|
| `wrangler.jsonc` `name` / prod URL | `todo` / `https://todo.lamsir.workers.dev` |
| `assets` | `directory = ./public`，`binding = "ASSETS"`（顯式） |
| `d1_databases` | `binding = "DB"`，`database_name = "todo-db"` |
| `remote` / `migrations_dir` | **兩個都唔設** |
| Redirect URL | 新增 `https://todo.lamsir.workers.dev/**` 同 `http://127.0.0.1:8787/**`，**只加不刪** padlet 既有 |
| local dev / 上線 | `npx wrangler dev` → `127.0.0.1:8787`；一次 `npx wrangler deploy`（Worker + Static Assets 同源） |

production secrets、Supabase dashboard 同 prod deploy 由用戶親自執行；助手只做到 local 驗證 + 產出 checklist，唔要求憑證（ADR-005）。

## 7. 驗收標準

本輪交付物係**文件**，驗收針對文件完整性，唔係 code 行得通。

1. 三份檔喺 `docs/`，檔名精確係 `spec.md` / `ADR.md` / `glossary.md`。
2. 本檔恰好 7 章、120–160 行；無 Change Log、無使用者角色章、無名詞表、無 ADR 摘要章、無附錄。
3. 本檔檔頭有 `**語言**：繁體中文`；§4 有完整定稿 DDL；§5 有 4 列 API 表；§6 有設定表。
4. `ADR.md` 恰好 6 則、ADR-001～006 連續；每則齊 5 欄；Context 有寫被否決方案同兩次範圍收窄。
5. `glossary.md` 三章 + 禁用詞表、四欄表頭、44 詞條，每詞備註有 ADR 編號。
6. 無雙重真相：DDL 只喺本檔、ADR 狀態欄只喺 `ADR.md`、詞條表只喺 `glossary.md`。
7. 所有交叉引用解析得到：本檔嘅 ADR 編號、ADR 嘅章節號、glossary 備註嘅 ADR 編號全部有效。
8. 正文繁體中文、技術詞保留 English，無簡體殘留。
9. 單一 `docs:` commit；無任何 `.js` / `.sql` 可執行檔入 commit。

**本 Spec 為設計共識版本 1.0，v1 已按此實作（2026-11-06）。**
