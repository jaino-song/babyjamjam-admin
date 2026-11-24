async function loadApiModule() {
  jest.resetModules();
  jest.doMock("@/lib/env", () => ({ PUBLIC_BACKEND_BASE_URL: "http://localhost.invalid" }));
  const mockGet = jest.fn();
  const mockPost = jest.fn();
  jest.doMock("@/lib/api/client", () => ({
    api: { delete: jest.fn(), get: mockGet, post: mockPost, put: jest.fn() },
  }));
  return { authApi: (await import("./api")).authApi, mockGet, mockPost };
}

it("posts register-link verification to the client endpoint and returns the response data", async () => {
  const { authApi, mockPost } = await loadApiModule();
  const response = { success: true, linked: true, emailVerificationRequired: false };
  mockPost.mockResolvedValue({ data: response });

  expect(await authApi.verifyRegisterLink("challenge-token", "123456")).toBe(response);
  expect(mockPost).toHaveBeenCalledWith("/auth/register/link/verify", { challengeToken: "challenge-token", code: "123456" });
  expect(mockPost).toHaveBeenCalledTimes(1);
});

it.each([
  [{ exists: true }, true],
  [{ exists: false }, false],
  [{}, false],
  [undefined, false],
  [{ exists: "true" }, false],
  [{ exists: 1 }, false],
] as const)("checks the email endpoint and normalizes %j to exists=%s", async (data, exists) => {
  const { authApi, mockGet } = await loadApiModule();
  mockGet.mockResolvedValue({ data });

  expect(await authApi.checkEmailExists("qa@example.test")).toEqual({ exists });
  expect(mockGet).toHaveBeenCalledWith("/auth/check-email", { params: { email: "qa@example.test" } });
  expect(mockGet).toHaveBeenCalledTimes(1);
});

it("offers account linking only on the email registration request", async () => {
  const { authApi, mockPost } = await loadApiModule();
  const body = { email: "qa@example.test", password: "Password1!", name: "QA", phone: "01012345678", birthDate: "1990-01-01" };
  const result = { success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" };
  mockPost.mockResolvedValueOnce({ data: result });

  await expect(authApi.register(body)).resolves.toEqual(result);
  expect(mockPost).toHaveBeenCalledWith("/auth/register", body, { headers: { "x-account-link-version": "1" } });
});
