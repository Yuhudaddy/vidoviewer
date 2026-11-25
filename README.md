# VidoViewer 階段 0

純靜態的手機圖面檢視原型。解析由 `core/parse-client.js` 管理讀檔、Worker、取消及逾時。匯入的原檔只存在這個瀏覽器的 IndexedDB（`vidoviewer-library`），不上傳；客戶圖檔不放進專案、證據資料夾或伺服器目錄。

## 本機整合與預覽

此工作樹的 `core/`、`vendor/` 與 `styles/` 為整合時同步的副本。預覽組合時直接讀取阿沅和莉芽的最新工作樹。三個工作樹位於同一個上層資料夾時：

```sh
./tools/sync-preview.sh                      # 重新組合並鏡射到 /private/tmp/vidoviewer-preview
python3 tools/preview-server.py 127.0.0.1 8769 /private/tmp/vidoviewer-preview        # Mac
python3 tools/preview-server.py <這台 Mac 的區網位址> 8770 /private/tmp/vidoviewer-preview 4  # 私人區網，四小時後自動停止
```

兩個預覽共用同一個目錄，改完程式只要重跑 `sync-preview.sh`，不必重啟伺服器。`index.html` 依序載入 `styles/tokens.css`、`styles/components.css`、`design-bridge.css`（App 專用的少量樣式，不覆寫 Dock 與讀數卡定位）。localhost 或 HTTPS 才有 Service Worker；任何快取內容更新都要升級 `sw.js` 的版本（目前 v60）。

## 功能

- 主畫面：最近（只列成功開啟過的，依最後開啟排序）、收藏、資料庫三個分頁，分頁膠囊與匯入的＋並排固定在底部（在捲動區外，相距 12px）；塊狀或條列（偏好存在本機）；每頁 20 筆。
- 標題右側的搜尋依檔名篩選目前分頁，分頁碼跟著結果，清除或 Esc 回到原清單。問號開啟使用說明面板，說明目前可用的量測、單位與標記功能；面板最下面的「開啟範例圖」開啟內建合成圖，它可以返回與重開，但不列在任何清單。
- 條列可左右滑動露出收藏與刪除，動作鈕也能用點選與鍵盤操作；塊狀用星號與「更多」選單。
- 刪除先標記為待刪，每一筆各有自己的 5 秒復原時間；連續刪除會合併成一個「已刪除 N 個　復原」提示，按復原會把還在時限內的全部放回，同一筆資料（Blob、收藏、開啟紀錄、縮圖）原樣回來。時限到或離開頁面超過時限才真的刪除；時限內重新整理會再次提供復原。
- 成功開圖後產生 320×200（16:10）的小圖存在同一筆 IndexedDB 紀錄，只畫圖面本身，不含量測、工具與檔名；沒開過的圖與舊紀錄顯示文件圖示。
- 同內容只存一份，同名不同內容各自保留。沒有開啟紀錄的舊資料不會被當成最近。
- 檢視：預設不選工具，只能平移與縮放。距離與面積在 Dock，鎖點開關也在 Dock。鎖點一律用 `core/query.js` 的 `snapAt`，畫出來的框就是放開後採用的點；滑鼠未按鍵移近即預覽，觸控按下先出現框、按住約 0.2 秒出現放大鏡，單指拖曳平移與雙指縮放都不落點。
- 面積按鈕展開選單，可點封閉邊界或逐點圈選；逐點達三個有效點後即時顯示預覽，按封閉後才可儲存，再點已選取的面積工具可退出。兩者都顯示面積與周長。預設 cm² 和 cm，可設定顯示單位；來源未知時保留圖面單位並提示，使用者可指定來源單位。點檔名可設定單位，畫布上方持續顯示單位；來源指定只套用本次開圖。無法可靠量測時不顯示數字。
- 讀數卡只在有量測值時出現，可清除或手動儲存標記；已儲存標記依圖面編號並存在本機，可點圖上標記或從右上清單開啟及刪除；右下復原按建立順序撤銷量測；撤銷已儲存的最新標記時，會一併從畫布與清單移除，狀態在重開後保留。介面的選取、焦點、按鈕為白色，冰藍只用在畫在圖上的量測線、鎖點框與數字膠囊；DWG、DXF 的圖層色照圖。

## 驗證

測試只用合成圖（`tests/make-fixtures.py` 產生），從實際網址操作：

