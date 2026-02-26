# allergy-checker
# 藥物過敏快速比對工具

手機可用 · GitHub Pages 部署 · 資料只存本機不上傳

> ⚠️ 此工具僅供自我核對與溝通參考，不能取代醫師/藥師判斷。  
> 若出現呼吸困難、全身蕁麻疹、喉頭腫脹等嚴重過敏症狀，請立刻就醫。

---

## 使用方式

開啟 GitHub Pages 網址後：
1. 貼上**成分名稱**或**許可證字號**
2. 按「比對」
3. 看結果：🔴 高風險 / 🟡 未驗證 / 🟢 已驗證安全

---

## 安全機制（保命規則）

| 狀態 | 條件 |
|---|---|
| 🟢 已驗證未命中 | 字號成功查到主成分，且未命中過敏清單 |
| 🟡 未命中（未驗證）| 只貼文字沒有字號，或字號查不到成分 |
| 🔴 高風險命中 | 命中過敏清單或高風險族群（NSAIDs、磺胺類等）|

**沒有驗證 = 絕不給綠燈。**

---

## 專案檔案說明

```
allergy-checker/
├── index.html              # 主網頁（前端全在這裡）
├── data.json               # 個人過敏清單 + 同義字 + 族群規則
├── app.js                  # 舊版 JS（保留備用）
├── manifest.webmanifest    # PWA 設定
├── sw.js                   # Service Worker
├── build_db_csv.py         # ★ 更新資料庫用的腳本（保留！）
└── db/
    └── license_to_actives.json   # TFDA 字號→成分索引（由腳本產生）
```

---

## 資料來源（TFDA 開放資料）

| 資料集 | 用途 | 下載網址 |
|---|---|---|
| **43_2**（藥品詳細處方成分） | 字號 → 主成分（最重要） | https://data.gov.tw/dataset/9121 |
| **36_2**（藥品許可證主表） | 補充中文品名（可選） | https://data.gov.tw/dataset/9122 |

---

## 每 1-2 個月更新資料庫

### 步驟 1：下載新版 CSV

**43_2.csv（必要）：**
1. 開瀏覽器前往 https://data.gov.tw/dataset/9121
2. 點「下載」→ 下載 CSV 檔
3. 存到 `C:\Users\mis23\OneDrive\桌面\allergy-checker\43_2.csv`（覆蓋舊檔）

**36_2.csv（選用，補充中文品名）：**
1. 前往 https://data.gov.tw/dataset/9122
2. 點「下載」→ 下載 CSV 檔
3. 存到 `C:\Users\mis23\OneDrive\桌面\allergy-checker\36_2.csv`（覆蓋舊檔）

---

### 步驟 2：執行更新腳本

在 VS Code 終端機輸入：

```
cd C:\Users\mis23\OneDrive\桌面\allergy-checker
python build_db_csv.py
```

看到以下輸出代表成功：
```
✅ 完成！
   有效許可證：62,542 筆
   DB key 數（含雙鍵）：105,376
   檔案大小：16,285.7 KB
```

---

### 步驟 3：上傳到 GitHub（用網頁）

1. 開瀏覽器，進入你的 GitHub repo
2. 點進 `db` 資料夾
3. 點 **Add file → Upload files**
4. 把 `C:\Users\mis23\OneDrive\桌面\allergy-checker\db\license_to_actives.json` 拖進去
5. 下方填寫：`Update TFDA license DB YYYY-MM`
6. 按 **Commit changes**
7. 等 2-3 分鐘，GitHub Pages 自動部署完成

---

## 哪些 .py 檔可以刪？

| 檔案 | 可以刪嗎？ |
|---|---|
| `build_db_csv.py` | ❌ **不要刪**，每次更新都需要它 |
| `build_db.py` | ✅ 可刪（舊版，改用 API 的，已不用） |
| `build_db_from_csv.py` | ✅ 可刪（被 build_db_csv.py 取代了） |

---

## 隱私與安全

- 所有過敏資料只存在**你的瀏覽器 localStorage**，不上傳到任何伺服器
- `build_db_csv.py` 完全離線執行，不連網路
- 可用「匯出 JSON」備份過敏清單到本機

---

## 免責聲明

此工具僅供自我核對與溝通參考，不能取代醫師/藥師判斷。  
使用前請先與醫師確認完整過敏原資訊。
