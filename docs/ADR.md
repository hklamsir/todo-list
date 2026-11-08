# Todo List · 架構決策紀錄（ADR）

> 本檔只記錄「難以回頭、冇背景說明會令後人意外嘅決定」；純技術小決定（變數命名、CSS 細節）不記。
> 本檔只答「點解咁決定」；做乜見 `spec.md`，點稱呼見 `glossary.md`。三份互不複述、無雙重真相。
> 建立日期：2026-11-05（ADR-006：2026-11-06、ADR-007：2026-11-08、ADR-008：2026-11-08）　狀態：ADR-001～008 全部 Accepted
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

---

## ADR-006: 執行時注入 SRI 與 config（`run_worker_first`）＋ 四項實作期補充

- **Status:** Accepted（2026-11-06 實作 v1 時）
- **Context:** 落手實作時遇到五個 spec 未覆蓋、或條文之間互相拉扯嘅位：
  1. spec §6.1 同時要求「SRI hash 執行時實計」同「code 同文件都唔准寫死任何 hash」，但靜態 HTML 嘅 `<script integrity>` 一定要有字面值——零 build 前提下兩者無法並存。被否決：① 靜態檔寫死 hash（違反條文，而且升 SDK 時會靜靜地過期）；② 寫假值或乾脆省略 `integrity`（安全假象，比冇更差）；③ 將 SDK 打包入 repo（要引入 bundler，違反 ADR-003 零 build）；④ 自己寫 PKCE 取代 SDK（ADR-003 已否決）。
  2. 進度摘要要顯示**整體**完成率，但 `GET /api/todos` 受 `status` 篩選。被否決：① 前端每次切 tab 再開一個 `status=all` 請求（多一跳）；② 前端自行累加（篩選後根本冇完整資料，計出嚟係錯）。
  3. `created_at` 用 `datetime('now')` 只有秒精度，同一秒建立兩條就只剩 UUID 排，次序隨機。被否決：① 改 DDL 用高精度時間（spec §4 係 DDL 唯一真相，改咗要重開 spec）；② 只喺前端補排（排序語意會前後端分裂）。
  4. spec §3.2 同時要「inline 改標題」同完整編輯（`due_at`、`tags`），但 wireframe 只有一個編輯圖示。被否決：① 圖示只做 inline（改唔到到期日同標籤，實測即發現）；② 圖示只開完整編輯頁（失去 inline 改名，同 §3.2 不符）。
  5. npm 10 arborist 解析 `vitest@4` ↔ `@cloudflare/vitest-pool-workers@0.23` 嘅 peer 依賴時直接拋 `Cannot read properties of null (reading 'edgesOut')`，`npm install` 失敗。被否決：① 逐個 `npm i` 手動釘版本（下次乾淨重裝又爆）；② 降 vitest 到 3.x（pool-workers 0.23 要求 `^4.1.0`）。

- **Decision:**
  - `wrangler.jsonc` 設 `assets.run_worker_first = true`；`GET /` 由 Worker 處理：fetch 釘版 SDK → `crypto.subtle.digest('SHA-384')` → 注入 `<script src integrity="sha384-…" crossorigin="anonymous" defer>`，同時注入 `window.__APP_CONFIG__`（`SUPABASE_URL` / `SUPABASE_ANON_KEY` 來自 env）同 per-request nonce 嘅 CSP。repo 內靜態檔**零 hash、零 key、零 SDK 版本字串**。
  - `GET /api/todos` 回 `{data, meta:{tags, counts}}`；`counts` 係獨立 aggregate，唔受 `status` 影響；`{data:[...]}` 契約不變。
  - 三個排序（`due` / `created` / `category`）一律加 `rowid DESC` 做 tie-breaker，**唔改** DDL。
  - 列表編輯圖示 → 完整操作頁；點標題 → inline 改名。
  - 專案加 `.npmrc` 設 `legacy-peer-deps=true`。
- **Rationale:** 執行時注入係唯一同時滿足「SRI 真實驗證」＋「唔寫死 hash/key」＋「零 build」嘅做法，代價只係每個 isolate 首次請求多一次 CDN fetch（之後 cache）；`meta.counts` 用一條 aggregate 換走一次額外請求；`rowid` 係 SQLite 隱含單調遞增欄，唔動 schema 就有穩定次序；雙入口令 §3.2 兩種改法都真係可用；`.npmrc` 純屬工具鏈 workaround，唔影響 runtime。
- **Consequences / 後人注意:**
  - **不變量**：`public/` 任何檔案都唔可以出現 SRI hash、publishable key 或 SDK 版本字串；升 SDK 只改 `src/index.js` 嘅 `SDK_URL` 一處，hash 會自動重算，唔使「改版本 → 重算 integrity」兩步。
  - CDN 抓唔到時 **fail closed**：唔注入標籤、`sdkReady=false`，登入掣 disable 並顯示訊息，唔會扮冇事。
  - `run_worker_first: true` 令所有靜態請求都經過 Worker（資產仍由 `env.ASSETS.fetch` 直出）；日後加 `_headers` / `_redirects` 要記得 Worker 會先處理。
  - `meta.counts` 只供 UI 摘要，**唔可以**當 data 渲染清單。
  - `rowid` 係隱含欄：日後改 `WITHOUT ROWID` 表或重建表，tie-breaker 會失效，要改用高精度時間欄或單調 id。
  - `.npmrc` 係 npm workaround，修好後可移除；移除前先確認乾淨 `node_modules` 下 `npm install` 成功。
  - spec §7 第 4 條由「恰好 5 則」改為「恰好 6 則、ADR-001～006 連續」，改動同呢個 ADR 喺同一個 `docs:` commit。

