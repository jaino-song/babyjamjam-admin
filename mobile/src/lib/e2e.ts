import { IS_E2E_TEST } from "@/lib/env";

export const E2E_ROLE_COOKIE = "e2e_role";

export const E2E_AUTH_USER = {
  id: "e2e-user",
  name: "E2E Tester",
  email: "e2e@example.com",
  profileImage: "",
  role: "admin",
  branchRole: "admin",
  branchId: "e2e-branch",
  branchName: "E2E Branch",
} as const;

export function getE2EAuthUser(role?: string) {
  return role === "owner" ? { ...E2E_AUTH_USER, role: "owner" as const } : E2E_AUTH_USER;
}

/**
 * Resolve the browser E2E identity from the same role cookie used by the
 * server-side auth helpers. Unknown or absent values intentionally keep the
 * default admin fixture; only the explicit owner fixture elevates access.
 */
export function getClientE2EAuthUser() {
  if (typeof document === "undefined") {
    return E2E_AUTH_USER;
  }

  const role = document.cookie
    .split(";")
    .map((part) => part.trim().split("=")[0] === E2E_ROLE_COOKIE ? part.trim().split("=")[1] : undefined)
    .find((value): value is string => value !== undefined);

  return getE2EAuthUser(role);
}

export const E2E_VAPID_PUBLIC_KEY =
  "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function isE2ETest() {
  return IS_E2E_TEST;
}
