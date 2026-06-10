# 開發處休假表

一個**獨立、免登入即可檢視**的休假月曆網站。前端網頁與後端 API 都跑在同一個
Cloudflare Worker 上,資料存在 Cloudflare D1 資料庫。對齊參考專案 VacWorkGantt
的「排休行事曆 + 我的排休」。

## 架構

```
瀏覽器 ──→ Cloudflare Worker（workforcemanagement）
              ├─ /            → public/index.html（全部排休：月曆總表）
              ├─ /me          → public/me.html  （我的排休：個人頁）
              └─ /api/*       → index.js（API）
                                  └─→ D1 資料庫 dpc-hub
```

- 靜態資源（`public/`)優先比對:對得上的路徑直接回網頁,對不上的(`/api/*`)才進 `index.js`。
- 推送到 GitHub `main` 會自動重新部署 Worker。

## 檔案

- `index.js`：Worker 後端 API。
- `public/index.html`：全部排休（月曆總表,讀 `/api/calendar`）。
- `public/me.html`：我的排休（個人請假/改假,讀寫 `/api/my-leaves` 等）。
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

- 管理頁:新增/刪除任意員工的休假、維護部門/假別(寫回 D1)。
- 簡單儀表板:各假別/各部門的請假統計。
