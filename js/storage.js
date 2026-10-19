/* Storage protection: navigator.storage.persist() + usage display + gentle export reminder.
   Does not touch existing data/keys. New localStorage keys only: lastExportAt, exportReminderSnoozeUntil. */
(function (global) {
  const LAST_EXPORT_KEY = 'lastExportAt';
  const SNOOZE_KEY = 'exportReminderSnoozeUntil';
  const REMIND_DAYS = 14;
  const SNOOZE_DAYS = 3;
  const DAY = 86400000;
  const $ = (id) => document.getElementById(id);
  const hasStorage = () => !!(navigator.storage && navigator.storage.persist && navigator.storage.persisted);

  function fmtBytes(n) {
    if (!(n >= 0)) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 ** 3) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 ** 3).toFixed(2) + ' GB';
  }

  async function isPersisted() {
    if (!hasStorage()) return null;
    try { return await navigator.storage.persisted(); } catch (e) { return null; }
  }

  async function requestPersist() {
    if (!hasStorage()) return null;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) { console.warn('persist failed', e); return false; }
  }

  async function renderStatus() {
    const st = $('persist-status'), us = $('storage-usage'), btn = $('btn-persist');
    if (!st) return;
    const p = await isPersisted();
    if (p === null) {
      st.textContent = 'データ保護：このブラウザは未対応';
      st.className = 'persist-status off';
      btn.hidden = true;
    } else if (p) {
      st.textContent = 'データ保護：有効';
      st.className = 'persist-status on';
      btn.hidden = true;
    } else {
      st.textContent = 'データ保護：未設定（ホーム画面に追加すると有効になりやすい）';
      st.className = 'persist-status off';
      btn.hidden = false;
    }
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const e = await navigator.storage.estimate();
        const pct = e.quota ? ((e.usage / e.quota) * 100) : 0;
        us.textContent = `使用量：${fmtBytes(e.usage)}` + (e.quota ? ` ／ 上限の目安 ${fmtBytes(e.quota)}（${pct < 0.1 ? '0.1%未満' : pct.toFixed(1) + '%'}）` : '');
      } catch (err) { us.textContent = ''; }
    } else us.textContent = '';
    const last = localStorage.getItem(LAST_EXPORT_KEY);
    const le = $('last-export');
    if (le) le.textContent = '最終書き出し：' + (last ? new Date(+last).toLocaleString('ja-JP') : 'まだありません');
  }

  function needsReminder(now = Date.now()) {
    const last = +localStorage.getItem(LAST_EXPORT_KEY) || 0;
    if (last && now - last < REMIND_DAYS * DAY) return false;
    const snooze = +localStorage.getItem(SNOOZE_KEY) || 0;
    return now >= snooze;
  }

  function renderBanner() {
    const b = $('backup-banner');
    if (b) b.hidden = !needsReminder();
  }

  function markExported() {
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
    localStorage.removeItem(SNOOZE_KEY);
    renderBanner();
    renderStatus();
  }

  function goToExport() {
    App.showView('settings');
    const blk = $('backup-block');
    if (blk) {
      blk.scrollIntoView({ behavior: 'smooth', block: 'start' });
      blk.classList.add('flash');
      setTimeout(() => blk.classList.remove('flash'), 1600);
    }
  }

  function init() {
    $('btn-persist').addEventListener('click', async () => {
      const r = await requestPersist();
      await renderStatus();
      App.toast(r ? 'データ保護が有効になりました' : 'ブラウザが許可しませんでした（ホーム画面から開くと有効になりやすいです）');
    });
    $('backup-banner-go').addEventListener('click', goToExport);
    $('backup-banner-close').addEventListener('click', () => {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * DAY));
      renderBanner();
    });
    renderBanner();
    // Ask once on start if not yet persisted (silent; status shown in settings)
    requestPersist().then(renderStatus);
  }

  global.StorageGuard = { init, renderStatus, renderBanner, markExported, requestPersist, needsReminder, goToExport };
})(window);
