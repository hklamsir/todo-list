# Todo List · 架構決策紀錄（ADR）

> 本檔只記錄「難以回頭、冇背景說明會令後人意外嘅決定」；純技術小決定（變數命名、CSS 細節）不記。
> 本檔只答「點解咁決定」；做乜見 `spec.md`，點稱呼見 `glossary.md`。三份互不複述、無雙重真相。
> 建立日期：2026-11-05　狀態：ADR-001～005 全部 Accepted（2026-11-05 設計共識，待實作）
> 範圍收窄軌跡：full combo → 只做 Google ＋ 單表；三表 tags → `todos.tags TEXT` JSON array。呢兩次收窄係本檔最有價值嘅內容。
> 改動傳播：改決策先改本檔（新增或改 Status），`spec.md` 只改引用編號、唔搬理由入去；改功能先改 spec；改用字先改 glossary。

---

## ADR-001: 沿用既有 Supabase project ＋ `jose` ES256 驗證、Worker 無狀態、只信 `sub`

- **Status:** Accepted（2026-11-05 設計共識，待實作）
- **Context:** 新 app 要 Google 登入，但本機已有一個跑通嘅 Supabase project（`waerfnbazlebjjhnqfrb.supabase.co`），連 Google provider、Redirect URL、ES256 JWKS 驗證嘅坑都踩過。被否決嘅替代方案：① 開新 Supabase project（要重設 OAuth client、重新拎 key、重新除錯 JWKS）；② Worker 自己管 session cookie 或連 Postgres 驗 token（多一層狀態、多一跳）；③ 把 email / display name / avatar 寫入 D1（多一份 PII、要處理 sync）；④ HS256 共用 secret（要將 signing secret 擺落 Worker）。
- **Decision:**
  - 沿用既有 project，同 `my-padlet-api` 共用 user pool；只喺 Supabase Auth **新增**兩條 Redirect URL，唔刪既有。
  - Worker 用 `jose` + `createRemoteJWKSet` 驗 ES256 JWT，完全無狀態；前端 Supabase JS SDK 行 PKCE、`autoRefreshToken`、token 存 `localStorage`、fetch 帶 Bearer。
  - D1 只存 `user_id` = JWT `sub`；身份顯示交畀前端嘅 Supabase `user` object。
  - 流程見 `spec.md` §3.1、§6.1。
- **Rationale:** 共用 pool 零搬遷、零重新申請 OAuth；只信 `sub` 令 DB 唔掂 PII；無狀態貼合邊緣運算模型，Worker 唔使記 session；ES256 用公鑰驗，唔使將 signing secret 擺落 Worker。
- **Consequences / 後人注意:**
  - **不變量**：JWKS path 係 `/auth/v1/.well-known/jwks.json`（唔係 `/jwks`），所有 auth endpoint 要帶 `apikey` header；`aud` 要相容 string `'authenticated'` 或 array；issuer 係 `<SUPABASE_URL>/auth/v1`。
  - token 存 `localStorage` 係已知取捨（JS 讀到 token）；本 app 無 user-generated HTML、無第三方 inline script，風險可控。
  - 兩個 app 嘅 session 存喺各自 origin 嘅 `localStorage`，登出互不影響；但共用 user pool，日後改 project 層設定（JWT secret、Site URL）要同時驗兩個 app。

---

## ADR-002: D1 單表 `todos.tags TEXT` 存 JSON array，不開 `tags` / `todo_tags`

- **Status:** Accepted（2026-11-05 設計共識，待實作）
- **Context:** 開場要求「功能唔太複雜」，但決策過程出現**兩次範圍收窄**，呢兩段係後人最易誤解嘅位：
  - **收窄一**：用戶先揀 full combo（CRUD ＋ due date ＋ 分類 ＋ **多清單** ＋ **拖曳排序** ＋ 側欄），經指出同「唔太複雜」矛盾後，自行收窄到 CRUD 五件事 ＋ due date ＋ 分類，明確唔做多清單／拖曳／側欄。
  - **收窄二**：用戶之後明確要**多選 tags**，即使已知正規化要開 `todos` + `tags` + `todo_tags` 三張表仍照揀。被否決嘅三表方案代價：FK cascade 清理、`db.batch()` sync 關聯（D1 batch 唔係真正 ACID）、篩選要 JOIN，而且 **global 詞表會令 A 用戶打過嘅字出現喺 B 用戶嘅 autocomplete，屬資料洩漏**。
  - 其他被否決：KV（read-modify-write race）、Durable Objects（過度設計）、直接用 Supabase Postgres（多一跳 + RLS，Worker 變得可有可無）。
