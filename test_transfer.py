#!/usr/bin/env python3
"""E2E: 引っ越し用「データを書き出す／データを読み込む」(js/transfer.js).
全ストア＋写真Blob＋localStorage が往復で戻ること、壊れたファイル・他アプリのファイルで今のデータが壊れないこと、
置き換え（既定）／統合、iPhone では navigator.share に File が渡ること。
Usage: python3 test_transfer.py [BASE_URL] [SHOT_PATH]"""
import asyncio, json, re, sys, tempfile, os
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

SEED = r"""async () => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d');
  x.fillStyle = '#e11d48'; x.fillRect(0,0,64,48);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
  const now = new Date().toISOString();
  await DB.put('photos', {id:'p1', dateKey:'2026-10-19', blob, thumb: blob, takenAt: now, createdAt: now});
  await DB.put('memos', {id:'m1', dateKey:'2026-10-19', text:'メモ本文', createdAt: now});
  await DB.put('reminders', {id:'r1', title:'TODO1', when: new Date(Date.now()+30*86400000).toISOString(), done:false, createdAt: now});
  await DB.put('reminders', {id:'r2', title:'期限1', when: now, done:true, doneAt: now, createdAt: now, source:'inbox'});
  await DB.put('plans', {id:'pl1', title:'大事な予定', type:'big', start:'2026-10-20', end:'2026-10-22', createdAt: now});
  await DB.put('plans', {id:'pl2', title:'小さな用事', type:'small', start:'2026-10-21', createdAt: now});
  await DB.put('sessions', {id:'s1', start: Date.now()-1500000, end: Date.now(), kind:'work'});
  await DB.put('notebooks', {id:'nb1', title:'ノート', createdAt: now});
  await DB.put('nbpages', {id:'np1', nb:'nb1', blob, createdAt: now});
  await DB.put('habits', {id:'h1', name:'読書', emoji:'📚', target:5, order:1, badges:['b1'], createdAt: now});
  await DB.put('habitlogs', {id:'hl1', habit:'h1', date:'2026-10-19'});
  await DB.put('collages', {id:'c1', dateKey:'2026-10-19', blob, createdAt: now});
  await DB.setMeta('inboxUrl', 'https://example.com/inbox.json');
  await DB.setMeta('inboxPass', 'secret-pass');
  await DB.setMeta('inboxLastPull', now);
  await DB.setMeta('pomodoro', {work:30, brk:5});
  await DB.setMeta('multiTimers', [{id:'t1', label:'ラーメン'}]);
  localStorage.setItem('weekStart','1'); localStorage.setItem('gtTab','big'); localStorage.setItem('thumbOverlay','0');
  localStorage.setItem('otherApp.key','keep');
}"""

SNAP = r"""async () => {
  const db = await DB.openDB(); const out = {};
  for (const s of Array.from(db.objectStoreNames)) {
    const rows = await DB.getAll(s);
    out[s] = await Promise.all(rows.map(async r => { const o = {...r};
      for (const k in o) if (o[k] instanceof Blob) o[k] = 'blob:' + o[k].size + ':' + o[k].type;
      return o; }));
    out[s].sort((a,b) => String(a.id||a.key).localeCompare(String(b.id||b.key)));
  }
  out.ls = {weekStart: localStorage.getItem('weekStart'), gtTab: localStorage.getItem('gtTab'), thumbOverlay: localStorage.getItem('thumbOverlay')};
  return out;
}"""

WIPE = r"""async () => { const db = await DB.openDB(); for (const s of Array.from(db.objectStoreNames)) for (const r of await DB.getAll(s)) await DB.del(s, s==='meta'?r.key:r.id);
  await DB.put('memos', {id:'new-phone', dateKey:'2026-10-25', text:'新しい端末のメモ', createdAt: new Date().toISOString()});
  localStorage.removeItem('weekStart'); localStorage.removeItem('gtTab'); localStorage.removeItem('thumbOverlay'); }"""

