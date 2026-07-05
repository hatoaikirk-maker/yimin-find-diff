# 北港義民廟《大家來找碴》🐕⚡

義犬將軍來發威！找出 A、B 兩圖之間 5 個不同的地方。
純前端網頁遊戲，不需伺服器，直接放上 GitHub Pages 就能玩。

## 玩法

- 每關 90 秒，找出 5 處不同，點錯扣 5 秒
- 卡關按「義犬將軍來發威」自動揭示一處（每關 3 次，金圈標記）
- 過關依剩餘時間給 1~3 顆星，過關解鎖下一關
- 手機建議橫向遊玩（也支援直式堆疊版面）

## 檔案結構

```
├── index.html            遊戲主頁
├── editor.html           關卡編輯器（標答案座標用，不用對外公開）
├── css/style.css         遊戲樣式
├── css/editor.css        編輯器樣式
├── js/game.js            遊戲主程式
├── js/editor.js          編輯器程式
├── js/levels.js          ★ 關卡資料（圖片檔名＋差異座標）
├── ChatGPT Image *.png   關卡圖（A/B 合成圖）與模板底圖
└── README.md
```

## 放上 GitHub Pages（第一次）

1. 到 GitHub 建新 repo（例如 `yimin-find-diff`，Public）
2. 把這整個資料夾的檔案上傳：
   ```bash
   cd 大家來找碴
   git init
   git add .
   git commit -m "北港義民廟大家來找碴 v1"
   git branch -M main
   git remote add origin https://github.com/你的帳號/yimin-find-diff.git
   git push -u origin main
   ```
   （不會用指令的話：repo 頁面 → Add file → Upload files → 全部拖進去）
3. Repo → Settings → Pages → Source 選 `Deploy from a branch`，
   Branch 選 `main` / `(root)` → Save
4. 等 1~2 分鐘，網址就是
   `https://你的帳號.github.io/yimin-find-diff/`

## 校正／新增關卡

1. 瀏覽器打開 `editor.html`（本機直接雙擊，或上線後網址加 `/editor.html`）
2. 下拉選關卡 → 按「🔍 自動偵測差異」（可調靈敏度重試），
   或直接左鍵點圖加圈、右鍵刪圈
3. 按「📋 複製 JSON」，貼回 `js/levels.js` 對應關卡，
   取代該關的 `panelA / panelB / diffs`
4. 新關卡：把新的 A/B 合成圖丟進資料夾，在 `levels.js` 的
   `levels` 陣列照格式加一筆即可（`file` 填檔名）

驗證答案位置：網址加 `?debug=1` 會用虛線圈顯示所有答案區。

## 資安說明

- CSP（內容安全政策）鎖定只載入站內資源，防 XSS 注入
- 所有動態文字用 `textContent` 寫入，不用 `innerHTML`
- `localStorage` 進度有格式驗證，竄改不會弄壞遊戲
- 不想讓玩家 F12 看到答案：編輯器「🔒 複製混淆版」會輸出
  `data: "..."` 字串，貼到關卡取代 `diffs` 欄位即可（遊戲兩種格式都支援）

## 素材授權

關卡照片為北港義民廟實地拍攝、由 ChatGPT 生成找碴版本。
僅供廟方推廣使用。