- **Decision:**
  - 功能範圍鎖死喺收窄一嘅結果；`todos` 保持**單表**，`tags` 用 TEXT 存 JSON array，篩選用 `json_each()`，分類排序用 `json_extract(tags,'$[0]')`。
  - `due_at` 只存 `YYYY-MM-DD`（date only），唔掂時區。
  - 狀態 tab（全部／未完成／已完成）同分類篩選**兩個都要**；分類下拉由自己 todos 嘅 tags 聯集產生。
  - 表結構見 `spec.md` §4；功能見 §3.3、§3.4。
- **Rationale:** 單表折衷同時滿足「多選 tags」同「唔太複雜」；tags 天然跟住 row、天然 per-user，上面嗰個私隱問題自動消失；date only 避開時區同 DST；個人資料量細，唔使為三種排序各建索引。
- **Consequences / 後人注意:**
  - **不變量**：tags 無正規化、無 global 詞表；**tags 第一個元素當主分類**係排序約定，改動要同步 `spec.md` §3.5。
  - 寫入端要嚴格校驗 JSON array，讀取端用 `json_valid()` 防髒資料；tag 改名要 UPDATE 所有相關 row（本來就唔做 tag 管理頁）。
  - 唔好喺實作時擅自加返多清單／拖曳排序／側欄 —— 呢個係用戶明確收窄嘅決定。
  - 唔好再加 `idx_todos_user_id` 呢類重複索引；最左欄 `user_id` 已隔離用戶並承接 `status` tab。

---

## ADR-003: Vanilla JS ＋ Static Assets 同源、CDN 釘版 ＋ SRI ＋ CSP，無 build step

- **Status:** Accepted（2026-11-05 設計共識，待實作）
- **Context:** 功能收窄到一個畫面、四至五個 endpoint，但登入頁要引入 Supabase JS SDK，而呢個 SDK 會掂到 access token，屬 supply-chain 考量。被否決嘅替代方案：① Vite/React + build step（得幾個 component，唔抵）；② 前後端分離網域（要處理 CORS 同兩次 deploy）；③ 將 SDK 打包入 repo（要引入 bundler 先送得到 static assets）；④ 自己寫 PKCE helper 唔用 SDK（零第三方 JS，但多約百行同 refresh corner case）；⑤ **SRI hash 手填假值**或 key 寫死喺 HTML；⑥ 支援 Email OTP `?token_hash=&type=`（最終收窄到**只做 Google**，callback 只處理 `?code=`）；⑦ 沿用 padlet 嗰套浮動 `@2` CDN 而無 SRI/CSP。
- **Decision:**
  - `wrangler.jsonc` 的 `name = "todo"`；`assets.directory = ./public` 且**顯式** `binding = "ASSETS"`；`API_BASE = ''` 同源；Worker + Static Assets 一次 `wrangler deploy`。
  - 前端 Vanilla JS、無 build step；單頁用 `hidden` 切兩個 view，唔跳頁。
  - Supabase SDK 經 CDN **釘死確切版本** + `integrity` (SRI) + `crossorigin` + CSP 白名單；**SRI hash 執行時用工具實計，文件同 code 都唔准寫死任何 hash 或 key 值**；publishable key 由 `.dev.vars` 或執行時注入。
  - 只做 Google，UI 只有一個「以 Google 登入」掣；OAuth redirect 一律 `origin + '/'`。
  - 設定見 `spec.md` §6.2、§6.3；登入流程見 §3.1。
- **Rationale:** 零 build、零 CORS、一次部署；釘版 + SRI + CSP 將「第三方 host 被改動就讀到 token」嘅風險鎖到最低，代價只係升級時要同步更新版本、hash 同 CSP domain。
- **Consequences / 後人注意:**
  - **不變量**：`*.html` 會被 Cloudflare html_handling 做 307 redirect，所有 redirect 同連結唔准出現 `.html`；單頁 view 切換用 `hidden`，唔用 pathname 前端路由。
  - CDN 升級三步：改 URL 版本 → 重算 integrity → 確認 `script-src` 白名單 domain 不變；升級後 local dev 要睇 Console 有無 SRI/CSP 拒載（SDK 唔載入 = 登入掣失效，症狀明顯）。
  - 每次 fetch 前 `getSession()` 重拎 token，唔好快取 global token，否則 `autoRefreshToken` 後會用舊值。
  - worker 改名 = 新建 service，secrets 唔會自動 migrate；本專案係新建非 rename，無舊 service 要清。

---

## ADR-004: 硬性 401 無訪客、ownership 下推每條 SQL、`sort` / `status` 白名單

