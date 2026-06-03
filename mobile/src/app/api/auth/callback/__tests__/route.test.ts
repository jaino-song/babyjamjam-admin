/**
 * @jest-environment node
 */
import { cookies } from "next/headers";

import { GET } from "../route";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

describe("GET /api/auth/callback", () => {
  beforeEach(() => {
    mockCookies.mockReset();
  });

  it("does not accept query tokens or mutate auth cookies", async () => {
    const cookieStore = {
      set: jest.fn(),
    };
    mockCookies.mockResolvedValue(cookieStore as never);

    const response = await GET();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Legacy token callback is disabled",
    });
    expect(mockCookies).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