---

## ADR-007: 標題語音輸入用瀏覽器原生 Web Speech API、漸進增強、不自動儲存

- **Status:** Accepted（2026-11-08，spec 1.1 §3.7）
- **Context:** 用戶要求喺「待辦標題」輸入框加語音輸入。被否決嘅替代方案：① **Google Cloud STT v2 經 Worker 代理**（準確度最高、可加自訂詞彙 boost `EC` / `ADR` / `Supabase`，但要新增端點 + secret + US$0.016/分鐘，同「一個畫面、一張表」嘅極簡目標相反）；② 第三方語音 SDK（多一個 CDN 依賴，要再做一次釘版 + SRI + CSP）；③ 只在 Chrome 顯示、其他瀏覽器顯示壞掣（違反漸進增強，Firefox 預設關閉 `SpeechRecognition`）；④ 語音結果直接寫入 DB（粵語辨識錯字會直接污染資料，改都改唔返）。另一條「唔使寫 code」嘅路線（OS 聽寫 Win+H／iOS 鍵盤）保留做日常替代，但唔可以由 app 控制語言同錯誤提示。
- **Decision:**
  - 用 `window.SpeechRecognition || window.webkitSpeechRecognition`，**feature detect 到才顯示**麥克風掣；冇就完全唔出現。
  - push-to-talk：撳一下開始、再撳一下停止；`continuous=false`、`interimResults=true`、`lang` 預設 `zh-HK`，可切 `zh-CN` / `en-US`。
  - 轉寫只**插入游標位置**、保留原有文字、超過 200 字截斷；草稿即時可見，但**要用戶按「儲存」才寫入 DB**。
  - 錯誤（`not-allowed` / `no-speech` / `network` / `audio-capture` / `aborted`）統一映射成中文提示，表單唔中斷。
  - Worker 嘅 `Permissions-Policy` 由 `microphone=()` 放寬到 `microphone=(self)`，其餘（相機、定位）維持封鎖。
  - 實作拆兩層：`public/lib/voice.js`（純邏輯：插入、截斷、錯誤映射、狀態機，可單元測試）＋ `public/app.js`（DOM 接線）。見 `spec.md` §3.7。
- **Rationale:** 零成本、零後端、零 build 影響；音頻由瀏覽器廠商處理，Worker 唔會接觸音頻，隱私邊界最清楚；不自動儲存令辨識錯誤永遠有得改。相對 Cloud STT，v1.1 用唔著為準確度付後端複雜度——粵語短句 + 用戶自己校對，已經夠用。
- **Consequences / 後人注意:**
  - **不變量**：語音純屬輸入輔助，鍵盤永遠可用；冇 API 就唔顯示掣，**唔可以**出現 disabled 嘅壞掣。`voice.js` 唔可以 import DOM，否則測唔到。
  - 顯示條件有三個：有 `SpeechRecognition`、`document.featurePolicy.allowsFeature('microphone')` 為 true、`enumerateDevices()` 見到 `audioinput`。第二項為 false 通常代表 `Permissions-Policy` 送錯（例如仍係 `microphone=()`），癥狀係 Chrome 站點設定仲顯示「詢問（預設）」但一撳就 `not-allowed`；第三項為 false 代表部機根本冇麥克風，`getUserMedia` 會直接 `NotFoundError`。兩種情況而家都唔會出掣（政策封鎖靜靜隱藏、冇裝置顯示「未偵測到麥克風」），唔會再出現「有掣但永遠失敗」。
  - 判斷「有冇裝置」時，`enumerateDevices()` 回空清單一律當「判斷唔到」而唔隱藏，避免某些環境（未授權／私密模式）誤擋正常用戶。
  - Chrome 嘅 `continuous` 有已知缺陷：靜音 5–10 秒或連續約 30 秒會自動 `onend`。本設計係單句模式，斷線即回 idle，**唔做自動重連**（避免無限重試燒網絡同電）。
  - `zh-HK` 出書面語，而且中英夾雜（`EC`、`ADR`、`Supabase`、`PS Training`）幾乎必錯；呢個係「唔自動儲存」嘅第二個理由，唔好改。
  - 改 `Permissions-Policy` 只放寬 microphone，**唔好**順手開 camera / geolocation。
  - iOS 上嘅 Chrome / Edge 用 WebKit 但唔暴露 `SpeechRecognition`，feature detect 會自然隱藏；iOS Safari 14.5+ 有，但每次要 user gesture。
  - 日後若要提升準確度，走 Cloud STT 要**先開新 ADR**（新端點、secret、成本、音頻處理邊界全部要重寫）。

