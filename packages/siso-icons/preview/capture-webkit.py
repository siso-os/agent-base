#!/usr/bin/env python3
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

url, output_dir = sys.argv[1:3]
out = Path(output_dir)
out.mkdir(parents=True, exist_ok=True)
page_errors = []
samples = ("briefcase-business", "chess-king", "stethoscope")

with sync_playwright() as playwright:
    browser = playwright.webkit.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1, reduced_motion="no-preference")
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    response = page.goto(url, wait_until="networkidle")
    if response is None or not response.ok:
        raise RuntimeError(f"preview returned {response.status if response else 'no response'}")
    page.wait_for_selector("[data-icon]")
    expected = int(page.locator("main").get_attribute("data-icon-count") or "0")
    actual = page.locator("[data-icon]").count()
    if expected != actual or actual != 55:
        raise AssertionError(f"expected all 55 ICON-MAP names; rendered {actual} of {expected}")
    for name in samples:
        row = page.locator(f'[data-icon="{name}"]')
        row.scroll_into_view_if_needed()
        row.hover()
        page.wait_for_timeout(320)
        path = out / f"{name}-hover-webkit.png"
        page.screenshot(path=str(path))
        print(f"WebKit hover screenshot: {path}")
        page.mouse.move(1435, 20)
    if page_errors:
        raise AssertionError("page errors: " + "; ".join(page_errors))
    print(f"WebKit rendered all {actual} icons; invalid name rejected by preview assertion")
    browser.close()
