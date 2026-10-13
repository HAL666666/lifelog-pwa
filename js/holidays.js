(function (global) {
  'use strict';
  // Japanese national holidays (current law, valid ~2020-2099), computed offline.
  const cache = {};
  const key = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  function nthMonday(y, m, n) {
    const dow = new Date(y, m - 1, 1).getDay();
    return 1 + ((8 - dow) % 7) + (n - 1) * 7;
  }
  function equinox(y, base) {
    return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }
  function forYear(y) {
    if (cache[y]) return cache[y];
    const h = {};
    const add = (m, d, n) => { h[key(y, m, d)] = n; };
    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    add(2, 23, '天皇誕生日');
    add(3, equinox(y, 20.8431), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    add(7, nthMonday(y, 7, 3), '海の日');
    add(8, 11, '山の日');
    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, equinox(y, 23.2488), '秋分の日');
    add(10, nthMonday(y, 10, 2), 'スポーツの日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');
    // 国民の休日: a non-holiday weekday sandwiched between two holidays
    const base = Object.keys(h).sort();
    for (const k of base) {
      const d = new Date(k + 'T00:00:00');
      const mid = new Date(d); mid.setDate(d.getDate() + 1);
      const nxt = new Date(d); nxt.setDate(d.getDate() + 2);
      const mk = key(mid.getFullYear(), mid.getMonth() + 1, mid.getDate());
      const nk = key(nxt.getFullYear(), nxt.getMonth() + 1, nxt.getDate());
      if (!h[mk] && h[nk] && mid.getDay() !== 0) h[mk] = '国民の休日';
    }
    // 振替休日: holiday on Sunday -> next non-holiday day
    for (const k of Object.keys(h).sort()) {
      const d = new Date(k + 'T00:00:00');
      if (d.getDay() !== 0) continue;
      const s = new Date(d);
      do { s.setDate(s.getDate() + 1); } while (h[key(s.getFullYear(), s.getMonth() + 1, s.getDate())]);
      h[key(s.getFullYear(), s.getMonth() + 1, s.getDate())] = '振替休日';
    }
    cache[y] = h;
    return h;
  }
  function name(dateKey) { return forYear(+dateKey.slice(0, 4))[dateKey] || null; }
  global.Holidays = { forYear, name };
})(typeof window !== 'undefined' ? window : globalThis);
