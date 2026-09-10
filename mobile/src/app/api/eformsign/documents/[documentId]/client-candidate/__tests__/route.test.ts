/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { proxyLocalGetRequest } from "@/lib/api/route-utils";

import { GET } from "../route";

jest.mock("@/lib/api/route-utils", () => ({
  proxyLocalGetRequest: jest.fn(),
}));

const mockProxyLocalGetRequest = proxyLocalGetRequest as jest.Mock;

describe("GET /api/eformsign/documents/[documentId]/client-candidate", () => {
  beforeEach(() => {
    mockProxyLocalGetRequest.mockReset();
    mockProxyLocalGetRequest.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("proxies the encoded document ID to the local candidate endpoint", async () => {
    const request = new NextRequest("http://localhost/api/eformsign/documents/doc%2F1/client-candidate");

    await GET(request, { params: Promise.resolve({ documentId: "doc/1" }) });

    expect(mockProxyLocalGetRequest).toHaveBeenCalledWith(
      request,
      "/api/documents/doc%2F1/client-candidate",
      "fetch eformsign contract client candidate",
    );
  });
});
