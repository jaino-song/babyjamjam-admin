import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

function readJwtSecret(): string {
  const envPath = path.resolve(process.cwd(), "../backend/.env");
  const env = fs.readFileSync(envPath, "utf-8");
  const line = env
    .split("\n")
    .find((l) => l.startsWith("JWT_SECRET="))
    ?.trim();
  if (!line) {
    throw new Error("JWT_SECRET not found in ../backend/.env");
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
  const organizationId = "33dbe950-1574-4951-b7b4-92d97ab29512";

  const token = signJwtHS256(
    {
      sub: userId,
      role: "owner",
      organizationId,
      orgRole: "admin",
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
        name: "selected_organization_id",
        value: organizationId,
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

  test("streams a tool-based response on /chat", async ({ page }) => {
    page.on("console", (msg) => {
      // Useful when debugging auth/stream issues locally.
      if (["warning", "error"].includes(msg.type())) {
        // eslint-disable-next-line no-console
        console.log(`[browser:${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto("/chat");
    await expect(page.getByText("AI 어시스턴트")).toBeVisible({ timeout: 15000 });

    const input = page.getByPlaceholder("무엇을 도와드릴까요?").first();
    await expect(input).toBeVisible({ timeout: 10000 });

    const start = Date.now();
    await input.fill("현재 등록된 제공인력은 몇명이야?");
    await input.press("Enter");

    // Assistant content should stream and include employee/caregiver phrasing + a count.
    const assistantMessages = page.locator('[data-component="chat-message-assistant"]');
    await expect(assistantMessages.last()).toContainText(/제공인력|관리사|직원/, { timeout: 15000 });
    await expect(assistantMessages.last()).toContainText(/\d+\s*명/, { timeout: 15000 });

    // Wait for stream completion (blinking cursor removed).
    await expect(
      assistantMessages.last().locator(".animate-blink")
    ).toHaveCount(0, { timeout: 20000 });

    const ttfbMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[chat-live] time-to-first-response-ms=${ttfbMs}`);
  });

  test("quick action chip opens wizard without calling SSE", async ({ page }) => {
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
    await expect(page.getByText("AI 어시스턴트")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "산모 등록" }).click();
    await expect(page.locator('[data-component="chat-wizard-registration"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel("이름")).toBeVisible({ timeout: 5000 });

    expect(sseCalled).toBe(0);
  });
});
