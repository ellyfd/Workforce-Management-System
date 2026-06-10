# 開發處休假表

一個**獨立、免登入即可檢視**的休假月曆網站。前端網頁與後端 API 都跑在同一個
Cloudflare Worker 上,資料存在 Cloudflare D1 資料庫。對齊參考專案 VacWorkGantt
的「排休行事曆 + 我的排休」。

## 架構

```
瀏覽器 ──→ Cloudflare Worker（workforcemanagement）
              ├─ /            → public/index.html （全部排休：月曆總表）
              ├─ /me          → public/me.html     （我的排休：個人頁）
              ├─ /manage      → public/manage.html （休假管理：改任一員工）
              ├─ /stats       → public/stats.html  （儀表板統計）
              ├─ /settings    → public/settings.html（設定管理：DPC 同步）
              └─ /api/*       → index.js（API）
                                  └─→ D1 資料庫 dpc-hub
                                        ↑
   Base44（DPC 真相來源）──→ Worker 同步（Cron 每 30 分鐘 + 手動 /api/sync）──┘
```

### 資料來源：Base44 → D1（單向同步）

- **Base44 是 DPC 的真相來源**。Worker 會把 Base44 的 DPC 部門**單向**同步進 D1:
  - **定時**:Cron 每 30 分鐘自動跑(`wrangler.toml` 的 `[triggers]`)。
  - **手動**:設定管理頁(`/settings`)按「立即同步」,或 `POST /api/sync`(帶 `X-Sync-Secret`)。
- 同步**只動 DPC 部門**的 department/employees/leave_records;`leave_types`、`holidays`
  為全域參考資料一併更新;**保留每位員工的 `device_token`**(me.html 綁定用)。
- 前端一律**只讀 D1**(`/api/calendar`)。方向為 Base44 → D1,所以 DPC 同仁在 me.html
  改的假,下次同步會以 Base44 為準覆蓋。
- 過渡期:Worker 同步尚未部署時,全部排休頁偵測到 D1 沒有 DPC,會暫時合併
  `public/dpc.json`(由舊的 `.github/workflows/sync-dpc.yml` 產生)當畫面備援;
  Worker 同步上線後即自動改用 D1,該 Action 可移除。

### 部署同步所需設定

```sh
cd <repo>
npx wrangler secret put BASE44_API_KEY   # 讀 Base44 用（機密）
npx wrangler secret put SYNC_SECRET       # 手動同步通關密語（機密，自己取）
npx wrangler deploy                        # 部署，Cron 一併生效
```

> 非機密設定(Base44 URL / App ID / 部門名)已放在 `wrangler.toml` 的 `[vars]`,可直接改。
> 部署後開 `/settings` 輸入 `SYNC_SECRET` 按「立即同步」做第一次灌入。

- 靜態資源（`public/`)優先比對:對得上的路徑直接回網頁,對不上的(`/api/*`)才進 `index.js`。
- 推送到 GitHub `main` 會自動重新部署 Worker。

## 檔案

- `index.js`：Worker 後端 API。
- `public/index.html`：全部排休（月曆總表,讀 `/api/calendar`）。
- `public/me.html`：我的排休（個人請假/改假,讀寫 `/api/my-leaves` 等）。
- `public/manage.html`：休假管理（改任一員工的休假,讀寫 `/api/admin/*`）。
- `public/stats.html`：儀表板統計（讀 `/api/stats`）。
- `public/dpc.json`：DPC（3D team）即時休假,由下方 GitHub Action 產生。
- `scripts/build-dpc.mjs`、`.github/workflows/sync-dpc.yml`：Base44 → `public/dpc.json` 同步。
- `wrangler.toml`：Worker 設定（D1 綁定 + 靜態資源 `public/`）。

## 網址

- 全部排休：`https://workforcemanagement.ellyfd.workers.dev/`
- 我的排休：`https://workforcemanagement.ellyfd.workers.dev/me`

> 前端預設打同一個 Worker 的 API；若要指向別的後端,開頁時加 `?api=<Worker 網址>`。
> 全部排休頁可用 `?year=&month=` 直接開到指定月份,頁面上也有上一月/下一月切換。

## API 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 健康檢查 |
| GET | `/api/calendar?year&month` | 全部排休（月曆總表用） |
| GET | `/api/employees` | 人員清單（登入選人用） |
| GET | `/api/leave-types` | 假別清單 |
| POST | `/api/bind` `{employee_id}` | 將本裝置綁定為某員工 |
| GET | `/api/me` | 取得本裝置綁定的員工 |
| GET | `/api/my-leaves?year` | 我的休假 |
| POST | `/api/my-leaves` `{date,leave_type_id,period}` | 新增/覆蓋一筆休假 |
| DELETE | `/api/my-leaves/:id` | 刪除一筆休假 |
| GET | `/api/admin/meta` | 管理頁用：部門/員工/假別清單 |
| GET | `/api/admin/leaves?employee_id&year` | 某員工的休假紀錄 |
| POST | `/api/admin/leaves` `{employee_id,date,leave_type_id,period,note}` | 新增/覆蓋任一員工的休假 |
| DELETE | `/api/admin/leaves/:id` | 刪除任一筆休假 |
| GET | `/api/stats?year` | 儀表板統計（各假別/部門/員工/月份） |

> **管理權限**：`/api/admin/*` 在未設定環境變數 `ADMIN_KEY` 時為開放（內部低風險）。
> 要上鎖就在 Cloudflare 後台或 `wrangler secret put ADMIN_KEY` 設一組密鑰,之後管理頁
> 會要求輸入,請求帶 `X-Admin-Key` 才放行。

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

- `leaves` 的假別文字會去 `legend` 找顏色;含「早」視為上午半天、含「午」視為下午半天,
  在月曆上以半格呈現。

## 身分模型（無密碼）

前端產生一組隨機 device token 存在瀏覽器,每次請求帶 `X-Device-Token`。
第一次選自己的名字後,把 token 綁到該員工。
⚠️ 無密碼＝拿到連結的人都能綁成任一員工,屬內部低風險用途。

## 本機開發

```sh
npx wrangler dev      # 本機跑 Worker + 靜態資源
npx wrangler deploy   # 手動部署（平時靠 push main 自動部署）
```

## 後續規劃

- 管理頁再擴充:維護部門、員工、假別本身（目前僅維護休假紀錄）。
- 統計匯出（CSV）與自訂日期區間。
