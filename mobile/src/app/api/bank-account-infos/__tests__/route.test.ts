/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listBankAccountInfos } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("bank-account-infos API routes", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  describe("auth rejection", () => {
    it("rejects bank account info listing without auth_token", async () => {
      const request = new NextRequest("http://localhost/api/bank-account-infos");
      const response = await listBankAccountInfos(request);
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
