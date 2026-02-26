/**
 * app.js — 藥物過敏快速比對（驗證版 v2）
 *
 * 核心安全原則（Fail-Safe）：
 *   🔴 高風險命中  → 命中你的清單或風險藥物族群
 *   🟡 未命中但未驗證 → 只貼文字（無字號），或字號查不到主成分
 *   🟢 已驗證未命中  → 字號成功查到主成分 且 比對未命中
 *   ⚠️  沒有驗證 = 絕不給綠燈
 */

"use strict";

const $ = (id) => document.getElementById(id);

// ── 常數 ─────────────────────────────────────────────────────────────────────
const STORAGE_KEY = "allergy_checker_user_data_v3";
const DB_URL      = "./db/license_to_actives.json";
const DATA_URL    = "./data.json";
// 版本號：每次更新程式時改這裡，讓瀏覽器重新載入
const VER         = "20260226b";

// ── 全域狀態 ──────────────────────────────────────────────────────────────────
let licenseDB   = null;   // db/license_to_actives.json 載入後存這裡（懶加載）
let dbLoadState = "idle"; // "idle" | "loading" | "ok" | "missing" | "error"

// ── HTML 跳脫 ─────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ── 文字正規化 ────────────────────────────────────────────────────────────────
function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\[\]{}]/g, " ")
    .replace(/\bmg\b|\bml\b|\btab\b|\bcap\b|\bamp\b/gi, " ")
    .replace(/[+;,/]/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff\s.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTokens(s) {
  const t = normalizeText(s);
  if (!t) return [];
  return t.split(" ").map((x) => x.trim()).filter(Boolean);
}

// ── 字號正規化 ────────────────────────────────────────────────────────────────
function normalizeLicenseFull(s) {
  // 去掉所有空白後比對（「衛 署 藥 製 字 第012345號」→「衛署藥製字第012345號」）
  return (s || "").replace(/\s+/g, "").trim();
}

function extractLicenseDigits(s) {
  // 抽出 5~6 位數字（許可證號碼核心）
  const m = (s || "").match(/(\d{5,6})/);
  return m ? m[1] : "";
}

// ── 懶加載 TFDA 字號資料庫 ────────────────────────────────────────────────────
async function ensureLicenseDB() {
  if (dbLoadState === "ok")      return true;
  if (dbLoadState === "missing") return false;
  if (dbLoadState === "error")   return false;
  if (dbLoadState === "loading") {
    // 等待中，最多等 15 秒
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (dbLoadState === "ok")      return true;
      if (dbLoadState === "missing") return false;
      if (dbLoadState === "error")   return false;
    }
    return false;
  }

  // 首次載入
  dbLoadState = "loading";
  showDbStatus("loading");

  try {
    const resp = await fetch(`${DB_URL}?v=${VER}`, { cache: "no-store" });

    if (resp.status === 404) {
      dbLoadState = "missing";
      showDbStatus("missing");
      return false;
    }

    if (!resp.ok) {
      dbLoadState = "error";
      showDbStatus("error");
      return false;
    }

    licenseDB = await resp.json();
    dbLoadState = "ok";
    showDbStatus("ok");
    return true;

  } catch (e) {
    dbLoadState = "error";
    showDbStatus("error");
    return false;
  }
}

function showDbStatus(state) {
  const el = $("dbStatus");
  if (!el) return;
  const msgs = {
    idle:    "",
    loading: "🔄 載入 TFDA 資料庫中…",
    ok:      "✅ TFDA 資料庫已載入",
    missing: "⚠️  找不到 db/license_to_actives.json — 請先執行 build_db.py 建立資料庫",
    error:   "❌ 資料庫載入失敗（請重新整理頁面）",
  };
  el.textContent = msgs[state] || "";
  el.className   = "dbstatus " + state;
}

// ── 從 DB 查主成分 ────────────────────────────────────────────────────────────
function lookupLicense(licenseFull, licenseDigits) {
  if (!licenseDB) return null;

  // 先用完整字號查，再用純數字查
  const entry = licenseDB[licenseFull] || licenseDB[licenseDigits] || null;
  if (!entry) return null;

  // 支援兩種格式：
  //   新格式（build_db.py）：直接是陣列 ["ibuprofen", ...]
  //   舊格式（手寫）        ：{ actives: ["ibuprofen"], ... }
  if (Array.isArray(entry)) return entry;
  if (Array.isArray(entry.actives)) return entry.actives;
  return null;
}

