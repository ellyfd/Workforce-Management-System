# 開發處休假表 🗓️

> **打開連結,三秒看懂全處誰在休假。**
> 免登入、免安裝、免後端維運 —— 一個跑在 Cloudflare 邊緣節點上的輕量休假管理系統。

還在用 Excel 傳來傳去排休?還在群組裡問「明天誰有空」?
**開發處休假表**把整個處的排休變成一張即時月曆:打開網頁就能看、選個名字就能排、管理員一鍵維護人員與假別。沒有密碼要記、沒有伺服器要顧、沒有月費要繳。

🌐 **立即體驗**

| 頁面 | 網址 |
|---|---|
| 全部排休(月曆總表) | <https://workforcemanagement.ellyfd.workers.dev/> |
| 我的排休(個人頁) | <https://workforcemanagement.ellyfd.workers.dev/me> |

---

## ✨ 為什麼你會喜歡它

### 🔓 免密碼,但不無腦
第一次進站,全螢幕「身分閘門」讓你搜尋並選擇自己的名字 —— 之後這台裝置就記住你了。背後是隨機 device token 綁定(`X-Device-Token`),不必註冊、不必記密碼。
⚠️ 設計定位是**內部低風險用途**:拿到連結的人都能綁成任一員工,請勿用於需要嚴格身分驗證的場景。

### 📅 一張月曆看懂全處
- 各部門 × 各員工 × 每一天,假別以**顏色圖例**呈現,國定假日紅底標示。
- 支援**半天假**:上午(AM)與下午(PM)可並存,月曆以半格顯示;全天假會自動清掉同日半天假,規則互斥不打架。
- `?year=&month=` 直接開到指定月份,頁面也有上一月/下一月切換。

### 🙋 排休像點餐一樣簡單
「我的排休」支援單日與**區間批次請假**,批次請假自動**略過國定假日**。送出前系統還會主動提醒:

- 🔔 **職代衝突警示** —— 你的職務代理人當天也請假了?先告訴你。
- 🔔 **部門人力警示** —— 部門當天請假人數達 1/3 上限?先告訴你。

提醒不擋人、只提示,最終決定權在你(和你的主管)。

### 📊 儀表板與統計,主管的好朋友
- **今日儀表板**:今天誰休假、哪個部門缺人,一目了然,可按部門篩選。
- **年度統計**:各假別 / 各部門 / 各員工 / 各月份的休假分布,一頁看完。

### 🛠️ 管理後台,該有的都有
管理員(`role=admin` 或持有 `ADMIN_KEY`)獨享側邊欄「設定管理」區:

- **人員管理**:維護部門、員工、排序、職務代理人(職代)。
- **休假設定**:維護假別(名稱/簡稱/顏色)與國定假日。
- **休假代管**:替任一員工新增、修改、刪除休假,支援批次操作與重複資料一鍵去重。
- **DPC 同步**:查看同步狀態、按「立即同步」手動觸發。

### ⚡ 零維運的部署哲學
前端網頁、後端 API、資料庫、排程任務,**全部住在同一個 Cloudflare Worker 上**。push 到 `main` 自動部署,沒有機器要開、沒有容器要顧,全球邊緣節點就是你的伺服器。

---

## 🏗️ 架構總覽

一個 Worker 打天下:靜態資源優先比對,對得上的路徑直接回網頁,對不上的(`/api/*`)才進 `index.js`。

```
瀏覽器 ──→ Cloudflare Worker(workforcemanagement)
              ├─ /                → public/index.html          (全部排休:月曆總表)
              ├─ /me              → public/me.html             (我的排休:個人頁)
              ├─ /dashboard       → public/dashboard.html      (今日儀表板)
              ├─ /people          → public/people.html         (人員管理,管理員限定)
              ├─ /leave-settings  → public/leave-settings.html (休假設定,管理員限定)
              ├─ /settings        → public/settings.html       (DPC 同步,管理員限定)
              └─ /api/*           → index.js(API)
                                      └─→ D1 資料庫 dpc-hub
                                            ↑
   Base44(DPC 真相來源)──→ Worker 同步(每天台北 8 點 Cron + 手動 /api/sync)──┘
```

**技術棧**:Cloudflare Workers(運算)+ D1(SQLite 資料庫)+ Workers Assets(靜態網頁)+ Cron Triggers(排程)。前端是純 HTML/CSS/JS,共用殼層 `public/app.js` 負責響應式側邊欄、身分閘門與角色權限。

### 🔄 資料來源:Base44 → D1(單向同步)

**Base44 是 DPC 部門的真相來源**,Worker 把它單向同步進 D1:

- **定時**:Cron 每天台北早上 8 點自動跑(`wrangler.toml` 的 `[triggers]`,UTC 00:00)。
- **手動**:「DPC 同步」頁(`/settings`)按「立即同步」,或 `POST /api/sync`(帶 `X-Sync-Secret`)。

同步規則刻意保守,只動該動的:

- ✅ 只同步 **DPC 部門**的 department / employees / leave_records。
- ✅ 保留每位員工的 `device_token`(身分綁定不會被沖掉)。
- ❌ `leave_types`、`holidays` **不同步**,由「休假設定」頁手動維護。
- ⚠️ 方向是 Base44 → D1,DPC 同仁在本系統改的假,下次同步會以 Base44 為準覆蓋。

同步結果記錄在 D1 的 kv 表,`GET /api/sync/status` 隨時可查最近一次同步狀態。

### 🔐 權限模型

| 角色 | 取得方式 | 能做什麼 |
|---|---|---|
| 一般成員 | 進站選名字綁定裝置 | 看全部排休、儀表板、管理自己的排休 |
| 管理員 | 員工 `role=admin`,或請求帶 `X-Admin-Key` | 加上人員管理、休假設定、代管休假、DPC 同步 |

