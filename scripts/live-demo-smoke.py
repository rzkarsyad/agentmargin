#!/usr/bin/env python3
"""Full localhost demo E2E: Docker PostgreSQL + live API + SDK + real Chromium.

Use ONLY in a disposable development/CI environment. The generated demo API
key is consumed in memory and never printed or saved by this smoke test.
"""
import os
import json
import re
import signal
import socket
import uuid
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
BASE = "http://127.0.0.1:8787"
RUN_ENV = {}
KEY_PATTERN = re.compile(r"Demo API key \(visible once; keep local\): (am_[A-Za-z0-9_-]{32,})")


def fetch(path: str, key: str | None = None):
    headers = {"Authorization": "Bearer " + key} if key else {}
    return urllib.request.urlopen(
        urllib.request.Request(BASE + path, headers=headers), timeout=3
    )


def live_browser(browser, key: str, width: int, customer_count: int, unknown_count: int):
    page = browser.new_page(viewport={"width": width, "height": 850})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        response = page.goto(BASE + "/dashboard", wait_until="domcontentloaded")
        assert response and response.status == 200, "Dashboard HTTP response was not 200"
        assert "script-src 'self'" in response.headers.get("content-security-policy", "")
        page.wait_for_selector(".topline", timeout=15_000)
        assert page.evaluate("document.documentElement.dataset.theme") == "dark", "App is not in permanent dark mode"
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        assert bg == "rgb(16, 17, 19)", f"Expected neutral graphite background, got {bg}"
        assert not page.locator(".hero, .heroArtwork").count(), "Marketing hero must not be rendered"
        assert page.locator(".distributionPanel").count() == 1, "Customer data chart missing"
        assert page.locator(".metrics .metric").count() == 4, "Expected four compact KPIs"
        font = page.evaluate("getComputedStyle(document.querySelector('.topline')).fontFamily")
        assert "Inter" in font and "serif" not in font.split(",")[0].lower(), font
        page.locator("#key").fill(key)
        page.locator("#load").click()
        page.wait_for_function(
            "(expected) => document.querySelector('#count').textContent === expected",
            arg=f"{customer_count} customers",
            timeout=20_000,
        )
        assert page.locator("#rows tr").count() == customer_count
        assert page.locator(".queryBar").is_hidden(), "Connection controls should collapse after loading"
        page.get_by_role("button", name="Change workspace connection").click()
        assert page.locator("#key").is_visible(), "Topbar must reopen connection controls"
        page.get_by_role("button", name="Change workspace connection").click()
        assert page.locator(".queryBar").is_hidden(), "Topbar must collapse connection controls"
        assert page.locator(".uiIcon").count() >= 6, "Product navigation should use the outlined icon system"
        assert page.locator(".barUnverified").count() == unknown_count, "Unknown cost must be explicit in chart"
        assert page.locator(".chartCustomer").count() == customer_count, "Only real customer categories allowed"
        assert page.locator(".unverifiedBar").count() == unknown_count, "Unverified cost bars must be explicit"
        assert page.locator(".costIncomplete").count() == unknown_count, "Unknown cost must not read as verified $0"
        if width == 390:
            excess = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert excess <= 1, f"Mobile layout overflows viewport by {excess}px"
        assert page.locator("#revenue").inner_text() == ("$97.00" if customer_count == 3 else "$126.00")
        assert page.locator("#cost").inner_text() == "$35.00"
        assert page.locator("#unknown").inner_text() == str(unknown_count)
        assert "Partial" in page.locator("#contribution").inner_text()
        assert page.locator("#missing-panel").is_visible()
        assert page.locator("#missing-rows tr").count() == 1
        assert "example-model" in page.locator("#missing-rows").inner_text()
        assert str(unknown_count) in page.locator("#missing-rows").inner_text()
        assert page.locator("#rows img, #missing-rows svg").count() == 0
        assert page.evaluate("localStorage.length + sessionStorage.length") == 0
        page.get_by_role("button", name="Unknown", exact=True).click()
        assert page.locator("#rows tr").count() == unknown_count, "Arc status filter did not narrow results"
        page.get_by_role("button", name="All", exact=True).click()
        assert page.locator("#rows tr").count() == customer_count
        assert not errors, f"Browser script errors: {errors}"
        if customer_count == 4:
            # Demo-only screenshot. Clear the masked key from the DOM without
            # firing React onChange, so no credential appears in the PNG.
            page.locator("#key").evaluate("(el) => { el.value = ''; }")
            # Clicking the filter scrolls the browser to the table. Reset before
            # a full-page screenshot or Chromium relocates the sticky sidebar.
            page.evaluate("window.scrollTo({ top: 0, left: 0, behavior: 'instant' })")
            page.wait_for_function("window.scrollY === 0")
            out = ROOT / "ci-artifacts"
            out.mkdir(exist_ok=True)
            page.screenshot(path=str(out / f"arc-overview-{width}px.png"), full_page=True)
        print(f"PASS: live Chromium {width}px, {customer_count} customers, {unknown_count} unknown-cost customers")
    finally:
        page.close()


