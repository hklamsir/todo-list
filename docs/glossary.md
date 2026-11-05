# Todo List · 名詞表（Glossary）

> **目的**：讓「人 / AI / 程式碼」三方用同一套詞彙，避免溝通同實作歧義。本檔只答「點稱呼」；做乜見 `spec.md`，點解見 `ADR.md`。
> **鐵律**：本專案所有註解、變數命名、API 參數、log 訊息、文件，一律使用本表嘅中文詞或英文半形原名；「四、禁用詞表」標 `[禁用]` 嘅寫法唔准出現喺 code 或文件入面。
> **單一真相**：術語定義只喺本表出現；`spec.md` 唔內嵌名詞表，`ADR.md` 唔重述定義；備註欄只落 ADR 編號，唔引用 spec 章節號。
> 建立日期：2026-11-05　狀態：共識（待實作）；對應 ADR-001～005
> 改動傳播：改用字先改本表，再同步三份；新增功能／決策時先對返本表有無孤兒詞。

---

## 一、領域詞（Domain Terms）

| 詞 | 代碼 / English | 定義 | 備註 |
|---|---|---|---|
| Todo／待辦 | `todo` / `todos` | 一條由單一登入用戶擁有嘅待辦事項，含標題、完成狀態、到期日、多選分類 | ADR-002 |
| 標題 | `title` | Todo 必填文字，支援 inline 修改 | ADR-002 |
| 完成狀態 | `is_done` | 0/1 二值，勾選或取消完成共用同一 PATCH | ADR-002 |
| 擁有者 | `user_id` / owner | 由 JWT `sub` 而嚟嘅用戶識別碼，D1 唯一身份欄位，唔存 email / name / avatar | ADR-001、ADR-004 |
| 多選 tags | `tags` | 存喺 `todos.tags TEXT` 嘅 JSON array，一條 Todo 可掛多個分類 | ADR-002 |
| 主分類 | `json_extract(tags,'$[0]')` | 「依分類」排序時取 tags 第一個元素做鍵 | ADR-002 |
| due date | `due_at` | `YYYY-MM-DD` date only 到期日，無時區 | ADR-002 |
| 今日／逾期 | today / overdue | 前端比對本機日期計出嘅提示，唔入 DB | ADR-002 |
| 狀態 tab | `status` | 全部／未完成／已完成三種檢視切換 | ADR-004 |
| 分類篩選 | `tag` / `json_each()` | 展開 `tags` JSON array 後按單一值篩選 | ADR-002 |
| 分類下拉聯集 | tag union | 下拉選項由自己 todos 嘅 tags 聯集產生 | ADR-002 |
| 排序切換 | `sort` | 到期日／建立時間／分類三種排序，偏好存 `localStorage` | ADR-004 |
| 已完成置底 | done-last | 任何排序下 `is_done=1` 一律排最後 | ADR-004 |

## 二、流程與產品詞（Flow / Product）

| 詞 | 代碼 / English | 定義 | 備註 |
|---|---|---|---|
| CRUD 五件事 | CRUD | 新增／列出／勾選或取消完成／inline 改標題／刪除，功能範圍全部 | ADR-002 |
| 硬性 401 | hard 401 | 所有 `/api/*` 無有效 JWT 一律 401，無訪客模式；未登入只見登入頁 | ADR-004 |
| 以 Google 登入 | Google sign-in | UI 唯一登入掣，只做 Google OAuth | ADR-001、ADR-003 |
| 登入回呼 | `?code=` callback | 只處理 PKCE authorization code | ADR-003 |
| ownership isolation | ownership isolation | 每條 SQL 帶 `WHERE id=? AND user_id=?`，`meta.changes===0 → 404` | ADR-004 |
| 統一錯誤 | `{"error":"..."}` | 所有 API 錯誤回同一 JSON 形狀，401 都係 JSON | ADR-004 |
| 本地驗證 | `wrangler dev` | 助手只做到 `127.0.0.1:8787` 本地驗證加 checklist | ADR-005 |

## 三、技術與實作詞（Tech）

