import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

function readJwtSecret(): string {
  // CI provides the secret via env; local dev falls back to backend/.env.
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const envPath = path.resolve(process.cwd(), "../backend/.env");
  const env = fs.readFileSync(envPath, "utf-8");
  const line = env
    .split("\n")
    .find((l) => l.startsWith("JWT_SECRET="))
    ?.trim();
  if (!line) {
    throw new Error("JWT_SECRET not found in env or ../backend/.env");
  }
  return line.slice("JWT_SECRET=".length);
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signJwtHS256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data}.${base64url(sig)}`;
}

function makeStorageState() {
  const secret = readJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60;

  // Known valid IDs for local dev (used elsewhere in workspace scripts).
  const userId = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";
  const branchId = "33dbe950-1574-4951-b7b4-92d97ab29512";

  const token = signJwtHS256(
    {
      sub: userId,
      role: "owner",
      branchId,
      branchRole: "admin",
      type: "access",
      exp,
    },
    secret
  );

  return {
    cookies: [
      {
        name: "auth_token",
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
        expires: exp,
      },
      {
        name: "selected_branch_id",
        value: branchId,
        domain: "localhost",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
        expires: exp,
      },
    ],
    origins: [],
  };
}

test.describe("Chat live stream smoke", () => {
  test.use({ storageState: makeStorageState() });

  test.beforeEach(async ({ page }) => {
    // Keep the live test deterministic: don't render persisted wizard markers from backend history.
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("ai_chat_session_id");
      } catch {
        // ignore
      }
    });

    await page.route("**/api/ai/chat/history**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [],
          total: 0,
          hasMore: false,
          sessionId: null,
          isSessionActive: false,
        }),
      });
    });
  });

  test("streams a deterministic Gemini stub response on /chat", async ({ page }) => {
    page.on("console", (msg) => {
      // Useful when debugging auth/stream issues locally.
      if (["warning", "error"].includes(msg.type())) {
        console.log(`[browser:${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto("/chat");
    await expect(page.locator('[data-component="chat"]')).toBeVisible({ timeout: 15000 });

    const input = page.locator('[data-component="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    const start = Date.now();
    await input.fill("안녕하세요");
    await input.press("Enter");

    await expect(page.getByLabel("응답 작성 중")).toBeVisible({ timeout: 5000 });

    const assistantMessages = page.locator('[data-component="chat-message-assistant"]');
    await expect(assistantMessages.last()).toContainText("[e2e-stub]", { timeout: 15000 });
    await expect(assistantMessages.last()).toContainText("안녕하세요", { timeout: 15000 });

    await expect(page.getByLabel("응답 작성 중")).toHaveCount(0, { timeout: 20000 });
    await expect(input).toBeEnabled({ timeout: 5000 });

    const ttfbMs = Date.now() - start;
    console.log(`[chat-live] time-to-first-response-ms=${ttfbMs}`);
  });

  test("typing the local registration command opens the wizard without calling SSE", async ({ page }) => {
    let sseCalled = 0;
    await page.route("**/api/ai/chat/stream", async (route) => {
      sseCalled += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "SSE should not be called for local wizard" }),
      });
    });

    await page.goto("/chat");
    await expect(page.locator('[data-component="chat"]')).toBeVisible({ timeout: 15000 });

    const input = page.locator('[data-component="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    await input.fill("산모 등록");
    await input.press("Enter");

    await expect(page.locator('[data-component="chat-wizard-registration"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("산모 등록")).toBeVisible({ timeout: 5000 });

    expect(sseCalled).toBe(0);
  });
});
