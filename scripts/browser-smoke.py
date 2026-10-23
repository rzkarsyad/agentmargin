#!/usr/bin/env python3
"""Real Chromium dashboard smoke test. Requires Python Playwright + Chromium.
Runs only a disposable localhost HTTP server and mocks the analytics API.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
ASSETS = json.loads(subprocess.check_output(['node','--experimental-strip-types','--input-type=module','-e',
    "import {loadFallbackDashboard} from './apps/api/src/dashboard-assets.ts'; console.log(JSON.stringify(loadFallbackDashboard()));"],cwd=ROOT,text=True))
INJECTION = '<img src=x onerror=alert(1)>'
URL='http://127.0.0.1:8787/dashboard'
MOCK={'periodStart':'2026-10-01T00:00:00Z','periodEnd':'2026-11-01T00:00:00Z',
      'customers':[{'customerId':INJECTION,'revenueMicros':'49000000',
      'knownAiCostMicros':'12000000','contributionMicros':'37000000',
      'marginBasisPoints':'7551','usageEvents':1,'unknownEvents':0}], 'truncated':True,
      'unknownModels':[{'model':'<svg/onload=alert(1)>','eventCount':4}],
      'unknownModelsTruncated':True}
try:
    with sync_playwright() as p:
        browser_path = os.environ.get('AGENTMARGIN_CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
        # Use Playwright-managed Chromium on CI when system Chromium is unavailable.
        browser = p.chromium.launch(headless=True, executable_path=browser_path, args=['--no-sandbox'])
        for width in [1280,390]:
            page=browser.new_page(viewport={'width':width,'height':850})
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))

            csp="default-src 'none'; script-src 'sha256-"+ASSETS['scriptHash']+"'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
            page.route(URL,lambda route:route.fulfill(status=200,body=ASSETS['html'],headers={'content-type':'text/html','content-security-policy':csp}))
            def analytics(route):
                assert route.request.headers.get('authorization','').startswith('Bearer am_')
                route.fulfill(status=200,json=MOCK)
            page.route('http://127.0.0.1:8787/v1/analytics?*',analytics)
            response=page.goto(URL,wait_until='load')
            assert response.headers['content-security-policy']==csp

            page.locator('#key').fill('am_'+'x'*40)
            page.locator('#load').click()
            page.wait_for_function("() => document.querySelector('#status').textContent.includes('Partial results')")
            assert page.locator('#rows tr').count()==1
            assert page.locator('#rows img').count()==0, 'Customer ID injected HTML'
            assert page.locator('#missing-panel').is_visible(), 'Missing model diagnostics not visible'
            assert page.locator('#missing-rows svg').count()==0, 'Model name injected SVG'
            assert '<svg/onload=alert(1)>' in page.locator('#missing-rows').inner_text()
            assert 'Top 20 models shown' in page.locator('#missing-note').inner_text()
            assert INJECTION in page.locator('#rows').inner_text()
            assert page.locator('#revenue').inner_text()=='$49.00'
            assert not errors, errors
            assert page.evaluate('document.documentElement.scrollWidth - window.innerWidth')<=1 or width==390
            print(f'PASS: Chromium dashboard {width}px, truncation, XSS-resistant text rendering, totals')
            page.close()
        browser.close()
finally:
    pass
