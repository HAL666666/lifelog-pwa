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
    st.workMin = clamp(+document.getElementById('pomo-work').value || 25, 1, 120);
    st.breakMin = clamp(+document.getElementById('pomo-break').value || 5, 1, 60);
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
    document.getElementById('pomo-work').value = st.workMin;
    document.getElementById('pomo-break').value = st.breakMin;
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
    st.endsAt = Date.now() + st.remainingMs;
    await save(st);
    if (st.wakeLock) await requestWakeLock();
    paint(st);
  }

  async function pause() {
    const st = await load();
    if (st.running && st.endsAt) {
      st.remainingMs = Math.max(0, st.endsAt - Date.now());
    }
    st.running = false;
    st.endsAt = null;
    await save(st);
    await releaseWakeLock();
    paint(st);
  }

  async function reset() {
    const st = await load();
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
    st.mode = finishedMode === 'work' ? 'break' : 'work';
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

  global.Pomodoro = { init, syncFromStorage };
})(typeof window !== 'undefined' ? window : self);
