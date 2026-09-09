import { expect, test } from "@playwright/test";

import { installPhase3WizardFixture } from "./helpers/phase3-fixtures";

test.describe("phase 3 synthetic fixture routing", () => {
  test("keeps the phone check response separate from the clients list fallback", async ({ page }) => {
    await installPhase3WizardFixture(page);
    await page.goto("/");

    const responses = await page.evaluate(async () => {
      const [checkPhoneResponse, clientsListResponse] = await Promise.all([
        fetch("/api/clients/check-phone?phone=01011112222"),
        fetch("/api/clients?limit=20"),
      ]);

      return {
        checkPhone: await checkPhoneResponse.json(),
        clientsList: await clientsListResponse.json(),
      };
    });

    expect(responses.checkPhone).toEqual({ exists: false });
    expect(responses.clientsList).toEqual([]);
  });
});
