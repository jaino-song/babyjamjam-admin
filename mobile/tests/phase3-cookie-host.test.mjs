import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { chromium } from "@playwright/test";
import { phase3AuthStorageStatePath } from "../phase3-e2e-auth-path.mjs";
import {
  cookieDomainFromBaseURL,
  createSyntheticCookies,
  getEffectiveBaseURL,
  default as globalSetup,
} from "../phase3-e2e-global-setup.mjs";

const acceptedBaseURLs = [
  ["http://localhost:4317", "localhost"],
  ["http://127.0.0.1:4317", "127.0.0.1"],
  ["http://[::1]:4317", "[::1]"],
];

test("cookie domain follows the effective Playwright baseURL for every loopback host", () => {
  for (const [baseURL, expectedDomain] of acceptedBaseURLs) {
    assert.equal(
      getEffectiveBaseURL({ projects: [{ use: { baseURL } }] }),
      baseURL,
    );
    assert.equal(cookieDomainFromBaseURL(baseURL), expectedDomain);
    assert.deepEqual(
      createSyntheticCookies(baseURL, "synthetic-token", -1).map(({ domain }) => domain),
      [expectedDomain, expectedDomain, expectedDomain],
    );
  }
});

test("IPv6 cookie domains retain browser-compatible brackets", () => {
  assert.equal(cookieDomainFromBaseURL("http://[::1]:4317"), "[::1]");
});

test("synthetic auth cookies are sent by a browser context on every accepted host", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => browser.close());

  for (const [baseURL] of acceptedBaseURLs) {
    await t.test(baseURL, async () => {
      await globalSetup({ projects: [{ use: { baseURL } }] });
      const storageState = JSON.parse(fs.readFileSync(phase3AuthStorageStatePath, "utf8"));
      const authCookie = storageState.cookies.find(({ name }) => name === "auth_token");
      assert.ok(authCookie);
      assert.equal(authCookie?.domain, cookieDomainFromBaseURL(baseURL));

      const context = await browser.newContext({
        storageState,
      });
      t.after(async () => context.close());

      let cookieHeader;
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        cookieHeader = route.request().headers().cookie ?? "";
        await route.abort();
      });

      await page.goto(`${baseURL}/cookie-probe`, {
        waitUntil: "commit",
        timeout: 5_000,
      }).catch(() => undefined);

      assert.match(
        cookieHeader ?? "",
        new RegExp(`(?:^|; )auth_token=${authCookie.value}(?:;|$)`),
      );
    });
  }
});
