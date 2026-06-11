# CLAUDE.md — 給 AI 代理 / 開發者的工作須知

開發處休假表：跑在單一 Cloudflare Worker 上的輕量休假系統。
前端網頁（`public/`）、後端 API（`index.js`）、資料庫（D1）、排程（Cron）全在同一個 Worker。

---

## ⚠️ 部署模型（最重要，先讀這段）

**正式站 <https://workforcemanagement.ellyfd.workers.dev> 只從 `main` 分支部署。**

- ✅ **要上線 = 合併進 `main`。** push 到 `main` 後 Cloudflare 會自動重新部署。
- ❌ **推到功能分支（feature branch）不會上線。** 在 `claude/*` 之類的分支上 commit／push，正式站**不會有任何變化**——必須等它合併進 `main`。
- ❌ **`git reset` + force-push 到舊 commit 不會觸發重新部署。** 部署是看「有沒有新 commit」，強推回舊 commit 不算新 commit，所以正式站會停在原本的版本。

### 要「還原」一個已經上線（已在 main）的功能，怎麼做才有效
不要用 force-push reset 分支（那只動到分支、進不了 main，也觸發不了部署）。改用**正向（forward）的還原 commit**：

```sh
# 在功能尖端之上疊一個把內容改回舊狀態的 commit，
# 這樣合併進 main 時才會真的反轉功能。
git checkout <feature-branch>
git checkout <good-old-commit> -- .   # 把檔案還原成上一個好版本
git add -A && git commit -m "還原 XXX 功能"
# 然後合併這個分支進 main → 正式站才會反映還原
```

### 規則
- 開發都在指定的功能分支上；**不要在沒有明確許可下 push 到 `main`**。
- 完成後請主人把分支合併進 `main`（或經其同意才由代理合併）。每次「修好了」都要記得：**沒進 main = 沒上線**。

---

## 🗂️ 快取（為什麼「改了卻看到舊版」）

`public/_headers` 已設 `Cache-Control: no-cache`，讓 HTML/JS 部署後**立即生效**、不被瀏覽器或 Cloudflare 邊緣快取卡住。若拿掉這個檔，部署後可能要強制重新整理（Ctrl/Cmd+Shift+R）才看得到新版。**不要隨意移除 `public/_headers`。**

---

## 🏗️ 架構與路由

- `wrangler.toml`：`main = index.js`、`[assets] directory = ./public`。
  - 靜態資源優先比對：對得上的路徑（`/`, `/me`, `/app.js`…）直接回 `public/` 的檔案；
  - 對不上的（`/api/*`）才進 `index.js` 的 `fetch`。
- 身分：無密碼。前端產生隨機 device token 存 localStorage，每次帶 `X-Device-Token`；`/api/bind` 把 token 綁到某員工。**內部低風險定位**——拿到連結的人都能綁成任一員工，後端嚴格權限意義有限。
- 權限：`role = 'admin'` 才能編輯排休、進設定（後端各 `/api/admin/*` 用 `canAdmin` 把關）。一般人只能看「全部排休」、改「我的排休」自己的假。

## 🛢️ 資料庫（D1）

- `database_id = 33f69061-a17d-431d-8105-343cadd695dc`（`dpc-hub`）。
- **沒有 migrations 資料夾**：schema 變更是直接對 D1 下 SQL（`npx wrangler d1 execute` 或透過 Cloudflare 介面/MCP）。改欄位後記得 `index.js` 的查詢要跟上。
- 主要表：`employees`、`departments`、`leave_types`、`leave_records`、`holidays`。

## 🔄 DPC 同步

- `.github/workflows/sync-dpc.yml`：每 10 分鐘把 Base44 的 DPC 假同步成 `public/dpc.json` 並 push 到 `main`（→ 觸發重新部署）。
- Cron（`wrangler.toml [triggers]`）每天台北 08:00 把 DPC 灌進 D1。

---

## ✅ 改完請自檢

- 後端：`node --check index.js`
- 前端內嵌 script：把 `<script>…</script>` 抽出來 `node --check`（HTML 不能直接 check）。
- 提醒自己：**commit / push 到功能分支只是第一步，要合併進 `main` 才會真的上線。**
