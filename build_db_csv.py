#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_db_csv.py
資安審查：
  ✅ 完全離線，不連網路
  ✅ 只讀本機 CSV/XLSX，只寫 db/ 目錄
  ✅ 無刪除、無上傳、無後門
"""

import csv, json, re, time, sys
from pathlib import Path
from collections import defaultdict

# ★ 關鍵修正：以「本腳本所在位置」為基準，不管從哪裡執行都能找到檔案
SCRIPT_DIR = Path(__file__).parent.resolve()
OUT_DIR    = SCRIPT_DIR / "db"
OUT_FILE   = OUT_DIR / "license_to_actives.json"


def norm_lic(s):
    return (s or "").replace(" ", "").replace("\u3000", "").strip()

def digits_lic(s):
    m = re.search(r"(\d{5,7})", s or "")
    return m.group(1) if m else ""

def clean_active(s):
    if not s: return ""
    s = str(s).strip()
    s = re.sub(r"\d[\d.,]*\s*(mg|ml|mcg|g|iu|%|unit|cc)s?", "", s, flags=re.I)
    s = re.sub(r"[\(（【\[].*?[\)）】\]]", "", s)
    s = s.strip(" .,，。\t")
    return s.lower() if len(s) >= 2 else ""

def find_file(prefixes):
    """在腳本所在資料夾搜尋檔案"""
    for prefix in prefixes:
        for ext in [".csv", ".xlsx", ".xls", ""]:
            p = SCRIPT_DIR / (prefix + ext)
            if p.exists():
                return p
    return None

def read_csv(path):
    print(f"  讀取 CSV：{path.name}  ({path.stat().st_size//1024:,} KB)")
    for enc in ("utf-8-sig", "utf-8", "big5", "cp950"):
        try:
            with open(path, encoding=enc, newline="") as f:
                rows = list(csv.DictReader(f))
            print(f"  編碼：{enc}，{len(rows):,} 筆")
            return rows
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"無法讀取 {path}")

def read_xlsx(path):
    print(f"  讀取 XLSX：{path.name}  ({path.stat().st_size//1024:,} KB)")
    try:
        import openpyxl
    except ImportError:
        print("  安裝 openpyxl…")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "openpyxl", "-q"])
        import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    headers = None
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        cells = [str(c).strip() if c is not None else "" for c in row]
        if i == 0:
            headers = cells
            continue
        if headers:
            rows.append(dict(zip(headers, cells)))
    wb.close()
    print(f"  {len(rows):,} 筆")
    return rows

def read_file(path):
    if path.suffix.lower() in (".xlsx", ".xls"):
        return read_xlsx(path)
    return read_csv(path)

def find_col(keys, keywords):
    for kw in keywords:
        for k in keys:
            if kw in k:
                return k
    return None


def main():
    print("=" * 56)
    print("build_db_csv.py — TFDA 成分資料 → license_to_actives.json")
    print(f"腳本位置：{SCRIPT_DIR}")
    print("=" * 56)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── 找 43_2 ───────────────────────────────────────────
    f43 = find_file(["43_2", "43_1", "43"])
    if not f43:
        print(f"\n❌ 在 {SCRIPT_DIR} 找不到 43_2.csv 或 43_2.xlsx")
        print()
        print("請把以下其中一個檔案複製到腳本資料夾：")
        print(f"  {SCRIPT_DIR}\\43_2.csv   ← 建議（小，1.9 MB）")
        print(f"  {SCRIPT_DIR}\\43_2.xlsx  ← 備用（大，13.5 MB）")
        return

    # ── 讀成分資料 ────────────────────────────────────────
    print(f"\n── 步驟 1：讀成分資料 ──")
    rows43 = read_file(f43)
    if not rows43:
        print("❌ 無資料"); return

    keys = list(rows43[0].keys())
    print(f"  欄位（前8）：{keys[:8]}")

    lic_col = find_col(keys, ["許可證字號", "許可", "字號", "LICNO", "LICENSE"])
    act_col = find_col(keys, ["成分名稱", "成分", "INGREDIENT", "ACTIVE"])

    if not lic_col:
        print(f"❌ 找不到字號欄位。可用欄位：{keys}"); return
    if not act_col:
        print(f"❌ 找不到成分欄位。可用欄位：{keys}"); return
    print(f"  ✔ 字號欄：【{lic_col}】，成分欄：【{act_col}】")

    lic_actives = defaultdict(list)
    skip = 0
    for row in rows43:
        lic_raw = (row.get(lic_col) or "").strip()
        act_raw = (row.get(act_col) or "").strip()
        if not lic_raw or not act_raw or act_raw in ("None", "-", "nan", ""):
            skip += 1; continue
        lf  = norm_lic(lic_raw)
        act = clean_active(act_raw)
        if lf and act and act not in lic_actives[lf]:
            lic_actives[lf].append(act)

    print(f"  有效許可證數：{len(lic_actives):,}，略過：{skip:,}")

    # ── 讀 36_2（補充中文品名，選用）────────────────────
    lic_zhname = {}
    f36 = find_file(["36_2", "36_1", "36"])
    if f36:
        print(f"\n── 步驟 2：讀主表（{f36.name}）──")
        rows36 = read_file(f36)
        keys36 = list(rows36[0].keys()) if rows36 else []
        lic36  = find_col(keys36, ["許可證字號", "許可", "字號", "LICNO"])
        zh36   = find_col(keys36, ["中文品名", "品名", "中文"])
        if lic36 and zh36:
            for row in rows36:
                lr = (row.get(lic36) or "").strip()
                zn = (row.get(zh36) or "").strip()
                if lr and zn and zn not in ("None", "-", "nan"):
                    lic_zhname[norm_lic(lr)] = zn
            print(f"  取得中文品名：{len(lic_zhname):,} 筆")
        else:
            print(f"  ⚠️  找不到欄位，略過")
    else:
        print(f"\n── 步驟 2：找不到 36_2，略過 ──")

    # ── 組合輸出 ──────────────────────────────────────────
    print(f"\n── 步驟 3：寫入 {OUT_FILE} ──")
    output = {}
    today  = time.strftime("%Y-%m-%d")

    for lf, acts in lic_actives.items():
        ld = digits_lic(lf)
        entry = {"actives": acts, "source": "TFDA_43_csv", "updated": today}
        if lic_zhname.get(lf):
            entry["name_zh"] = lic_zhname[lf]
        output[lf] = entry
        if ld and ld != lf:
            output[ld] = entry

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    sz = OUT_FILE.stat().st_size / 1024
    print()
    print(f"✅ 完成！")
    print(f"   有效許可證：{len(lic_actives):,} 筆")
    print(f"   DB key 數（含雙鍵）：{len(output):,}")
    print(f"   檔案大小：{sz:,.1f} KB")
    print()
    print("下一步：")
    print("  git add db/license_to_actives.json")
    print("  git commit -m 'Update TFDA license DB'")
    print("  git push")
    print("=" * 56)


if __name__ == "__main__":
    main()
