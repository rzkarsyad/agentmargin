#!/usr/bin/env python3
"""Full localhost demo E2E: Docker PostgreSQL + live API + SDK + real Chromium.

Use ONLY in a disposable development/CI environment. The generated demo API
key is consumed in memory and never printed or saved by this smoke test.
"""
import os
import re
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = "http://127.0.0.1:8787"
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
        page.locator("#key").fill(key)
        page.locator("#load").click()
        page.wait_for_function(
            "(expected) => document.querySelector('#count').textContent === expected",
            arg=f"{customer_count} customers",
            timeout=20_000,
        )
        assert page.locator("#rows tr").count() == customer_count
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
        assert not errors, f"Browser script errors: {errors}"
        print(f"PASS: live Chromium {width}px, {customer_count} customers, {unknown_count} unknown-cost customers")
    finally:
        page.close()


def main():
    if not (os.environ.get("CI") == "true" and os.environ.get("GITHUB_ACTIONS") == "true"):
        raise SystemExit("This disposable Docker demo smoke test is restricted to GitHub Actions CI.")
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
        env={**os.environ, "AGENTMARGIN_DEMO_DB_PORT": "55432"},
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
                    env={**os.environ, "AGENTMARGIN_API_KEY": key},
                    capture_output=True,
                    text=True,
                    timeout=35,
                )
                assert sdk.returncode == 0, f"Synthetic SDK example failed: {sdk.stderr[-700:]}"
                assert "1 inserted" in sdk.stdout, "Synthetic SDK example did not insert usage/revenue"
                for width in (1280, 390):
                    live_browser(browser, key, width, 4, 2)
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
            ["npm", "run", "demo:stop"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
            env={**os.environ, "AGENTMARGIN_DEMO_DB_PORT": "55432"},
        )


if __name__ == "__main__":
    main()
