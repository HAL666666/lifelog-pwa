(function (global) {
  'use strict';
  // Gantt-style plan view: items {id,title,start,end?,type:'big'|'small',icon?,color}
  const COLORS = ['#2563eb', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
  const DAY = 864e5;
  const st = {
    tab: localStorage.getItem('gtTab') || 'all',
    range: +(localStorage.getItem('gtRange') || 3),
    anchor: null, editing: null
  };
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (k) => new Date(k + 'T00:00:00');
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let ctx2d;
  function textW(s, px) {
    ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
    ctx2d.font = `600 ${px}px system-ui, -apple-system, sans-serif`;
    return ctx2d.measureText(s).width;
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function window_() {
    const a = st.anchor;
    const s = new Date(a.getFullYear(), a.getMonth(), 1);
    const e = new Date(a.getFullYear(), a.getMonth() + st.range, 1);
    return { s, e, days: Math.round((e - s) / DAY) };
  }

  async function render() {
    const root = document.getElementById('gt-chart');
    if (!root) return;
    document.querySelectorAll('#gt-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === st.tab));
    document.querySelectorAll('#gt-ranges button').forEach((b) => b.classList.toggle('active', +b.dataset.r === st.range));
    const { s, e, days } = window_();
    const last = new Date(e - DAY);
    document.getElementById('gt-label').textContent = st.range === 1
      ? `${s.getFullYear()}年${s.getMonth() + 1}月`
      : `${s.getFullYear()}/${s.getMonth() + 1}–${last.getFullYear() !== s.getFullYear() ? last.getFullYear() + '/' : ''}${last.getMonth() + 1}月`;
    const W = root.clientWidth || 366;
    const dw = W / days;
    const x = (d) => ((d - s) / DAY) * dw;

    document.getElementById('gt-help').textContent = '太いバー＝大事 / 細いバー＝小さな用事（●＝期限日）。タップで編集。';
    let all = st.tab === 'habit' ? [] : await DB.getAll('plans');
    all = all.filter((p) => p.start && parse(p.start) < e && parse(p.end || p.start) >= s);
    if (st.tab !== 'all') all = all.filter((p) => p.type === st.tab);
    all.sort((a, b) => (a.type === b.type ? 0 : a.type === 'big' ? -1 : 1) || a.start.localeCompare(b.start));

    // background: weekend/holiday tint + alternating week stripes
    const ws = +(localStorage.getItem('weekStart') || 0);
    let bg = '', wk = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
      if (d.getDay() === ws && i > 0) wk++;
      const hol = Holidays.name(key(d));
      const cls = hol || d.getDay() === 0 ? 'hol' : d.getDay() === 6 ? 'sat' : wk % 2 ? 'stripe' : '';
      if (cls) bg += `<i class="gt-col ${cls}" style="left:${(i * dw).toFixed(2)}px;width:${dw.toFixed(2) }px"${hol ? ` title="${hol}"` : ''}></i>`;
    }
    // axis
    let ax = '';
    for (let i = 0; i < days; i++) {
      const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
      const lbl = st.range === 1 ? (d.getDate() === 1 || d.getDay() === ws ? md(d) : '') : d.getDate() === 1 ? `${d.getMonth() + 1}月` : (st.range === 3 && d.getDate() === 15 ? '15' : '');
      if (lbl) ax += `<span style="left:${(i * dw).toFixed(1)}px" class="${d.getDate() === 1 ? 'm' : ''}">${lbl}</span>`;
    }

    if (st.tab === 'habit') return renderHabits(root, { s, e, days, W, dw, bg, ax });
    let rows = '', y = 0, section = null;
    for (const p of all) {
      if (st.tab === 'all' && p.type !== section) {
        section = p.type;
        rows += `<div class="gt-sec" style="top:${y}px">${p.type === 'big' ? '大事' : '小さな用事'}</div>`;
        y += 22;
      }
      const big = p.type === 'big';
      const c = p.color || (big ? COLORS[0] : COLORS[3]);
      const ps = parse(p.start), pe = parse(p.end || p.start);
      const x0 = Math.max(0, x(ps)), x1 = Math.min(W, x(new Date(+pe + DAY)));
      const label = `${p.icon ? p.icon + ' ' : ''}${p.title}${big ? '' : ' 〆' + md(pe)}${big && p.end && p.end !== p.start ? ` ${md(ps)}–${md(pe)}` : ''}`;
      const fs = big ? 12 : 11;
      const tw = textW(label, fs) + 4;
      const bh = big ? 22 : 6;
      const bw = Math.max(x1 - x0, big ? 6 : 3);
      // label placement: inside (big & fits) / right / left / above
      let pos;
      if (big && bw >= tw + 12) pos = 'in';
      else if (x0 + bw + 6 + tw <= W) pos = 'right';
      else if (x0 - 6 - tw >= 0) pos = 'left';
      else pos = 'above';
      const rh = (big ? 38 : 28) + (pos === 'above' ? 14 : 0);
      const cy = y + rh - (big ? 19 : 14);
      const grad = `linear-gradient(135deg, ${shade(c, 40)}, ${c} 60%, ${shade(c, -25)})`;
      let h = `<div class="gt-item ${big ? 'big' : 'small'}" data-id="${esc(p.id)}" style="top:${y}px;height:${rh}px">`;
      h += `<div class="gt-bar" style="left:${x0}px;width:${bw}px;top:${cy - bh / 2 - y}px;height:${bh}px;background:${grad};--c:${c}${big ? '' : ';opacity:.75'}"></div>`;
      if (!big && x(pe) + dw / 2 <= W && pe >= s) h += `<div class="gt-dot" style="left:${Math.min(W - 5, x(pe) + dw / 2)}px;top:${cy - y}px;background:${c};--c:${c}"></div>`;
      const ls = `font-size:${fs}px;`;
      const ly = cy - y;
      if (pos === 'in') h += `<span class="gt-lbl in" style="${ls}left:${x0 + 6}px;top:${ly}px">${esc(label)}</span>`;
      else if (pos === 'right') h += `<span class="gt-lbl" style="${ls}left:${x0 + bw + (big ? 6 : 10)}px;top:${ly}px;color:${shade(c, -40)}">${esc(label)}</span>`;
      else if (pos === 'left') h += `<span class="gt-lbl" style="${ls}left:${x0 - 6 - tw}px;top:${ly}px;color:${shade(c, -40)}">${esc(label)}</span>`;
      else h += `<span class="gt-lbl" style="${ls}left:${Math.max(0, Math.min(W - tw, x0))}px;top:9px;color:${shade(c, -40)}">${esc(label)}</span>`;
      h += '</div>';
      rows += h;
      y += rh;
    }
    const H = Math.max(y, 60);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let today = '';
    if (t >= s && t < e) today = `<div class="gt-today" style="left:${x(t) + dw / 2}px"><b>今日</b></div>`;
    root.innerHTML = `<div class="gt-axis">${ax}</div><div class="gt-body" style="height:${H + 8}px">${bg}${rows}${today}</div>`;
    document.getElementById('gt-empty').textContent = 'この期間の予定はありません';
    document.getElementById('gt-empty').hidden = all.length > 0;
  }

  /* 12 & 17b: habit Gantt — one row per habit, achieved days as filled segments (consecutive days merged).
     Past days where every habit was achieved are dimmed; missed days are tinted so they stand out. */
  async function renderHabits(root, { s, e, days, W, dw, bg, ax }) {
    document.getElementById('gt-help').textContent = '緑の帯＝達成した日（連続はつながる）。全部達成した日はうすく、未達の日は赤く表示。タップで習慣タブへ。';
    const ds = await Habits.dayStatus();
    const hs = ds.hs.sort((a, b) => (a.order || 0) - (b.order || 0));
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const todayK = key(t0);
    let rows = '', y = 0;
    for (const h of hs) {
      const set = new Set(ds.logs.filter((l) => l.habit === h.id).map((l) => l.date));
      const born = ds.born[h.id] || '0000-00-00';
      let segs = '', miss = '', n = 0, runStart = -1, runAll = null;
      const flush = (i) => {
        if (runStart < 0) return;
        segs += `<i class="gt-hseg${runAll ? ' all' : ''}" style="left:${(runStart * dw).toFixed(2)}px;width:${Math.max(2, (i - runStart) * dw - (dw > 4 ? 1 : 0)).toFixed(2)}px;--c:${h.color || '#10b981'}"></i>`;
        runStart = -1;
      };
      for (let i = 0; i < days; i++) {
        const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i), k = key(d);
        const on = set.has(k), all = k < todayK && ds.allDone(k);
        if (on) {
          n++;
          if (runStart >= 0 && runAll !== all) flush(i);
          if (runStart < 0) { runStart = i; runAll = all; }
        } else {
          flush(i);
          if (k < todayK && k >= born) miss += `<i class="gt-hmiss" style="left:${(i * dw).toFixed(2)}px;width:${dw.toFixed(2)}px"></i>`;
        }
      }
      flush(days);
      rows += `<div class="gt-hrow" data-habit="${esc(h.id)}" style="top:${y}px"><span class="gt-hlbl">${esc((h.emoji ? h.emoji + ' ' : '') + h.name)} <small>${n}日</small></span><div class="gt-htrack">${miss}${segs}</div></div>`;
      y += 40;
    }
    const H = Math.max(y, 60);
    let today = '';
    if (t0 >= s && t0 < e) today = `<div class="gt-today" style="left:${((t0 - s) / DAY) * dw + dw / 2}px"><b>今日</b></div>`;
    root.innerHTML = `<div class="gt-axis">${ax}</div><div class="gt-body habit" style="height:${H + 8}px">${bg}${rows}${today}</div>`;
    const empty = document.getElementById('gt-empty');
    empty.textContent = '習慣がありません（習慣タブで追加）';
    empty.hidden = hs.length > 0;
  }

  function openForm(p) {
    st.editing = p || null;
    const today = key(new Date());
    document.getElementById('plan-modal-title').textContent = p ? '予定を編集' : '予定を追加';
    document.getElementById('plan-title').value = p ? p.title : '';
    document.getElementById('plan-icon').value = p ? p.icon || '' : '';
    document.getElementById('plan-type').value = p ? p.type : (st.tab === 'small' ? 'small' : 'big');
    document.getElementById('plan-start').value = p ? p.start : today;
    document.getElementById('plan-end').value = p ? p.end || '' : '';
    document.getElementById('plan-delete').hidden = !p;
    const col = p ? p.color : null;
    const box = document.getElementById('plan-colors');
    box.innerHTML = COLORS.map((c, i) => `<label><input type="radio" name="plan-color" value="${c}" ${(col ? col === c : i === (document.getElementById('plan-type').value === 'big' ? 0 : 3)) ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('');
    document.getElementById('modal-plan').showModal();
  }

  async function save(ev) {
    ev.preventDefault();
    const start = document.getElementById('plan-start').value;
    let end = document.getElementById('plan-end').value || null;
    if (end && end < start) { App.toast('終了日が開始日より前です'); return; }
    if (end === start) end = null;
    const p = Object.assign(st.editing || { id: DB.uid(), createdAt: new Date().toISOString() }, {
      title: document.getElementById('plan-title').value.trim(),
      icon: document.getElementById('plan-icon').value.trim(),
      type: document.getElementById('plan-type').value,
      start, end,
      color: (document.querySelector('input[name=plan-color]:checked') || {}).value
    });
    if (!p.title) return;
    await DB.put('plans', p);
    document.getElementById('modal-plan').close();
    st.anchor = st.anchor && parse(start) >= window_().s && parse(start) < window_().e ? st.anchor : parse(start);
    render();
  }

  function init() {
    st.anchor = new Date();
    document.getElementById('gt-tabs').addEventListener('click', (e) => {
      const t = e.target.dataset.t; if (!t) return;
      st.tab = t; localStorage.setItem('gtTab', t); render();
    });
    document.getElementById('gt-ranges').addEventListener('click', (e) => {
      const r = +e.target.dataset.r; if (!r) return;
      st.range = r; localStorage.setItem('gtRange', r); render();
    });
    const nav = (dir) => { st.anchor = new Date(st.anchor.getFullYear(), st.anchor.getMonth() + dir * Math.max(1, Math.floor(st.range / 2)), 1); render(); };
    document.getElementById('gt-prev').addEventListener('click', () => nav(-1));
    document.getElementById('gt-next').addEventListener('click', () => nav(1));
    document.getElementById('gt-add').addEventListener('click', () => (st.tab === 'habit' ? Habits.openEditor(null) : openForm()));
    document.getElementById('gt-chart').addEventListener('click', async (e) => {
      if (e.target.closest('.gt-hrow')) { App.showView('habits'); return; }
      const it = e.target.closest('.gt-item'); if (!it) return;
      openForm(await DB.get('plans', it.dataset.id));
    });
    document.getElementById('form-plan').addEventListener('submit', save);
    document.getElementById('plan-cancel').addEventListener('click', () => document.getElementById('modal-plan').close());
    document.getElementById('plan-delete').addEventListener('click', async () => {
      if (!st.editing || !confirm('この予定を削除しますか？')) return;
      await DB.del('plans', st.editing.id);
      document.getElementById('modal-plan').close();
      render();
    });
    window.addEventListener('resize', () => { if (document.getElementById('view-gantt').classList.contains('active')) render(); });
  }

  function showHabits() { st.tab = 'habit'; localStorage.setItem('gtTab', 'habit'); App.showView('gantt'); }
  global.Gantt = { init, render, showHabits, setAnchor: (d) => { st.anchor = d; } };
})(window);
