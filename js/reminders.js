(function (global) {
  'use strict';

  let timers = [];
  let dayContext = null; // dateKey when adding from day view

  function init() {
    document.getElementById('reminder-add').addEventListener('click', () => openModal(null));
    document.getElementById('reminder-add-day').addEventListener('click', () => {
      openModal(null, dayContext);
    });
    document.getElementById('reminder-cancel').addEventListener('click', () => {
      document.getElementById('modal-reminder').close();
    });
    document.getElementById('form-reminder').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('reminder-title').value.trim();
      const whenLocal = document.getElementById('reminder-when').value;
      if (!title || !whenLocal) return;
      const when = new Date(whenLocal).toISOString();
      await DB.put('reminders', {
        id: DB.uid(),
        title,
        when,
        done: false,
        notified: false,
        createdAt: new Date().toISOString()
      });
      document.getElementById('modal-reminder').close();
      await renderUpcoming();
      if (dayContext) await renderForDay(dayContext);
      if (global.Calendar) Calendar.render();
      scheduleAll();
      if (global.App) App.toast('リマインダーを追加しました');
    });
    scheduleAll();
    checkOverdue();
  }

  function toLocalInputValue(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openModal(reminder, preferDateKey) {
    const titleEl = document.getElementById('reminder-title');
    const whenEl = document.getElementById('reminder-when');
    titleEl.value = reminder ? reminder.title : '';
    if (reminder) {
      whenEl.value = toLocalInputValue(new Date(reminder.when));
    } else if (preferDateKey) {
      const [y, m, d] = preferDateKey.split('-').map(Number);
      const now = new Date();
      const dt = new Date(y, m - 1, d, now.getHours(), now.getMinutes() + 5);
      whenEl.value = toLocalInputValue(dt);
    } else {
      const dt = new Date(Date.now() + 60 * 60 * 1000);
      whenEl.value = toLocalInputValue(dt);
    }
    const dlg = document.getElementById('modal-reminder');
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  async function renderUpcoming() {
    const all = await DB.getAll('reminders');
    all.sort((a, b) => new Date(a.when) - new Date(b.when));
    const now = Date.now();
    const upcoming = all.filter((r) => !r.done && new Date(r.when).getTime() >= now - 60000);
    const past = all.filter((r) => r.done || new Date(r.when).getTime() < now - 60000);

    fillList('upcoming-reminders', 'upcoming-empty', upcoming, false);
    fillList('past-reminders', null, past.slice(-20).reverse(), true);
  }

  function fillList(listId, emptyId, items, isPast) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';
    if (emptyId) {
      document.getElementById(emptyId).hidden = items.length > 0;
    }
    for (const r of items) {
      list.appendChild(makeItem(r, isPast));
    }
  }

  function makeItem(r, isPast) {
    const li = document.createElement('li');
    if (r.done) li.classList.add('done');
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = r.title;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new Date(r.when).toLocaleString('ja-JP');
    body.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    if (!r.done) {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.textContent = '完了';
      doneBtn.addEventListener('click', async () => {
        r.done = true;
        r.doneAt = new Date().toISOString(); // additive: for calendar やること完了 marker
        await DB.put('reminders', r);
        await renderUpcoming();
        if (dayContext) await renderForDay(dayContext);
        if (global.Calendar) Calendar.render();
        scheduleAll();
      });
      actions.appendChild(doneBtn);
    }
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async () => {
      if (!confirm('削除しますか？')) return;
      await DB.del('reminders', r.id);
      await renderUpcoming();
      if (dayContext) await renderForDay(dayContext);
      if (global.Calendar) Calendar.render();
      scheduleAll();
    });
    actions.appendChild(delBtn);
    li.appendChild(body);
    li.appendChild(actions);
    return li;
  }

  async function renderForDay(dateKey) {
    dayContext = dateKey;
    const all = await DB.getAll('reminders');
    const items = all.filter((r) => ExifUtil.toDateKey(new Date(r.when)) === dateKey);
    items.sort((a, b) => new Date(a.when) - new Date(b.when));
    const list = document.getElementById('day-reminders');
    const empty = document.getElementById('day-reminders-empty');
    list.innerHTML = '';
    empty.hidden = items.length > 0;
    for (const r of items) list.appendChild(makeItem(r, false));
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  async function scheduleAll() {
    clearTimers();
    const all = await DB.getAll('reminders');
    const now = Date.now();
    for (const r of all) {
      if (r.done || r.notified) continue;
      const t = new Date(r.when).getTime();
      const delay = t - now;
      if (delay <= 0) continue;
      if (delay > 2147483647) continue; // setTimeout max
      const id = setTimeout(() => fireReminder(r.id), delay);
      timers.push(id);
    }
  }

  async function checkOverdue() {
    const all = await DB.getAll('reminders');
    const now = Date.now();
    for (const r of all) {
      if (r.done || r.notified) continue;
      if (new Date(r.when).getTime() <= now) {
        await fireReminder(r.id);
      }
    }
  }

  async function fireReminder(id) {
    const r = await DB.get('reminders', id);
    if (!r || r.done || r.notified) return;
    r.notified = true;
    await DB.put('reminders', r);
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } catch (_) {}
    await showNotif('リマインダー', r.title);
    if (global.App) App.toast('🔔 ' + r.title);
    await renderUpcoming();
  }

  async function showNotif(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag: 'lifelog-reminder-' + Date.now()
        });
      } else {
        new Notification(title, { body, icon: 'icons/icon-192.png' });
      }
    } catch (err) {
      console.warn('notification failed', err);
    }
  }

  async function requestPermission() {
    if (!('Notification' in window)) {
      return 'unsupported';
    }
    const p = await Notification.requestPermission();
    return p;
  }

  function permissionStatus() {
    if (!('Notification' in window)) return 'このブラウザは通知に対応していません';
    const p = Notification.permission;
    if (p === 'granted') return '通知は許可されています';
    if (p === 'denied') return '通知が拒否されています（ブラウザ設定から変更）';
    return '通知はまだ許可されていません';
  }

  global.Reminders = {
    init, renderUpcoming, renderForDay, scheduleAll, checkOverdue,
    requestPermission, permissionStatus, showNotif, setDayContext: (k) => { dayContext = k; }
  };
})(typeof window !== 'undefined' ? window : self);
