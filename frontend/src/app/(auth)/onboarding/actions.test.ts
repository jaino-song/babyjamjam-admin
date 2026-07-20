/**
 * @jest-environment node
 */
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";
import { completeAccountOnboarding } from "./actions";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

jest.mock("@/lib/auth/session-cookies", () => ({
    setAuthSessionCookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockPost = serverAPIClient.post as jest.Mock;

describe("completeAccountOnboarding", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "pending-token" }),
            delete: jest.fn(),
        } as never);

        mockPost.mockResolvedValue({
            status: 201,
            data: {
                accessToken: "access-token",
                refreshToken: "refresh-token",
            },
        });
    });

    it("sends only fields accepted by the onboarding API contract", async () => {
        const input = {
            phone: "010-1234-5678",
            birthDate: "1990-01-01",
            branchId: "550e8400-e29b-41d4-a716-446655440000",
            role: "manager",
        };

        await completeAccountOnboarding(input);

        expect(mockPost).toHaveBeenCalledWith(
            "/auth/onboarding/complete",
            input,
            {
                headers: {
                    "x-pending-onboarding-token": "pending-token",
                },
            },
        );
    });
});
