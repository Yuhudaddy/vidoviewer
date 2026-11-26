# VidoViewer

在手機上檢視 DWG、DXF 圖面並量測的網頁 App（PWA）。純靜態，不需要建置。圖檔只在使用者的瀏覽器本機處理，儲存在瀏覽器的 IndexedDB，不上傳。

## 內容

```
index.html、app.js、home.js、library.js、renderer.js   介面與繪圖
core/            圖面解析與查詢（在 Web Worker 內執行）
styles/          設計變數與元件樣式
vendor/          acad-ts（MIT 授權，附授權全文）
functions/       Cloudflare Pages Functions：共用密碼閘門
login.html       登入頁
status.json      遠端停用開關
sw.js            Service Worker（離線外殼快取）
```

## 功能

主畫面（最近、收藏、資料庫，塊狀或條列）、開圖與平移縮放、距離與面積量測（鎖點、逐點封閉）、單位設定、手動儲存的量測標記、離線使用。

## 限制

- 顯示超出繪圖預算時只畫一部分，放大後補畫；線型與線寬、填充圖案、文字對齊尚未完整呈現。
- 被略過的物件（傾斜平面、不支援的填充邊界、缺內容的圖塊等）不參與量測，開圖後頂端提示會列出。
- 圖層、角度、已知長度校正與匯出尚未實作。

## Cloudflare Pages 上線與本機測試

在 Cloudflare Pages 連接 GitHub 儲存庫，使用無建置的靜態站設定：不設定建置指令，輸出目錄為專案根目錄（`/`）。在 Pages 環境設定 `AUTH_USER`、`AUTH_PASSWORD`、`SESSION_SECRET`（至少 32 個字元），密碼與密鑰使用加密環境變數，不要提交至儲存庫。每次修改快取外殼時更新 `sw.js` 的 CACHE_NAME。

可選擇另外設定 `AUTH_USER_2` 與 `AUTH_PASSWORD_2`，兩者都設定且帳號名稱不同於 `AUTH_USER` 時才啟用第二組；只設定其中一項或帳號名稱相同時會忽略第二組。兩組權限相同，變更其中一組的帳號或密碼只會讓該組原有工作階段失效。第一組的 `AUTH_USER`、`AUTH_PASSWORD` 與 `SESSION_SECRET` 仍為必填；缺少任一項或密鑰不足 32 字元時，受保護資源會回傳 503。

本機可安裝 Wrangler 後以 `wrangler pages dev .` 啟動，使用未追蹤的 `.dev.vars` 設定上述必要變數及選用的第二組帳密。部署前請另外測試 HTTPS 和目標裝置。

`status.json` 的 `enabled` 設為 `false` 可讓下次線上啟動顯示停用訊息，移除本 App 的 Service Worker 快取，保留 IndexedDB 圖面及標記。離線或無法取得狀態時仍可開啟已快取的外殼；網路請求逾 4 秒也會回退快取，逾時後才收到的登入拒絕不會阻止這次開啟，因此遠端停用、登出與密碼更換無法即時阻止離線或連線緩慢的裝置使用本機資料；取得裝置的人也可能存取本機儲存內容。登入使用共用帳密與有效期 90 天的工作階段，登出僅清除目前瀏覽器的 Cookie，並非資料加密；錯誤登入僅固定延遲，正式使用應另設 Cloudflare 層級的速率限制。