| 詞 | 代碼 / English | 定義 | 備註 |
|---|---|---|---|
| Bearer token | `Authorization: Bearer` | 前端 fetch 帶上 Supabase access token 嘅 header | ADR-001 |
| JWT `sub` | `sub` claim | JWT 入面唯一可信嘅用戶 ID，對應 `todos.user_id` | ADR-001 |
| PKCE | PKCE | Supabase JS SDK 授權碼流程 | ADR-001、ADR-003 |
| `autoRefreshToken` | `autoRefreshToken` | SDK 自動刷新 token，token 存 `localStorage` | ADR-001 |
| JWKS | JWKS | `createRemoteJWKSet` 攞公鑰驗簽，path 唔係 `/jwks` | ADR-001 |
| ES256 | ES256 | Supabase JWT 簽章演算法，`jose` 驗證 | ADR-001 |
| `jose` / `createRemoteJWKSet` | `jose` | Worker 驗 JWT 用嘅 lib 同 remote JWK set | ADR-001 |
| `aud` 相容 | `aud` string/array | 驗證 audience 時要相容字串或陣列 | ADR-001 |
| `apikey` header | `apikey` | 打 Supabase JWKS endpoint 必須附帶 | ADR-001 |
| Worker | Cloudflare Worker | 無狀態後端，驗 JWT 加打 D1，唔連 Postgres | ADR-001、ADR-003 |
| D1 | Cloudflare D1 | SQLite 資料庫，單表 `todos` 加一個複合索引 | ADR-002、ADR-005 |
| Static Assets | `assets.binding = "ASSETS"` | 同源托管前端靜態檔，要顯式設 binding | ADR-003 |
| `API_BASE` | `API_BASE=''` | 同源相對路徑，唔設跨網域 base | ADR-003 |
| 白名單 map | allowlist map | `sort` / `status` 經 map 轉 SQL，欄名唔准 interpolate | ADR-004 |
| `json_each()` | `json_each()` | SQLite JSON function，展開 `tags` 做分類篩選 | ADR-002 |
| `meta.changes` | `meta.changes===0` | D1 更新／刪除影響列數，為 0 統一轉 404 | ADR-004 |
| SRI | SRI (Subresource Integrity) | CDN SDK integrity hash，執行時實計 | ADR-003 |
| CSP | CSP | 限制腳本來源，配合 CDN 釘版 | ADR-003 |
| CDN 釘版 | pinned CDN | Supabase SDK 經 CDN 引入並鎖死版本 | ADR-003 |
| 零 key 明文 | `.dev.vars` / runtime inject | publishable key 由環境注入，唔寫死喺 HTML | ADR-003 |
| migration | `wrangler d1 execute --file` | D1 schema 變更唯一做法，絕不 `migrations apply` | ADR-005 |
| Redirect URL | Supabase Redirect URL | 只加不刪，配合 prod worker domain | ADR-003 |
| `wrangler.jsonc` | `wrangler.jsonc` | `name = "todo"`；唔設 `remote:true`／`migrations_dir` | ADR-003、ADR-005 |
| 同源重導 | `origin + '/'` | `*.html` 會 307，OAuth redirect 用 origin 根路徑 | ADR-003 |

## 四、禁用詞表（寫 code / 寫文件都唔准用）

> 豁免：`ADR.md` 嘅 Context 記錄「被否決方案」時可提及左欄寫法，唔算違規；除此之外 code 同文件一律唔准用。

| [禁用] 寫法 | 應該用 |
|---|---|
| 「訪客模式」／「匿名 session」／「未登入可讀」 | 硬性 401 |
| 「tag 表」／`todo_tags`／「global 詞表」 | 多選 tags（`todos.tags` JSON array） |
| 「標籤」 | 多選 tags |
| 「清單」（易混已否決嘅「多清單」） | Todo |
| `migrations apply` / `migrations_dir` | `wrangler d1 execute --file` |
| `remote: true`（wrangler） | 唔設，本地 `wrangler dev` |
| `DB.batch` | 逐條 SQL |
| `ORDER BY ${sort}`／「直接拼 sort 欄名」 | 白名單 map |
| 手填／估嘅 SRI hash、任何寫死嘅 hash 值 | 執行時實計 SRI hash |
| key 寫死喺 HTML | `.dev.vars` / 執行時注入 |
| Email OTP／`?token_hash=&type=` | 只做 Google／`?code=` |
| 拖曳排序／多清單／側欄 | `spec.md` §2 不做項 |

---

*最後更新：2026-11-05 · 44 詞條 · 定義只喺本表 · 交叉引用只落 ADR 編號*
