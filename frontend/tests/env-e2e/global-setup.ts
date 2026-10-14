import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

import { resolveE2eTarget, type E2eTarget } from "./target";

const LOGIN_TIMEOUT_MS = 60_000;
const BRANCH_CARD = '[data-component="desktop_select-branch_list_card"]';

async function selectBranchIfAsked(page: Page, target: E2eTarget): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith("/select-branch")) return;

  const cards = page.locator(BRANCH_CARD);
  await cards.first().waitFor({ timeout: LOGIN_TIMEOUT_MS });
  if (target.branchName) {
    // Exact accessible name, so "고양점" never matches "고양파주점".
    await page.getByRole("button", { name: `${target.branchName} 지점 선택`, exact: true }).click();
  } else {
    const count = await cards.count();
    if (count !== 1) {
      const key = target.name === "dev" ? "E2E_DEV_BRANCH_NAME" : "E2E_PREVIEW_BRANCH_NAME";
      const names = (await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? "")))
        .map((label) => label.replace(/ 지점 선택$/, ""));
      throw new Error(
        `[env-e2e] ${target.name}: account has ${count} branches (${names.join(", ")}); set ${key} in frontend/.env.local`,
      );
    }
    await cards.first().click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/select-branch"), { timeout: LOGIN_TIMEOUT_MS });
}

/**
 * Logs in once per run and saves the session for the tests. A saved session is never reused
 * across runs: its refresh token may already have been rotated, and replaying a rotated
 * refresh token makes the backend revoke the whole session.
 */
export default async function globalSetup(): Promise<void> {
  const target = resolveE2eTarget();
  if (!target.credentials) {
    throw new Error(
      `[env-e2e] ${target.name}: missing ${target.missingCredentialKeys.join(", ")} in frontend/.env.local`,
    );
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: target.baseURL });
    // A single attempt, never retried: preview counts logins per IP even for the exempt test account.
    const response = await context.request.post("/api/auth/login", {
      data: { ...target.credentials, autoLogin: true },
      timeout: LOGIN_TIMEOUT_MS,
    });
    const body = await response.json().catch(() => null) as { success?: boolean } | null;
    if (!response.ok() || body?.success !== true) {
      throw new Error(`[env-e2e] ${target.name}: login failed with HTTP ${response.status()}`);
    }

    const page = await context.newPage();
    await page.goto("/", { timeout: LOGIN_TIMEOUT_MS });
    await selectBranchIfAsked(page, target);
    if (new URL(page.url()).pathname.startsWith("/login")) {
      throw new Error(`[env-e2e] ${target.name}: still on /login after logging in`);
    }

    fs.mkdirSync(path.dirname(target.storageStatePath), { recursive: true });
    await context.storageState({ path: target.storageStatePath });
    console.log(`[env-e2e] ${target.name}: logged in, session saved`);
  } finally {
    await browser.close();
  }
}
