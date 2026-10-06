(function (global) {
  'use strict';

  let year, month; // month 0-11
  let markers = { photos: {}, memos: {}, reminders: {} };
  let urlCache = {};

  function init() {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
    document.getElementById('cal-prev').addEventListener('click', () => {
      month--;
      if (month < 0) { month = 11; year--; }
      render();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      month++;
      if (month > 11) { month = 0; year++; }
      render();
    });
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
    label.textContent = `${year}年${month + 1}月`;
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';

    const first = new Date(year, month, 1);
    const startPad = first.getDay();
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
      if (dow === 0) cell.classList.add('sun');
      if (dow === 6) cell.classList.add('sat');
      if (dateKey === todayKey) cell.classList.add('today');
      cell.dataset.date = dateKey;

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(d);
      cell.appendChild(num);

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
