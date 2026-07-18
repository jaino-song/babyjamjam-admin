const mockRedirect = jest.fn();
const mockCreateServerApiUrl = jest.fn((_pathname: string) => "https://api.example.com/auth/kakao");

jest.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

jest.mock("@/lib/api/server-base-url", () => ({
  createServerApiUrl: (pathname: string) => mockCreateServerApiUrl(pathname),
}));

import { GET } from "../route";

describe("GET /api/auth/kakao", () => {
  it("uses the fail-closed server API URL resolver", async () => {
    await GET();

    expect(mockCreateServerApiUrl).toHaveBeenCalledWith("/auth/kakao");
    expect(mockRedirect).toHaveBeenCalledWith("https://api.example.com/auth/kakao");
  });
});
