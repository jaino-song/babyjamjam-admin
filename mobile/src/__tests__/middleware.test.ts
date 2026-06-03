/**
 * @jest-environment node
 */
import { jwtDecode } from "jwt-decode";
import { NextRequest } from "next/server";

import { middleware } from "../middleware";

jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn(),
}));

const mockJwtDecode = jwtDecode as jest.Mock;

function createRequest(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("middleware API route protection", () => {
  beforeEach(() => {
    mockJwtDecode.mockReset();
  });

  it("allows explicitly public auth API routes without a session", async () => {
    const response = await middleware(createRequest("/api/auth/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not allow the legacy token callback as a public API route", async () => {
    const response = await middleware(createRequest("/api/auth/callback"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("rejects protected API routes without a session", async () => {
    const response = await middleware(createRequest("/api/clients"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("rejects protected API routes when the session has no selected branch", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      role: "manager",
      type: "access",
    });

    const response = await middleware(createRequest("/api/clients", "auth_token=session-token"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Branch selection required" });
  });

  it("allows protected API routes with auth and selected branch", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      role: "manager",
      type: "access",
    });

    const response = await middleware(createRequest(
      "/api/clients",
      "auth_token=session-token; selected_branch_id=branch-1",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