async def main():
    ok = True
    def check(name, cond, info=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{name}: {'OK' if cond else 'FAIL'} {info}")
    tmp = tempfile.mkdtemp()
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome") if os.path.exists(os.environ.get("CHROME", "/usr/bin/google-chrome")) else None)
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="ja-JP", accept_downloads=True)
        page = await ctx.new_page(); errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(BASE); await page.wait_for_timeout(600)
        await page.evaluate(SEED)
        before = await page.evaluate(SNAP)
        await page.click("#btn-settings"); await page.wait_for_timeout(300)
        check("buttons_visible", await page.is_visible("#btn-export-all") and "データを読み込む" in await page.inner_text("#transfer-block"))
        if SHOT:
            await page.evaluate("document.getElementById('transfer-block').scrollIntoView({block:'center'})"); await page.wait_for_timeout(300)
            await page.screenshot(path=SHOT)
        async with page.expect_download() as d:
            await page.click("#btn-export-all")
        dl = await d.value
        name = dl.suggested_filename
        check("filename_app_version_date", re.fullmatch(r"lifelog-all-v3-\d{4}-\d{2}-\d{2}\.json", name), name)
        path = os.path.join(tmp, name); await dl.save_as(path)
        data = json.load(open(path))
        check("header", data["app"] == "lifelog" and data["version"] == 3 and data["full"] is True)
        need = ["photos","memos","reminders","plans","sessions","notebooks","nbpages","habits","habitlogs","collages","meta"]
        check("all_stores_present", all(len(data["data"].get(s, [])) >= 1 for s in need), {s: len(data["data"].get(s, [])) for s in need})
        check("photo_base64", data["data"]["photos"][0]["blob"]["__blob"].startswith("data:image/jpeg;base64,"))
        check("no_inbox_pass", not any(m["key"] == "inboxPass" for m in data["data"]["meta"]))
        check("localstorage_exported", data["localStorage"].get("weekStart") == "1" and data["localStorage"].get("gtTab") == "big" and "otherApp.key" not in data["localStorage"])
        check("last_export_marked", (await page.evaluate("localStorage.getItem('lastExportAt')") or "").isdigit())

        # bad files: other app, future version, broken JSON, broken blob -> nothing changes
        bad = {"other_app.json": json.dumps({"app": "word-cards", "version": 3, "data": {}}),
               "future.json": json.dumps({**data, "version": 99}),
               "broken.json": json.dumps(data)[:5000],
               "badblob.json": json.dumps({**data, "data": {**data["data"], "photos": [{"id": "p9", "blob": {"__blob": "nope"}}]}})}
        dialogs = []
        page.on("dialog", lambda dlg: (dialogs.append(dlg.message), asyncio.ensure_future(dlg.accept())))
        for fn, txt in bad.items():
            fp = os.path.join(tmp, fn); open(fp, "w").write(txt)
            n0 = len(dialogs)
            await page.set_input_files("#import-all-input", fp); await page.wait_for_timeout(500)
            st = await page.inner_text("#transfer-status")
            same = (await page.evaluate(SNAP)) == before
            check(f"bad_file_rejected_{fn}", same and "中止" in st and len(dialogs) == n0, st[:60])

        # wipe -> import replace (default) -> identical
        await page.evaluate(WIPE)
        await page.set_input_files("#import-all-input", path)
        await page.wait_for_timeout(2500)  # reload after import
        check("confirm_shown_replace", dialogs and "置き換え" in dialogs[-1], dialogs[-1][:40] if dialogs else "")
        after = await page.evaluate(SNAP)
        before_np = {k: v for k, v in before.items() if k != "meta"}
        after_np = {k: v for k, v in after.items() if k != "meta"}
        check("replace_restores_everything", after_np == before_np, [(k, before_np.get(k), after_np.get(k)) for k in set(before_np)|set(after_np) if before_np.get(k)!=after_np.get(k)])
        bm = {m["key"]: m for m in before["meta"] if m["key"] not in ("inboxPass",)}
        am = {m["key"]: m for m in after["meta"]}
        check("meta_restored", all(am.get(k) == v for k, v in bm.items()), [k for k, v in bm.items() if am.get(k) != v])
        check("new_phone_memo_replaced", not any(m["id"] == "new-phone" for m in after["memos"]))

        # merge mode keeps local-only data
        await page.evaluate("DB.put('memos', {id:'local-only', dateKey:'2026-10-26', text:'x', createdAt: new Date().toISOString()})")
        await page.click("#btn-settings"); await page.wait_for_timeout(300)
        await page.check("input[name=import-mode][value=merge]")
        await page.set_input_files("#import-all-input", path); await page.wait_for_timeout(2500)
        mem = await page.evaluate("DB.getAll('memos').then(r=>r.map(x=>x.id).sort())")
        check("merge_keeps_local", mem == ["local-only", "m1"], mem)
        check("other_app_ls_untouched", await page.evaluate("localStorage.getItem('otherApp.key')") == "keep")
        check("no_page_errors", not errs, errs)
        await ctx.close()

        # iPhone: navigator.share gets a File
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, locale="ja-JP", user_agent=IOS_UA)
        page = await ctx.new_page()
        await page.add_init_script("navigator.canShare = (d) => !!(d && d.files); navigator.share = async (d) => { window.__shared = {name: d.files[0].name, size: d.files[0].size, type: d.files[0].type}; };")
        await page.goto(BASE); await page.wait_for_timeout(600)
        await page.evaluate(SEED)
        await page.click("#btn-settings"); await page.wait_for_timeout(300)
        await page.click("#btn-export-all"); await page.wait_for_timeout(1500)
        sh = await page.evaluate("window.__shared")
        check("ios_share_file", sh and re.fullmatch(r"lifelog-all-v3-\d{4}-\d{2}-\d{2}\.json", sh["name"]) and sh["size"] > 1000, sh)
        await b.close()
    print("ALL OK" if ok else "FAILED"); return 0 if ok else 1
if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
