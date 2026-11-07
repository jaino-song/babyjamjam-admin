/** @jest-environment node */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders } from "@/lib/api/route-utils";
import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn() } }));
jest.mock("@/lib/api/route-utils", () => ({
  ...jest.requireActual("@/lib/api/route-utils"),
  errorResponse: jest.fn(),
}));

const mockGet = serverAPIClient.get as jest.Mock;
const request = (authenticated = true) => new NextRequest(
  "http://localhost/api/eformsign-backups/runs?limit=1&unexpected=value",
  authenticated ? { headers: { cookie: "auth_token=test-token" } } : undefined,
);

beforeEach(() => jest.clearAllMocks());

it("returns the shared auth-required status when no token exists", async () => {
  const response = await GET(request(false));
  expect(response.status).toBe(authRequiredResponse().status);
  expect(mockGet).not.toHaveBeenCalled();
});

it("reads only the fixed staff endpoint with auth headers and returns the backend JSON", async () => {
  const data = { items: [{ id: "run-1" }] };
  mockGet.mockResolvedValue({ data });
  const response = await GET(request());
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(mockGet).toHaveBeenCalledWith("/eformsign-backups/runs?limit=60", {
    headers: getAuthHeaders("test-token"),
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(data);
});

it("delegates thrown errors to the shared read error response", async () => {
  const error = new Error("upstream failure");
  const response = new Response(null, { status: 502 });
  mockGet.mockRejectedValue(error);
  (errorResponse as jest.Mock).mockReturnValue(response);
  expect(await GET(request())).toBe(response);
  expect(errorResponse).toHaveBeenCalledWith(error, "fetch eformsign backup runs", "read");
});
