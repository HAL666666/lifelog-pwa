(function () {
  'use strict';

  /** Base path for GitHub Pages subpath (e.g. /lifelog-pwa/) */
  function getBasePath() {
    const path = location.pathname;
    if (path.endsWith('/')) return path;
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(0, i + 1) : '/';
  }

  const App = {
    currentDay: null,
    basePath: './',

    toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.hidden = true; }, 2500);
    },

    showView(name) {
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      const map = {
        calendar: 'view-calendar',
        day: 'view-day',
        reminders: 'view-reminders',
        pomodoro: 'view-pomodoro',
        settings: 'view-settings',
        gantt: 'view-gantt'
      };
      const id = map[name] || map.calendar;
      document.getElementById(id).classList.add('active');
      const tabName = name === 'day' ? 'calendar' : name;
      const tab = document.querySelector(`.tab[data-view="${tabName}"]`);
      if (tab) tab.classList.add('active');
      const titles = {
        calendar: 'ライフログ',
        day: '日の詳細',
        reminders: 'リマインダー',
        pomodoro: 'ポモドーロ',
        settings: '設定',
        gantt: '予定ガント'
      };
      document.getElementById('header-title').textContent = titles[name] || 'ライフログ';
      if (name === 'reminders') Reminders.renderUpcoming();
      if (name === 'pomodoro') Pomodoro.syncFromStorage();
      if (name === 'settings') updateNotifStatus();
      if (name === 'calendar') Calendar.render();
      if (name === 'gantt') Gantt.render();
    },

    async openDay(dateKey) {
      this.currentDay = dateKey;
      const [y, m, d] = dateKey.split('-');
      document.getElementById('day-label').textContent = `${y}年${+m}月${+d}日`;
      Memos.setDateKey(dateKey);
      Reminders.setDayContext(dateKey);
      await renderDayPhotos(dateKey);
      await Memos.renderForDay(dateKey);
      await Reminders.renderForDay(dateKey);
      this.showView('day');
    }
  };

  async function renderDayPhotos(dateKey) {
    const photos = await Photos.photosForDate(dateKey);
    photos.sort((a, b) => (a.takenAt || '').localeCompare(b.takenAt || ''));
    const grid = document.getElementById('day-photos');
    const empty = document.getElementById('day-photos-empty');
    grid.innerHTML = '';
    empty.hidden = photos.length > 0;
    for (const p of photos) {
      const img = document.createElement('img');
      img.alt = '写真';
      img.src = URL.createObjectURL(p.thumb || p.blob);
      img.addEventListener('click', () => openLightbox(p));
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm('この写真を削除しますか？')) {
          Photos.deletePhoto(p.id).then(async () => {
            await renderDayPhotos(dateKey);
            Calendar.render();
          });
        }
      });
      grid.appendChild(img);
    }
  }

  async function openLightbox(p) {
    const img = document.getElementById('lightbox-img');
    img.src = URL.createObjectURL(p.blob);
    const dlg = document.getElementById('lightbox');
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function updateNotifStatus() {
    document.getElementById('notif-status').textContent = Reminders.permissionStatus();
  }

  async function handlePhotoInput(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    App.toast(`写真を取り込み中… (${files.length})`);
    try {
      const imported = await Photos.importFiles(files);
      App.toast(`${imported.length}枚を保存しました`);
      await Calendar.render();
      if (App.currentDay && document.getElementById('view-day').classList.contains('active')) {
        await renderDayPhotos(App.currentDay);
      } else if (imported.length === 1) {
        await App.openDay(imported[0].dateKey);
      }
    } catch (err) {
      console.error(err);
      App.toast('取り込みに失敗しました');
    }
    e.target.value = '';
  }

  async function exportData() {
    const includePhotos = document.getElementById('export-photos').checked;
    if (includePhotos && !confirm('写真を含めるとファイルが非常に大きくなります。続行しますか？')) {
      return;
    }
    const memos = await DB.getAll('memos');
    const reminders = await DB.getAll('reminders');
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      memos,
      reminders,
      photos: []
    };
    if (includePhotos) {
      const photos = await Photos.allPhotos();
      for (const p of photos) {
        payload.photos.push({
          id: p.id,
          dateKey: p.dateKey,
          takenAt: p.takenAt,
          createdAt: p.createdAt,
          mime: p.mime,
          blob: await Photos.blobToDataURL(p.blob),
          thumb: p.thumb ? await Photos.blobToDataURL(p.thumb) : null
        });
      }
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lifelog-export-${ExifUtil.toDateKey(new Date())}.json`;
    a.click();
    App.toast('エクスポートしました');
  }

  async function importData(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.memos) || !Array.isArray(data.reminders)) {
      throw new Error('不正なファイル');
    }
    for (const m of data.memos) {
      if (!m.id) m.id = DB.uid();
      await DB.put('memos', m);
    }
    for (const r of data.reminders) {
      if (!r.id) r.id = DB.uid();
      await DB.put('reminders', r);
    }
    if (Array.isArray(data.photos)) {
      for (const p of data.photos) {
        const rec = {
          id: p.id || DB.uid(),
          dateKey: p.dateKey,
          takenAt: p.takenAt,
          createdAt: p.createdAt || new Date().toISOString(),
          mime: p.mime || 'image/jpeg',
          blob: typeof p.blob === 'string' ? Photos.dataURLToBlob(p.blob) : p.blob,
          thumb: p.thumb && typeof p.thumb === 'string' ? Photos.dataURLToBlob(p.thumb) : p.thumb
        };
        await DB.put('photos', rec);
      }
    }
    Reminders.scheduleAll();
    await Calendar.render();
    await Reminders.renderUpcoming();
    App.toast('インポートしました');
  }

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const base = getBasePath();
      const swUrl = base + 'sw.js';
      await navigator.serviceWorker.register(swUrl, { scope: base });
    } catch (err) {
      console.warn('SW register failed', err);
    }
  }

  async function boot() {
    App.basePath = getBasePath();
    await DB.openDB();
    Calendar.init();
    Memos.init();
    Reminders.init();
    Pomodoro.init();
    Gantt.init();

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => App.showView(tab.dataset.view));
    });
    document.getElementById('btn-settings').addEventListener('click', () => App.showView('settings'));
    document.getElementById('day-back').addEventListener('click', () => App.showView('calendar'));
    document.getElementById('photo-input').addEventListener('change', handlePhotoInput);
    document.getElementById('photo-capture').addEventListener('change', handlePhotoInput);
    document.getElementById('lightbox-close').addEventListener('click', () => {
      document.getElementById('lightbox').close();
    });
    document.getElementById('btn-notif-perm').addEventListener('click', async () => {
      const p = await Reminders.requestPermission();
      updateNotifStatus();
      App.toast(p === 'granted' ? '通知を許可しました' : '通知は許可されませんでした');
    });
    document.getElementById('btn-export').addEventListener('click', () => {
      exportData().catch((e) => { console.error(e); App.toast('エクスポート失敗'); });
    });
    document.getElementById('import-input').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        await importData(f);
      } catch (err) {
        console.error(err);
        App.toast('インポート失敗');
      }
      e.target.value = '';
    });

    await Calendar.render();
    await Reminders.checkOverdue();
    registerSW();
    App.showView('calendar');
  }

  window.App = App;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
