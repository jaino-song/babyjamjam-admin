import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

import { resolveE2eTarget, type E2eTarget } from "./target";

const LOGIN_TIMEOUT_MS = 60_000;
const REUSE_MIN_REMAINING_MS = 5 * 60_000;

interface StoredState {
  cookies?: Array<{ name: string; value: string }>;
}

function decodeJwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Reuse a saved session only while its access token is still comfortably valid.
 * A valid access token means nothing has refreshed (rotated) the stored refresh token yet,
 * so replaying it cannot trip the backend's refresh-reuse revocation.
 */
function canReuseStoredSession(target: E2eTarget): boolean {
  if (!fs.existsSync(target.storageStatePath)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(target.storageStatePath, "utf8")) as StoredState;
    const accessToken = state.cookies?.find((cookie) => cookie.name === "auth_token")?.value;
    const hasBranch = state.cookies?.some((cookie) => cookie.name === "selected_branch_id");
    const expiresAt = accessToken ? decodeJwtExpiryMs(accessToken) : null;
    return Boolean(hasBranch && expiresAt && expiresAt - Date.now() > REUSE_MIN_REMAINING_MS);
  } catch {
    return false;
  }
}

async function selectBranchIfAsked(page: Page, target: E2eTarget): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith("/select-branch")) return;

  if (target.branchName) {
    await page.getByRole("button", { name: target.branchName }).first().click();
  } else {
    const buttons = page.locator("main").getByRole("button");
    await buttons.first().waitFor();
    const count = await buttons.count();
    if (count !== 1) {
      const set = target.name === "dev" ? "E2E_DEV_BRANCH_NAME" : "E2E_PREVIEW_BRANCH_NAME";
      throw new Error(`Account has ${count} branch choices; set ${set} in frontend/.env.local`);
    }
    await buttons.first().click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/select-branch"), { timeout: LOGIN_TIMEOUT_MS });
}

export default async function globalSetup(): Promise<void> {
  const target = resolveE2eTarget();

  if (canReuseStoredSession(target)) {
    console.log(`[env-e2e] ${target.name}: reusing saved session (${path.relative(process.cwd(), target.storageStatePath)})`);
    return;
  }

  if (!target.credentials) {
    throw new Error(
      `[env-e2e] ${target.name}: missing ${target.missingCredentialKeys.join(", ")} in frontend/.env.local`,
    );
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: target.baseURL });
    // A single attempt: failed logins count toward the backend rate limit.
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
