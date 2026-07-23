import { expect, test } from "@playwright/test";

test("uses a real backend login session", async ({ request }) => {
  const response = await request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const user = await response.json();
  expect(user.email).toBe("admin-a@auth-e2e.test");
  expect(user.role).toBe("admin");
});

test("maps an invalid reset token to a safe client error", async ({ request }) => {
  const response = await request.post("/api/auth/reset-password", {
    data: {
      token: "invalid-reset-token",
      newPassword: "Password2!",
    },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: "AUTH_RESET_TOKEN_INVALID",
  });
});
