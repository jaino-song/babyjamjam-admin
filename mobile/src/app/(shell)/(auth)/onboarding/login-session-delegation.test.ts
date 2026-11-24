/** @jest-environment node */
import { loginWithEmail } from "../login/actions";
import { writeLoginSessionCookies } from "@/lib/auth/login-session-cookies";
import { serverAPIClient } from "@/lib/api/server";
jest.mock("@/lib/auth/login-session-cookies", () => ({ writeLoginSessionCookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
jest.mock("next/headers", () => ({ cookies: async () => ({ delete: jest.fn() }) }));
it("delegates email login tokens and chosen auto-login value", async () => {
 const data = { success: true, accessToken: "access", refreshToken: "refresh" };
 jest.mocked(serverAPIClient.post).mockResolvedValue({ data, status: 201 });
 expect(await loginWithEmail("qa@example.test", "fixture", false)).toEqual({ success: true, requiresBranchSelection: false });
 expect(writeLoginSessionCookies).toHaveBeenCalledWith(data, false);
});
