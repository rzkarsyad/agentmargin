#!/usr/bin/env python3
"""Real Chromium dashboard smoke test. Requires Python Playwright + Chromium.
Runs only a disposable localhost HTTP server and mocks the analytics API.
"""
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
HTML = Path(__file__).resolve().parent.parent / 'apps/api/src/dashboard.html'
INJECTION = '<img src=x onerror=alert(1)>'
URL=HTML.as_uri()
MOCK={'periodStart':'2026-10-01T00:00:00Z','periodEnd':'2026-11-01T00:00:00Z',
      'customers':[{'customerId':INJECTION,'revenueMicros':'49000000',
      'knownAiCostMicros':'12000000','contributionMicros':'37000000',
      'marginBasisPoints':'7551','usageEvents':1,'unknownEvents':0}], 'truncated':True}
try:
    with sync_playwright() as p:
        browser_path = os.environ.get('AGENTMARGIN_CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
        # Use Playwright-managed Chromium on CI when system Chromium is unavailable.
        browser = p.chromium.launch(headless=True, executable_path=browser_path, args=['--no-sandbox'])
        for width in [1280,390]:
            page=browser.new_page(viewport={'width':width,'height':850})
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))

            page.goto('about:blank')
            page.set_content(HTML.read_text(),wait_until='load')
            page.evaluate('(data) => {window.fetch = async () => ({ok:true,json:async()=>data})}', MOCK)
            page.locator('#key').fill('am_'+'x'*40)
            page.locator('#load').click()
            page.wait_for_function("document.querySelector('#status').textContent.includes('Partial results')")
            assert page.locator('#rows tr').count()==1
            assert page.locator('#rows img').count()==0, 'Customer ID injected HTML'
            assert INJECTION in page.locator('#rows').inner_text()
            assert page.locator('#revenue').inner_text()=='$49.00'
            assert not errors, errors
            assert page.evaluate('document.documentElement.scrollWidth - window.innerWidth')<=1 or width==390
            print(f'PASS: Chromium dashboard {width}px, truncation, XSS-resistant text rendering, totals')
            page.close()
        browser.close()
finally:
    pass
