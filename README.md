# 開發處休假表（免登入靜態檢視頁）

一個**獨立、免登入、不經過 Base44**的休假月曆檢視頁。長得像主系統的排休表，
但資料來自一份可公開取得的 JSON 檔，開發處不需要註冊或登入即可開啟。

## 檔案

- `index.html`：檢視頁（自帶樣式與程式，零外部相依）。
- `data.json`：資料檔（休假內容放這裡）。

## 怎麼上線（GitHub Pages 或 Cloudflare Pages 皆可）

### 方式 A：GitHub Pages
1. 把 `dev-division-viewer/` 這個資料夾放進一個 repo。
2. Settings → Pages → 選該分支與資料夾，啟用 Pages。
3. 開發處用網址開啟：`https://<帳號>.github.io/<repo>/dev-division-viewer/`
   （把這條網址存成書籤，點開即看，免登入。）

### 方式 B：Cloudflare Pages
1. 連結 repo，建立 Pages 專案。
2. Build 指令留空、輸出目錄設為這個資料夾（純靜態，不需 build）。
3. 用 Cloudflare 給的網址開啟。

> 資料檔也可以掛在別處（例如 Cloudflare R2、GitHub raw、任何公開網址），
> 開啟時用 `?data=` 指定：
> `…/index.html?data=https://example.com/dev-division-leave.json`

## 資料格式（`data.json`）

```jsonc
{
  "title": "開發處休假表",
  "year": 2026,
  "month": 12,              // 1–12
  "updated_at": "2026-06-10",
  "legend": {               // 假別 → 顏色（可自訂）
    "休": "#22c55e", "差": "#ec4899", "午休": "#a855f7",
    "病": "#f97316", "員旅": "#9ca3af", "早休": "#3b82f6"
  },
  "holidays": ["2026-12-25"],          // 國定假日（會以紅底標示）
  "departments": [
    {
      "name": "3D team（DPC）",
      "members": [
        {
          "name": "程麗如",
          "code": "Karen",            // 職代/英文名（可留空）
          "leaves": { "2026-12-12": "午休" }   // 日期 → 假別文字
        }
      ]
    }
  ]
}
```

- `leaves` 的「假別文字」會去 `legend` 找顏色；找不到就用內建預設色。
- 想換月份，改 `year` / `month` 即可；想多月，先各做一份 JSON、用 `?data=` 切換。

## 資料分兩塊

- `data.json` → **開發處自己維護**（他們的部門）。**不要**在這裡寫 DPC。
- `dpc.json` → **由 GitHub Actions 自動同步**（只有 DPC＝3D team 這段）。
- 網頁同時讀這兩個檔並合併，所以自動的永遠不會蓋掉開發處手填的。

## DPC 即時同步設定（GitHub Actions）

排程 `.github/workflows/sync-dpc.yml` 會每 ~10 分鐘讀 Base44 的 DPC 休假、
產生 `dpc.json` 並提交，GitHub Pages 隨即更新（near-realtime）。

設定步驟（在這個新 repo）：
1. 到 repo 的 **Settings → Secrets and variables → Actions → New repository secret**。
2. 新增一個 Secret：
   - Name：`BASE44_API_KEY`
   - Value：你的 Base44 api_key
3. （選填）若部門名稱或 API 位址不同，改 `scripts/build-dpc.mjs` 最上面的預設，
   或在 workflow 的 `env:` 覆蓋（`DPC_DEPT_NAME`、`BASE44_API_URL`…）。
4. 到 **Actions** 分頁手動執行一次 `Sync DPC leave` 驗證，成功後會產生 `dpc.json`。

> ⚠️ 這個 Secret 必須放在 **GitHub repo** 裡（GitHub Actions 只讀得到 GitHub 的 Secret）。
> Base44 後台自己的「Secret」是給 Base44 後端用的，**放那裡 GitHub Actions 讀不到**。

> 🔐 **安全**：該 api_key 具完整權限（可改/刪資料）。請只放進 GitHub Secret，
> 絕不要寫進任何檔案或公開出去；若曾外流，請到 Base44 重新產生（rotate）一把。

## 目前範圍與限制

- **唯讀**：此頁只呈現，不能在頁面上請假/修改。
- 任何拿到網址的人都看得到內容，請只在內部流通。
  （若要更嚴，建議用 Cloudflare Pages + Access 加一道存取控制。）
- 開發處端：不需登入、不需 Base44 帳號。資料是後端排程抓好放成靜態檔，
  api_key 只存在 GitHub Actions、不會出現在網頁。
