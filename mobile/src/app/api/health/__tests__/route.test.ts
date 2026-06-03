/**
 * @jest-environment node
 */
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    defaults: {
      baseURL: "https://backend.internal",
    },
    get: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/health", () => {
  beforeEach(() => {
    mockGet.mockReset();
    serverAPIClient.defaults.baseURL = "https://backend.internal";
  });

  it("does not expose environment config or backend response bodies", async () => {
    mockGet.mockResolvedValue({
      status: 200,
      statusText: "OK",
      data: {
        version: "internal-build",
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "success",
      backend: {
        reachable: true,
        status: 200,
      },
    });
    expect(body).not.toHaveProperty("environment");
    expect(body).not.toHaveProperty("backendURL");
    expect(body).not.toHaveProperty("hasBackendURL");
    expect(body.backend).not.toHaveProperty("statusText");
    expect(body.backend).not.toHaveProperty("data");
  });

  it("does not expose backend error details", async () => {
    mockGet.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:3001"), {
      code: "ECONNREFUSED",
    }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "error",
      message: "Backend unreachable",
      backend: {
        reachable: false,
      },
    });
    expect(body).not.toHaveProperty("environment");
    expect(body).not.toHaveProperty("backendURL");
    expect(body).not.toHaveProperty("hasBackendURL");
    expect(body.backend).not.toHaveProperty("error");
    expect(body.backend).not.toHaveProperty("code");
  });
});
