# Todo List · v1

個人待辦清單。一個畫面、一張表、一次 deploy。設計依據 `docs/spec.md` v1.1，視覺用 `todo-theme-proposals.html` 的**方案 F（Split Hybrid）**。

## 架構一覽

| 層 | 實作 |
|---|---|
| 前端 | Vanilla JS ES modules、零 build、`public/` 靜態檔同源 serve |
| 邊緣 | Cloudflare Workers + Static Assets（`assets.binding = ASSETS`、`API_BASE = ''`） |
| 資料 | D1 單表 `todos`，`tags` 以 TEXT 存 JSON array |
| 認證 | Supabase Auth（Google、PKCE），`jose` + JWKS 驗 ES256，Worker 無狀態，只信 `sub` |
| 語音 | 瀏覽器原生 Web Speech API，feature detect 到才顯示麥克風；音頻不經本 app（ADR-007） |
| 日誌 | 結構化 JSON（`level / event / requestId / status / durationMs`），不記錄 token 與標題內容 |

```
src/
  index.js          路由、安全標頭、HTML 執行時注入（config + SDK + SRI）
  auth.js           Bearer 驗證（ES256 / issuer / aud / sub）
  config.js         環境變數集中校驗，缺漏即 500
  validate.js       標題、到期日、tags、查詢參數白名單
  errors.js         型別化錯誤 + 統一 {"error":"..."}
  repo/todos.js     純 SQL（每條都帶 user_id = ?）
  service/todos.js  業務層（不知 HTTP）
  http/todos.js     控制器（解析 → service → JSON）
public/
  index.html        三個 view：#boot / #login-view / #app-view / #editor-view
  styles.css        Theme F：13px 頁首卡、黑色分段導覽、11px 項目卡、圓形 checkbox
  app.js            狀態、渲染、inline 改名、編輯器、語音接線
  lib/              純函數（format / state / voice）＋ API 客戶端（401 自動刷新重試一次）
test/
  unit/             驗證層、SQL 白名單、前端純函數（80 條）
  integration/      真 D1 + 真 ES256 簽名（34 條）
migrations/
  0001_create_todos.sql
```

## 本機啟動

```bash
cp .dev.vars.example .dev.vars     # 填 SUPABASE_URL / SUPABASE_ANON_KEY
npm install
npm run db:local                   # 套用 migration 到本地 D1
npm run dev                        # http://127.0.0.1:8787
```

Supabase Dashboard → Authentication → URL Configuration，加入 `http://127.0.0.1:8787/**`（只加不刪）。

## 測試

```bash
npm test          # vitest + @cloudflare/vitest-pool-workers
```

- 整合測試用真的 D1（`applyD1Migrations`）與真的簽名驗證：金鑰在 `vitest.config.js` 由 Node 生成，公開 JWK 用 miniflare `outboundService` 當 JWKS 回應，私鑰以 binding 傳入 workerd。沒有任何 mocking 庫、沒有假 token。
- 覆蓋：401 各種情境（缺 token／偽造／過期／issuer 不符／aud 陣列）、CRUD、ownership 讀改刪三路徑、已完成置底、三種排序、tag 篩選、SQL 注入字串、壞 JSON、錯誤 body 欄位。

## 部署 checklist（由你親自執行）

1. `npx wrangler d1 create todo-db` → 把回傳的 `database_id` 貼入 `wrangler.jsonc`（現時是全 0 佔位）
2. `npx wrangler secret put SUPABASE_URL`
3. `npx wrangler secret put SUPABASE_ANON_KEY`
4. `npx wrangler d1 execute todo-db --remote --file=./migrations/0001_create_todos.sql`
5. `npx wrangler deploy`
6. Supabase Redirect URLs 加 `https://todo.lamsir.workers.dev/**`

順序很重要：**先 secret 後 deploy**，否則 JWKS 缺 `apikey` 會 500（ADR-005）。prod 一律明確加 `--remote`，不要跑 `migrations apply`。

## 實作時的判斷（需要你確認是否補 ADR）

| # | 事項 | 原因 |
|---|---|---|
| 1 | `assets.run_worker_first: true` | spec §6.1 要求 SRI 與 publishable key **不准寫死**。靜態 HTML 無法在執行時算 hash，所以 `/` 由 Worker 接手：即時抓 SDK、用 SHA-384 算 SRI、連 config 一起注入。靜態檔內零 hash、零 key。 |
| 2 | `GET /api/todos` 多回 `meta.counts` | 進度環在「未完成」tab 下也要顯示整體完成率。`{data:[...]}` 契約不變。 |
| 3 | 排序加 `rowid DESC` tie-breaker | `created_at` 只有秒精度，同一秒建立的項目原本會亂序。 |
| 4 | 編輯入口拆兩個 | 列表編輯圖示 → 完整操作頁（標題／到期日／標籤／刪除）；點標題 → inline 改名。spec §3.2 兩種改法都保留，但只有 inline 改不到到期日與標籤。 |
| 5 | `.npmrc` 設 `legacy-peer-deps` | npm 10 解析 vitest 4 ↔ pool-workers 的 peer 依賴會拋 `edgesOut` 錯誤。 |

## 視覺驗證

`.qa/` 有五張 Playwright 截圖（登入、列表、新增、編輯、桌面）。臨時 QA 頁只在本機產生過，已刪除，不入 commit。