// ── 同義字 / 品牌展開 ─────────────────────────────────────────────────────────
function applySynonym(token, synonyms) {
  return synonyms[(token || "").toLowerCase()] || token;
}

function expandBrands(tokens, brandMap) {
  const out = [...tokens];
  for (const t of tokens) {
    const mapped = brandMap[(t || "").toLowerCase()];
    if (mapped) mapped.forEach((a) => out.push(String(a).toLowerCase()));
  }
  return out;
}

// ── 比對過敏清單 + 族群 ───────────────────────────────────────────────────────
function severityRank(sev) {
  if (sev === "high" || sev === "bad") return 3;
  if (sev === "medium" || sev === "warn") return 2;
  return 1;
}

function matchAllergies(tokens, allergies, base) {
  const synonyms = base.synonyms || {};
  const brandMap = base.brand_to_actives || {};

  const normTokens = tokens.map((t) => applySynonym(t, synonyms));
  const expanded   = expandBrands(normTokens, brandMap).map((t) => applySynonym(t, synonyms));
  const tokenSet   = new Set(expanded);

  // ── 直接命中（你的過敏清單）
  const directHits = [];
  for (const a of allergies) {
    const v = applySynonym(normalizeText(a.value), synonyms);
    if (v && tokenSet.has(v)) {
      directHits.push({ value: a.value, note: a.note || "", canonical: v });
    }
  }

  // 中文品名 substring 匹配
  const rawJoined = expanded.join(" ");
  for (const a of allergies) {
    const av = (a.value || "").trim();
    if (av.length >= 2 && /[\u4e00-\u9fff]/.test(av)) {
      if (rawJoined.includes(normalizeText(av))) {
        directHits.push({ value: av, note: a.note || "", canonical: normalizeText(av) });
      }
    }
  }

  // 去重
  const seen = new Set();
  const directUnique = directHits.filter((h) => {
    const k = `${h.canonical}::${h.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // ── 族群命中（NSAIDs, 磺胺類…）
  const groupHits = [];
  for (const g of base.groups || []) {
    const members    = (g.members || []).map((x) => String(x).toLowerCase());
    const hitMembers = members.filter((m) => tokenSet.has(m));
    if (hitMembers.length) {
      groupHits.push({
        id: g.id, name: g.name,
        severity: g.severity || "warn",
        hit_members: [...new Set(hitMembers)],
      });
    }
  }

  return { directHits: directUnique, groupHits };
}

// ── 結果渲染 ──────────────────────────────────────────────────────────────────
function renderResult(res, base, meta) {
  const { directHits, groupHits } = res;

  const worst = Math.max(
    ...groupHits.map((g) => severityRank(g.severity)),
    ...(directHits.length ? [3] : [1])
  );

  const verOk  = meta.verification.ok === true;
  const verWhy = meta.verification.why || "";

  let status, statusText;
  if (worst >= 3) {
    status = "bad";  statusText = "🔴 高風險命中";
  } else if (worst === 2) {
    status = "warn"; statusText = "🟡 可能相關";
  } else if (verOk) {
    status = "good"; statusText = "🟢 已驗證未命中";
  } else {
    status = "warn"; statusText = "🟡 未命中（但未驗證）";
  }

  let html = `<div class="pill big"><span class="dot ${status}"></span><b>${escapeHtml(statusText)}</b></div>`;

  // 未命中但未驗證：顯示原因
  if (!verOk && worst < 3) {
    html += `<div class="warn-box">⚠️ ${escapeHtml(verWhy || "資料不足，不能確認安全")}</div>`;
  }

  html += `<div class="sep"></div>`;

  // 族群命中
  if (groupHits.length) {
    html += `<div class="section-label">族群命中</div>`;
    for (const g of groupHits.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))) {
      const s = severityRank(g.severity) >= 3 ? "bad" : "warn";
      html += `<div class="pill"><span class="dot ${s}"></span>${escapeHtml(g.name)}<br/>
        <span class="mono small">命中：${escapeHtml(g.hit_members.join(", "))}</span></div>`;
    }
    html += `<div class="sep"></div>`;
  }

  // 直接命中
  if (directHits.length) {
    html += `<div class="section-label">直接命中（你的清單）</div>`;
    for (const h of directHits) {
      html += `<div class="pill"><span class="dot bad"></span>${escapeHtml(h.value)}
        ${h.note ? `<span class="small muted">（${escapeHtml(h.note)}）</span>` : ""}</div>`;
    }
    html += `<div class="sep"></div>`;
  }

  // ── 驗證資訊（讓你親眼確認系統真的查到了什麼）──
  html += `
    <div class="section-label">驗證資訊（請自行核對）</div>
    <table class="verify-table">
      <tr>
        <td>📝 成分/藥名（輸入原樣）</td>
        <td class="mono">${escapeHtml(meta.rawText || "（未輸入）")}</td>
      </tr>
      <tr>
        <td>📝 成分/藥名（正規化）</td>
        <td class="mono">${escapeHtml(meta.normText || "（無）")}</td>
      </tr>
      <tr>
        <td>🔑 許可證字號（輸入原樣）</td>
        <td class="mono">${escapeHtml(meta.rawLicense || "（未輸入）")}</td>
      </tr>
      <tr>
        <td>🔑 許可證字號（正規化）</td>
        <td class="mono">${escapeHtml(meta.licenseFull || "（無）")}</td>
      </tr>
      <tr>
        <td>🔑 純數字號碼</td>
        <td class="mono">${escapeHtml(meta.licenseDigits || "（無）")}</td>
      </tr>
      <tr class="${meta.activesFromLicense.length ? "highlight" : ""}">
        <td>💊 主成分（由字號查得）</td>
        <td class="mono">${escapeHtml(
          meta.activesFromLicense.length
            ? meta.activesFromLicense.join(", ")
            : "（無 / 未驗證）"
        )}</td>
      </tr>
    </table>
  `;

  $("result").innerHTML = html;
}

// ── URL 分享 ──────────────────────────────────────────────────────────────────
function buildShareUrl(text, license) {
  const url = new URL(window.location.href);
  text    ? url.searchParams.set("text",    text)    : url.searchParams.delete("text");
  license ? url.searchParams.set("license", license) : url.searchParams.delete("license");
  return url.toString();
}

// ── 過敏清單管理 ──────────────────────────────────────────────────────────────
function buildAllergyPreview(allergies) {
  $("allergyPreview").innerHTML = allergies
    .map((a) => `• ${escapeHtml(a.value)}${a.note ? `（${escapeHtml(a.note)}）` : ""}`)
    .join("<br>") || "（空）";
}

function promptEditAllergies(userData) {
  const next = window.prompt("以 JSON 編輯（格式錯誤會取消）：", JSON.stringify(userData.allergies, null, 2));
  if (!next) return;
  try {
    const parsed = JSON.parse(next);
    if (!Array.isArray(parsed)) throw new Error("必須是 array");
    userData.allergies = parsed
      .filter((x) => x && typeof x.value === "string")
      .map((x) => ({ type: x.type || "active", value: x.value.trim(), note: x.note || "" }))
      .filter((x) => x.value.length);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    buildAllergyPreview(userData.allergies);
    alert("已更新（只儲存在本機）。");
  } catch {
    alert("JSON 格式錯誤，未更新。");
  }
}

function exportJson(userData) {
  const blob = new Blob([JSON.stringify(userData.allergies, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my_allergies.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function importJsonFile(file, userData) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      if (!Array.isArray(parsed)) throw new Error("not array");
      userData.allergies = parsed
        .filter((x) => x && typeof x.value === "string")
        .map((x) => ({ type: x.type || "active", value: x.value.trim(), note: x.note || "" }))
        .filter((x) => x.value.length);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
      buildAllergyPreview(userData.allergies);
      alert("匯入完成（只儲存在本機）。");
    } catch {
      alert("匯入失敗：JSON 格式不正確。");
    }
  };
  reader.readAsText(file);
}

// ── 主程式入口 ────────────────────────────────────────────────────────────────
(async function main() {
  // 載入設定檔（過敏清單、同義字、族群規則）
  let base;
  try {
    const resp = await fetch(`${DATA_URL}?v=${VER}`, { cache: "no-store" });
    if (!resp.ok) throw new Error("data.json 讀取失敗");
    base = await resp.json();
  } catch (e) {
    $("result").innerHTML = `<div class="warn-box">❌ 設定檔載入失敗：${escapeHtml(String(e))}</div>`;
    return;
  }

  $("disclaimer").textContent = base.disclaimer || "";

  // 載入使用者個人過敏清單（localStorage 優先，fallback 用預設）
  let userData;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    userData = (parsed && Array.isArray(parsed.allergies)) ? parsed : { allergies: base.allergies };
  } catch {
    userData = { allergies: base.allergies };
  }
  buildAllergyPreview(userData.allergies);

  // 預先觸發 DB 載入（背景，不等結果）
  ensureLicenseDB();

  // URL 參數自動填入
  const params = new URLSearchParams(window.location.search);
  const urlText    = params.get("text")    || "";
  const urlLicense = params.get("license") || "";
  if (urlText)    $("text").value    = urlText;
  if (urlLicense) $("license").value = urlLicense;

  // ── 核心比對函式 ─────────────────────────────────────────────────────────
  async function run() {
    const rawText    = ($("text").value    || "").trim();
    const rawLicense = ($("license").value || "").trim();

    if (!rawText && !rawLicense) {
      $("result").innerHTML = `<div class="warn-box">請先輸入「成分/藥名」或「許可證字號」其中一項。</div>`;
      return;
    }

    // 正規化
    const normText     = normalizeText(rawText);
    const licenseFull  = normalizeLicenseFull(rawLicense);
    const licenseDigits= extractLicenseDigits(rawLicense);

    // 若有輸入字號，確保 DB 已載入
    let activesFromLicense = [];
    let verification       = { ok: false, why: "" };

    const hasText    = !!normText;
    const hasLicense = !!(licenseFull || licenseDigits);

    if (hasLicense) {
      // 嘗試載入 DB（若尚未載入）
      const dbOk = await ensureLicenseDB();

      if (dbOk) {
        const found = lookupLicense(licenseFull, licenseDigits);
        if (found && found.length > 0) {
          activesFromLicense = found;
          verification = { ok: true, why: "" };
        } else {
          verification = { ok: false, why: "字號查不到主成分（此藥未收錄，或字號格式不同）" };
        }
      } else if (dbLoadState === "missing") {
        verification = { ok: false, why: "TFDA 資料庫尚未建立 — 請先執行 build_db.py" };
      } else {
        verification = { ok: false, why: "資料庫載入失敗，請重新整理頁面" };
      }
    } else if (hasText) {
      verification = {
        ok: false,
        why: "只輸入文字（無許可證字號）— 未命中不代表安全，建議同時貼字號驗證",
      };
    } else {
      verification = { ok: false, why: "未輸入任何資訊" };
    }

    // 比對 tokens = 輸入文字 + DB 查到的主成分
    const tokens = splitTokens(rawText + " " + activesFromLicense.join(" "));
    const res    = matchAllergies(tokens, userData.allergies, base);

    renderResult(res, base, {
      rawText, normText,
      rawLicense, licenseFull, licenseDigits,
      activesFromLicense,
      verification,
    });
  }

  // ── 事件綁定 ──────────────────────────────────────────────────────────────
  $("run").addEventListener("click", run);

  // Enter 快速觸發
  [$("text"), $("license")].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
    });
  });

  $("clear").addEventListener("click", () => {
    $("text").value = "";
    $("license").value = "";
    $("result").innerHTML = `<div class="muted small">已清空。</div>`;
    history.replaceState(null, "", window.location.pathname);
  });

  $("share").addEventListener("click", async () => {
    const url = buildShareUrl($("text").value, $("license").value);
    try {
      await navigator.clipboard.writeText(url);
      alert("已複製分享連結。");
    } catch {
      window.prompt("複製這個連結：", url);
    }
  });

  $("edit").addEventListener("click", () => promptEditAllergies(userData));
  $("export").addEventListener("click", () => exportJson(userData));
  $("import").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJsonFile(f, userData);
    e.target.value = "";
  });

  // URL 帶參數時自動比對
  if (urlText || urlLicense) run();
})();
