(function (global) {
  'use strict';

  let year, month; // month 0-11
  let markers = { photos: {}, memos: {}, reminders: {} };
  let urlCache = {};
  let mode = localStorage.getItem('calMode') || 'month'; // month|3|6|12
  const weekStart = () => (localStorage.getItem('weekStart') === '1' ? 1 : 0);
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  function step() { return mode === 'month' ? 1 : +mode; }
  function shift(dir) {
    month += dir * step();
    while (month < 0) { month += 12; year--; }
    while (month > 11) { month -= 12; year++; }
    render();
  }
  function renderWeekdays() {
    const names = ['日', '月', '火', '水', '木', '金', '土'];
    const el = document.getElementById('cal-weekdays');
    el.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const dow = (i + weekStart()) % 7;
      const s = document.createElement('span');
      s.textContent = names[dow];
      if (dow === 0) s.className = 'sun';
      if (dow === 6) s.className = 'sat';
      el.appendChild(s);
    }
  }
  function renderMini() {
    const wrap = document.getElementById('cal-multi');
    wrap.innerHTML = '';
    wrap.className = 'cal-multi cols-' + (mode === '12' ? 3 : 2);
    const todayKey = ExifUtil.toDateKey(new Date());
    const names = ['日', '月', '火', '水', '木', '金', '土'];
    for (let i = 0; i < +mode; i++) {
      const y = year + Math.floor((month + i) / 12), m = (month + i) % 12;
      const box = document.createElement('div');
      box.className = 'mini-month';
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'mini-title';
      t.textContent = (i === 0 || m === 0) ? `${y}年${m + 1}月` : `${m + 1}月`;
      t.addEventListener('click', () => { year = y; month = m; setMode('month'); });
      box.appendChild(t);
      const g = document.createElement('div');
      g.className = 'mini-grid';
      for (let w = 0; w < 7; w++) {
        const s = document.createElement('span');
        s.className = 'mini-wd'; s.textContent = names[(w + weekStart()) % 7];
        g.appendChild(s);
      }
      const lead = (new Date(y, m, 1).getDay() - weekStart() + 7) % 7;
      for (let k = 0; k < lead; k++) g.appendChild(document.createElement('span'));
      const dim = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const key = dk(y, m, d);
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'mini-day'; c.dataset.date = key;
        c.textContent = d;
        const dow = new Date(y, m, d).getDay();
        const hol = Holidays.name(key);
        if (dow === 0 || hol) c.classList.add('sun'); else if (dow === 6) c.classList.add('sat');
        if (hol) { c.classList.add('holiday'); c.title = hol; }
        if (markers.photos[key] || markers.memos[key] || markers.reminders[key]) c.classList.add('has-ev');
        if (key === todayKey) c.classList.add('today');
        c.addEventListener('click', () => { if (global.App && App.openDay) App.openDay(key); });
        g.appendChild(c);
      }
      box.appendChild(g);
      wrap.appendChild(box);
    }
  }
  function setMode(m) {
    mode = m; localStorage.setItem('calMode', m);
    render();
  }

  function init() {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
    document.getElementById('cal-prev').addEventListener('click', () => shift(-1));
    document.getElementById('cal-next').addEventListener('click', () => shift(1));
    document.querySelectorAll('#cal-modes button').forEach((b) =>
      b.addEventListener('click', () => setMode(b.dataset.mode)));
    const ws = document.getElementById('week-start');
    if (ws) {
      ws.value = String(weekStart());
      ws.addEventListener('change', () => { localStorage.setItem('weekStart', ws.value); render(); });
    }
  }

  async function refreshMarkers() {
    const [photos, memos, reminders] = await Promise.all([
      Photos.thumbsByDate(),
      DB.getAll('memos'),
      DB.getAll('reminders')
    ]);
    markers.photos = photos;
    markers.memos = {};
    for (const m of memos) {
      markers.memos[m.dateKey] = (markers.memos[m.dateKey] || 0) + 1;
    }
    markers.reminders = {};
    for (const r of reminders) {
      if (r.done) continue;
      const dk = ExifUtil.toDateKey(new Date(r.when));
      markers.reminders[dk] = (markers.reminders[dk] || 0) + 1;
    }
    // revoke old URLs
    Object.values(urlCache).forEach((u) => URL.revokeObjectURL(u));
    urlCache = {};
    for (const [dk, p] of Object.entries(photos)) {
      if (p.thumb) urlCache[dk] = URL.createObjectURL(p.thumb);
    }
  }

  async function render() {
    await refreshMarkers();
    const label = document.getElementById('cal-month-label');
    document.querySelectorAll('#cal-modes button').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === mode));
    renderWeekdays();
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';
    const multi = mode !== 'month';
    grid.hidden = multi;
    document.getElementById('cal-weekdays').hidden = multi;
    document.getElementById('cal-multi').hidden = !multi;
    if (multi) {
      const ey = year + Math.floor((month + +mode - 1) / 12), em = (month + +mode - 1) % 12;
      label.textContent = `${year}年${month + 1}月〜${ey !== year ? ey + '年' : ''}${em + 1}月`;
      renderMini();
      return;
    }
    label.textContent = `${year}年${month + 1}月`;

    const first = new Date(year, month, 1);
    const startPad = (first.getDay() - weekStart() + 7) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = ExifUtil.toDateKey(new Date());

    for (let i = 0; i < startPad; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell empty';
      grid.appendChild(cell);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      const dow = new Date(year, month, d).getDay();
      const hol = Holidays.name(dateKey);
      if (dow === 0 || hol) cell.classList.add('sun');
      if (dow === 6) cell.classList.add('sat');
      if (dateKey === todayKey) cell.classList.add('today');
      cell.dataset.date = dateKey;

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(d);
      cell.appendChild(num);
      if (hol) {
        cell.classList.add('holiday');
        cell.title = hol;
        const hn = document.createElement('span');
        hn.className = 'hol-name';
        hn.textContent = hol;
        cell.appendChild(hn);
      }

      if (urlCache[dateKey]) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.alt = '';
        img.src = urlCache[dateKey];
        cell.appendChild(img);
      }

      const marks = document.createElement('div');
      marks.className = 'cal-markers';
      if (markers.photos[dateKey] && !urlCache[dateKey]) {
        const s = document.createElement('span');
        s.className = 'dot-photo';
        marks.appendChild(s);
      }
      if (markers.memos[dateKey]) {
        const s = document.createElement('span');
        s.className = 'dot-memo';
        marks.appendChild(s);
      }
      if (markers.reminders[dateKey]) {
        const s = document.createElement('span');
        s.className = 'dot-reminder';
        marks.appendChild(s);
      }
      cell.appendChild(marks);

      cell.addEventListener('click', () => {
        if (global.App && App.openDay) App.openDay(dateKey);
      });
      grid.appendChild(cell);
    }
  }

  global.Calendar = { init, render, refreshMarkers };
})(typeof window !== 'undefined' ? window : self);
