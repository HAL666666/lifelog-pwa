(function (global) {
  'use strict';

  const META_KEY = 'pomodoro';
  let tickTimer = null;
  let wakeLock = null;
  let audioCtx = null;

  function defaults() {
    return {
      workMin: 25,
      breakMin: 5,
      mode: 'work', // work | break
      running: false,
      endsAt: null,
      remainingMs: 25 * 60 * 1000,
      wakeLock: false
    };
  }

  async function load() {
    const s = await DB.getMeta(META_KEY, null);
    return Object.assign(defaults(), s || {});
  }

  async function save(state) {
    await DB.setMeta(META_KEY, state);
  }

  function init() {
    document.getElementById('pomo-start').addEventListener('click', start);
    document.getElementById('pomo-pause').addEventListener('click', pause);
    document.getElementById('pomo-reset').addEventListener('click', reset);
    document.getElementById('pomo-work').addEventListener('change', onConfig);
    document.getElementById('pomo-break').addEventListener('change', onConfig);
    initExtras();
    document.getElementById('pomo-wakelock').addEventListener('change', async (e) => {
      const st = await load();
      st.wakeLock = e.target.checked;
      await save(st);
      if (st.wakeLock && st.running) await requestWakeLock();
      else await releaseWakeLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncFromStorage();
    });
    syncFromStorage();
    setInterval(syncFromStorage, 1000);
  }

  async function onConfig() {
    const st = await load();
    if (st.running) return;
    const w = parseInt(document.getElementById('pomo-work').value, 10);
    const b = parseInt(document.getElementById('pomo-break').value, 10);
    st.workMin = clamp(isNaN(w) ? st.workMin : w, 1, 600);
    st.breakMin = clamp(isNaN(b) ? st.breakMin : b, 0, 600);
    if (st.mode === 'break' && st.breakMin === 0) st.mode = 'work';
    st.phaseStart = null; st.phaseElapsed = 0;
    const mins = st.mode === 'work' ? st.workMin : st.breakMin;
    st.remainingMs = mins * 60 * 1000;
    st.endsAt = null;
    await save(st);
    paint(st);
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  async function syncFromStorage() {
    let st = await load();
    if (st.running && st.endsAt) {
      const left = st.endsAt - Date.now();
      if (left <= 0) {
        await onComplete(st);
        st = await load();
      } else {
        st.remainingMs = left;
      }
    }
    paint(st);
  }

  function paint(st) {
    const wi = document.getElementById('pomo-work');
    const bi = document.getElementById('pomo-break');
    if (document.activeElement !== wi) wi.value = st.workMin;
    if (document.activeElement !== bi) bi.value = st.breakMin;
    document.querySelectorAll('#pomo-presets button').forEach((x) => {
      x.classList.toggle('on', +x.dataset.w === st.workMin && (x.dataset.b === '' || +x.dataset.b === st.breakMin));
      x.disabled = !!st.running;
    });
    document.getElementById('pomo-wakelock').checked = !!st.wakeLock;
    document.getElementById('pomo-mode').textContent = st.mode === 'work' ? '作業' : '休憩';
    const ms = Math.max(0, st.remainingMs | 0);
    const sec = Math.ceil(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    document.getElementById('pomo-time').textContent =
      `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    document.getElementById('pomo-start').hidden = !!st.running;
    document.getElementById('pomo-pause').hidden = !st.running;
    document.getElementById('pomo-work').disabled = !!st.running;
    document.getElementById('pomo-break').disabled = !!st.running;
  }

  async function start() {
    const st = await load();
    if (!st.remainingMs || st.remainingMs <= 0) {
      const mins = st.mode === 'work' ? st.workMin : st.breakMin;
      st.remainingMs = mins * 60 * 1000;
    }
    st.running = true;
    if (!st.phaseStart) { st.phaseStart = Date.now(); st.phaseElapsed = 0; }
    st.runStart = Date.now();
    st.endsAt = Date.now() + st.remainingMs;
    await save(st);
    if (st.wakeLock) await requestWakeLock();
    paint(st);
  }

  async function pause() {
    const st = await load();
    if (st.running && st.endsAt) {
      st.remainingMs = Math.max(0, st.endsAt - Date.now());
      st.phaseElapsed = (st.phaseElapsed || 0) + (Date.now() - (st.runStart || Date.now()));
    }
    st.running = false;
    st.endsAt = null;
    await save(st);
    await releaseWakeLock();
    paint(st);
  }

  async function reset() {
    const st = await load();
    let el = st.phaseElapsed || 0;
    if (st.running && st.runStart) el += Date.now() - st.runStart;
    if (st.phaseStart && el >= 10000) await record(st.phaseStart, Date.now(), st.mode, el, 'ポモドーロ');
    st.phaseStart = null; st.phaseElapsed = 0;
    st.running = false;
    st.endsAt = null;
    st.mode = 'work';
    st.remainingMs = st.workMin * 60 * 1000;
    await save(st);
    await releaseWakeLock();
    paint(st);
  }

  async function onComplete(st) {
    st.running = false;
    st.endsAt = null;
    const finishedMode = st.mode;
    const endAt = Date.now();
    const full = (finishedMode === 'work' ? st.workMin : st.breakMin) * 60000;
    await record(st.phaseStart || (endAt - full), endAt, finishedMode, full, 'ポモドーロ');
    st.phaseStart = null; st.phaseElapsed = 0;
    st.mode = finishedMode === 'work' && st.breakMin > 0 ? 'break' : 'work';
    st.remainingMs = (st.mode === 'work' ? st.workMin : st.breakMin) * 60 * 1000;
    await save(st);
    await releaseWakeLock();
    try {
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
    } catch (_) {}
    playBeep();
    const title = finishedMode === 'work' ? '作業終了' : '休憩終了';
    const body = finishedMode === 'work' ? '休憩の時間です' : '作業を始めましょう';
    if (global.Reminders) await Reminders.showNotif(title, body);
    if (global.App) App.toast(title + ' — ' + body);
  }

  // ---- sessions / totals / badges / multi-timers ----
  const PRESETS = [[5],[10],[15],[20],[25],[30],[45],[50],[60],[90],[25,5],[50,10],[90,0],[45,15],[15,3]];
  const BADGES = [[1,'🌱'],[10,'🌿'],[50,'🌳'],[100,'🏅'],[300,'🏆'],[1000,'👑']];
  const MT_KEY = 'multiTimers';

  async function record(start, end, mode, ms, label) {
    await DB.put('sessions', {
      id: DB.uid(), start, end, label,
      workMs: mode === 'work' ? ms : 0,
      breakMs: mode === 'break' ? ms : 0
    });
    renderStats();
  }

  function fmt(ms) {
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}`;
  }
  function sum(rows, from, to) {
    let w = 0, b = 0;
    rows.forEach((r) => { if (r.start >= from && r.start < to) { w += r.workMs || 0; b += r.breakMs || 0; } });
    return [w, w + b];
  }

  async function renderStats() {
    const rows = await DB.getAll('sessions');
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const wk = new Date(d0); wk.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); // Monday start
    const periods = [['今日', d0], ['今週', wk], ['今月', new Date(now.getFullYear(), now.getMonth(), 1)],
      ['今年', new Date(now.getFullYear(), 0, 1)], ['全期間', new Date(0)]];
    const end = Date.now() + 1;
    const html = periods.map(([n, f]) => {
      const [w, a] = sum(rows, +f, end);
      return `<tr><td>${n}</td><td>${fmt(w)}</td><td>${fmt(a)}</td></tr>`;
    }).join('');
    document.getElementById('pomo-totals').innerHTML = html;
    const [tw, ta] = sum(rows, +d0, end);
    document.getElementById('pomo-today-work').textContent = fmt(tw);
    document.getElementById('pomo-today-all').textContent = fmt(ta);
    const fi = document.getElementById('tot-from').value, ti = document.getElementById('tot-to').value;
    const out = document.getElementById('tot-range-out');
    if (fi && ti) {
      const [w, a] = sum(rows, +new Date(fi + 'T00:00'), +new Date(ti + 'T00:00') + 86400000);
      out.textContent = `指定期間: 作業 ${fmt(w)} ／ 休憩込み ${fmt(a)}`;
    } else out.textContent = '';
    const totalH = sum(rows, 0, end)[0] / 3600000;
    document.getElementById('pomo-badges').innerHTML = BADGES.map(([h, i]) =>
      `<div class="badge ${totalH >= h ? '' : 'locked'}"><span class="i">${totalH >= h ? i : '🔒'}</span>${h}時間</div>`).join('');
  }

  async function renderTimers() {
    const list = await DB.getMeta(MT_KEY, []);
    const ul = document.getElementById('mt-list');
    const now = Date.now();
    const done = list.filter((t) => t.start + t.min * 60000 <= now);
    if (done.length) {
      for (const t of done) {
        await record(t.start, t.start + t.min * 60000, 'work', t.min * 60000, t.label);
        if (global.App) App.toast(`${t.label} 終了`);
      }
      playBeep();
      await DB.setMeta(MT_KEY, list.filter((t) => !done.includes(t)));
      return renderTimers();
    }
    const sig = list.map((t) => t.id).join();
    if (ul.dataset.sig !== sig) {
      ul.dataset.sig = sig;
      ul.innerHTML = list.map((t) => `<li data-id="${t.id}"><span class="lbl"></span><span class="t"></span>` +
        `<button type="button" class="btn-secondary" data-stop="${t.id}">終了</button></li>`).join('');
      list.forEach((t) => { ul.querySelector(`[data-id="${t.id}"] .lbl`).textContent = t.label; });
    }
    list.forEach((t) => {
      const left = Math.max(0, Math.ceil((t.start + t.min * 60000 - now) / 1000));
      ul.querySelector(`[data-id="${t.id}"] .t`).textContent =
        `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    });
  }

  function initExtras() {
    const box = document.getElementById('pomo-presets');
    const seen = new Set();
    box.innerHTML = PRESETS.filter(([w, b]) => { const k = w + '/' + b; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(([w, b]) => `<button type="button" data-w="${w}" data-b="${b ?? ''}">${b != null ? w + '/' + b : w + '分'}</button>`).join('');
    box.addEventListener('click', async (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      document.getElementById('pomo-work').value = btn.dataset.w;
      if (btn.dataset.b !== '') document.getElementById('pomo-break').value = btn.dataset.b;
      await onConfig();
    });
    document.getElementById('mt-add').addEventListener('click', async () => {
      const lab = document.getElementById('mt-label');
      const min = clamp(parseInt(document.getElementById('mt-min').value, 10) || 25, 1, 600);
      const list = await DB.getMeta(MT_KEY, []);
      list.push({ id: DB.uid(), label: lab.value.trim() || `タイマー${list.length + 1}`, min, start: Date.now() });
      await DB.setMeta(MT_KEY, list);
      lab.value = '';
      renderTimers();
    });
    document.getElementById('mt-list').addEventListener('click', async (e) => {
      const id = e.target.dataset.stop; if (!id) return;
      const list = await DB.getMeta(MT_KEY, []);
      const t = list.find((x) => x.id === id);
      if (t) {
        const ms = Date.now() - t.start;
        if (ms >= 10000) await record(t.start, Date.now(), 'work', ms, t.label);
        await DB.setMeta(MT_KEY, list.filter((x) => x.id !== id));
      }
      renderTimers();
    });
    ['tot-from', 'tot-to'].forEach((i) => document.getElementById(i).addEventListener('change', renderStats));
    renderStats();
    renderTimers();
    setInterval(renderTimers, 1000);
    setInterval(renderStats, 60000);
  }

  function playBeep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.start();
      setTimeout(() => {
        osc.stop();
      }, 400);
    } catch (_) {}
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) {}
  }

  async function releaseWakeLock() {
    try {
      if (wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (_) {}
  }

  global.Pomodoro = { init, syncFromStorage, renderStats };
})(typeof window !== 'undefined' ? window : self);
