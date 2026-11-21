/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
jest.mock("@/lib/api/route-utils", () => ({ errorResponse: jest.fn() }));
it.each([200, 201])("forwards the body and %s status", async (status) => {
  const body = { challengeToken: "challenge", code: "123456" };
  const data = { success: true, linked: true, emailVerificationRequired: false };
  jest.mocked(serverAPIClient.post).mockResolvedValue({ status, data });
  const response = await POST(new NextRequest("http://localhost/api/auth/register/link/verify", { method: "POST", body: JSON.stringify(body) }));
  expect(serverAPIClient.post).toHaveBeenCalledWith("/auth/register/link/verify", body);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(data);
});
it("uses the register route error boundary", async () => {
  const error = new Error("failed");
  jest.mocked(serverAPIClient.post).mockRejectedValue(error);
  jest.mocked(errorResponse).mockReturnValue(new Response(null, { status: 400 }) as never);
  const response = await POST(new NextRequest("http://localhost/api/auth/register/link/verify", { method: "POST", body: "{}" }));
  expect(response.status).toBe(400);
  expect(errorResponse).toHaveBeenCalledWith(error, "verify register link");
});
