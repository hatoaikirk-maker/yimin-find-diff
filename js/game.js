/* ============================================================
 * 北港義民廟《大家來找碴》遊戲主程式
 * ------------------------------------------------------------
 * 功能：選關、90 秒倒數、點擊判定、紅圈標記、點錯扣 5 秒、
 *       義犬將軍來發威（每關 3 次自動揭示）、結算、進度儲存。
 * 資安：不使用 innerHTML 塞入任何動態資料（防 XSS）、
 *       事件與計時器都有確實清除（防記憶體洩漏）、
 *       localStorage 讀取有 try/catch 與格式驗證。
 * 除錯：網址加 ?debug=1 會顯示所有答案區（虛線圈）。
 * ============================================================ */
"use strict";

(function () {

  /* ---------- 常數設定 ---------- */
  const GAME_TIME    = 90;   // 每關秒數
  const MISS_PENALTY = 5;    // 點錯扣秒
  const SKILL_MAX    = 3;    // 義犬將軍每關次數
  const CLICK_COOLDOWN = 220;              // 防連點（毫秒）
  const STORE_KEY    = "yimin_findiff_v1"; // 進度儲存鍵
  const XOR_KEY      = "YiMinTemple2026";  // 混淆金鑰（與編輯器一致）

  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

  /* ---------- DOM 快取 ---------- */
  const $ = (id) => document.getElementById(id);
  const screenHome = $("screenHome"), screenGame = $("screenGame");
  const stage = $("stage");
  const cvsA = $("panelA"), cvsB = $("panelB");
  const ctxA = cvsA.getContext("2d"), ctxB = cvsB.getContext("2d");
  const timerText = $("timerText"), foundText = $("foundText");
  const timerTextP = $("timerTextP"), foundTextP = $("foundTextP");
  const btnStart = $("btnStart"), btnSkill = $("btnSkill"), btnBack = $("btnBack");
  const skillCount = $("skillCount");
  const dogFx = $("dogFx"), missFx = $("missFx");
  const overlay = $("overlayResult");
  const resultTitle = $("resultTitle"), resultStars = $("resultStars"), resultDetail = $("resultDetail");
  const btnRetry = $("btnRetry"), btnNext = $("btnNext"), btnHome = $("btnHome"), btnShowAns = $("btnShowAns");
  const rotateHint = $("rotateHint"), btnStayPortrait = $("btnStayPortrait");

  /* ---------- 遊戲狀態 ---------- */
  const S = {
    levelIndex: -1,     // 目前關卡索引
    img: null,          // 目前關卡大圖（Image 物件）
    diffs: [],          // 差異點（已解碼）
    found: new Set(),   // 已找到的差異索引
    revealed: new Set(),// 由義犬將軍揭示的索引（畫金圈）
    timeLeft: GAME_TIME,
    timerId: 0,         // setInterval id（0 = 未啟動）
    running: false,
    skillLeft: SKILL_MAX,
    lastClick: 0,       // 防連點時間戳
    showAnswers: false  // 結算後看答案模式
  };

  /* ---------- 工具：混淆解碼（支援 data:"字串" 的關卡） ---------- */
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

  /* 取得某關的 diffs（相容明文陣列與混淆字串兩種格式） */
  function getDiffs(level) {
    if (Array.isArray(level.diffs)) return level.diffs;
    if (typeof level.data === "string") {
      const d = xorDecode(level.data);
      if (d && Array.isArray(d.diffs)) return d.diffs;
    }
    return [];
  }

  /* ---------- 工具：進度儲存（防呆） ---------- */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { unlocked: 1, best: {} };
      const p = JSON.parse(raw);
      // 嚴格驗證格式，避免被竄改的資料弄壞遊戲
      if (typeof p !== "object" || p === null) throw 0;
      return {
        unlocked: Math.max(1, Math.min(99, p.unlocked | 0)),
        best: (typeof p.best === "object" && p.best) ? p.best : {}
      };
    } catch (e) { return { unlocked: 1, best: {} }; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* 無痕模式可能失敗，忽略 */ }
  }
  let progress = loadProgress();

  /* ---------- 工具：音效（WebAudio，不需外部檔案） ---------- */
  let audioCtx = null;
  function beep(freq, dur, type, vol) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.15, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* 瀏覽器不支援就靜音 */ }
  }
  const sndHit  = () => { beep(880, 0.15, "sine"); setTimeout(() => beep(1320, 0.2, "sine"), 90); };
  const sndMiss = () => beep(160, 0.25, "sawtooth", 0.12);
  const sndWin  = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.22, "triangle"), i * 130));
  const sndLose = () => [392, 330, 262].forEach((f, i) => setTimeout(() => beep(f, 0.3, "sine"), i * 200));
  const sndDog  = () => { beep(600, 0.1, "square", 0.1); setTimeout(() => beep(900, 0.1, "square", 0.1), 110); setTimeout(() => beep(1200, 0.25, "square", 0.1), 220); };

  /* ---------- 版面：把畫布尺寸對齊實際顯示大小 ---------- */
  function panelRect(which) {
    const lv = LEVELS.levels[S.levelIndex];
    return (which === "a")
      ? (lv && lv.panelA) || LEVELS.defaultPanelA
      : (lv && lv.panelB) || LEVELS.defaultPanelB;
  }

  function resizeCanvases() {
    if (!S.img) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 上限 2 避免低階手機過載
    [[cvsA, ctxA], [cvsB, ctxB]].forEach(([cvs]) => {
      const w = cvs.clientWidth, h = cvs.clientHeight;
      if (w === 0 || h === 0) return;
      cvs.width = Math.round(w * dpr);
      cvs.height = Math.round(h * dpr);
    });
    redraw();
  }

  /* ---------- 繪圖 ---------- */
  function drawPanel(cvs, ctx, rect) {
    if (!S.img) return;
    const iw = S.img.naturalWidth, ih = S.img.naturalHeight;
    const sx = rect[0] * iw, sy = rect[1] * ih, sw = rect[2] * iw, sh = rect[3] * ih;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(S.img, sx, sy, sw, sh, 0, 0, cvs.width, cvs.height);

    const W = cvs.width, H = cvs.height;
    const lw = Math.max(3, W * 0.008); // 圈線寬隨尺寸縮放

    S.diffs.forEach((d, i) => {
      const hit = S.found.has(i);
      const show = hit || S.showAnswers || DEBUG;
      if (!show) return;
      ctx.beginPath();
      ctx.arc(d.x * W, d.y * H, d.r * W, 0, Math.PI * 2);
      if (hit) {
        ctx.strokeStyle = S.revealed.has(i) ? "#e8a512" : "#e33a24"; // 義犬揭示=金圈、自己找到=紅圈
        ctx.lineWidth = lw;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = DEBUG && !S.showAnswers ? "#2e7dd7" : "#e8a512";
        ctx.lineWidth = Math.max(2, lw * 0.7);
        ctx.setLineDash([6, 5]); // 答案/除錯用虛線
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function redraw() {
    drawPanel(cvsA, ctxA, panelRect("a"));
    drawPanel(cvsB, ctxB, panelRect("b"));
  }

  /* ---------- 計時 ---------- */
  function fmt(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return m + ":" + s;
  }
  function updateHUD() {
    const t = fmt(Math.max(0, S.timeLeft));
    const f = S.found.size + " / " + S.diffs.length;
    timerText.textContent = t;  foundText.textContent = f;
    timerTextP.textContent = t; foundTextP.textContent = f;
    skillCount.textContent = String(S.skillLeft);
    btnSkill.disabled = S.skillLeft <= 0;   // 用完就反灰停用
    timerBoxWarn(S.timeLeft <= 15);
  }
  function timerBoxWarn(on) {
    $("timerBox").classList.toggle("warn", on);
  }
  function stopTimer() {
    if (S.timerId) { clearInterval(S.timerId); S.timerId = 0; }
  }
  function startTimer() {
    stopTimer();
    S.timerId = setInterval(() => {
      if (!S.running) return;
      S.timeLeft--;
      updateHUD();
      if (S.timeLeft <= 0) endLevel(false);
    }, 1000);
  }

  /* 頁面被切到背景時暫停計時（公平性＋省電），切回來自動恢復 */
  let pausedByHidden = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (S.running) { S.running = false; pausedByHidden = true; }
    } else if (pausedByHidden) {
      S.running = true; pausedByHidden = false;
    }
  });

  /* ---------- 關卡流程 ---------- */
  function openLevel(index) {
    S.levelIndex = index;
    const lv = LEVELS.levels[index];
    S.diffs = getDiffs(lv);
    S.found.clear(); S.revealed.clear();
    S.timeLeft = GAME_TIME;
    S.skillLeft = SKILL_MAX;
    S.running = false;
    S.showAnswers = false;

    screenHome.classList.add("hidden");
    screenGame.classList.remove("hidden");
    overlay.classList.add("hidden");
    btnStart.classList.remove("hidden");

    // 載入關卡大圖（encodeURI 處理中文與空白檔名）
    S.img = new Image();
    S.img.decoding = "async";
    S.img.onload = () => { resizeCanvases(); updateHUD(); };
    S.img.onerror = () => alert("圖片載入失敗：" + lv.file + "\n請確認檔案還在資料夾裡。");
    S.img.src = encodeURI(lv.file);

    checkOrientation();
    updateHUD();
  }

  function startPlay() {
    if (S.running) return;
    S.running = true;
    btnStart.classList.add("hidden");
    startTimer();
    updateHUD();
  }

  function endLevel(win) {
    S.running = false;
    stopTimer();
    S.showAnswers = false;

    if (win) {
      sndWin();
      // 星等：剩 60 秒以上 3 星、30 秒以上 2 星、其他 1 星
      const stars = S.timeLeft >= 60 ? 3 : S.timeLeft >= 30 ? 2 : 1;
      resultTitle.textContent = "🎉 過關！義犬將軍守護成功";
      resultStars.textContent = "⭐".repeat(stars) + "☆".repeat(3 - stars);
      resultDetail.textContent = "剩餘時間 " + fmt(S.timeLeft) + "，找到全部 " + S.diffs.length + " 處不同！";
      btnShowAns.classList.add("hidden");
      // 解鎖下一關並記錄最佳成績
      const cleared = S.levelIndex + 1;
      if (cleared + 1 > progress.unlocked) progress.unlocked = cleared + 1;
      const id = LEVELS.levels[S.levelIndex].id;
      const prev = progress.best[id];
      if (!prev || S.timeLeft > prev.timeLeft) progress.best[id] = { timeLeft: S.timeLeft, stars: stars };
      saveProgress(progress);
      btnNext.classList.toggle("hidden", S.levelIndex >= LEVELS.levels.length - 1);
    } else {
      sndLose();
      resultTitle.textContent = "⏰ 時間到！";
      resultStars.textContent = "";
      resultDetail.textContent = "找到了 " + S.found.size + " / " + S.diffs.length + " 處，再挑戰一次吧！";
      btnShowAns.classList.remove("hidden");
      btnNext.classList.add("hidden");
    }
    overlay.classList.remove("hidden");
  }

  /* ---------- 點擊判定 ---------- */
  function onPanelClick(e, cvs) {
    if (!S.running) return;
    const now = Date.now();
    if (now - S.lastClick < CLICK_COOLDOWN) return; // 防連點洗答案
    S.lastClick = now;

    const box = cvs.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;   // 0~1 面板相對座標
    const py = (e.clientY - box.top) / box.height;

    // 找最近且在判定半徑內、尚未找到的差異點
    let hitIndex = -1;
    for (let i = 0; i < S.diffs.length; i++) {
      if (S.found.has(i)) continue;
      const d = S.diffs[i];
      const dx = (px - d.x) * box.width;
      const dy = (py - d.y) * box.height;
      if (Math.hypot(dx, dy) <= d.r * box.width * 1.15) { hitIndex = i; break; } // 1.15 = 容錯加成
    }

    if (hitIndex >= 0) {
      S.found.add(hitIndex);
      sndHit();
      redraw(); updateHUD();
      if (S.found.size >= S.diffs.length) setTimeout(() => endLevel(true), 450);
    } else {
      // 點錯：扣時間、紅 X、震動
      S.timeLeft = Math.max(0, S.timeLeft - MISS_PENALTY);
      sndMiss();
      showMissFx(e.clientX, e.clientY);
      stage.classList.remove("shake");
      void stage.offsetWidth; // 重新觸發動畫
      stage.classList.add("shake");
      updateHUD();
      if (S.timeLeft <= 0) endLevel(false);
    }
  }

  function showMissFx(cx, cy) {
    missFx.style.left = cx + "px";
    missFx.style.top = cy + "px";
    missFx.classList.remove("show");
    void missFx.offsetWidth;
    missFx.classList.add("show");
  }

  /* ---------- 義犬將軍來發威 ---------- */
  function useSkill() {
    if (!S.running || S.skillLeft <= 0) return;
    // 找一個還沒被找到的差異
    let target = -1;
    for (let i = 0; i < S.diffs.length; i++) { if (!S.found.has(i)) { target = i; break; } }
    if (target < 0) return;

    S.skillLeft--;
    sndDog();
    updateHUD();

    // 狗狗從按鈕位置飛到 B 圖目標點
    const d = S.diffs[target];
    const boxB = cvsB.getBoundingClientRect();
    const endX = boxB.left + d.x * boxB.width;
    const endY = boxB.top + d.y * boxB.height;
    const boxBtn = btnSkill.getBoundingClientRect();

    dogFx.style.left = (boxBtn.left + boxBtn.width / 2) + "px";
    dogFx.style.top = (boxBtn.top + boxBtn.height / 2) + "px";
    dogFx.classList.add("fly");
    // 用 CSS transition 移動到目標
    requestAnimationFrame(() => {
      dogFx.style.left = endX + "px";
      dogFx.style.top = endY + "px";
    });

    setTimeout(() => {
      dogFx.classList.remove("fly");
      S.found.add(target);
      S.revealed.add(target); // 金圈標記
      redraw(); updateHUD();
      if (S.found.size >= S.diffs.length) setTimeout(() => endLevel(true), 450);
    }, 750);
  }

  /* ---------- 首頁選關 ---------- */
  function buildHome() {
    const grid = $("levelGrid");
    while (grid.firstChild) grid.removeChild(grid.firstChild); // 不用 innerHTML，安全清空

    LEVELS.levels.forEach((lv, i) => {
      const locked = (i + 1) > progress.unlocked;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "level-card" + (locked ? " locked" : "");
      card.setAttribute("role", "listitem");
      card.disabled = locked;

      // 縮圖：canvas 裁 A 圖
      const thumb = document.createElement("canvas");
      thumb.className = "thumb";
      thumb.width = 320; thumb.height = 200;
      card.appendChild(thumb);

      const name = document.createElement("span");
      name.className = "lv-name";
      name.textContent = lv.name; // textContent 防 XSS
      card.appendChild(name);

      const status = document.createElement("span");
      status.className = "lv-status";
      const best = progress.best[lv.id];
      status.textContent = locked ? "🔒 先過前一關" : best ? "⭐".repeat(best.stars) + "（最佳剩 " + best.timeLeft + " 秒）" : "尚未挑戰";
      card.appendChild(status);

      card.addEventListener("click", () => openLevel(i));
      grid.appendChild(card);

      // 非同步畫縮圖
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const r = lv.panelA || LEVELS.defaultPanelA;
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const tctx = thumb.getContext("2d");
        tctx.drawImage(img, r[0] * iw, r[1] * ih, r[2] * iw, r[3] * ih, 0, 0, thumb.width, thumb.height);
        if (locked) { tctx.fillStyle = "rgba(40,30,20,.6)"; tctx.fillRect(0, 0, thumb.width, thumb.height); }
      };
      img.src = encodeURI(lv.file);
    });
  }

  function goHome() {
    S.running = false;
    stopTimer();
    S.img = null;
    overlay.classList.add("hidden");
    screenGame.classList.add("hidden");
    screenHome.classList.remove("hidden");
    progress = loadProgress();
    buildHome();
  }

  /* ---------- 直式提醒 ---------- */
  let portraitOk = false; // 使用者選擇直式繼續玩
  function checkOrientation() {
    const portrait = window.innerHeight > window.innerWidth;
    rotateHint.classList.toggle("hidden", !portrait || portraitOk || screenGame.classList.contains("hidden"));
    document.body.classList.toggle("portrait", portrait);
  }

  /* ---------- 事件綁定 ---------- */
  cvsA.addEventListener("click", (e) => onPanelClick(e, cvsA));
  cvsB.addEventListener("click", (e) => onPanelClick(e, cvsB));
  btnStart.addEventListener("click", startPlay);
  btnSkill.addEventListener("click", useSkill);
  btnBack.addEventListener("click", goHome);
  btnRetry.addEventListener("click", () => openLevel(S.levelIndex));
  btnNext.addEventListener("click", () => openLevel(Math.min(S.levelIndex + 1, LEVELS.levels.length - 1)));
  btnHome.addEventListener("click", goHome);
  btnShowAns.addEventListener("click", () => {
    // 看答案：關掉彈窗、顯示全部虛線圈（不能再點）
    overlay.classList.add("hidden");
    S.showAnswers = true;
    redraw();
    setTimeout(() => { overlay.classList.remove("hidden"); }, 4000); // 4 秒後回到結算
  });
  btnStayPortrait.addEventListener("click", () => { portraitOk = true; checkOrientation(); });

  let resizeTid = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTid);
    resizeTid = setTimeout(() => { checkOrientation(); resizeCanvases(); }, 120);
  });

  /* ---------- 啟動 ---------- */
  // 舞台背景（模板圖）用 JS 設定，路徑集中在 levels.js 管理
  stage.style.backgroundImage = 'url("' + encodeURI(LEVELS.template) + '")';
  buildHome();
  checkOrientation();

})();
