# 勁揚業務管家

這是一個手機優先的 PWA 網頁 App 原型，提供業務員管理店家、保留物品提醒、拍照存檔、業績分析與庫存查詢。

## 目前功能

- 深色科技感卡片首頁，保留原本業務管理內容
- 店家資料：可依負責業務篩選店家，只顯示店家資訊，不顯示當月業績金額
- 保留物品：包含編號、必要欄位與系列、保留地址、保留時間、提醒內容
- 期限提醒：保留物品期限為兩個月，到期前一週會列入提醒
- 拍照存檔：每個店家有獨立照片資料夾
- 外部資訊：業績分析表與庫存查詢表以卡片入口整合到 App
- 後台管理：新增店家、清除本機資料、匯出資料
- PWA 設定：支援 manifest 與 service worker，可加入手機主畫面

## 使用方式

直接開啟 `index.html` 可以使用原型。若要完整測試 PWA 安裝與 service worker，建議用本機伺服器開啟：

```bash
python3 -m http.server 4181 --bind 0.0.0.0
```

然後用瀏覽器開啟：

```text
http://localhost:4181
```

手機測試時，請讓手機與電腦在同一個 Wi-Fi，改用電腦的區網 IP 開啟。

## 手機長期使用

長期使用建議部署到 HTTPS 網站，再從手機瀏覽器加入主畫面。這樣手機不用跟電腦在同一個網路，也不需要電腦一直開著。

建議平台：

- Vercel：適合靜態網站與之後升級成 API
- Netlify：適合純前端 PWA，設定簡單
- Cloudflare Pages：速度快，適合正式長期使用

目前專案已包含：

- `vercel.json`：Vercel 部署設定
- `netlify.toml`：Netlify 部署設定
- `manifest.webmanifest`：PWA 安裝資訊
- `service-worker.js`：離線快取
- `icons/`：手機 App icon

部署完成後，用手機打開 HTTPS 網址，然後：

- iPhone Safari：分享按鈕 → 加入主畫面
- Android Chrome：右上角選單 → 新增至主畫面 / 安裝應用程式


## Google 雲端後台

本專案已加入 Google Sheet / Google Drive 後台串接範本。

- Apps Script 程式：`google-apps-script/Code.gs`
- 部署步驟：`GOOGLE_SETUP.md`
- Drive 資料夾：`https://drive.google.com/drive/folders/1eOqcHag3qUO_Cd7n2Hv4A4Q3K8NKgXvB`

部署 Apps Script 後，把 Web App URL 貼到 App 的「後台管理 → Google 雲端同步」，即可建立試算表後台並同步店家、保留物品與照片紀錄。


## 專案位置

目前固定使用的業務管家主資料夾：

`/Users/chenhaoan/Documents/jingyang-sales-app`

請避免再用 `/Users/chenhaoan/Documents/app` 來修改業務管家，該資料夾目前已偏向其他專案用途。