---

## ADR-008: 上一頁用 History API 分層紀錄 —— 編輯器獨立一筆、清單頁留守衛、連撳兩下才離開

- **Status:** Accepted（2026-11-08，spec §6.2）
- **Context:** 三個視圖（登入／清單／編輯器）只用 `hidden` 切換，由頭到尾冇寫過任何 `history` 紀錄。喺 Android 實體返回鍵或桌面 Back 一撳，瀏覽器冇「app 內」嘅紀錄可退，就直接卸載文件 —— 用戶睇落就係「直接跳出 app」，而且喺新增／編輯頁填到一半都一樣，成套輸入白費。被否決嘅替代方案：① **改 hash route**（`#/new`、`#/edit/:id`）：URL 會殘留，重新載入會落返一個冇 auth guard 嘅深層連結，而未儲存草稿本身唔可以靠 URL 還原，得物無所用；② **`beforeunload` 攔返回**：對瀏覽器 Back 唔可靠（Android Chrome 多數唔問），而且會出「離開此網站？」呢個嚇人嘅系統對話框；③ **改真多頁**：每次切視圖都要重新載入 SDK 同驗 session，違反 spec §6.2「唔跳頁」；④ **只做編輯器嗰筆、清單頁照舊直接離開**：解決唔到用戶回報嘅症狀。
- **Decision:**
  - `history.state` 寫 `{ todoView: 'app' | 'editor' | 'login', todoId? }`；**URL 一律保持 `/`**（三個視圖係同一份文件，唔偽造深層連結）。
  - 進入清單頁：`replaceState(app)` 標記當前紀錄，再 `pushState(app)` 留一筆**守衛紀錄**。有守衛，返回鍵才會先觸發 `popstate` 而唔係直接卸載文件。
  - 開編輯器：`pushState(editor, { todoId })`。上一頁 = 關編輯器（只切視圖，唔再 push、唔出離開提示）。
  - 喺清單頁按返回：第一下攔住並補回守衛，出「再撳一次『返回』離開」提示（2 秒內有效）；第二下才 `history.back()` 真正放行。
  - UI 上嘅「←」「取消」「儲存」關編輯器時，主動 `history.back()`，並用 600ms 時間窗（`suppressUntil`）吞掉隨之而來嘅 `popstate`，令歷史唔會殘留一筆「其實已經關咗」嘅編輯器紀錄。
  - 登入頁唔攔返回（離開係正常行為），並重置守衛狀態。
  - 純邏輯（白名單讀 state、守衛狀態機）放 `public/lib/nav.js`，`history` / DOM 接線留 `public/app.js`。
- **Rationale:** History API 係唯一可以令「上一頁」有 app 內語意而又唔改 URL、唔重新載入文件嘅方法。守衛紀錄借用「同文件多一筆」呢個特性，把必然會卸載嘅返回動作變成一個可以觀察嘅 `popstate`，於是「攔一次、講清楚、再放行」可以純前端做到，唔需要 `beforeunload` 那種嚇人對話框。連撳兩下嘅窗口設 2 秒：足夠讓人讀完七個字嘅提示，又短到唔會變成「永遠走唔到」。
- **Consequences / 後人注意:**
  - **不變量一**：`pushState` 一定要有對應嘅「退出歷史」路徑。任何關編輯器嘅新入口（快捷鍵、手勢、日後嘅 modal）都必須經 `closeEditor()`，否則歷史多一筆孤兒紀錄，之後按上一頁會重開一個空編輯器。
  - **不變量二**：`editorEntry` 必須有兩個地方歸零 —— 程式關（`closeEditor()`）同瀏覽器關（`closeEditor({ fromHistory: true })`）。漏咗前者會亂 `back()` 直接離開頁面；漏咗後者會喺已經退到清單之後再 back 一次。
  - 吞 `popstate` 用**時間窗**而唔用計數器：`history.back()` 有時唔會產生 `popstate`（已經喺第一筆），計數器會殘留並吞掉下一次真正嘅返回。
  - 單筆 history 嘅分頁（主畫面捷徑直開、`history.length === 1`）第二下 `history.back()` 可能係 no-op，交由瀏覽器處理（Android Chrome 會關分頁／返上一個 app）。**唔好**加 `location.replace('about:blank')` 之類 fallback，會令用戶真係走唔到。
  - 唔好喺 `popstate` handler 內「push 完即刻 `back()`」，兩邊會互拉；要放行就直接 `back()`，要攔就只 push。
  - 日後若真要深層連結，要**先開新 ADR** 改走 hash route，並為每個深層連結補 auth guard（本 app 冇 guest、冇 401 fallback page）。
  - 已用 Playwright 實測五個情境（編輯器按上一頁、清單第一下、2.4 秒後失效、儲存後上一頁、UI ← 之後再上一頁），全部符合預期，見 `.qa/back-*.png`。
