(function (global) {
  'use strict';
  // Photo study notebooks. notebooks {id,name,created}; nbpages {id,nb,order,blob,thumb,w,h,ink:[{c,w,e,pts}],created}
  // Images are stored locally only (IndexedDB Blobs); nothing is uploaded.
  const COLORS = ['#ef4444', '#2563eb', '#10b981', '#f59e0b', '#0f172a', '#ffffff'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { nb: null, pages: [], idx: 0, mode: 'grid', pen: false, color: COLORS[0], eraser: false, z: 1, tx: 0, ty: 0 };
  const urls = [];
  const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const freeUrls = () => { while (urls.length) URL.revokeObjectURL(urls.pop()); };

  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {
      const img = new Image(); img.src = URL.createObjectURL(file); await img.decode(); return img;
    }
  }
  function toBlob(src, max, q) {
    const w0 = src.width, h0 = src.height, k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob((b) => r({ b, w: c.width, h: c.height }), 'image/jpeg', q));
  }
  async function addFiles(files) {
    let order = st.pages.length ? Math.max(...st.pages.map((p) => p.order)) + 1 : 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const src = await decode(f);
      const big = await toBlob(src, 2000, 0.85), th = await toBlob(src, 320, 0.7);
      await DB.put('nbpages', { id: DB.uid(), nb: st.nb.id, order: order++, blob: big.b, thumb: th.b, w: big.w, h: big.h, ink: [], created: Date.now() });
    }
    await load(); renderDetail();
  }

  // ---- undo toast ----
  function undoToast(msg, undo) {
    const el = $('nb-undo-toast');
    el.querySelector('span').textContent = msg; el.hidden = false;
    el.querySelector('button').onclick = async () => { el.hidden = true; await undo(); };
    clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // ---- notebook list ----
  async function render() {
    if (st.nb) return renderDetail();
    $('nb-list-wrap').hidden = false; $('nb-detail').hidden = true;
    freeUrls();
    const [nbs, pages] = await Promise.all([DB.getAll('notebooks'), DB.getAll('nbpages')]);
    nbs.sort((a, b) => b.created - a.created);
    $('nb-empty').hidden = nbs.length > 0;
    const g = $('nb-grid'); g.innerHTML = '';
    for (const n of nbs) {
      const ps = pages.filter((p) => p.nb === n.id).sort((a, b) => a.order - b.order);
      const d = document.createElement('button');
      d.type = 'button'; d.className = 'nb-tile';
      const last = ps.reduce((m, p) => Math.max(m, p.created || 0), 0) || n.created;
      const cap = ps[0] && global.Thumbs ? Thumbs.capHTML(last ? new Date(last) : null, `${n.name} · ${ps.length}枚`) : '';
      d.innerHTML = `<div class="nb-cover tthumb">${ps[0] ? `<img src="${url(ps[0].thumb)}" alt="">` : '<span>📓</span>'}${cap}</div><div class="nb-meta${cap ? ' has-cap' : ''}"><b>${esc(n.name)}</b><small>${ps.length}枚</small></div>`;
      d.onclick = () => open(n);
      g.appendChild(d);
    }
  }
  async function open(n) { st.nb = n; st.idx = 0; st.mode = 'grid'; await load(); renderDetail(); }
  async function load() {
    st.pages = (await DB.getByIndex('nbpages', 'byNb', st.nb.id)).sort((a, b) => a.order - b.order);
    st.idx = Math.max(0, Math.min(st.idx, st.pages.length - 1));
  }
  async function saveOrder() {
    for (let i = 0; i < st.pages.length; i++) if (st.pages[i].order !== i) { st.pages[i].order = i; await DB.put('nbpages', st.pages[i]); }
  }

  // ---- detail ----
  function renderDetail() {
    $('nb-list-wrap').hidden = true; $('nb-detail').hidden = false;
    $('nb-title').textContent = st.nb.name;
    document.querySelectorAll('#nb-modes button').forEach((b) => b.classList.toggle('active', b.dataset.m === st.mode));
    $('nb-pempty').hidden = st.pages.length > 0;
    const card = st.mode === 'card' && st.pages.length > 0;
    $('nb-pgrid').hidden = card; $('nb-cardwrap').hidden = !card;
    if (!card) { setPen(false); renderGrid(); } else showCard();
  }
  function renderGrid() {
    freeUrls();
    const g = $('nb-pgrid'); g.innerHTML = '';
    st.pages.forEach((p, i) => {
      const im = document.createElement('img');
      im.src = url(p.thumb); im.alt = `${i + 1}`; im.dataset.i = i; im.draggable = false;
      if (p.ink && p.ink.length) im.classList.add('inked');
      g.appendChild(im);
    });
  }
  // long-press drag reorder in grid; short tap opens card
  function bindGrid() {
    const g = $('nb-pgrid');
    let lp = null, drag = null, sx = 0, sy = 0;
    g.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('img'); if (!t) return;
      sx = e.clientX; sy = e.clientY;
      lp = setTimeout(() => { drag = { el: t, from: +t.dataset.i }; t.classList.add('dragging'); g.classList.add('reordering'); if (navigator.vibrate) navigator.vibrate(20); }, 380);
    });
    g.addEventListener('pointermove', (e) => {
      if (!drag) { if (lp && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(lp); lp = null; } return; }
      e.preventDefault();
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const o = over && over.closest && over.closest('#nb-pgrid img');
      if (o && o !== drag.el) {
        const r = o.getBoundingClientRect();
        g.insertBefore(drag.el, e.clientX > r.left + r.width / 2 ? o.nextSibling : o);
      }
    });
    const end = async (e) => {
      clearTimeout(lp);
      if (drag) {
        const ids = [...g.children].map((x) => +x.dataset.i);
        st.pages = ids.map((i) => st.pages[i]);
        drag = null; g.classList.remove('reordering');
        await saveOrder(); renderGrid();
      } else if (lp && e.type === 'pointerup') {
        const t = e.target.closest('img'); if (t) { st.idx = +t.dataset.i; st.mode = 'card'; renderDetail(); }
      }
      lp = null;
    };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    g.addEventListener('contextmenu', (e) => e.preventDefault());
    g.style.touchAction = 'pan-y';
  }

  // ---- card view ----
  function applyT(anim) {
    const l = $('nb-layer');
    l.style.transition = anim ? 'transform .2s' : 'none';
    l.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.z})`;
  }
  function resetZoom() { st.z = 1; st.tx = 0; st.ty = 0; applyT(true); }
  async function showCard(dir) {
    const p = st.pages[st.idx]; if (!p) return;
    freeUrls();
    const img = $('nb-img');
    img.src = url(p.blob);
    await img.decode().catch(() => {});
    st.z = 1; st.tx = 0; st.ty = 0; applyT(false);
    sizeInk(); drawInk();
    $('nb-count').textContent = `${st.idx + 1} / ${st.pages.length}`;
    if (dir) {
      const s = $('nb-stage');
      s.classList.remove('flip-l', 'flip-r'); void s.offsetWidth;
      s.classList.add(dir > 0 ? 'flip-l' : 'flip-r');
    }
  }
  function go(d) {
    const n = st.idx + d;
    if (n < 0 || n >= st.pages.length) { const s = $('nb-stage'); s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); return; }
    st.idx = n; showCard(d);
  }
  function sizeInk() {
    const img = $('nb-img'), c = $('nb-ink');
    const r = img.getBoundingClientRect(), z = st.z || 1;
    const w = r.width / z, h = r.height / z, dpr = devicePixelRatio || 1;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  }
  function drawInk() {
    const p = st.pages[st.idx], c = $('nb-ink'), x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    if (!p) return;
    for (const s of p.ink || []) stroke(x, c, s);
  }
  function stroke(x, c, s) {
    x.save();
    x.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    x.strokeStyle = s.c; x.lineWidth = s.w * c.width; x.lineCap = x.lineJoin = 'round';
    x.beginPath();
    s.pts.forEach(([a, b], i) => (i ? x.lineTo(a * c.width, b * c.height) : x.moveTo(a * c.width, b * c.height)));
    if (s.pts.length === 1) x.lineTo(s.pts[0][0] * c.width + 0.01, s.pts[0][1] * c.height);
    x.stroke(); x.restore();
  }
  function setPen(on) {
    st.pen = on;
    $('nb-pen').hidden = !on; $('nb-actions').hidden = on;
    $('nb-stage').classList.toggle('pen', on);
  }
  function bindCard() {
    const stage = $('nb-stage');
    const pts = new Map();
    let g = null, lastTap = 0, cur = null;
    const local = (e) => {
      const r = $('nb-ink').getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pen && pts.size === 1) {
        const r = $('nb-ink').getBoundingClientRect();
        const w = +$('nb-width').value / r.width * (st.eraser ? 3 : 1);
        cur = { c: st.color, w, e: st.eraser || undefined, pts: [local(e)] };
        return;
      }
      if (cur) { cur = null; drawInk(); } // second finger cancels stroke → pinch
      const a = [...pts.values()];
      g = { x0: e.clientX, y0: e.clientY, tx: st.tx, ty: st.ty, z: st.z, t: Date.now(), moved: false };
      if (a.length === 2) { g.d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); g.cx = (a[0].x + a[1].x) / 2; g.cy = (a[0].y + a[1].y) / 2; }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (cur) {
        cur.pts.push(local(e));
        const c = $('nb-ink'), x = c.getContext('2d');
        drawInk(); stroke(x, c, cur);
        return;
      }
      if (!g) return;
      const a = [...pts.values()];
      if (a.length >= 2 && g.d) {
        const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        const cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
        st.z = Math.max(1, Math.min(6, g.z * d / g.d));
        st.tx = g.tx + (cx - g.cx); st.ty = g.ty + (cy - g.cy);
        if (st.z === 1) { st.tx = 0; st.ty = 0; }
        g.moved = true; applyT(false);
      } else if (a.length === 1) {
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true;
        if (st.z > 1) { st.tx = g.tx + dx; st.ty = g.ty + dy; applyT(false); }
        else if (!st.pen) { $('nb-layer').style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`; }
      }
    });
    const up = async (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (cur) {
        const p = st.pages[st.idx];
        p.ink = (p.ink || []).concat([cur]); cur = null;
        await DB.put('nbpages', p);
        return;
      }
      if (!g || pts.size) { if (pts.size === 1 && g) { const a = [...pts.values()][0]; g = { x0: a.x, y0: a.y, tx: st.tx, ty: st.ty, z: st.z, moved: true }; } return; }
      const dx = e.clientX - g.x0;
      if (!g.moved) {
        const now = Date.now();
        if (now - lastTap < 300) { // double-tap zoom
          if (st.z > 1) resetZoom();
          else { const r = stage.getBoundingClientRect(); const k = 2.5; st.z = k; st.tx = (r.left + r.width / 2 - e.clientX) * (k - 1); st.ty = (r.top + r.height / 2 - e.clientY) * (k - 1); applyT(true); }
          lastTap = 0;
        } else lastTap = now;
      } else if (st.z <= 1 && !st.pen) {
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); else applyT(true);
      }
      g = null;
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => { if (!$('nb-cardwrap').hidden) { sizeInk(); drawInk(); } });
  }

  async function cardAction(a) {
    const p = st.pages[st.idx];
    if (a === 'prev') return go(-1);
    if (a === 'next') return go(1);
    if (a === 'pen') { resetZoom(); return setPen(true); }
    if (a === 'left' || a === 'right') {
      const j = st.idx + (a === 'left' ? -1 : 1);
      if (j < 0 || j >= st.pages.length) return;
      [st.pages[st.idx], st.pages[j]] = [st.pages[j], st.pages[st.idx]];
      st.idx = j; await saveOrder(); $('nb-count').textContent = `${st.idx + 1} / ${st.pages.length}`;
      return App.toast(`${j + 1}番目に移動`);
    }
    if (a === 'dup') {
      const c = Object.assign({}, p, { id: DB.uid(), ink: JSON.parse(JSON.stringify(p.ink || [])), created: Date.now() });
      st.pages.splice(st.idx + 1, 0, c); await DB.put('nbpages', c); await saveOrder();
      return go(1);
    }
    if (a === 'del') {
      const i = st.idx;
      await DB.del('nbpages', p.id); st.pages.splice(i, 1); await saveOrder();
      if (!st.pages.length) st.mode = 'grid';
      st.idx = Math.min(i, st.pages.length - 1); renderDetail();
      undoToast('写真を削除しました', async () => { st.pages.splice(i, 0, p); await DB.put('nbpages', p); await saveOrder(); st.idx = i; renderDetail(); });
    }
  }

  function init() {
    $('nb-new').onclick = async () => {
      const name = prompt('ノート名', '新しいノート'); if (!name) return;
      const n = { id: DB.uid(), name: name.trim(), created: Date.now() };
      await DB.put('notebooks', n); open(n);
    };
    $('nb-back').onclick = () => { setPen(false); st.nb = null; render(); };
    $('nb-rename').onclick = async () => {
      const name = prompt('新しい名前', st.nb.name); if (!name) return;
      st.nb.name = name.trim(); await DB.put('notebooks', st.nb); renderDetail();
    };
    $('nb-delete').onclick = async () => {
      if (!confirm(`「${st.nb.name}」と写真${st.pages.length}枚を削除しますか？`)) return;
      const n = st.nb, ps = st.pages.slice();
      for (const p of ps) await DB.del('nbpages', p.id);
      await DB.del('notebooks', n.id); st.nb = null; await render();
      undoToast('ノートを削除しました', async () => { await DB.put('notebooks', n); for (const p of ps) await DB.put('nbpages', p); render(); });
    };
    $('nb-modes').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.m; renderDetail(); };
    $('nb-file').onchange = async (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { App.toast('取り込み中…'); await addFiles(f); App.toast(`${f.length}枚追加`); } };
    $('nb-actions').onclick = (e) => { const b = e.target.closest('button'); if (b) cardAction(b.dataset.a); };
    const cs = $('nb-colors');
    COLORS.forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'nb-sw'; b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', c);
      b.onclick = () => { st.color = c; st.eraser = false; syncPen(); };
      cs.appendChild(b);
    });
    const syncPen = () => { cs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !st.eraser && b.dataset.c === st.color)); $('nb-eraser').classList.toggle('on', st.eraser); };
    syncPen();
    $('nb-eraser').onclick = () => { st.eraser = !st.eraser; syncPen(); };
    $('nb-undo').onclick = async () => { const p = st.pages[st.idx]; if (!p.ink || !p.ink.length) return; p.ink.pop(); await DB.put('nbpages', p); drawInk(); };
    $('nb-clear').onclick = async () => {
      const p = st.pages[st.idx], old = p.ink || []; if (!old.length) return;
      p.ink = []; await DB.put('nbpages', p); drawInk();
      undoToast('書き込みを消去', async () => { p.ink = old; await DB.put('nbpages', p); drawInk(); });
    };
    $('nb-done').onclick = () => setPen(false);
    bindGrid(); bindCard();
  }

  global.Notebook = { init, render, addFiles, _st: st };
})(window);