```sh
python3 tests/e2e/undo-saved.py URL # 已存標記撤銷、交易回滾與隔離
python3 tests/e2e/legacy-undo.py URL # 舊版標記撤銷與編號保留
python3 tests/e2e/legacy-marks.py URL # 舊版標記與既存資料保留
python3 tests/e2e/marks.py URL       # 標記、復原、重開與切圖隔離
python3 tests/e2e/polygon-layout.py URL # 小畫面讀數與選單避讓
python3 tests/e2e/polygon-live.py URL # 即時讀數、有效性、單位與退出
python3 tests/e2e/polygon.py URL     # 封閉、退點、清除與自交
python3 tests/e2e/layout-marks.py URL # 選單與動畫對比
python3 tests/e2e/interface.py URL   # 新選單、長按鎖點、單位及減少動態
python3 tests/e2e/measurement.py URL # 單位、面積、周長、圈選、標記與選單
python3 tests/e2e/arcs.py URL    # 多段線正負 bulge 圓弧的圓心、端點、中點所在側與鎖點
python3 tests/e2e/app.py URL     # 匯入、返回、重開、hover 與觸控鎖點、距離、面積、可視高度、離線
python3 tests/e2e/home.py URL    # 分頁、分頁碼、收藏、滑動、刪除與復原
```

把 URL 換成實際入口（Mac 是 `http://127.0.0.1:8769/`，區網是 `http://<區網位址>:8770/`）。2026-11-24 的結果：Mac 為 30/30、105/105、106/106；區網為 30/30、104/104、106/106（HTTP 沒有 Service Worker，所以少一項離線檢查）。受控 Worker 生命週期 14/14、合成場景 5/5（`/tests/lifecycle.html`、`/tests/scene-render.html`）。驗收截圖存在本機的 `evidence/`（已列入 `.gitignore`），全部是合成圖。

觸控步驟用的是 Chrome 的模擬觸控，不是真機。

## 限制與待驗收

- iPhone 真機尚未測：開檔時間、記憶體、Safari 選檔、長按與滑動手感、戶外辨識都還沒有結果；底部分頁、＋與說明面板在實機安全區（瀏海、Home 指示條、加入主畫面後）的位置也只在沒有安全區的桌面瀏覽器量過。
- 本機真實鋼構樣本的圓角尚未驗證（讀取該檔的權限被拒）。
- 顯示超出 7 ms 繪圖預算時會截斷並提示放大；核心尚未提供線型與線寬；填充圖案、文字對齊與複雜格式尚未完整呈現。
- 圖層、角度、已知長度校正、匯出等設計稿上的功能尚未實作，介面上也沒有放入口。

導覽動態示意的參數化來源與無聲 MP4 位於 `animation/`；執行 `python3 animation/render.py` 可用本機 Chrome 與 FFmpeg 重新彩現。Safari 的原生選單配色、長按呼叫選單與手勢仍須以 iPhone 實機驗證。


## Cloudflare Pages 上線與本機測試

在 Cloudflare Pages 連接 GitHub 儲存庫，使用無建置的靜態站設定：不設定建置指令，輸出目錄為專案根目錄（`/`）。在 Pages 環境設定 `AUTH_USER`、`AUTH_PASSWORD`、`SESSION_SECRET`（至少 32 個字元），密碼與密鑰使用加密環境變數，不要提交至儲存庫。每次修改快取外殼時更新 `sw.js` 的 CACHE_NAME；可執行 `python3 scripts/check_cache_bump.py origin/main HEAD` 檢查兩個提交。

可選擇另外設定 `AUTH_USER_2` 與 `AUTH_PASSWORD_2`，兩者都設定且帳號名稱不同於 `AUTH_USER` 時才啟用第二組；只設定其中一項或帳號名稱相同時會忽略第二組。兩組權限相同，變更其中一組的帳號或密碼只會讓該組原有工作階段失效。第一組的 `AUTH_USER`、`AUTH_PASSWORD` 與 `SESSION_SECRET` 仍為必填；缺少任一項或密鑰不足 32 字元時，受保護資源會回傳 503。

本機可安裝 Wrangler 後以 `wrangler pages dev .` 啟動，使用未追蹤的 `.dev.vars` 設定上述必要變數及選用的第二組帳密。部署前請另外測試 HTTPS 和目標裝置。

`status.json` 的 `enabled` 設為 `false` 可讓下次線上啟動顯示停用訊息，移除本 App 的 Service Worker 快取，保留 IndexedDB 圖面及標記。離線或無法取得狀態時仍可開啟已快取的外殼；網路請求逾 4 秒也會回退快取，逾時後才收到的登入拒絕不會阻止這次開啟，因此遠端停用、登出與密碼更換無法即時阻止離線或連線緩慢的裝置使用本機資料；取得裝置的人也可能存取本機儲存內容。登入使用共用帳密與有效期 90 天的工作階段，登出僅清除目前瀏覽器的 Cookie，並非資料加密；錯誤登入僅固定延遲，正式使用應另設 Cloudflare 層級的速率限制。
