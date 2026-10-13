/* Daily habit tracker: list (add/edit/delete/reorder), today checklist, streaks, 30-day heatmap, milestone badges. */
(function (global) {
  'use strict';
  const MILESTONES = [3, 7, 14, 30, 100];
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let editing = null;

  async function list() { return (await DB.getAll('habits')).sort((a, b) => (a.order || 0) - (b.order || 0)); }
  async function logsFor(id) { return new Set((await DB.getByIndex('habitlogs', 'byHabit', id)).map((l) => l.date)); }

  function streaks(set, today = new Date()) {
    let cur = 0, d = set.has(dk(today)) ? today : addDays(today, -1);
    while (set.has(dk(d))) { cur++; d = addDays(d, -1); }
    let best = 0, run = 0, prev = null;
    for (const k of [...set].sort()) {
      const t = Date.parse(k + 'T00:00:00');
      run = prev !== null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
      best = Math.max(best, run); prev = t;
    }
    return { cur, best: Math.max(best, cur) };
  }

  async function save(h) {
    const now = new Date().toISOString();
    if (!h.id) { h.id = DB.uid(); h.createdAt = now; h.order = (await list()).length; h.badges = []; }
    h.updatedAt = now;
    return DB.put('habits', h);
  }
  async function remove(id) {
    for (const l of await DB.getByIndex('habitlogs', 'byHabit', id)) await DB.del('habitlogs', l.id);
    await DB.del('habits', id);
  }
  async function move(id, dir) {
    const hs = await list(); const i = hs.findIndex((h) => h.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= hs.length) return;
    [hs[i], hs[j]] = [hs[j], hs[i]];
    for (let k = 0; k < hs.length; k++) { hs[k].order = k; await DB.put('habits', hs[k]); }
    render();
  }

  async function toggle(h, el) {
    const date = dk(new Date()), id = `${h.id}|${date}`;
    const done = await DB.get('habitlogs', id);
    if (done) { await DB.del('habitlogs', id); await render(); return; }
    await DB.put('habitlogs', { id, habit: h.id, date, at: new Date().toISOString() });
    el && el.classList.add('pop');
    const { cur } = streaks(await logsFor(h.id));
    const hit = MILESTONES.filter((m) => cur >= m && !(h.badges || []).includes(m));
    if (hit.length) { h.badges = [...(h.badges || []), ...hit]; await DB.put('habits', h); celebrate(`${h.emoji || '🏅'} ${hit[hit.length - 1]}日連続達成！`); }
    await render();
    const hs = await list(); const today = dk(new Date());
    const all = hs.length && (await Promise.all(hs.map((x) => DB.get('habitlogs', `${x.id}|${today}`)))).every(Boolean);
    if (all && !hit.length) celebrate('🎉 今日の習慣ぜんぶ完了！');
  }

  function celebrate(msg) {
    const box = document.createElement('div'); box.className = 'confetti';
    const colors = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#a855f7'];
    for (let i = 0; i < 40; i++) {
      const s = document.createElement('i');
      s.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % 5]};animation-delay:${Math.random() * .4}s;--dx:${(Math.random() - .5) * 120}px`;
      box.appendChild(s);
    }
    const b = document.createElement('div'); b.className = 'celebrate-msg'; b.textContent = msg; box.appendChild(b);
    document.body.appendChild(box); setTimeout(() => box.remove(), 2600);
  }

  async function render() {
    const hs = await list(), today = new Date(), tk = dk(today);
    const ul = $('habit-list'); ul.innerHTML = '';
    $('habit-empty').hidden = hs.length > 0;
    let doneN = 0;
    for (const h of hs) {
      const set = await logsFor(h.id), done = set.has(tk); if (done) doneN++;
      const { cur, best } = streaks(set, today);
      let week = 0; for (let i = 0; i < 7; i++) if (set.has(dk(addDays(today, -i)))) week++;
      let heat = ''; for (let i = 29; i >= 0; i--) heat += `<span class="${set.has(dk(addDays(today, -i))) ? 'on' : ''}"></span>`;
      const badges = MILESTONES.map((m) => `<b class="badge ${(h.badges || []).includes(m) ? 'got' : ''}" title="${m}日">${m}</b>`).join('');
      const li = document.createElement('li'); li.className = 'habit-card' + (done ? ' done' : ''); li.dataset.id = h.id;
      li.innerHTML = `<button type="button" class="habit-check" aria-pressed="${done}" aria-label="${esc(h.name)}を完了"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
        <div class="habit-body"><div class="habit-name">${esc(h.emoji || '')} ${esc(h.name)}</div>
        <div class="habit-meta">🔥 <span class="h-cur">${cur}</span>日 · 最高 ${best}日${h.target ? ` · 今週 ${week}/${h.target}` : ''}</div>
        <div class="heat">${heat}</div><div class="badges">${badges}</div></div>
        <div class="habit-ops"><button type="button" class="h-up" aria-label="上へ">▲</button><button type="button" class="h-edit" aria-label="編集">✎</button><button type="button" class="h-down" aria-label="下へ">▼</button></div>`;
      const chk = li.querySelector('.habit-check');
      chk.addEventListener('click', () => toggle(h, chk));
      li.querySelector('.h-up').addEventListener('click', () => move(h.id, -1));
      li.querySelector('.h-down').addEventListener('click', () => move(h.id, 1));
      li.querySelector('.h-edit').addEventListener('click', () => openEditor(h));
      ul.appendChild(li);
    }
    $('habit-progress').textContent = hs.length ? `今日 ${doneN}/${hs.length}` : '';
    if (!$('badge-panel').hidden) renderBadges();
    $('habit-bar').style.width = hs.length ? `${(doneN / hs.length) * 100}%` : '0';
  }

  function openEditor(h) {
    editing = h || null;
    $('habit-name').value = h ? h.name : ''; $('habit-emoji').value = h ? h.emoji || '' : '';
    $('habit-target').value = h && h.target ? h.target : '';
    $('habit-delete').hidden = !h;
    $('modal-habit').showModal();
  }

  function init() {
    $('habit-badges').addEventListener('click', () => { const p = $('badge-panel'); p.hidden = !p.hidden; if (!p.hidden) { renderBadges(); p.scrollIntoView({ behavior: 'smooth' }); } });
    $('habit-add').addEventListener('click', () => openEditor(null));
    $('habit-cancel').addEventListener('click', () => $('modal-habit').close());
    $('habit-delete').addEventListener('click', async () => {
      if (editing && confirm('この習慣と記録を削除しますか？')) { await remove(editing.id); $('modal-habit').close(); render(); }
    });
    $('habit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('habit-name').value.trim(); if (!name) return;
      const t = parseInt($('habit-target').value, 10);
      const h = Object.assign(editing || {}, { name, emoji: $('habit-emoji').value.trim(), target: t >= 1 && t <= 7 ? t : null });
      await save(h); $('modal-habit').close(); render();
    });
  }

  /* Shared achievements (habits + pomodoro), derived from data — nothing extra stored. */
  async function achievements() {
    const hs = await DB.getAll('habits'), logs = await DB.getAll('habitlogs'), ss = await DB.getAll('sessions');
    const hr = (l) => l.at ? new Date(l.at).getHours() : 12;
    const days = new Set(logs.map((l) => l.date));
    const sorted = [...days].sort(); let comeback = false;
    for (let i = 1; i < sorted.length; i++) if ((Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 864e5 >= 4) comeback = true;
    const byDay = {}; for (const l of logs) (byDay[l.date] = byDay[l.date] || new Set()).add(l.habit);
    const ids = hs.map((h) => h.id), t = new Date(); let perfect = false;
    for (let s0 = 0; s0 < 60 && ids.length && !perfect; s0++) {
      perfect = [...Array(7)].every((_, i) => { const d = byDay[dk(addDays(t, -s0 - i))]; return d && ids.every((x) => d.has(x)); });
    }
    const weekend = sorted.some((k) => { const d = new Date(k + 'T00:00:00'); return d.getDay() === 6 && days.has(dk(addDays(d, 1))); });
    const work = ss.filter((x) => x.workMs > 0), sd = {};
    for (const x of work) { const k = dk(new Date(x.start)); (sd[k] = sd[k] || []).push(x); }
    const day4 = Object.values(sd).some((a) => a.length >= 4);
    const lab3 = Object.values(sd).some((a) => new Set(a.map((x) => x.label).filter(Boolean)).size >= 3);
    const weekAgo = Date.now() - 7 * 864e5; let wk10 = false;
    for (const x of work) { const s0 = +new Date(x.start); const sum = work.filter((y) => +new Date(y.start) >= s0 && +new Date(y.start) < s0 + 7 * 864e5).reduce((a, y) => a + y.workMs, 0); if (sum >= 36e6) { wk10 = true; break; } }
    const best = Math.max(0, ...await Promise.all(hs.map(async (h) => streaks(await logsFor(h.id)).best)));
    return [
      ['🌱', 'はじめの一歩', '最初の習慣を追加', hs.length >= 1],
      ['🖐', 'コレクター', '習慣を5つ登録', hs.length >= 5],
      ['💯', '100チェック', '合計100回チェック', logs.length >= 100],
      ['🌅', '早起き', '7時前にチェック', logs.some((l) => hr(l) < 7)],
      ['🦉', '夜ふかし', '23時以降にチェック', logs.some((l) => hr(l) >= 23)],
      ['🌟', 'パーフェクトウィーク', '全習慣を7日連続達成', perfect],
      ['🔁', 'カムバック', '3日以上空けて再開', comeback],
      ['🏖', '週末戦士', '土日どちらも達成', weekend],
      ['🔥', '7日連続', 'どれかで7日連続', best >= 7],
      ['🏆', '30日連続', 'どれかで30日連続', best >= 30],
      ['🍅', '初ポモドーロ', '初めてのセッション', work.length >= 1],
      ['⚡', '集中デー', '1日に4セッション', day4],
      ['🎨', 'マルチタスク', '1日に3種類のラベル', lab3],
      ['⏳', '10時間ウィーク', '1週間で作業10時間', wk10]
    ];
  }
  async function renderBadges() {
    const a = await achievements(), g = $('badge-grid');
    $('badge-count').textContent = `${a.filter((x) => x[3]).length}/${a.length}`;
    g.innerHTML = a.map(([e, n, hint, ok]) => `<li class="ach ${ok ? 'got' : ''}"><span>${e}</span><b>${n}</b><small>${hint}</small></li>`).join('');
  }

  global.Habits = { achievements, renderBadges, init, render, streaks, list, save, remove, celebrate, MILESTONES };
})(window);
