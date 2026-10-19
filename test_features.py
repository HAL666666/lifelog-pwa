#!/usr/bin/env python3
"""E2E for items 11-18 + thumbnail overlay: DB v6 migration, calendar markers/legend, collage + daily prompt,
habit recent strip / dimming, habit Gantt, badges, naming, inbox habit (via scripts/make-inbox.py), overlay toggle.
Usage: python3 test_features.py [BASE_URL] [SHOT_DIR]"""
import asyncio, json, os, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOT = Path(sys.argv[2] if len(sys.argv) > 2 else "/workspace/lifelog-pwa-screens")
SHOT.mkdir(parents=True, exist_ok=True)
ROOT = Path(__file__).resolve().parent
LOCAL = BASE.startswith("http://127.0.0.1")

SEED = r"""async () => {
  const pad = n => String(n).padStart(2,'0');
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const day = n => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return d; };
  const colors = ['#f97316','#22c55e','#3b82f6','#a855f7','#ec4899','#14b8a6','#eab308','#ef4444','#6366f1','#84cc16'];
  async function img(i, w, h, label) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(0,0,w,h); g.addColorStop(0, colors[i%10]); g.addColorStop(1, colors[(i+3)%10]);
    x.fillStyle = g; x.fillRect(0,0,w,h);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(w*.5, h*.45, Math.min(w,h)*.22, 0, 7); x.fill();
    x.fillStyle = '#0f172a'; x.font = `bold ${Math.round(Math.min(w,h)*.16)}px sans-serif`; x.textAlign='center'; x.fillText(label, w*.5, h*.5);
    return new Promise(r => c.toBlob(r, 'image/jpeg', .85));
  }
  const y = day(-1);
  for (let i = 0; i < 4; i++) {
    const t = new Date(y); t.setHours(9+i*2, 15);
    await DB.put('photos', { id:'tp-y'+i, dateKey: dk(y), takenAt: t.toISOString(), createdAt: t.toISOString(), mime:'image/jpeg',
      blob: await img(i, i%2 ? 900 : 1200, i%2 ? 1200 : 900, '写真'+(i+1)), thumb: await img(i, 200, 200, String(i+1)) });
  }
  for (const n of [-3, -6]) { const d = day(n); await DB.put('photos', { id:'tp'+n, dateKey: dk(d), takenAt: d.toISOString(), createdAt: d.toISOString(), mime:'image/jpeg', blob: await img(-n, 800, 600, 'P'), thumb: await img(-n, 200, 200, 'P') }); }
  await DB.put('memos', { id:'tm1', dateKey: dk(day(-1)), text:'公園', createdAt: new Date().toISOString() });
  await DB.put('memos', { id:'tm2', dateKey: dk(day(-4)), text:'読書メモ', createdAt: new Date().toISOString() });
  await DB.put('reminders', { id:'tr1', title:'歯医者', when: day(2).toISOString(), done:false, notified:false, createdAt: new Date().toISOString() });
  await DB.put('reminders', { id:'tr2', title:'レポート', when: day(-2).toISOString(), done:true, doneAt: day(-2).toISOString(), notified:true, createdAt: new Date().toISOString() });
  const born = day(-20).toISOString();
  await DB.put('habits', { id:'th1', name:'水を飲む', emoji:'💧', order:0, badges:[], createdAt: born, updatedAt: born });
  await DB.put('habits', { id:'th2', name:'英単語', emoji:'📖', order:1, badges:[], createdAt: born, updatedAt: born });
  for (let n = -20; n <= -1; n++) {
    const k = dk(day(n));
    if (n !== -5 && n !== -12) await DB.put('habitlogs', { id:'th1|'+k, habit:'th1', date:k, at: day(n).toISOString() });
    if (n % 3 !== 0) await DB.put('habitlogs', { id:'th2|'+k, habit:'th2', date:k, at: day(n).toISOString() });
  }
  await DB.put('sessions', { id:'ts1', start: +day(-1), end: +day(-1)+25*60000, label:'英語', workMs: 25*60000, breakMs: 0 });
  await DB.put('notebooks', { id:'tnb', name:'英文法', created: +day(-8) });
  for (let i = 0; i < 3; i++) await DB.put('nbpages', { id:'tpg'+i, nb:'tnb', order:i, blob: await img(i+4, 600, 800, 'p'+i), thumb: await img(i+4, 160, 200, 'p'+i), w:600, h:800, ink: i ? [] : [{c:'#ef4444',w:4,pts:[[.1,.1],[.5,.5]]}], created: +day(-1) });
  return dk(day(-1));
}"""

