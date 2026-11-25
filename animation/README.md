# 導覽動態示意

`index.html`、`motion.css`、`motion.js` 是可獨立開啟的 HTML/CSS/JS 來源，未使用客戶資料或外部素材。`motion.js` 的 `CONFIG` 可調整時長、點擊時間、目標與位置；`motion.css` 的變數可調整配色及尺寸，`seek(t)` 可定位動畫時間。

`navigation-loop.mp4` 為 1080 × 1350、30 fps、4 秒、H.264、無音訊的循環影片。執行 `python3 render.py` 使用本機 Chrome、Playwright 與 FFmpeg 重新逐幀彩現；修改尺寸或時長時，也需同步調整 `render.py` 的畫布尺寸及影格數。

已讀取本機 HyperFrames 技能；動態圖形工作流程離線安裝未成功，因此此交付使用本機 Playwright 逐幀彩現，並非 HyperFrames 專案。
