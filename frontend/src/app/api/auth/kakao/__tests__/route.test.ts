/**
 * @jest-environment node
 */

const mockRedirect = jest.fn();
const mockCreateServerApiUrl = jest.fn(() => "https://api.example.com/auth/kakao");

jest.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

jest.mock("@/lib/api/server-base-url", () => ({
  createServerApiUrl: (pathname: string) => mockCreateServerApiUrl(pathname),
}));

import { GET } from "../route";

describe("GET /api/auth/kakao", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the fail-closed server API URL resolver", async () => {
    await GET();

    expect(mockCreateServerApiUrl).toHaveBeenCalledWith("/auth/kakao");
    expect(mockRedirect).toHaveBeenCalledWith("https://api.example.com/auth/kakao");
  });

  it("forwards only the existing provider client selector", async () => {
    await GET(new Request(
      "https://admin.example/api/auth/kakao?client=mobile&returnTo=https%3A%2F%2Fevil.example",
    ));

    expect(mockRedirect).toHaveBeenCalledWith(
      "https://api.example.com/auth/kakao?client=mobile",
    );
  });

  it("drops unsupported selectors and navigation metadata", async () => {
    await GET(new Request(
      "https://admin.example/api/auth/kakao?client=desktop&returnTo=%2Fservice-record-admin%2Fclient-1",
    ));

    expect(mockRedirect).toHaveBeenCalledWith("https://api.example.com/auth/kakao");
  });
});