async def main():
    res = []
    def check(name, ok, info=""):
        res.append((name, bool(ok), info)); print(f"{name}: {'OK' if ok else 'FAIL'} {info}")
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True,
                                  has_touch=True, locale="ja-JP", accept_downloads=True, service_workers="block")
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" and "favicon" not in m.text.lower() and "status of 404" not in m.text else None)

        # --- migration v5 -> v6 (all v5 stores with data) ---
        await page.goto(BASE + "test-fixtures/", wait_until="commit")
        await page.evaluate("""() => new Promise((res, rej) => { const r = indexedDB.open('lifelog-db', 5);
          r.onupgradeneeded = e => { const db = e.target.result;
            const mk = (n, idx) => { const s = db.createObjectStore(n, {keyPath: n === 'meta' ? 'key' : 'id'}); (idx||[]).forEach(([a,b]) => s.createIndex(a, b)); };
            mk('photos', [['byDate','dateKey']]); mk('memos', [['byDate','dateKey']]); mk('reminders', [['byWhen','when']]); mk('meta');
            mk('sessions', [['byStart','start']]); mk('plans', [['byStart','start']]); mk('notebooks'); mk('nbpages', [['byNb','nb']]);
            mk('habits'); mk('habitlogs', [['byHabit','habit'], ['byDate','date']]); };
          r.onsuccess = () => { const db = r.result; const tx = db.transaction(['memos','habits','habitlogs','meta'],'readwrite');
            tx.objectStore('memos').put({id:'v5m', dateKey:'2026-01-01', text:'v5メモ'});
            tx.objectStore('habits').put({id:'v5h', name:'v5習慣', order:5, badges:[3]});
            tx.objectStore('habitlogs').put({id:'v5h|2026-01-01', habit:'v5h', date:'2026-01-01'});
            tx.objectStore('meta').put({key:'inboxUrl', value:'https://example.invalid/x'});
            tx.oncomplete = () => { db.close(); res(); }; }; r.onerror = rej; })""")
        await page.evaluate("localStorage.setItem('weekStart','1'); localStorage.setItem('lastExportAt', String(Date.now()))")
        await page.goto(BASE, wait_until="networkidle")
        mig = await page.evaluate("""async () => { const db = await DB.openDB(); return [db.version, [...db.objectStoreNames].includes('collages'),
          (await DB.get('memos','v5m')||{}).text, (await DB.get('habits','v5h')||{}).name, !!(await DB.get('habitlogs','v5h|2026-01-01')),
          await DB.getMeta('inboxUrl',''), localStorage.getItem('weekStart')]; }""")
        check("db_migration_v5_v6", mig == [6, True, 'v5メモ', 'v5習慣', True, 'https://example.invalid/x', '1'], mig)
        await page.evaluate("async () => { await DB.del('habits','v5h'); await DB.del('habitlogs','v5h|2026-01-01'); await DB.del('memos','v5m'); }")

        ykey = await page.evaluate(SEED)
        # --- daily collage prompt ---
        await page.evaluate("localStorage.removeItem('collagePromptDay')")
        await page.reload(wait_until="networkidle"); await page.wait_for_timeout(600)
        vis = await page.is_visible("#collage-banner")
        txt = await page.text_content("#collage-banner-go")
        check("collage_prompt_shown", vis and "昨日のコラージュを作る？" in txt, txt)
        await page.screenshot(path=str(SHOT / "collage-prompt.png"))
        await page.reload(wait_until="networkidle"); await page.wait_for_timeout(400)
        check("collage_prompt_once_per_day", not await page.is_visible("#collage-banner"))

        # --- calendar markers + legend (month) ---
        await page.evaluate("App.showView('calendar')"); await page.wait_for_timeout(300)
        cell = f'.cal-cell[data-date="{ykey}"] .cal-markers'
        kinds = await page.evaluate(f"""() => {{ const all = {{}}; document.querySelectorAll('.cal-cell[data-date]').forEach(c => {{
            c.querySelectorAll('.mk').forEach(m => {{ const k = [...m.classList].filter(x => x !== 'mk').join('.'); all[k] = (all[k]||0)+1; }}); }}); return all; }}""")
        ymk = await page.evaluate(f"() => [...document.querySelectorAll('{cell} .mk')].map(m => m.className)")
        need = ['mk-photo', 'mk-memo', 'mk-rem', 'mk-habit', 'mk-habit.part', 'mk-todo']
        # some kinds may fall in previous month near month start; accept if seeded day is in this month
        in_month = await page.evaluate("() => { const d=new Date(); return d.getDate() > 7 && d.getDate() < 26; }")
        check("calendar_marker_types", (not in_month) or all(k in kinds for k in need), kinds)
        check("calendar_marker_yesterday", 'mk mk-photo' in ymk and 'mk mk-memo' in ymk, ymk)
        shapes = await page.evaluate("""() => ['mk-photo','mk-memo','mk-rem','mk-habit','mk-todo'].map(c => { const e=document.querySelector('#cal-legend .'+c); const s=getComputedStyle(e); return [c, s.backgroundColor, s.borderRadius, s.clipPath !== 'none']; })""")
        cols = [s[1] for s in shapes]
        check("marker_distinct_shape_color", len(set(cols)) == 5 and shapes[0][2] == '50%' and shapes[2][3] and shapes[3][3] and shapes[4][3], shapes)
        leg = await page.text_content("#cal-legend")
        check("legend", all(w in leg for w in ['写真', 'メモ', 'リマインダー', '習慣達成', 'やること完了']), leg)
        await page.screenshot(path=str(SHOT / "calendar-markers.png"))
        await page.click('#cal-modes button[data-mode="3"]'); await page.wait_for_timeout(400)
        mini = await page.locator(".mini-mk .mk").count()
        check("mini_view_markers", mini >= 5, mini)
        await page.screenshot(path=str(SHOT / "calendar-3m.png"))
        await page.click('#cal-modes button[data-mode="month"]')

        # --- naming: no 日課 in UI ---
        body = await page.evaluate("document.body.innerText + document.documentElement.innerHTML")
        check("naming_no_nikka", "日課" not in body)

        # --- day view overlay + collage ---
        await page.evaluate(f"App.openDay('{ykey}')"); await page.wait_for_timeout(500)
        dates = await page.locator("#day-photos .tt-date").all_text_contents()
        exp = await page.evaluate(f"Thumbs.fmtDate('{ykey}')")
        import re
        check("overlay_day_photos", len(dates) == 4 and dates[0] == exp and re.match(r"^\d{1,2}/\d{1,2}（[日月火水木金土]）$", exp), (dates[:1], exp))
        await page.screenshot(path=str(SHOT / "day-overlay.png"))
        await page.click("#day-collage-btn"); await page.wait_for_timeout(500)
        nchk = await page.locator("#cl-pick input:checked").count()
        check("collage_prechecked", nchk == 4, nchk)
        await page.click("#cl-pick .cl-item >> nth=3"); await page.fill("#cl-title", "公園の日")
        await page.screenshot(path=str(SHOT / "collage-pick.png"))
        await page.click("#cl-make")
        await page.wait_for_selector("#cl-pane-result:not([hidden])", timeout=15000)
        rec = await page.evaluate("async () => { const a = await DB.getAll('collages'); return a.map(r => [r.dateKey, r.count, r.title, r.blob.size > 20000, r.w, r.h, r.photoIds.length]); }")
        check("collage_saved", rec == [[ykey, 3, '公園の日', True, 1600, 1600, 3]], rec)
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(SHOT / "collage-result.png"))
        async with page.expect_download() as d:
            await page.click("#cl-download")
        dl = await d.value
        check("collage_download", dl.suggested_filename == f"collage-{ykey}.jpg", dl.suggested_filename)
        await page.click("#cl-close"); await page.wait_for_timeout(400)
        check("collage_in_day_view", await page.locator("#day-collages .cl-thumb").count() == 1)
        # layout sanity for 1..9 (+ cap)
        lay = await page.evaluate("() => [1,2,3,4,5,6,7,8,9,12].map(n => { const c = Collage.layout(n); return [c.length, c.every(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1600.01 && b.y + b.h <= 1600.01 && b.w > 100)]; })")
        check("collage_layouts", [l[0] for l in lay] == [1,2,3,4,5,6,7,8,9,9] and all(l[1] for l in lay), lay)
        # prompt suppressed now that yesterday has a collage
        await page.evaluate("localStorage.removeItem('collagePromptDay')")
        shown = await page.evaluate("Collage.checkPrompt()")
        check("collage_prompt_skips_done_day", shown is False)

        # --- notebook covers + collage gallery ---
        await page.evaluate("App.showView('notebook')"); await page.wait_for_timeout(600)
        cov = await page.text_content(".nb-cover .tt-title")
        gal = await page.locator("#cl-gallery .cl-thumb").count()
        check("overlay_nb_cover", cov == "英文法 · 3枚", cov)
        check("collage_gallery", gal == 1, gal)
        await page.screenshot(path=str(SHOT / "notebook-covers.png"))
        # toggle off
        await page.evaluate("App.showView('settings')")
        await page.uncheck("#thumb-overlay")
        await page.evaluate("App.showView('notebook')"); await page.wait_for_timeout(400)
        off = await page.is_visible(".nb-cover .tt-cap")
        meta = await page.is_visible(".nb-meta")
        check("overlay_toggle_off", not off and meta and await page.evaluate("localStorage.getItem('thumbOverlay')") == '0')
        await page.screenshot(path=str(SHOT / "notebook-overlay-off.png"))
        await page.evaluate("App.showView('settings')"); await page.check("#thumb-overlay")
        await page.evaluate("document.getElementById('thumb-overlay').closest('.settings-block').scrollIntoView({block:'start'})")
        await page.screenshot(path=str(SHOT / "settings-overlay.png"))

        # --- habits: recent strip, dimming ---
        await page.evaluate("App.showView('habits')"); await page.wait_for_timeout(600)
        nall = await page.locator(".hr-day.all").count(); nmiss = await page.locator(".hr-day.miss").count()
        op = await page.evaluate("[getComputedStyle(document.querySelector('.hr-day.all')).opacity, getComputedStyle(document.querySelector('.hr-day.miss')).opacity]")
        check("habit_recent_dim", nall >= 5 and nmiss >= 3 and float(op[0]) < 0.5 and float(op[1]) == 1, (nall, nmiss, op))
        hd = await page.locator(".heat span.on.all").count(); hm = await page.locator(".heat span.miss").count()
        check("habit_heat_dim", hd > 0 and hm > 0, (hd, hm))
        await page.screenshot(path=str(SHOT / "habits-recent.png"))
        # badges
        await page.click("#habit-badges"); await page.wait_for_timeout(500)
        nb = await page.locator("#badge-grid .ach").count(); ng = await page.locator("#badge-grid .ach.got").count()
        locked_hint = await page.locator("#badge-grid .ach:not(.got) small").first.text_content()
        prog = await page.locator("#badge-grid .ach:not(.got) em").count()
        got_names = await page.locator("#badge-grid .ach.got b").all_text_contents()
        check("badges_count", nb >= 34, nb)
        check("badges_locked_hint", locked_hint.startswith("🔒") and prog >= 5, (locked_hint, prog))
        check("badges_multi", all(n in got_names for n in ['三冠の日', 'ノート開設', '文武両道', 'オールラウンダー', '初コラージュ']), got_names)
        await page.evaluate("document.getElementById('badge-panel').scrollIntoView({block:'start'})")
        await page.screenshot(path=str(SHOT / "badges.png"))
        # habit gantt
        await page.click("#habit-gantt"); await page.wait_for_timeout(600)
        rows = await page.locator(".gt-hrow").count(); segs = await page.locator(".gt-hseg").count()
        dim = await page.locator(".gt-hseg.all").count(); miss = await page.locator(".gt-hmiss").count()
        check("habit_gantt", rows == 2 and segs >= 4 and dim >= 1 and miss >= 3, (rows, segs, dim, miss))
        await page.click('#gt-ranges button[data-r="1"]'); await page.wait_for_timeout(300)
        await page.screenshot(path=str(SHOT / "habit-gantt.png"))
        for r in ("3", "6"):
            await page.click(f'#gt-ranges button[data-r="{r}"]'); await page.wait_for_timeout(200)
            check(f"habit_gantt_{r}m", await page.locator(".gt-hrow").count() == 2)
        await page.click('#gt-tabs button[data-t="all"]'); await page.click('#gt-ranges button[data-r="3"]')

        # --- inbox habit via make-inbox.py (local only: needs a file served from this repo) ---
        if LOCAL:
            items = [{"id": "h-stretch", "kind": "habit", "name": "ストレッチ", "emoji": "🧘", "target": 5},
                     {"id": "t-1", "kind": "todo", "title": "提出", "when": "2026-10-30T17:00:00+09:00"}]
            out = subprocess.run([sys.executable, str(ROOT / "scripts/make-inbox.py"), "-"], input=json.dumps(items).encode(),
                                 env={**os.environ, "LIFELOG_INBOX_PASS": "feat-pass"}, capture_output=True, check=True).stdout
            f = ROOT / "test-fixtures/inbox-habit.tmp.json"; f.write_bytes(out)
            try:
                await page.evaluate("App.showView('settings')")
                await page.fill("#inbox-url", BASE + "test-fixtures/inbox-habit.tmp.json"); await page.fill("#inbox-pass", "feat-pass")
                for _ in range(2):
                    await page.click("#btn-inbox-pull")
                    await page.wait_for_function("document.getElementById('inbox-status').textContent.startsWith('取得完了')", timeout=10000)
                    await page.evaluate("document.getElementById('inbox-status').textContent=''")
                await page.evaluate("App.showView('habits')"); await page.wait_for_timeout(400)
                names = await page.locator(".habit-name").all_text_contents()
                n = await page.evaluate("async () => (await DB.getAll('habits')).filter(h => h.id === 'inbox-h-stretch').length")
                check("inbox_habit_script", any("ストレッチ" in x for x in names) and n == 1, names)
            finally:
                f.unlink(missing_ok=True)
            await page.evaluate("App.showView('settings')")
            doc = await page.text_content("#view-settings")
            check("inbox_kinds_documented", "習慣（習慣タブに追加）" in doc)

        # --- backup includes collages ---
        exp = await page.evaluate("async () => { const e = await Backup.buildExport(true); return [e.data.collages.length, !!(e.data.collages[0]||{}).blob]; }")
        check("backup_includes_collages", exp == [1, True], exp)
        check("no_page_errors", not errs, errs[:3])
        await b.close()
    bad = [r for r in res if not r[1]]
    print("ALL OK" if not bad else f"FAILED: {[r[0] for r in bad]}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
