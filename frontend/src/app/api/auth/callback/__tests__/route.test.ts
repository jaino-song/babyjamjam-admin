/**
 * @jest-environment node
 */
import { cookies } from "next/headers";

import { GET } from "../route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

jest.mock("next/navigation", () => ({
    redirect: jest.fn(() => new Response(null, { status: 307 })),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

describe("GET /api/auth/callback", () => {
    beforeEach(() => {
        mockCookies.mockReset();
    });

    it.each([
        "?token=attacker-access&refreshToken=attacker-refresh",
        "?token=attacker-access",
        "",
    ])("rejects legacy callback %s without mutating auth cookies", async (query) => {
        const cookieStore = { set: jest.fn() };
        mockCookies.mockResolvedValue(cookieStore as never);
        const request = new Request(`http://localhost/api/auth/callback${query}`);

        // Next.js supplies a request even when the disabled handler ignores it.
        const response = await Reflect.apply(GET, undefined, [request]) as Response;

        expect(mockCookies).not.toHaveBeenCalled();
        expect(cookieStore.set).not.toHaveBeenCalled();
        expect(response.status).toBe(410);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("set-cookie")).toBeNull();
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_EXPIRED",
            status: 410,
            outcome: "NOT_APPLIED",
            detail: "요청한 정보의 이용 기간이 끝났어요.",
            error: "요청한 정보의 이용 기간이 끝났어요.",
        }));
    });
});
