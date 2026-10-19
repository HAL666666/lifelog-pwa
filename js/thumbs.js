/* Thumbnail text overlay (date + optional title). Setting: localStorage 'thumbOverlay' ('0' = off, default on).
   Overlays are always rendered; body.thumb-text-off hides them, so toggling is instant. */
(function (global) {
  'use strict';
  const KEY = 'thumbOverlay';
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const on = () => localStorage.getItem(KEY) !== '0';
  function apply() { document.body.classList.toggle('thumb-text-off', !on()); }
  function parse(k) { return k instanceof Date ? k : new Date(String(k).length === 10 ? k + 'T00:00:00' : k); }
  /** '2026-10-19' -> '10/19（月）' */
  function fmtDate(k) { const d = parse(k); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; }
  /** Long form for collage stamp: '2026.10.19（月）' */
  function fmtLong(k) { const d = parse(k); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}（${WD[d.getDay()]}）`; }
  /** HTML for an overlay caption to place inside a position:relative box */
  function capHTML(date, title) {
    if (!date && !title) return '';
    return `<span class="tt-cap">${date ? `<b class="tt-date">${esc(fmtDate(date))}</b>` : ''}${title ? `<small class="tt-title">${esc(title)}</small>` : ''}</span>`;
  }
  /** Wrap an <img> in a figure with overlay caption */
  function wrap(img, date, title) {
    const f = document.createElement('figure');
    f.className = 'tthumb';
    f.appendChild(img);
    f.insertAdjacentHTML('beforeend', capHTML(date, title));
    return f;
  }
  function init() {
    apply();
    const cb = document.getElementById('thumb-overlay');
    if (cb) {
      cb.checked = on();
      cb.addEventListener('change', () => { localStorage.setItem(KEY, cb.checked ? '1' : '0'); apply(); });
    }
  }
  global.Thumbs = { init, apply, on, fmtDate, fmtLong, capHTML, wrap, keyOf, WD };
})(window);
