/* 引っ越し用「まるごと書き出し／読み込み」（機種変更向け）。
   書き出し: IndexedDB の全ストア（写真・コラージュ・ノートの画像は Base64）＋このアプリの localStorage 設定を 1つの JSON に。
   読み込み: アプリ名とスキーマ版を確認 → 内容を先に全部検証・変換 → 確認ダイアログ → 1つのトランザクションで置き換え（既定）または統合。
   途中で失敗したらトランザクションごと取り消されるので、今のデータは壊れない。既存のデータ形式・キーは変更しない（追加のみ）。 */
(function (global) {
  'use strict';
  const APP = 'lifelog';
  const SCHEMA = 3;              // 3 = まるごと（全ストア＋localStorage）。2 = 従来のバックアップ（読み込み可）
  const SKIP_META = ['inboxPass']; // 受信箱のパスフレーズは平文で書き出さない（新しい端末で入れ直す）
  // このアプリが使う localStorage キー（同じ github.io の他アプリのキーは触らない）
  const LS_KEYS = ['calMode', 'weekStart', 'gtTab', 'gtRange', 'thumbOverlay', 'collagePromptDay', 'lastExportAt', 'exportReminderSnoozeUntil'];
  const BLOB_STORES = ['photos', 'nbpages', 'collages'];

  const toDataURL = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
  function dataURLToBlob(s) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(s || '');
    if (!m) throw new Error('画像データが壊れています');
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: m[1] || 'application/octet-stream' });
  }
  const keyOf = (store, r) => (store === 'meta' ? r.key : r.id);

  async function storeNames() { const db = await DB.openDB(); return Array.from(db.objectStoreNames); }

  async function encode(v) {
    if (v instanceof Blob) return { __blob: await toDataURL(v) };
    if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await encode(x)); return o; }
    if (v && typeof v === 'object' && !(v instanceof Date)) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await encode(x); return o; }
    return v;
  }
  function decode(v) {
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === 'object') {
      if (typeof v.__blob === 'string' && Object.keys(v).length === 1) return dataURLToBlob(v.__blob);
      const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o;
    }
    return v;
  }

  async function buildFullExport() {
    const data = {};
    for (const s of await storeNames()) {
      data[s] = [];
      for (const r of await DB.getAll(s)) {
        if (s === 'meta' && SKIP_META.includes(r.key)) continue;
        data[s].push(await encode(r));
      }
    }
    const ls = {};
    for (const k of LS_KEYS) { const v = localStorage.getItem(k); if (v !== null) ls[k] = v; }
    const counts = {}; for (const s in data) counts[s] = data[s].length;
    return { app: APP, version: SCHEMA, schema: SCHEMA, full: true, exportedAt: new Date().toISOString(), includesPhotos: true, counts, data, localStorage: ls };
  }

  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fileName = () => `lifelog-all-v${SCHEMA}-${localDate()}.json`;

  /* 検証＋変換（DBには触らない）。問題があれば Error を投げる */
  async function parseFull(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('JSONの形が違います');
    if (obj.app !== APP) throw new Error(`このアプリのファイルではありません（app: ${obj.app || 'なし'}）`);
    const ver = Number(obj.version);
    if (!Number.isInteger(ver) || ver < 2) throw new Error('バージョンが不明です');
    if (ver > SCHEMA) throw new Error(`新しすぎるファイルです（v${ver}）。アプリを更新してください`);
    if (!obj.data || typeof obj.data !== 'object') throw new Error('data がありません');
    const known = await storeNames();
    const stores = {}; const counts = {}; const ignored = [];
    for (const [s, rows] of Object.entries(obj.data)) {
      if (!known.includes(s)) { ignored.push(s); continue; }
      if (!Array.isArray(rows)) throw new Error(`${s} が一覧になっていません`);
      const out = [];
      for (const raw of rows) {
        if (!raw || typeof raw !== 'object') throw new Error(`${s} に不正な行があります`);
        const r = decode(raw);
        if (s === 'meta') { if (!r.key || SKIP_META.includes(r.key)) continue; }
        else if (r.id == null) throw new Error(`${s} に id のない行があります`);
        out.push(r);
      }
      stores[s] = out; counts[s] = out.length;
    }
    const ls = {};
    if (obj.localStorage && typeof obj.localStorage === 'object') for (const k of LS_KEYS) if (typeof obj.localStorage[k] === 'string') ls[k] = obj.localStorage[k];
    return { version: ver, full: !!obj.full, stores, counts, ls, ignored, exportedAt: obj.exportedAt || '' };
  }

  const stamp = (r) => Date.parse(r.updatedAt || r.createdAt || 0) || Number(r.updatedAt || r.created || 0) || 0;

  /* mode: 'replace'（全部消してファイルの内容に）| 'merge'（無い物を足し、新しい物で更新） */
  async function applyFull(parsed, mode) {
    const db = await DB.openDB();
    const names = Array.from(db.objectStoreNames);
    // 統合のときは、先に今の行を読む（トランザクション内で await しないため）
    const current = {};
    if (mode === 'merge') for (const s of Object.keys(parsed.stores)) current[s] = new Map((await DB.getAll(s)).map((r) => [keyOf(s, r), r]));
    const keepPass = await DB.get('meta', 'inboxPass'); // 置き換えでもこの端末のパスフレーズは残す
    const res = { added: 0, updated: 0, skipped: 0, removed: 0 };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('中止されました'));
      try {
        if (mode === 'replace') {
          for (const s of names) tx.objectStore(s).clear();
          for (const [s, rows] of Object.entries(parsed.stores)) for (const r of rows) { tx.objectStore(s).put(r); res.added++; }
          if (keepPass) tx.objectStore('meta').put(keepPass);
        } else {
          for (const [s, rows] of Object.entries(parsed.stores)) {
            for (const r of rows) {
              const cur = current[s].get(keyOf(s, r));
              if (!cur) {
                if (BLOB_STORES.includes(s) && !(r.blob instanceof Blob)) { res.skipped++; continue; } // 画像なしの行は足さない
                tx.objectStore(s).put(r); res.added++;
              }
              else if (stamp(r) > stamp(cur)) {
                const next = Object.assign({}, cur, r);
                if (BLOB_STORES.includes(s) && !(r.blob instanceof Blob) && cur.blob) next.blob = cur.blob;
                tx.objectStore(s).put(next); res.updated++;
              } else res.skipped++;
            }
          }
        }
      } catch (e) { try { tx.abort(); } catch (_) {} reject(e); }
    });
    // localStorage（DB が成功してから）
    if (mode === 'replace') for (const k of LS_KEYS) { if (k in parsed.ls) localStorage.setItem(k, parsed.ls[k]); }
    else for (const [k, v] of Object.entries(parsed.ls)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    return res;
  }

  /* iPhone（ホーム画面版を含む）は共有シート（ファイルに保存/Drive）、それ以外はダウンロード。
     共有できなかったときは画面にダウンロードリンクと「共有」ボタンを出す（2回目のタップで確実に動く）。 */
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function triggerDownload(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  async function saveFile(blob, name, statusEl) {
    const url = URL.createObjectURL(blob);
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
    const canShare = file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] });
    const showFallback = () => {
      if (!statusEl) return;
      statusEl.innerHTML = '';
      const a = document.createElement('a'); a.href = url; a.download = name; a.textContent = '⬇ ' + name + ' を保存'; a.className = 'btn-secondary full file-label';
      statusEl.appendChild(a);
      if (canShare) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-primary full'; b.textContent = '📤 共有して保存（ファイル／Drive）'; b.onclick = () => navigator.share({ files: [file], title: name }).catch(() => {}); statusEl.appendChild(b); }
    };
    if (canShare && isIOS()) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') { showFallback(); return 'aborted'; } showFallback(); return 'fallback'; }
    }
    triggerDownload(url, name); showFallback();
    return 'download';
  }

  const LABELS = { photos: '写真', memos: 'メモ', reminders: 'リマインダー/TODO/期限', plans: '予定（大事/小さな用事）', sessions: 'タイマー記録', notebooks: 'ノート', nbpages: 'ノートのページ', habits: '習慣', habitlogs: '習慣の記録', collages: 'コラージュ', meta: '設定など' };
  const summary = (counts) => Object.entries(counts).map(([s, n]) => `${LABELS[s] || s}: ${n}`).join('\n');

  function init() {
    const $ = (id) => document.getElementById(id);
    const st = $('transfer-status');
    $('btn-export-all').addEventListener('click', async () => {
      st.textContent = '書き出し中…（写真が多いと時間がかかります）';
      try {
        const obj = await buildFullExport();
        const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
        st.textContent = '';
        const how = await saveFile(blob, fileName(), st);
        if (how !== 'aborted') { if (global.StorageGuard) StorageGuard.markExported(); }
        const mb = (blob.size / 1048576).toFixed(1);
        const p = document.createElement('p'); p.className = 'help-text'; p.textContent = `${fileName()}（${mb} MB）\n` + summary(obj.counts); p.style.whiteSpace = 'pre-line';
        st.prepend(p);
        App.toast(how === 'shared' ? '書き出しました' : how === 'aborted' ? '共有をキャンセルしました（下のボタンから保存できます）' : 'ダウンロードしました');
      } catch (e) { console.warn(e); st.textContent = '書き出し失敗: ' + e.message; }
    });
    $('import-all-input').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      let parsed;
      try { parsed = await parseFull(JSON.parse(await f.text())); }
      catch (err) { console.warn(err); App.toast('読み込めません: ' + err.message); st.textContent = '読み込み中止（今のデータはそのまま）: ' + err.message; return; }
      let mode = (document.querySelector('input[name="import-mode"]:checked') || {}).value === 'merge' ? 'merge' : 'replace';
      if (mode === 'replace' && !parsed.full) {
        // 従来の（写真なしもある）バックアップで置き換えると写真が消えるので、統合にする
        if (!confirm('これは「まるごと」ではない古い形式のバックアップです。写真を守るため「統合」で読み込みます。続けますか？')) { st.textContent = 'キャンセルしました（今のデータはそのまま）'; return; }
        mode = 'merge';
      }
      const msg = `「${f.name}」（v${parsed.version}${parsed.exportedAt ? '・' + new Date(parsed.exportedAt).toLocaleString('ja-JP') : ''}）\n\n${summary(parsed.counts)}\n\n` +
        (mode === 'replace' ? '⚠ 今この端末にあるデータを全部消して、ファイルの内容に置き換えます。よろしいですか？' : '今のデータは残したまま、ファイルの内容を足します（同じ項目は新しい方）。よろしいですか？');
      if (!confirm(msg)) { st.textContent = 'キャンセルしました（今のデータはそのまま）'; return; }
      try {
        const r = await applyFull(parsed, mode);
        st.textContent = mode === 'replace' ? `置き換え完了: ${r.added}件` : `統合完了: 追加${r.added} 更新${r.updated} スキップ${r.skipped}`;
        App.toast('読み込みました。画面を更新します');
        setTimeout(() => location.reload(), 1200);
      } catch (err) { console.warn(err); st.textContent = '読み込み失敗（今のデータはそのまま）: ' + err.message; }
    });
  }

  global.Transfer = { init, buildFullExport, parseFull, applyFull, saveFile, fileName, LS_KEYS, SCHEMA };
})(window);
