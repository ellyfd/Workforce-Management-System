# 開發處休假表 🗓️

> **打開連結，三秒看懂全處誰在休假。**
> 免登入、免安裝、免後端維運 —— 一個跑在 Cloudflare 邊緣節點上的輕量休假管理系統。

還在用 Excel 傳來傳去排休？還在群組裡問「明天誰有空」？
**開發處休假表**把整個處的排休變成一張即時月曆：打開網頁就能看、選個名字就能排、管理員直接在總表上點格子改假。沒有密碼要記、沒有伺服器要顧、沒有月費要繳。第一次來還有**互動式操作引導**牽著你走完一輪，看完就會用。

🌐 **立即體驗**

| 頁面 | 網址 |
|---|---|
| 全部排休（月曆總表） | <https://workforcemanagement.ellyfd.workers.dev/> |
| 我的排休（個人頁） | <https://workforcemanagement.ellyfd.workers.dev/me> |
| 儀表板（當日概況） | <https://workforcemanagement.ellyfd.workers.dev/dashboard> |

---

## ✨ 為什麼你會喜歡它

### 🔓 免密碼，但不無腦
第一次進站，全螢幕「身分閘門」讓你搜尋並選擇自己的名字 —— 之後這台裝置就記住你了。背後是隨機 device token 綁定（`X-Device-Token`），不必註冊、不必記密碼。
⚠️ 設計定位是**內部低風險用途**：拿到連結的人都能綁成任一員工，請勿用於需要嚴格身分驗證的場景。

### 👤 個人檔案卡，自己的資料自己管
點側欄頭像就能打開個人檔案：

- 自助編輯**英文名**與兩位**職務代理人**（候選自動限定同部門在職同仁）；部門、狀態、角色仍由管理員把關。
- 即時看到**本月請假小計**與**年度累計**，依假別分色列出。
- 一鍵**切換身分／登出**，換台裝置或借同事電腦都不卡。

### 📅 一張月曆看懂全處
- 各部門 × 各員工 × 每一天，假別以**顏色色塊**呈現，國定假日紅底、今天高亮，姓名與累計欄**凍結捲動**不迷路。
- **單月／全年一鍵切換**：按「全年」整年攤開看，「今天」秒回本月。
- **部門 + 假別雙重篩選**：桌機是色票 chip、手機自動收成下拉；套用假別篩選還會**自動橫向捲到第一筆該假別**，不用自己找。
- **年度「累計」欄**：依各假別的「計入天數」自動加總（休=1、午休/早休=0.5、出差=0），跟原本的 Excel 公式無縫接軌。
- 支援**半天假**：上午（AM）與下午（PM）可並存，月曆以半格顯示；全天假會自動清掉同日半天假，規則互斥不打架。
- `?year=&month=` 直接開到指定月份，年/月下拉與前後月切換都有。

### 🙋 排休像點餐一樣簡單
「我的排休」是**筆刷式**操作：先選假別當筆刷，再點日期就填入，雙擊取消。支援**區間批次請假**，自動**略過週末與假日**。送出前系統還會主動提醒：

- 🔔 **職代衝突警示** —— 你的職務代理人當天也請假了？先告訴你。
- 🔔 **部門人力警示** —— 部門當天請假人數達 1/3 上限？先告訴你。

提醒不擋人、只提示，最終決定權在你（和你的主管）。

### 📊 儀表板，主管的好朋友
- 今天誰休假、哪個部門缺人，一目了然；前一天/後一天/「今天」自由切換，回顧未來都行。
- **未來 7 天展望**：一條七日預覽，每天顯示請假人數，哪天有部門將達 1/3 上限直接標紅點 —— 事前預警，不是事後才知道。點任一天即切換檢視。
- **部門人力一覽**：每部門一條請假占比條，達 1/3 上限標紅、只差一人標黃，缺人的部門一眼跳出來。
- 可按**部門篩選**，休假人員可依**部門或假別分組**顯示，1/3 人力警示直接標在畫面上。
- 管理員還能在這裡**一鍵清理重複的休假記錄**。

### 🛠️ 管理員：直接在總表上改假
管理員（員工 `role=admin`）打開「全部排休」就多一條編輯工具列 —— **選好假別、點任何人的格子就填入**，雙擊取消、半天點上半/下半，「區間」一次填一整段，連員工列的順序都能拖曳調整。另有專屬設定頁：