def live_pricing_browser(browser, key: str):
    """Exercise genuine Arc Input/Button price form against the real authenticated API."""
    page = browser.new_page(viewport={"width": 1280, "height": 850})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(BASE + "/dashboard", wait_until="domcontentloaded")
        page.get_by_role("navigation", name="Sections").get_by_role("button", name="Model pricing", exact=True).click()
        page.locator("#key").fill(key)
        page.get_by_role("button", name="Refresh prices").click()
        page.get_by_text("No workspace price versions yet. Add one above.").wait_for(timeout=15_000)

        page.get_by_label("Provider model identifier").fill("arc-smoke-model")
        page.get_by_label("Input $ / 1M tokens").fill("1.25")
        page.get_by_label("Output $ / 1M tokens").fill("4")
        page.get_by_label("Source / verification note").fill("Synthetic pricing UI smoke check")
        page.get_by_role("button", name="Add immutable price").click()

        page.get_by_role("status").get_by_text("Price version added", exact=False).wait_for(timeout=15_000)
        assert page.get_by_role("row", name="arc-smoke-model", exact=False).count() == 1
        assert "$1.25" in page.locator("table").inner_text()
        assert "$4" in page.locator("table").inner_text()
        page.locator("#key").evaluate("(el) => { el.value = ''; }")
        out = ROOT / "ci-artifacts"
        out.mkdir(exist_ok=True)
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(out / "arc-pricing-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 850})
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(out / "arc-pricing-mobile.png"), full_page=True)

        # A negative rate is rejected client-side; the old row remains immutable.
        page.get_by_label("Provider model identifier").fill("arc-invalid-price")
        page.get_by_label("Input $ / 1M tokens").fill("-1")
        page.get_by_label("Output $ / 1M tokens").fill("4")
        page.get_by_label("Source / verification note").fill("Synthetic invalid rate test")
        page.get_by_role("button", name="Add immutable price").click()
        page.get_by_role("alert").get_by_text("Enter a USD amount", exact=False).wait_for(timeout=10_000)
        assert page.get_by_role("row", name="arc-smoke-model", exact=False).count() == 1
        assert not errors, errors
        print("PASS: live Arc UI pricing form, authenticated persistence, history, validation")
    finally:
        page.close()


def live_adjustment_browser(browser, key: str):
    """A real prior-period payment/refund must remain negative in the current UI."""
    code = """
import {AgentMarginClient} from './packages/sdk/src/index.ts';
const client=new AgentMarginClient({endpoint:process.env.AGENTMARGIN_ENDPOINT,apiKey:process.env.AGENTMARGIN_API_KEY});
const now=new Date(),old=new Date(now.getTime()-400*86400000);
await client.trackRevenue([{id:'prior-period-demo',customerId:'refund-period-demo',occurredAt:old.toISOString(),amountMicros:'500000'}]);
await client.trackAdjustments([{originalPaymentId:'prior-period-demo',customerId:'refund-period-demo',kind:'refund',amountMicros:'80000',currency:'USD',
occurredAt:now.toISOString(),provider:'import',providerAccount:'synthetic',sourceObjectId:'partial_refund_demo',evidenceRef:'synthetic:refund:demo'}]);
"""
    result = subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", code], cwd=ROOT,
                            env={**RUN_ENV, "AGENTMARGIN_API_KEY": key}, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, "Synthetic adjustment SDK ingestion failed"
    for width in (1280, 390):
        page = browser.new_page(viewport={"width": width, "height": 850})
        try:
            page.goto(BASE + "/dashboard", wait_until="domcontentloaded")
            page.locator("#key").fill(key)
            page.locator("#load").click()
            expect(page.locator("#count")).to_have_text("5 customers", timeout=15000)
            assert page.locator("#revenue").inner_text() == "$125.92"
            row = page.locator("#rows tr").filter(has_text="refund-period-demo")
            assert "−$0.08" in row.inner_text(), "Prior-period refund was dropped or treated as positive"
            assert row.locator("td").nth(4).inner_text() == "—", "Nonpositive revenue must not have a percentage margin"
            bar = page.locator(".chartCustomer").filter(has_text="refund-period-demo").locator(".chartRevenue")
            assert bar.evaluate("el => el.style.height") == "0%", "Negative revenue generated an invalid bar height"
            assert "Net of recorded adjustments" in page.locator(".metrics").inner_text()
        finally:
            page.close()
    print("PASS: live SDK partial refund, original payment preserved, adjusted net totals and negative-period UI")



