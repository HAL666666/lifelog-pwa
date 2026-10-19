/* Photo collage: pick a date -> that day's photos (pre-checked) -> auto layout by count (max 9) with date stamp.
   Saved to IndexedDB store 'collages' {id,dateKey,title,blob,thumb,count,photoIds,w,h,createdAt}; download offered.
   Daily prompt: first open of a day, if yesterday had 2+ photos and no collage -> 「昨日のコラージュを作る？」. */
(function (global) {
  'use strict';
  const MAX = 9;
  const SIZE = 1600;
  const GAP = 14;
  const PROMPT_KEY = 'collagePromptDay';
  // photos per row for each count (rows top->bottom)
  const ROWS = { 1: [1], 2: [2], 3: [1, 2], 4: [2, 2], 5: [2, 3], 6: [3, 3], 7: [2, 2, 3], 8: [3, 2, 3], 9: [3, 3, 3] };
  const $ = (id) => document.getElementById(id);
  const st = { date: null, photos: [], checked: new Set(), result: null, viewing: null };
  const urls = [];
  const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const freeUrls = () => { while (urls.length) URL.revokeObjectURL(urls.pop()); };
  const gal = { day: [], all: [] }; // per-container thumb URLs
  const gurl = (bucket, b) => { const u = URL.createObjectURL(b); gal[bucket].push(u); return u; };
  const freeGal = (bucket) => { while (gal[bucket].length) URL.revokeObjectURL(gal[bucket].pop()); };

  function layout(n) {
    const rows = ROWS[Math.min(MAX, Math.max(1, n))];
    const rh = (SIZE - GAP * (rows.length + 1)) / rows.length;
    const cells = [];
    rows.forEach((cnt, r) => {
      const cw = (SIZE - GAP * (cnt + 1)) / cnt;
      for (let c = 0; c < cnt; c++) cells.push({ x: GAP + c * (cw + GAP), y: GAP + r * (rh + GAP), w: cw, h: rh });
    });
    return cells;
  }

  function drawCover(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 18); else ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
    ctx.restore();
  }

  function stamp(ctx, dateKey, title) {
    const date = Thumbs.fmtLong(dateKey);
    ctx.save();
    ctx.font = '700 72px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    const dw = ctx.measureText(date).width;
    let tw = 0;
    if (title) { ctx.font = '600 52px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; tw = ctx.measureText(title).width; }
    const bw = Math.max(dw, tw) + 56, bh = title ? 176 : 104;
    const bx = SIZE - GAP - 18 - bw, by = SIZE - GAP - 18 - bh;
    ctx.fillStyle = 'rgba(15,23,42,.55)';
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 22); else ctx.rect(bx, by, bw, bh); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
    if (title) { ctx.font = '600 52px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; ctx.fillText(title, bx + bw - 28, by + 66); }
    ctx.font = '700 72px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.fillText(date, bx + bw - 28, by + bh - 26);
    ctx.restore();
  }

  const toBlob = (c, q) => new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('toBlob failed'))), 'image/jpeg', q));

  /** Build collage from photo records; returns saved record */
  async function build(dateKey, photos, title) {
    const use = photos.slice(0, MAX);
    const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, SIZE, SIZE);
    const cells = layout(use.length);
    for (let i = 0; i < use.length; i++) {
      const img = await Photos.loadImageFromBlob(use[i].blob || use[i].thumb);
      const b = cells[i]; drawCover(ctx, img, b.x, b.y, b.w, b.h);
    }
    stamp(ctx, dateKey, title);
    const blob = await toBlob(c, 0.88);
    const t = document.createElement('canvas'); t.width = 320; t.height = 320;
    t.getContext('2d').drawImage(c, 0, 0, 320, 320);
    const thumb = await toBlob(t, 0.75);
    const rec = { id: DB.uid(), dateKey, title: title || '', blob, thumb, count: use.length, photoIds: use.map((p) => p.id), w: SIZE, h: SIZE, createdAt: new Date().toISOString() };
    await DB.put('collages', rec);
    return rec;
  }

  async function forDate(dateKey) { return (await DB.getByIndex('collages', 'byDate', dateKey)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async function all() { return (await DB.getAll('collages')).sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.createdAt.localeCompare(a.createdAt)); }

  function download(rec) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(rec.blob);
    a.download = `collage-${rec.dateKey}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---- modal ----
  async function loadDate(dateKey) {
    st.date = dateKey;
    $('cl-date').value = dateKey;
    st.photos = (await Photos.photosForDate(dateKey)).sort((a, b) => (a.takenAt || '').localeCompare(b.takenAt || ''));
    st.checked = new Set(st.photos.map((p) => p.id));
    renderPick();
  }
  function renderPick() {
    freeUrls();
    const g = $('cl-pick'); g.innerHTML = '';
    for (const p of st.photos) {
      const lb = document.createElement('label'); lb.className = 'cl-item';
      lb.innerHTML = `<input type="checkbox" ${st.checked.has(p.id) ? 'checked' : ''}><img alt="" src="${url(p.thumb || p.blob)}"><i>✓</i>`;
      lb.querySelector('input').addEventListener('change', (e) => { e.target.checked ? st.checked.add(p.id) : st.checked.delete(p.id); count(); });
      g.appendChild(lb);
    }
    $('cl-empty').hidden = st.photos.length > 0;
    count();
  }
  function count() {
    const n = st.checked.size;
    $('cl-count').textContent = st.photos.length ? `${n}枚を選択${n > MAX ? `（最大${MAX}枚：先頭${MAX}枚を使います）` : ''}` : '';
    $('cl-make').disabled = n < 1;
  }
  function showPane(which) { $('cl-pane-pick').hidden = which !== 'pick'; $('cl-pane-result').hidden = which !== 'result'; }
  async function open(dateKey) {
    st.viewing = null;
    $('cl-title').value = '';
    showPane('pick');
    $('modal-collage').showModal();
    await loadDate(dateKey || (global.App && App.currentDay) || Thumbs.keyOf(new Date()));
  }
  function showResult(rec) {
    st.result = rec;
    $('cl-result-img').src = url(rec.blob);
    $('cl-result-cap').textContent = `${Thumbs.fmtDate(rec.dateKey)} ${rec.title || ''} ・ ${rec.count}枚`;
    showPane('result');
  }
  async function view(rec) { st.viewing = rec; showPane('result'); $('modal-collage').showModal(); showResult(rec); }

  async function make() {
    const picked = st.photos.filter((p) => st.checked.has(p.id));
    if (!picked.length) return;
    $('cl-make').disabled = true; $('cl-make').textContent = '作成中…';
    try {
      const rec = await build(st.date, picked, $('cl-title').value.trim());
      showResult(rec);
      App.toast('コラージュを保存しました');
      await refresh();
    } catch (err) { console.error(err); App.toast('コラージュの作成に失敗しました'); }
    $('cl-make').textContent = 'コラージュを作る'; count();
  }

  /** Render a list of collage thumbs into container el */
  function renderThumbs(el, list, bucket) {
    el.innerHTML = ''; freeGal(bucket);
    for (const r of list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cl-thumb';
      const img = document.createElement('img'); img.alt = 'コラージュ'; img.src = gurl(bucket, r.thumb || r.blob);
      b.appendChild(Thumbs.wrap(img, r.dateKey, `${r.title ? r.title + ' · ' : ''}${r.count}枚`));
      b.addEventListener('click', () => view(r));
      el.appendChild(b);
    }
  }
  async function refresh() {
    const day = $('day-collages');
    if (day && global.App && App.currentDay) {
      const l = await forDate(App.currentDay);
      renderThumbs(day, l, 'day'); $('day-collages-wrap').hidden = !l.length;
    }
    const ge = $('cl-gallery');
    if (ge) { const l = await all(); renderThumbs(ge, l, 'all'); $('cl-gallery-empty').hidden = l.length > 0; }
  }

  // ---- daily prompt ----
  async function checkPrompt(now = new Date()) {
    const today = Thumbs.keyOf(now);
    if (localStorage.getItem(PROMPT_KEY) === today) return false;
    localStorage.setItem(PROMPT_KEY, today);
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yk = Thumbs.keyOf(y);
    const n = (await Photos.photosForDate(yk)).length;
    if (n < 2 || (await forDate(yk)).length) return false;
    const b = $('collage-banner');
    b.dataset.date = yk;
    $('collage-banner-go').textContent = `🧩 昨日のコラージュを作る？（写真${n}枚）`;
    b.hidden = false;
    return true;
  }

  function init() {
    $('cl-date').addEventListener('change', (e) => { if (e.target.value) loadDate(e.target.value); });
    $('cl-make').addEventListener('click', make);
    $('cl-all').addEventListener('click', () => { const any = st.checked.size < st.photos.length; st.checked = new Set(any ? st.photos.map((p) => p.id) : []); renderPick(); });
    $('cl-cancel').addEventListener('click', () => { $('modal-collage').close(); freeUrls(); refresh(); });
    $('cl-close').addEventListener('click', () => { $('modal-collage').close(); freeUrls(); refresh(); });
    $('cl-download').addEventListener('click', () => st.result && download(st.result));
    $('cl-delete').addEventListener('click', async () => {
      if (!st.result || !confirm('このコラージュを削除しますか？（元の写真は残ります）')) return;
      await DB.del('collages', st.result.id); $('modal-collage').close(); freeUrls(); refresh();
    });
    $('day-collage-btn').addEventListener('click', () => open(App.currentDay));
    $('cl-new').addEventListener('click', () => open(Thumbs.keyOf(new Date())));
    $('collage-banner-go').addEventListener('click', () => { $('collage-banner').hidden = true; open($('collage-banner').dataset.date); });
    $('collage-banner-close').addEventListener('click', () => { $('collage-banner').hidden = true; });
  }

  global.Collage = { init, open, build, forDate, all, layout, refresh, checkPrompt, download, ROWS, MAX };
})(window);
