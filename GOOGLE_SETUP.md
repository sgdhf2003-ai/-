# Google Sheet / Drive 後台部署

Drive 資料夾已指定：

`https://drive.google.com/drive/folders/1eOqcHag3qUO_Cd7n2Hv4A4Q3K8NKgXvB`

## 1. 建立 Apps Script

1. 開啟 [Google Apps Script](https://script.google.com/)
2. 建立新專案，名稱建議：`勁揚業務管家後台`
3. 刪掉預設內容，貼上 `google-apps-script/Code.gs`
4. 儲存

## 2. 授權與部署

1. 點右上角「部署」→「新增部署作業」
2. 類型選「網頁應用程式」
3. 執行身分選「我」
4. 存取權限先選「知道連結的任何人」
5. 按部署並完成 Google 授權
6. 複製 Web App URL，格式會像：

```text
https://script.google.com/macros/s/AKfycb.../exec
```

## 3. 回到 PWA 後台

1. 開啟勁揚業務管家
2. 進入「後台管理」
3. 在「Google 雲端同步」貼上 Web App URL
4. 按「儲存連線」
5. 按「建立 Google 後台」
6. 按「上傳目前資料」

完成後，Apps Script 會在指定 Drive 資料夾裡建立：

- `勁揚業務管家後台` Google Sheet
- 每個店家的照片資料夾
- 照片檔案與 Sheet 紀錄連結

## 注意

目前 PWA 仍保留本機資料作為暫存。照片會先壓縮後存本機縮圖，再將較大版本上傳到 Google Drive，避免手機長期堆滿原圖。