def v09_fixture_browser(browser):
    code = """
import pg from 'pg';
import {testV09FinancialFixture} from './scripts/v09-financial-fixture.ts';
const url=process.env.AGENTMARGIN_DEMO_TEST_DATABASE_URL;
const pool=new pg.Pool({connectionString:url});
try {const result=await testV09FinancialFixture(pool,url);process.stdout.write(JSON.stringify(result));}
finally {await pool.end();}
"""
    result = subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", code], cwd=ROOT,
                            env=RUN_ENV, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, "Synthetic v0.9 fixture failed"
    fixture = json.loads(result.stdout.splitlines()[-1])
    for width in (1280, 390):
        page = browser.new_page(viewport={"width": width, "height": 850})
        try:
            page.goto(BASE + "/dashboard", wait_until="domcontentloaded")
            page.locator("#key").fill(fixture["key"])
            page.locator("#load").click()
            expect(page.locator("#revenue")).to_have_text("$10.75", timeout=15000)
            expect(page.locator("#rows tr")).to_have_count(1)
            assert "stripe:cus_v09_fixture" in page.locator("#rows").inner_text()
            assert "Net of recorded adjustments" in page.locator(".metrics").inner_text()
        finally:
            page.close()
    print("PASS: synthetic v0.9 $128 gross / $117.25 reductions / $10.75 net across ledger, API, reconciliation and desktop/mobile dashboard")


def main():
    if not (os.environ.get("CI") == "true" and os.environ.get("GITHUB_ACTIONS") == "true"):
        raise SystemExit("This disposable Docker demo smoke test is restricted to GitHub Actions CI.")
    global BASE, RUN_ENV
    # Unique Compose identity and free loopback ports isolate concurrent jobs and
    # preserve any existing operator demo. Binding failures still fail closed.
    with socket.socket() as database, socket.socket() as api:
        database.bind(("127.0.0.1", 0))
        api.bind(("127.0.0.1", 0))
        database_port = str(database.getsockname()[1])
        api_port = str(api.getsockname()[1])
    BASE = "http://127.0.0.1:" + api_port
    RUN_ENV = {**os.environ, "AGENTMARGIN_DEMO_DB_PORT": database_port, "PORT": api_port,
               "COMPOSE_PROJECT_NAME": "agentmargin-ci-" + uuid.uuid4().hex,
               "AGENTMARGIN_ENDPOINT": BASE,
               "AGENTMARGIN_DEMO_TEST_DATABASE_URL": "postgresql://agentmargin_demo:local-development-only@127.0.0.1:" + database_port + "/agentmargin_demo"}
    logs = []
    key_holder = []
    reader_finished = threading.Event()
    process = subprocess.Popen(
        ["npm", "run", "demo"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
        env=RUN_ENV,
    )

    def consume_output():
        try:
            assert process.stdout is not None
            for line in process.stdout:
                match = KEY_PATTERN.search(line)
                if match:
                    key_holder.append(match.group(1))
                    line = KEY_PATTERN.sub("Demo API key: [REDACTED]", line)
                logs.append(line.rstrip())
                if len(logs) > 80:
                    del logs[:-80]
        finally:
            reader_finished.set()

    reader = threading.Thread(target=consume_output, daemon=True)
    reader.start()
    try:
        deadline = time.monotonic() + 150
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError("The local demo terminated before the HTTP API became ready.")
            if key_holder:
                try:
                    with fetch("/health") as response:
                        if response.status == 200:
                            break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    pass
            time.sleep(0.5)
        else:
            raise TimeoutError("Demo did not provide a key and healthy localhost API within 150 seconds.")
        key = key_holder[0]
        assert key.startswith("am_")
        try:
            with fetch("/v1/analytics", "am_" + "z" * 43):
                raise AssertionError("An invalid API key was accepted")
        except urllib.error.HTTPError as error:
            assert error.code == 401, f"Invalid API key returned {error.code}"

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
            try:
                for width in (1280, 390):
                    live_browser(browser, key, width, 3, 1)
                # Real source-first SDK -> live local API -> PostgreSQL -> live dashboard.
                sdk = subprocess.run(
                    ["node", "--experimental-strip-types", "examples/track-synthetic-openai.ts"],
                    cwd=ROOT,
                    env={**RUN_ENV, "AGENTMARGIN_API_KEY": key},
                    capture_output=True,
                    text=True,
                    timeout=35,
                )
                assert sdk.returncode == 0, f"Synthetic SDK example failed: {sdk.stderr[-700:]}"
                assert "1 inserted" in sdk.stdout, "Synthetic SDK example did not insert usage/revenue"
                for width in (1280, 390):
                    live_browser(browser, key, width, 4, 2)
                live_pricing_browser(browser, key)
                live_adjustment_browser(browser, key)
                v09_fixture_browser(browser)
            finally:
                browser.close()
        print("PASS: full live demo E2E — Docker PostgreSQL, API auth, SDK metering, and Chromium")
    except Exception:
        # Always strip demo secrets from any diagnostic output.
        tail = "\n".join(logs[-16:])
        for key in key_holder:
            tail = tail.replace(key, "[REDACTED]")
        if tail:
            print("Last sanitized demo output:\n" + tail)
        raise
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=8)
        subprocess.run(
            ["npm", "run", "demo:reset"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
            env={**RUN_ENV, "AGENTMARGIN_CONFIRM_DEMO_RESET": "YES"},
        )


if __name__ == "__main__":
    main()
