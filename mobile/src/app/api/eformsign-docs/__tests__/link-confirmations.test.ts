/** @jest-environment node */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { GET } from "../link-confirmations/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn() } }));
const mockGet = jest.mocked(serverAPIClient.get);
const request = (query: string, authenticated = true) => new NextRequest(`http://localhost/api/eformsign-docs/link-confirmations${query}`, {
  headers: authenticated ? { cookie: "auth_token=test-token" } : {},
});
beforeEach(() => mockGet.mockReset());
it("forwards only the validated clientId and returns backend data", async () => {
  mockGet.mockResolvedValue({ status: 200, data: [{ documentId: "doc-1" }] });
  const response = await GET(request("?clientId=7&extra=discard"));
  expect(response.status).toBe(200); expect(await response.json()).toEqual([{ documentId: "doc-1" }]);
  expect(mockGet).toHaveBeenCalledWith("/eformsign-docs/link-confirmations?clientId=7", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
});
it("forwards with no query when clientId is omitted, dropping other params", async () => {
  mockGet.mockResolvedValue({ status: 200, data: [{ documentId: "doc-2" }] });
  const response = await GET(request("?extra=discard"));
  expect(response.status).toBe(200); expect(await response.json()).toEqual([{ documentId: "doc-2" }]);
  expect(mockGet).toHaveBeenCalledWith("/eformsign-docs/link-confirmations", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
});
it("forwards with no query when there is no query string at all", async () => {
  mockGet.mockResolvedValue({ status: 200, data: [] });
  expect((await GET(request(""))).status).toBe(200);
  expect(mockGet).toHaveBeenCalledWith("/eformsign-docs/link-confirmations", expect.anything());
});
it.each(["?clientId=", "?clientId=0", "?clientId=-1", "?clientId=01", "?clientId=1.2", "?clientId=abc", "?clientId=%207", "?clientId=9007199254740992"])("rejects invalid %s locally", async query => {
  const response = await GET(request(query));
  expect(response.status).toBe(400); expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED", errors: [expect.objectContaining({ pointer: "/clientId", location: "query" })] });
  expect(mockGet).not.toHaveBeenCalled();
});
it("requires authentication", async () => {
  expect((await GET(request("?clientId=7", false))).status).toBe(401); expect(mockGet).not.toHaveBeenCalled();
});
