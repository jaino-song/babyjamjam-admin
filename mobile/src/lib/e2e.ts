export const E2E_AUTH_USER = {
  id: "e2e-user",
  name: "E2E Tester",
  email: "e2e@example.com",
  profileImage: "",
  role: "admin",
  organizationName: "E2E Organization",
} as const;

export const E2E_VAPID_PUBLIC_KEY =
  "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function isE2ETest() {
  return process.env.NEXT_PUBLIC_E2E_TEST === "true" || process.env.E2E_TEST === "true";
}
