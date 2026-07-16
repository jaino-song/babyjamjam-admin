import { expect, test } from "@playwright/test";

test.describe("legacy demo mode", () => {
  test.skip(
    process.env.LEGACY_DEMO_MODE !== "true",
    "LEGACY_DEMO_MODE must be enabled for this focused suite.",
  );

  test("redirects the login page to the dashboard without authentication", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Legacy Demo").first()).toBeVisible();
  });

  test("blocks backend proxy requests", async ({ request }) => {
    const responses = await Promise.all([
      request.get("/api/employees"),
      request.post("/api/employees", { data: { name: "blocked" } }),
      request.patch("/api/employees?id=legacy-demo", { data: { name: "blocked" } }),
      request.delete("/api/employees?id=legacy-demo"),
    ]);

    for (const response of responses) {
      expect(response.status()).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
    }
  });
});
