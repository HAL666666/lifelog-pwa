/* Backup (export/import all stores) + opt-in encrypted inbox pull. No network unless user presses 「今すぐ取得」. */
(function (global) {
  const STORES = ['memos', 'reminders', 'plans', 'sessions', 'notebooks', 'nbpages', 'habits', 'habitlogs', 'photos', 'meta'];
  const BLOB_STORES = ['photos', 'nbpages'];
  const SKIP_META = ['inboxPass']; // never export the inbox passphrase
  const keyOf = (store, r) => (store === 'meta' ? r.key : r.id);
  const stamp = (r) => ('updatedAt' in r && !r.updatedAt) ? 0 : Date.parse(r.updatedAt || r.createdAt || r.created || 0) || Number(r.updatedAt || r.created || 0) || 0;

  const toDataURL = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
  async function fromDataURL(s) { return (await fetch(s)).blob(); }

  async function serialize(rec, withBlobs) {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v instanceof Blob) { if (withBlobs) out[k] = { __blob: await toDataURL(v) }; }
      else out[k] = v;
    }
    return out;
  }
  async function deserialize(rec) {
    for (const [k, v] of Object.entries(rec)) if (v && typeof v === 'object' && typeof v.__blob === 'string') rec[k] = await fromDataURL(v.__blob);
    return rec;
  }

  async function buildExport(withPhotos) {
    const data = {};
    for (const s of STORES) {
      const rows = await DB.getAll(s);
      data[s] = [];
      for (const r of rows) {
        if (s === 'meta' && SKIP_META.includes(r.key)) continue;
        data[s].push(await serialize(r, withPhotos));
      }
    }
    return { app: 'lifelog', version: 2, exportedAt: new Date().toISOString(), includesPhotos: !!withPhotos, data };
  }

  /* Merge: new ids are added; existing ids are kept unless the incoming record is newer.
     Records arriving without their blob (text-only backup) only update fields of an existing record, never wipe the image. */
  async function mergeRecords(store, rows) {
    let added = 0, updated = 0, skipped = 0;
    for (const raw of rows || []) {
      if (!raw || typeof raw !== 'object') { skipped++; continue; }
      const r = await deserialize({ ...raw });
      if (store !== 'meta' && !r.id) r.id = DB.uid();
      if (store === 'meta' && (!r.key || SKIP_META.includes(r.key))) { skipped++; continue; }
      const cur = await DB.get(store, keyOf(store, r));
      if (!cur) {
        if (BLOB_STORES.includes(store) && !(r.blob instanceof Blob)) { skipped++; continue; }
        await DB.put(store, r); added++;
      } else if (stamp(r) > stamp(cur)) {
        await DB.put(store, Object.assign({}, cur, r)); updated++;
      } else skipped++;
    }
    return { added, updated, skipped };
  }

  async function importObject(obj) {
    let data;
    if (obj && obj.data && typeof obj.data === 'object') data = obj.data; // v2
    else if (obj && Array.isArray(obj.memos)) { // legacy v1 {memos, reminders, photos}
      data = { memos: obj.memos, reminders: obj.reminders || [], photos: (obj.photos || []).map((p) => ({ ...p, blob: p.blob && { __blob: p.blob }, thumb: p.thumb && { __blob: p.thumb } })) };
    } else throw new Error('不正なファイル');
    const tot = { added: 0, updated: 0, skipped: 0 };
    for (const s of STORES) {
      if (!Array.isArray(data[s])) continue;
      const r = await mergeRecords(s, data[s]);
      tot.added += r.added; tot.updated += r.updated; tot.skipped += r.skipped;
    }
    return tot;
  }

  async function refreshUI() {
    try { Reminders.scheduleAll(); await Calendar.render(); await Reminders.renderUpcoming(); } catch (e) { console.warn(e); }
  }

  function download(obj, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- encrypted inbox ----------
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function decryptInbox(env, pass) {
    if (!env || env.v !== 1 || env.alg !== 'AES-GCM' || env.kdf !== 'PBKDF2-SHA256') throw new Error('未対応の形式');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(env.salt), iterations: env.iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let pt;
    try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct)); }
    catch (e) { throw new Error('パスフレーズが違うか、データが壊れています'); }
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* Accept Drive share links and rewrite them to the CORS-enabled usercontent endpoint. */
  function normalizeUrl(u) {
    const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/);
    return m ? `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t` : u;
  }

  /* Inbox item -> store record. Kinds: plan | todo/reminder | memo | habit. */
  function mapItem(it) {
    const id = 'inbox-' + it.id;
    const createdAt = it.createdAt || new Date().toISOString();
    const updatedAt = it.updatedAt || it.createdAt || ''; // no timestamp => re-pulls never overwrite local edits
    if (it.kind === 'plan') return ['plans', { id, title: it.title, icon: it.icon || '', type: it.type === 'big' ? 'big' : 'small', start: it.start, end: it.end || null, color: it.color, createdAt, updatedAt, source: 'inbox' }];
    if (it.kind === 'todo' || it.kind === 'reminder' || it.kind === 'deadline') return ['reminders', { id, title: it.title, when: new Date(it.when || it.due).toISOString(), done: !!it.done, notified: false, createdAt, updatedAt, source: 'inbox' }];
    if (it.kind === 'memo') return ['memos', { id, dateKey: it.dateKey, text: it.text || it.title || '', createdAt, updatedAt, source: 'inbox' }];
    if (it.kind === 'habit' || it.type === 'habit') { const t = parseInt(it.target, 10); return ['habits', { id, name: it.name || it.title || '習慣', emoji: it.emoji || it.icon || '', target: t >= 1 && t <= 7 ? t : null, order: Number(it.order) || 999, badges: [], createdAt, updatedAt, source: 'inbox' }]; }
    return null;
  }

  async function applyInbox(payload) {
    const items = Array.isArray(payload) ? payload : payload.items;
    if (!Array.isArray(items)) throw new Error('items がありません');
    const by = {};
    for (const it of items) { if (!it || !it.id) continue; const m = mapItem(it); if (m) (by[m[0]] = by[m[0]] || []).push(m[1]); }
    const tot = { added: 0, updated: 0, skipped: 0 };
    for (const [s, rows] of Object.entries(by)) { const r = await mergeRecords(s, rows); for (const k in tot) tot[k] += r[k]; }
    return tot;
  }

  async function pullInbox() {
    const url = (await DB.getMeta('inboxUrl', '')).trim();
    const pass = await DB.getMeta('inboxPass', '');
    if (!url || !pass) throw new Error('URL とパスフレーズを設定してください');
    const res = await fetch(normalizeUrl(url), { cache: 'no-store' });
    if (!res.ok) throw new Error('取得失敗 HTTP ' + res.status);
    const r = await applyInbox(await decryptInbox(await res.json(), pass));
    await DB.setMeta('inboxLastPull', new Date().toISOString());
    return r;
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    $('btn-export').addEventListener('click', async () => {
      const withPhotos = $('export-photos').checked;
      if (withPhotos && !confirm('写真を含めるとファイルが非常に大きくなります。続行しますか？')) return;
      download(await buildExport(withPhotos), `lifelog-backup-${new Date().toISOString().slice(0, 10)}${withPhotos ? '-photos' : ''}.json`);
      App.toast('エクスポートしました');
    });
    $('import-input').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const r = await importObject(JSON.parse(await f.text()));
        await refreshUI();
        App.toast(`インポート: 追加${r.added} 更新${r.updated} スキップ${r.skipped}`);
      } catch (err) { console.warn(err); App.toast('インポート失敗: ' + err.message); }
      e.target.value = '';
    });
    // inbox (opt-in)
    (async () => {
      $('inbox-url').value = await DB.getMeta('inboxUrl', '');
      $('inbox-pass').value = await DB.getMeta('inboxPass', '');
      const lp = await DB.getMeta('inboxLastPull', null);
      $('inbox-status').textContent = lp ? '最終取得: ' + new Date(lp).toLocaleString('ja-JP') : '未使用（オフラインのまま動作します）';
    })();
    $('inbox-url').addEventListener('change', (e) => DB.setMeta('inboxUrl', e.target.value.trim()));
    $('inbox-pass').addEventListener('change', (e) => DB.setMeta('inboxPass', e.target.value));
    $('btn-inbox-pull').addEventListener('click', async () => {
      await DB.setMeta('inboxUrl', $('inbox-url').value.trim());
      await DB.setMeta('inboxPass', $('inbox-pass').value);
      $('inbox-status').textContent = '取得中…';
      try {
        const r = await pullInbox(); await refreshUI();
        $('inbox-status').textContent = `取得完了: 追加${r.added} 更新${r.updated} スキップ${r.skipped}`;
        App.toast('受信箱を取り込みました');
      } catch (err) { console.warn(err); $('inbox-status').textContent = 'エラー: ' + err.message; }
    });
  }

  global.Backup = { init, buildExport, importObject, decryptInbox, applyInbox, pullInbox, normalizeUrl };
})(window);
