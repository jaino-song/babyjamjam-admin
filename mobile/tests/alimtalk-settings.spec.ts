import { expect, test, type Page } from "@playwright/test";

type ProviderValue = "aligo_alimtalk" | "none";

test.use({ viewport: { width: 390, height: 844 } });

async function mockNotificationSettingsRoutes(
  page: Page,
  options?: {
    initialProvider?: ProviderValue;
    onProviderUpdate?: (provider: ProviderValue) => void;
  }
) {
  let providerState: { provider: ProviderValue; updatedAt: string } = {
    provider: options?.initialProvider ?? "aligo_alimtalk",
    updatedAt: "2026-06-07T09:00:00.000Z",
  };

  await page.route("**/api/notifications/vapid-key**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ publicKey: "test-vapid-key" }),
    });
  });

  await page.route("**/api/settings/alimtalk-provider", async (route) => {
    if (route.request().method() === "PUT") {
      const { provider } = route.request().postDataJSON() as { provider: ProviderValue };
      providerState = {
        provider,
        updatedAt: "2026-06-07T09:30:00.000Z",
      };
      options?.onProviderUpdate?.(provider);
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(providerState),
    });
  });

}

test.describe("notification settings surface", () => {
  test("renders the current /notification provider settings UI", async ({ page }) => {
    await mockNotificationSettingsRoutes(page);
    await page.goto("/notification");

    await expect(page.locator('[data-component="notification-settings"]')).toBeVisible();
    await expect(page.getByText("알림 설정")).toBeVisible();
    await expect(page.getByText("수신 채널")).toBeVisible();
    await expect(page.getByText("알림톡 서비스")).toBeVisible();
    await expect(page.locator('[data-component="settings-alimtalk-provider"]')).toBeVisible();
    await expect(page.getByRole("radio", { name: "알리고 (Aligo) 선택" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "사용 안함 선택" })).toBeVisible();
  });

  test("redirects /settings to /notification", async ({ page }) => {
    await mockNotificationSettingsRoutes(page);
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/notification$/);
    await expect(page.locator('[data-component="notification-settings"]')).toBeVisible();
  });

  test("redirects /notifications to /notification", async ({ page }) => {
    await mockNotificationSettingsRoutes(page);
    await page.goto("/notifications");

    await expect(page).toHaveURL(/\/notification$/);
    await expect(page.locator('[data-component="notification-settings"]')).toBeVisible();
  });

  test("saves provider selection through the current /notification surface", async ({ page }) => {
    let updatedProvider: ProviderValue | null = null;

    await mockNotificationSettingsRoutes(page, {
      onProviderUpdate: (provider) => {
        updatedProvider = provider;
      },
    });
    await page.goto("/notification");

    const noneOption = page.getByRole("radio", { name: "사용 안함 선택" });
    await noneOption.click();

    await expect(noneOption).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-component="notification-alimtalk-updated-at"]')).toContainText("마지막 수정:");
    expect(updatedProvider).toBe("none");
  });

  test("reflects the mocked saved provider state on first render", async ({ page }) => {
    await mockNotificationSettingsRoutes(page, {
      initialProvider: "none",
    });
    await page.goto("/notification");

    await expect(page.getByRole("radio", { name: "사용 안함 선택" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-component="notification-alimtalk-updated-at"]')).toContainText("마지막 수정:");
  });
});
