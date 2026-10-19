#!/usr/bin/env python3
"""E2E: storage persistence status, usage, export reminder banner (no data format change)."""
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOT = sys.argv[2] if len(sys.argv) > 2 else None

async def main():
    ok = True
    def check(name, cond, info=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{name}: {'OK' if cond else 'FAIL'} {info}")
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path="/usr/bin/google-chrome" if __import__("os").path.exists("/usr/bin/google-chrome") else None)
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True, locale="ja-JP", accept_downloads=True)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(BASE)
        await page.evaluate("localStorage.setItem('weekStart','1')")  # pre-existing pref must survive
        await page.reload(); await page.wait_for_timeout(800)
        check("banner_shown_never_exported", await page.is_visible("#backup-banner"))
        await page.click("#backup-banner-go"); await page.wait_for_timeout(500)
        check("banner_opens_settings", await page.is_visible("#btn-export"))
        st = await page.text_content("#persist-status")
        check("persist_status", st.startswith("データ保護："), st)
        us = await page.text_content("#storage-usage")
        check("usage_shown", "使用量" in us, us)
        if SHOT:
            await page.evaluate("document.getElementById('storage-block').scrollIntoView({block:'start'})")
            await page.wait_for_timeout(300)
            await page.screenshot(path=SHOT)
        async with page.expect_download() as d:
            await page.click("#btn-export")
        await d.value
        await page.wait_for_timeout(300)
        ts = await page.evaluate("localStorage.getItem('lastExportAt')")
        check("export_timestamp", ts and ts.isdigit(), ts)
        check("banner_hidden_after_export", not await page.is_visible("#backup-banner"))
        await page.evaluate("localStorage.setItem('lastExportAt', String(Date.now()-15*86400000))")
        await page.reload(); await page.wait_for_timeout(800)
        check("banner_shown_after_15d", await page.is_visible("#backup-banner"))
        await page.click("#backup-banner-close"); await page.reload(); await page.wait_for_timeout(800)
        check("banner_dismiss_snoozes", not await page.is_visible("#backup-banner"))
        check("existing_pref_kept", await page.evaluate("localStorage.getItem('weekStart')") == "1")
        check("db_version_current", await page.evaluate("new Promise(r=>{const q=indexedDB.open('lifelog-db');q.onsuccess=()=>{r(q.result.version);q.result.close()}})") == 6)
        check("no_page_errors", not errs, errs)
        await b.close()
    print("ALL OK" if ok else "FAILED"); return 0 if ok else 1
if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