- **Status:** Accepted（2026-11-05 設計共識，待實作）
- **Context:** 呢個 app 天然係私人嘢，但參考專案 padlet 有「公開 room / guest」概念，直接搬會出事。被否決嘅替代方案：① 訪客模式／匿名 session（要處理 anonymous → authenticated 資料合併、去重、衝突，係最易出 bug 嗰截）；② 軟性 401（容許未登入讀 demo）；③ **`sort` 直接 interpolate 落 SQL column name**（即 SQL injection）；④ 狀態 tab 同分類篩選二選一（最終裁定**兩個都要**）；⑤ `UPDATE` 前先 SELECT 判斷擁有者（TOCTOU）。
- **Decision:**
  - 所有 `/api/*` 無有效 JWT 一律 401，未登入只見登入頁；`OPTIONS` 預檢除外；其他 `/api/*` 路由仍先驗 JWT 先回 404，唔洩漏路由是否存在。
  - 每條 SQL 都帶 `WHERE ... AND user_id = ?`，`user_id` 一律取 `sub`，完全忽略 body 挾帶嘅 `user_id`；`UPDATE` / `DELETE` 用 `meta.changes === 0` 統一轉 404。
  - `sort` / `status` / `PATCH` SET 全部走 `Object.freeze` 白名單 map，未知值 fallback；`tag` / `id` / `user_id` 一律 `.bind()`。
  - 狀態 tab ＋ 分類篩選並存；已完成一律置底；`sort` / `status` 偏好存 `localStorage`。
  - API 見 `spec.md` §5；參數見 §3.5；隔離見 §3.6。
- **Rationale:** 單一用戶資料模型下訪客模式無意義，仲要孭住合併邏輯；白名單杜絕 column injection；ownership 下推 SQL 令「A 用戶改到 B 用戶資料」喺資料庫層就唔可能發生。
- **Consequences / 後人注意:**
  - **不變量**：錯誤統一 `{"error":"..."}`，401 都係 JSON；前端要處理 401 自動跳登入、`SIGNED_OUT` 回登入頁。
  - 必測 ownership isolation 嘅讀／改／刪三條路徑；呢個係成個 app 唯一真正會出事嘅 security bug。
  - 前端 `localStorage` 嘅偏好值都要再驗一次白名單，唔好信自己寫入過嘅嘢；後端仍獨立再驗。

---

## ADR-005: Migration 只走 `d1 execute --file`、不設 `remote:true`、不用 `DB.batch`

- **Status:** Accepted（2026-11-05 設計共識，待實作）
- **Context:** 既有 padlet 專案踩過 prod D1 migration 嘅坑：prod ledger 只記 0001，`0002+` 全部靠 `wrangler d1 execute --remote --file` 落 DB；佢個 `wrangler.jsonc` 設咗 `remote: true`，搞到 vitest 要特別覆蓋先唔會誤清 prod。被否決嘅替代方案：① `wrangler d1 migrations apply`（同既有 prod ledger 唔夾）；② 設 `migrations_dir`；③ 用 `DB.batch()` 包多條寫入（D1 batch 非真正 ACID，失敗唔回滾）；④ 設 `remote: true` 令 local dev 直搫 prod；⑤ 由助手代做 prod deploy / secrets / Supabase dashboard。
- **Decision:**
  - 初始 schema 放 `migrations/0001_create_todos.sql`，日後變動一律新增 `0002_*.sql` + `wrangler d1 execute --file`；**絕不跑 `migrations apply`**。
  - `wrangler.jsonc` **唔設** `remote: true`、唔設 `migrations_dir`；prod 操作一律明確加 `--remote` 旗標。
  - CRUD 全部單一 statement，**完全唔用 `DB.batch()`**。
  - 測試用 `@cloudflare/vitest-pool-workers`（強制本地 D1）+ 本地 HTML 測試頁；commit 採 topic-scoped conventional commits，code 階段分 6 個逐階段 commit。
  - 助手只做到 local `wrangler dev`（`127.0.0.1:8787`）全線驗證 + 產出逐步 checklist；prod deploy、`wrangler secret put`、Supabase dashboard 由用戶親自執行，助手唔要求憑證。
  - 交付邊界見 `spec.md` §6.3；本輪文件交付驗收見 §7。
- **Rationale:** D1 migration 語意同 Supabase 唔同，誤用 `migrations apply` 會同既有 prod ledger 打架；唔設 `remote` 令 local dev 天然安全；單一 statement 避開 batch 非 ACID；prod 權責分清，憑證唔經對話傳遞。
- **Consequences / 後人注意:**
  - **不變量**：新 service 初始無任何 secret，必須**先** `wrangler secret put` **再** `wrangler deploy`，否則 JWKS 缺 `apikey` 會 500。
  - `schema.sql` 只係現況快照，**變更歷史唯一真相喺 `migrations/`**；改 schema 唔好只改快照。
  - 本輪先一個 `docs:` commit 交付三份文件；code 階段 6 個 commit 接落去，兩者唔好撈埋。
  - 日後若 code 同 `spec.md` 不符，**改 code 遷就 spec**；要改 spec 必須先開新 ADR。
