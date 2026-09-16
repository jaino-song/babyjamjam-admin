import {
  appendSafeReturnPath,
  getSafeReturnPathFromSearchParams,
  getSafeReturnPathFromStorage,
  getSafeServiceRecordAdminReturnPath,
  OAUTH_RETURN_PATH_TTL_MS,
  serializeSafeReturnPathForStorage,
} from "./safe-return-path";

describe("service-record-admin return paths", () => {
  it.each([
    "/service-record-admin/550e8400-e29b-41d4-a716-446655440000",
    "/service-record-admin/cml8k4r2n0001abcde1234567",
    "/service-record-admin/12345",
    "/service-record-admin/client_id-01",
  ])("accepts a local editor path for %s", (path) => {
    expect(getSafeServiceRecordAdminReturnPath(path)).toBe(path);
  });

  it.each([
    "/service-record-administer/client-1",
    "/service-record-admin/",
    "/service-record-admin/client-1/next",
    "/service-record-admin/client-1/../other",
    "/service-record-admin/client-1?next=/dashboard",
    "/service-record-admin/client-1#section",
    "/service-record-admin/client-1%2F..%2Fother",
    "/service-record-admin/client-1%252F..%252Fother",
    "/service-record-admin/client-1\\..\\other",
    "https://evil.example/service-record-admin/client-1",
    "//evil.example/service-record-admin/client-1",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])("rejects an unsafe return path (%s)", (path) => {
    expect(getSafeServiceRecordAdminReturnPath(path)).toBeNull();
  });

  it("reads only the allowlisted returnTo query value", () => {
    expect(
      getSafeReturnPathFromSearchParams(
        new URLSearchParams({ returnTo: "/service-record-admin/client-1" }),
      ),
    ).toBe("/service-record-admin/client-1");
    expect(
      getSafeReturnPathFromSearchParams(
        new URLSearchParams({ returnTo: "https://evil.example" }),
      ),
    ).toBeNull();
  });

  it("encodes a safe return path when carrying it to another local route", () => {
    expect(
      appendSafeReturnPath(
        "/select-branch",
        "/service-record-admin/client-1",
      ),
    ).toBe("/select-branch?returnTo=%2Fservice-record-admin%2Fclient-1");
    expect(appendSafeReturnPath("/dashboard", "https://evil.example")).toBe(
      "/dashboard",
    );
  });

  it("serializes a safe path with a short expiry for the OAuth handoff", () => {
    const now = 1_000;
    const serialized = serializeSafeReturnPathForStorage(
      "/service-record-admin/client-1",
      now,
    );

    expect(serialized).toBe(JSON.stringify({
      path: "/service-record-admin/client-1",
      expiresAt: now + OAUTH_RETURN_PATH_TTL_MS,
    }));
    expect(getSafeReturnPathFromStorage(serialized, now)).toBe(
      "/service-record-admin/client-1",
    );
  });

  it.each([
    JSON.stringify({ path: "https://evil.example", expiresAt: 2_000 }),
    JSON.stringify({ path: "/service-record-admin/client-1/../other", expiresAt: 2_000 }),
    JSON.stringify({ path: "/service-record-admin/client-1", expiresAt: 1_000 }),
    JSON.stringify({ path: "/service-record-admin/client-1", expiresAt: "later" }),
    "not-json",
  ])("rejects an unsafe or expired OAuth handoff value (%s)", (value) => {
    expect(getSafeReturnPathFromStorage(value, 1_000)).toBeNull();
  });
});