- **人員管理**：維護部門、員工、職代，拖曳握把 ⋮⋮ 排序，放開自動儲存。
- **休假設定**：維護假別（名稱/簡稱/顏色/**計入天數**）與假日。假日分**國定假日**與**公司假**（如員工旅遊），排休時兩者都會自動略過。
- **DPC 同步**：查看同步狀態、按「立即同步」手動觸發。

### ⚡ 零維運的部署哲學
前端網頁、後端 API、資料庫、排程任務，**全部住在同一個 Cloudflare Worker 上**。push 到 `main` 自動部署，沒有機器要開、沒有容器要顧，全球邊緣節點就是你的伺服器。

---

## 🏗️ 架構總覽

一個 Worker 打天下：靜態資源優先比對，對得上的路徑直接回網頁，對不上的（`/api/*`）才進 `index.js`。

```
瀏覽器 ──→ Cloudflare Worker（workforcemanagement）
              ├─ /                → public/index.html          （全部排休：月曆總表）
              ├─ /me              → public/me.html             （我的排休：個人頁）
              ├─ /dashboard       → public/dashboard.html      （儀表板）
              ├─ /people          → public/people.html         （人員管理，管理員限定）
              ├─ /leave-settings  → public/leave-settings.html （休假設定，管理員限定）
              ├─ /settings        → public/settings.html       （DPC 同步，管理員限定）
              └─ /api/*           → index.js（API）
                                      └─→ D1 資料庫 dpc-hub
                                            ↑
   Base44（DPC 真相來源）──→ Worker 同步（每天台北 8 點 Cron + 手動 /api/sync）──┘
```

**技術棧**：Cloudflare Workers（運算）+ D1（SQLite 資料庫）+ Workers Assets（靜態網頁）+ Cron Triggers（排程）。前端是純 HTML/CSS/JS，共用殼層 `public/app.js` 負責響應式側邊欄（手機自動變底部導覽列）、身分閘門、個人檔案卡與角色權限。

### 🔄 資料來源：Base44 → D1（單向同步）

**Base44 是 DPC 部門的真相來源**，Worker 把它單向同步進 D1：

- **定時**：Cron 每天台北早上 8 點自動跑（`wrangler.toml` 的 `[triggers]`，UTC 00:00）。
- **手動**：「DPC 同步」頁（`/settings`）按「立即同步」，或 `POST /api/sync`（帶 `X-Sync-Secret`）。

同步規則刻意保守，只動該動的：

- ✅ 只同步 **DPC 部門**的 department / employees / leave_records。
- ✅ 保留每位員工的 `device_token`（身分綁定不會被沖掉）。
- ❌ `leave_types`、`holidays` **不同步**，由「休假設定」頁手動維護。
- ⚠️ 方向是 Base44 → D1，DPC 同仁在本系統改的假，下次同步會以 Base44 為準覆蓋。

同步結果記錄在 D1 的 kv 表，`GET /api/sync/status` 隨時可查最近一次同步狀態。

### 🔐 權限模型

| 角色 | 取得方式 | 能做什麼 |
|---|---|---|
| 一般成員 | 進站選名字綁定裝置 | 看全部排休、儀表板、管理自己的排休與個人資料（英文名/職代） |
| 管理員 | 員工 `role=admin` | 加上總表直接編輯任何人的假、人員管理、休假設定、DPC 同步 |

權限**只認「本裝置綁定的 admin 員工」**，沒有萬用密鑰後門（舊版 `ADMIN_KEY` 已移除）。
啟動保險：系統內尚無任何 admin 時，管理 API 暫時開放，讓你能指派第一位管理員；指派完成即自動上鎖。

---

## 📡 API 端點

### 公開 / 個人

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 健康檢查 |
| GET | `/api/calendar?year&month` | 全部排休（月曆總表用，含年度累計） |
| GET | `/api/employees` | 人員清單（身分綁定用） |
| GET | `/api/departments` | 部門清單（篩選用） |
| GET | `/api/holidays?year&names` | 假日清單（國定假日/公司假，區間請假略過用） |
| GET | `/api/leave-types` | 假別清單 |
| GET | `/api/leave-check?employee_id&dates` | 請假前警示：職代同日請假 / 部門 1/3 上限 |
| POST | `/api/bind` `{employee_id}` | 將本裝置綁定為某員工 |
| GET | `/api/me` | 取得本裝置綁定的員工 |
| PUT | `/api/my-profile` | 更新本人英文名與職代（不可選自己、兩位不可重複） |
| GET | `/api/my-leaves?year` | 我的休假 |
| POST | `/api/my-leaves` `{date,leave_type_id,period}` | 新增/覆蓋一筆休假 |
| POST | `/api/my-leaves/bulk` | 區間批次請假 |
| POST | `/api/my-leaves/delete` | 批次刪除休假 |
| DELETE | `/api/my-leaves/:id` | 刪除單筆休假 |
| GET | `/api/dashboard?date&dept` | 儀表板（當日休假概況） |
| GET | `/api/stats?year` | 年度統計（各假別/部門/員工/月份） |

### 管理（需本裝置綁定 admin 員工）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/admin/meta` | 部門/員工/假別清單（管理頁用） |
| GET | `/api/admin/leaves?employee_id&year` | 某員工的休假紀錄 |
| POST | `/api/admin/leaves` | 新增/覆蓋任一員工的休假 |
| POST | `/api/admin/leaves/bulk` | 批次新增休假 |
| POST | `/api/admin/leaves/delete` | 批次刪除休假 |
| POST | `/api/admin/leaves/delete-by-date` | 依日期刪除休假 |
| DELETE | `/api/admin/leaves/:id` | 刪除單筆休假 |
| GET/POST | `/api/admin/departments` | 部門清單/新增 |
| PUT/DELETE | `/api/admin/departments/:id` | 部門修改/刪除 |
| GET/POST | `/api/admin/employees` | 員工清單/新增（含職代設定） |
| PUT/DELETE | `/api/admin/employees/:id` | 員工修改/刪除（刪除自動清理懸空職代） |
| POST | `/api/admin/employees/bulk` | 批次員工維護 |
| POST | `/api/admin/employees/delete` | 批次刪除員工 |
| GET/POST | `/api/admin/leave-types` | 假別清單/新增 |
| PUT/DELETE | `/api/admin/leave-types/:id` | 假別修改（含計入天數）/刪除 |
| GET/POST | `/api/admin/holidays` | 假日清單/新增（分國定假日/公司假） |
| PUT/DELETE | `/api/admin/holidays/:id` | 假日修改/刪除 |
| POST | `/api/admin/dedupe-leaves` | 重複休假紀錄一鍵去重 |

### 同步

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/sync` | 手動觸發 Base44 → D1 同步（帶 `X-Sync-Secret`） |
| GET | `/api/sync/status` | 最近一次同步狀態 |

### `/api/calendar` 回傳格式

```jsonc
{
  "title": "開發處休假表",
  "year": 2026, "month": 6,
  "updated_at": "2026-06-11T...",
  "legend": { "休": "#22c55e", "午休": "#a855f7" },   // 假別 → 顏色
  "holidays": ["2026-06-19"],                          // 假日（紅底）
  "year_totals": { "<employee_id>": 7.5 },             // 年度累計（依假別計入天數加總）
  "departments": [
    { "name": "特工", "members": [
        { "id": "…", "name": "游怡專", "code": "Eve",
          "leaves": { "2026-06-16": { "full": { "label": "休", "period": "full", "color": "#22c55e" } } } }
    ] }
  ]
}
```

每人每日有 `full` / `am` / `pm` 三個槽位（AM+PM 可並存），月曆以全格或半格呈現，顏色直接帶在色塊上。回應以「年」為單位撈資料，單月與全年檢視共用同一份。

---

## 🚀 部署與本機開發

### 三行指令上線

```sh
npx wrangler secret put BASE44_API_KEY   # 讀 Base44 用（機密）
npx wrangler secret put SYNC_SECRET      # 手動同步通關密語（機密，自己取）
npx wrangler deploy                      # 部署，Cron 一併生效
```

> 非機密設定（Base44 URL / App ID / 部門名）放在 `wrangler.toml` 的 `[vars]`，可直接改。
> 部署後開 `/settings` 輸入 `SYNC_SECRET` 按「立即同步」做第一次灌入；再到「人員管理」把自己設為第一位 admin（系統尚無 admin 前，管理 API 暫時開放）。
> 平時 push 到 GitHub `main` 就會自動重新部署，連 deploy 指令都省了。

> ⚠️ **只有 `main` 會部署。** 在功能分支（feature branch）上 commit／push **不會讓正式站有任何變化**——要上線就得**合併進 `main`**。
> 另外：`git reset` + force-push 退回舊 commit **不會觸發重新部署**（沒有新 commit）。要還原一個已上線的功能，請在分支上疊一個「把內容改回去」的**正向 commit**，再合併進 `main`，才會真的反映。詳見 `CLAUDE.md`。

### 本機開發

```sh
npx wrangler dev      # 本機跑 Worker + 靜態資源
```

> 前端預設打**正式站**的 API（`public/app.js` 的 `API_BASE`）；要指向本機或其他後端，開頁時加 `?api=<Worker 網址>`。

---

## 📁 檔案導覽

| 檔案 | 角色 |
|---|---|
| `index.js` | Worker 後端：全部 API、同步邏輯、Cron 進入點 |
| `public/app.js` | 前端共用殼層：側邊欄/底部導覽、身分閘門、個人檔案卡、角色權限、API 包裝 |
| `public/app.css` | 全站共用樣式 |
| `public/index.html` | 全部排休（月曆總表 + 管理員直接編輯 + 操作引導） |
| `public/me.html` | 我的排休（筆刷式請假/區間請假 + 操作引導） |
| `public/dashboard.html` | 儀表板（當日概況/分組/去重） |
| `public/people.html` | 人員管理（部門/員工/職代，拖曳排序） |
| `public/leave-settings.html` | 休假設定（假別/計入天數/假日：國定假日與公司假） |
| `public/settings.html` | DPC 同步（狀態查看/手動觸發） |
| `wrangler.toml` | Worker 設定（D1 綁定、靜態資源、Cron、vars） |
| `scripts/build-dpc.mjs`、`public/dpc.json` | 舊版 GitHub Action 同步產物（過渡期備援） |

---

## 🗺️ 後續規劃

- 統計頁面（後端 `/api/stats` 已就緒，待前端視覺化）與 CSV 匯出。
- 更多儀表板視角（部門人力熱圖、請假趨勢）。

---

**開發處休假表** —— 把排休從表格地獄裡救出來。🎉
