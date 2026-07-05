/* ============================================================
 * 關卡編輯器主程式
 * ------------------------------------------------------------
 * 用途：
 *   1. 標記/微調每一關的差異座標（點圖即可）
 *   2. 「自動偵測差異」：瀏覽器端像素比對 A/B 面板，
 *      自動找出差異最大的區塊當作答案圈（可調靈敏度）
 *   3. 輸出 JSON（明文）或混淆字串（防 F12 偷看）
 * ============================================================ */
"use strict";

(function () {

  const XOR_KEY = "YiMinTemple2026"; // 必須與 game.js 相同

  function xorDecode(b64) {
    try {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length);
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      console.error("關卡資料解碼失敗", e);
      return null;
    }
  }

  function getDiffsForEditor(level) {
    if (Array.isArray(level.diffs)) return level.diffs;
    if (typeof level.data === "string") {
      const decoded = xorDecode(level.data);
      if (decoded && Array.isArray(decoded.diffs)) return decoded.diffs;
    }
    return [];
  }

  const $ = (id) => document.getElementById(id);
  const cvsA = $("edA"), cvsB = $("edB");
  const ctxA = cvsA.getContext("2d"), ctxB = cvsB.getContext("2d");
  const output = $("output");

  /* 編輯狀態 */
  const E = {
    img: null,
    rectA: LEVELS.defaultPanelA.slice(),
    rectB: LEVELS.defaultPanelB.slice(),
    diffs: [],       // {x,y,r} 面板相對座標
    history: []      // 復原用
  };

  /* ---------- 初始化關卡下拉選單 ---------- */
  const sel = $("selLevel");
  LEVELS.levels.forEach((lv, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = lv.name;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => loadLevel(parseInt(sel.value, 10)));

  function loadLevel(i) {
    const lv = LEVELS.levels[i];
    E.rectA = (lv.panelA || LEVELS.defaultPanelA).slice();
    E.rectB = (lv.panelB || LEVELS.defaultPanelB).slice();
    E.diffs = getDiffsForEditor(lv).map(d => ({ x: d.x, y: d.y, r: d.r }));
    E.history = [];
    loadImage(encodeURI(lv.file));
    syncRectInputs();
  }

  function loadImage(src) {
    const img = new Image();
    img.onload = () => { E.img = img; resize(); redraw(); updateOutput(); };
    img.onerror = () => alert("圖片載入失敗：" + src);
    img.src = src;
  }

  /* 自選圖片（做新關卡用） */
  $("fileInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { alert("請選擇圖片檔"); return; } // 防呆：只收圖片
    const url = URL.createObjectURL(f);
    E.diffs = []; E.history = [];
    loadImage(url);
  });

  /* ---------- 面板範圍輸入框 ---------- */
  const rectIds = { a: ["ax", "ay", "aw", "ah"], b: ["bx", "by", "bw", "bh"] };
  function syncRectInputs() {
    rectIds.a.forEach((id, i) => { $(id).value = E.rectA[i].toFixed(3); });
    rectIds.b.forEach((id, i) => { $(id).value = E.rectB[i].toFixed(3); });
  }
  $("btnApplyRect").addEventListener("click", () => {
    // 讀回並夾在 0~1，避免亂輸入
    const clamp = (v) => Math.min(1, Math.max(0, parseFloat(v) || 0));
    E.rectA = rectIds.a.map(id => clamp($(id).value));
    E.rectB = rectIds.b.map(id => clamp($(id).value));
    resize(); redraw(); updateOutput();
  });

  /* ---------- 畫布尺寸與繪製 ---------- */
  function resize() {
    if (!E.img) return;
    const iw = E.img.naturalWidth, ih = E.img.naturalHeight;
    [[cvsA, E.rectA], [cvsB, E.rectB]].forEach(([cvs, r]) => {
      const w = Math.round(r[2] * iw), h = Math.round(r[3] * ih);
      // 用面板實際像素當畫布解析度（顯示大小交給 CSS）
      cvs.width = w; cvs.height = h;
    });
  }

  function drawOne(cvs, ctx, rect) {
    if (!E.img) return;
    const iw = E.img.naturalWidth, ih = E.img.naturalHeight;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(E.img, rect[0] * iw, rect[1] * ih, rect[2] * iw, rect[3] * ih, 0, 0, cvs.width, cvs.height);
    E.diffs.forEach((d, i) => {
      ctx.beginPath();
      ctx.arc(d.x * cvs.width, d.y * cvs.height, d.r * cvs.width, 0, Math.PI * 2);
      ctx.strokeStyle = "#e33a24";
      ctx.lineWidth = Math.max(3, cvs.width * 0.006);
      ctx.stroke();
      ctx.fillStyle = "#e33a24";
      ctx.font = "bold " + Math.max(16, cvs.width * 0.03) + "px sans-serif";
      ctx.fillText(String(i + 1), d.x * cvs.width + d.r * cvs.width + 4, d.y * cvs.height);
    });
  }
  function redraw() { drawOne(cvsA, ctxA, E.rectA); drawOne(cvsB, ctxB, E.rectB); }

  /* ---------- 點擊新增 / 右鍵刪除 ---------- */
  function canvasPos(e, cvs) {
    const box = cvs.getBoundingClientRect();
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  }
  function addDiff(e, cvs) {
    const p = canvasPos(e, cvs);
    E.history.push(E.diffs.slice());
    E.diffs.push({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), r: parseFloat($("radius").value) });
    redraw(); updateOutput();
  }
  function removeNearest(e, cvs) {
    e.preventDefault();
    if (!E.diffs.length) return;
    const p = canvasPos(e, cvs);
    let bi = 0, bd = Infinity;
    E.diffs.forEach((d, i) => {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < bd) { bd = dist; bi = i; }
    });
    E.history.push(E.diffs.slice());
    E.diffs.splice(bi, 1);
    redraw(); updateOutput();
  }
  [cvsA, cvsB].forEach(cvs => {
    cvs.addEventListener("click", (e) => addDiff(e, cvs));
    cvs.addEventListener("contextmenu", (e) => removeNearest(e, cvs));
  });

  $("btnUndo").addEventListener("click", () => {
    if (E.history.length) { E.diffs = E.history.pop(); redraw(); updateOutput(); }
  });
  $("btnClear").addEventListener("click", () => {
    E.history.push(E.diffs.slice());
    E.diffs = [];
    redraw(); updateOutput();
  });
  $("radius").addEventListener("input", () => { $("radiusVal").textContent = $("radius").value; });

  /* ---------- 自動偵測差異（像素比對） ---------- */
  $("btnAuto").addEventListener("click", () => {
    if (!E.img) return;
    const th = parseInt($("threshold").value, 10); // 靈敏度（色差門檻）

    // 1. 把 A/B 面板縮到相同小尺寸做比對（速度快、抗雜訊）
    //    H2 依面板實際長寬比計算，避免變形影響比對
    const W = 260;
    const H2 = Math.round(W * (E.rectA[3] * E.img.naturalHeight) / (E.rectA[2] * E.img.naturalWidth));
    const da = sample(E.rectA, W, H2), db = sample(E.rectB, W, H2);

    // 2. 嘗試小幅位移對齊（AI 合成圖 A/B 可能有 1~2px 偏移）
    let best = { off: [0, 0], score: Infinity };
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      let s = 0;
      for (let y = 8; y < H2 - 8; y += 7) for (let x = 8; x < W - 8; x += 7) {
        s += pixDist(da, db, x, y, x + ox, y + oy, W);
      }
      if (s < best.score) best = { off: [ox, oy], score: s };
    }
    const [ox, oy] = best.off;

    // 3. 產生差異圖（跳過左上角 A圖/B圖 標籤區）
    const mask = new Uint8Array(W * H2);
    for (let y = 3; y < H2 - 3; y++) for (let x = 3; x < W - 3; x++) {
      if (x < W * 0.16 && y < H2 * 0.10) continue; // 標籤區忽略
      const x2 = Math.min(W - 1, Math.max(0, x + ox));
      const y2 = Math.min(H2 - 1, Math.max(0, y + oy));
      if (pixDist(da, db, x, y, x2, y2, W) > th) mask[y * W + x] = 1;
    }

    // 4. 連通區塊分群（BFS），取面積最大的前幾群
    const groups = cluster(mask, W, H2);
    groups.sort((a, b) => b.count - a.count);
    const picked = groups.filter(g => g.count > 12).slice(0, 8);

    E.history.push(E.diffs.slice());
    E.diffs = picked.map(g => ({
      x: +(g.cx / W).toFixed(4),
      y: +(g.cy / H2).toFixed(4),
      r: +Math.min(0.15, Math.max(0.05, (g.rad / W) * 1.6)).toFixed(4)
    }));
    redraw(); updateOutput();
    alert("偵測到 " + picked.length + " 個差異區塊（已依大小排序取前 8）。\n多的請右鍵刪除、漏的請左鍵補點，調「靈敏度」可重試。");
  });

  /* 取樣：把面板縮小畫進暫存 canvas 取得像素 */
  function sample(rect, w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const iw = E.img.naturalWidth, ih = E.img.naturalHeight;
    ctx.drawImage(E.img, rect[0] * iw, rect[1] * ih, rect[2] * iw, rect[3] * ih, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }
  function pixDist(a, b, x1, y1, x2, y2, w) {
    const i = (y1 * w + x1) * 4, j = (y2 * w + x2) * 4;
    return Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
  }
  function cluster(mask, w, h) {
    const seen = new Uint8Array(w * h);
    const groups = [];
    const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || seen[idx]) continue;
      // BFS 找連通區塊（含 2px 間隙容忍）
      let head = 0, tail = 0, sx = 0, sy = 0, n = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      qx[tail] = x; qy[tail] = y; tail++; seen[idx] = 1;
      while (head < tail) {
        const cx = qx[head], cy = qy[head]; head++;
        sx += cx; sy += cy; n++;
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] && !seen[ni]) { seen[ni] = 1; qx[tail] = nx; qy[tail] = ny; tail++; }
        }
      }
      groups.push({
        cx: sx / n, cy: sy / n, count: n,
        rad: Math.max(maxX - minX, maxY - minY) / 2
      });
    }
    return groups;
  }

  /* ---------- 輸出 ---------- */
  function levelJson() {
    return {
      panelA: E.rectA.map(v => +v.toFixed(3)),
      panelB: E.rectB.map(v => +v.toFixed(3)),
      diffs: E.diffs
    };
  }
  function updateOutput() {
    output.value = JSON.stringify(levelJson(), null, 2);
  }
  function xorEncode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i] ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
    }
    return btoa(s);
  }
  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "✅ 已複製";
      setTimeout(() => { btn.textContent = old; }, 1200);
    } catch (e) {
      output.value = text; output.select();
      alert("自動複製失敗，內容已放到下方文字框，請手動複製");
    }
  }
  $("btnCopy").addEventListener("click", (e) => copy(JSON.stringify(levelJson(), null, 2), e.target));
  $("btnCopyObf").addEventListener("click", (e) => {
    // 混淆版：diffs 改成 data 字串，貼回 levels.js 時「刪掉 diffs、加上 data」
    const obf = 'data: "' + xorEncode({ diffs: E.diffs }) + '"';
    copy(obf, e.target);
  });

  /* ---------- 啟動 ---------- */
  loadLevel(0);
  $("radiusVal").textContent = $("radius").value;

})();
