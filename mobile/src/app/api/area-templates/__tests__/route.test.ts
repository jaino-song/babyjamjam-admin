/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listAreaTemplates } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(
  path: string,
  init: { headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
  });
}

describe("area-templates API routes", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  describe("auth rejection", () => {
    it("rejects area templates GET without an auth cookie before proxying", async () => {
      const response = await listAreaTemplates(createRequest("/api/area-templates", { headers: { cookie: "" } }));
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