啟動保險:系統內尚無任何 admin 且未設 `ADMIN_KEY` 時,管理 API 暫時開放,讓你能指派第一位管理員。要上鎖就 `npx wrangler secret put ADMIN_KEY` 設一組密鑰。

---

## 📡 API 端點

### 公開 / 個人

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 健康檢查 |
| GET | `/api/calendar?year&month` | 全部排休(月曆總表用) |
| GET | `/api/employees` | 人員清單(身分綁定用) |
| GET | `/api/departments` | 部門清單(篩選用) |
| GET | `/api/holidays?year&names` | 國定假日(區間請假略過用) |
| GET | `/api/leave-types` | 假別清單 |
| GET | `/api/leave-check?employee_id&dates` | 請假前警示:職代同日請假 / 部門 1/3 上限 |
| POST | `/api/bind` `{employee_id}` | 將本裝置綁定為某員工 |
| GET | `/api/me` | 取得本裝置綁定的員工 |
| GET | `/api/my-leaves?year` | 我的休假 |
| POST | `/api/my-leaves` `{date,leave_type_id,period}` | 新增/覆蓋一筆休假 |
| POST | `/api/my-leaves/bulk` | 區間批次請假 |
| POST | `/api/my-leaves/delete` | 刪除休假 |
| GET | `/api/dashboard?date&dept` | 今日儀表板(當日休假概況) |
| GET | `/api/stats?year` | 年度統計(各假別/部門/員工/月份) |

### 管理(需 admin 身分或 `X-Admin-Key`)

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/admin/meta` | 部門/員工/假別清單(管理頁用) |
| GET | `/api/admin/leaves?employee_id&year` | 某員工的休假紀錄 |
| POST | `/api/admin/leaves` | 新增/覆蓋任一員工的休假 |
| POST | `/api/admin/leaves/bulk` | 批次新增休假 |
| POST | `/api/admin/leaves/delete` | 刪除休假 |
| POST | `/api/admin/leaves/delete-by-date` | 依日期刪除休假 |
| GET/POST | `/api/admin/departments` | 部門維護 |
| GET/POST | `/api/admin/employees` | 員工維護(含職代設定) |
| POST | `/api/admin/employees/bulk` | 批次員工維護 |
| POST | `/api/admin/employees/delete` | 刪除員工(自動清理懸空職代) |
| GET/POST | `/api/admin/leave-types` | 假別維護 |
| GET/POST | `/api/admin/holidays` | 國定假日維護 |
| POST | `/api/admin/dedupe-leaves` | 重複休假紀錄一鍵去重 |

### 同步

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/sync` | 手動觸發 Base44 → D1 同步(帶 `X-Sync-Secret`) |
| GET | `/api/sync/status` | 最近一次同步狀態 |

### `/api/calendar` 回傳格式

```jsonc
{
  "title": "開發處休假表",
  "year": 2026, "month": 12,
  "updated_at": "2026-06-10T...",
  "legend": { "休": "#22c55e", "午休": "#a855f7", ... },  // 假別 → 顏色
  "holidays": ["2026-12-25"],                              // 國定假日(紅底)
  "departments": [
    { "name": "特工", "members": [
        { "name": "游怡專", "code": "", "leaves": { "2026-12-16": "休" } }
    ] }
  ]
}
```

每人每日可同時有 full / AM / PM 三個槽位(AM+PM 可並存),月曆以全格或半格呈現,顏色取自 `legend`。

---

## 🚀 部署與本機開發

### 三行指令上線

```sh
npx wrangler secret put BASE44_API_KEY   # 讀 Base44 用(機密)
npx wrangler secret put SYNC_SECRET      # 手動同步通關密語(機密,自己取)
npx wrangler deploy                      # 部署,Cron 一併生效
```

> 非機密設定(Base44 URL / App ID / 部門名)放在 `wrangler.toml` 的 `[vars]`,可直接改。
> 部署後開 `/settings` 輸入 `SYNC_SECRET` 按「立即同步」做第一次灌入。
> 平時 push 到 GitHub `main` 就會自動重新部署,連 deploy 指令都省了。

### 本機開發

```sh
npx wrangler dev      # 本機跑 Worker + 靜態資源
```

> 前端預設打同一個 Worker 的 API;若要指向別的後端,開頁時加 `?api=<Worker 網址>`。

---

## 📁 檔案導覽

| 檔案 | 角色 |
|---|---|
| `index.js` | Worker 後端:全部 API、同步邏輯、Cron 進入點 |
| `public/app.js` | 前端共用殼層:側邊欄、身分閘門、角色權限、API 包裝 |
| `public/app.css` | 全站共用樣式 |
| `public/index.html` | 全部排休(月曆總表) |
| `public/me.html` | 我的排休(個人請假/改假) |
| `public/dashboard.html` | 今日儀表板 |
| `public/people.html` | 人員管理(部門/員工/職代) |
| `public/leave-settings.html` | 休假設定(假別/國定假日) |
| `public/settings.html` | DPC 同步(狀態查看/手動觸發) |
| `wrangler.toml` | Worker 設定(D1 綁定、靜態資源、Cron、vars) |
| `scripts/build-dpc.mjs`、`public/dpc.json` | 舊版 GitHub Action 同步產物(過渡期備援) |

---

## 🗺️ 後續規劃

- 統計匯出(CSV)與自訂日期區間。
- 更多儀表板視角(部門人力熱圖、請假趨勢)。

---

**開發處休假表** —— 把排休從表格地獄裡救出來。🎉
