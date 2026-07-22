/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { DELETE } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        delete: jest.fn(),
    },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;

function createRequest(): NextRequest {
    return new NextRequest("http://localhost/api/clients/75", {
        method: "DELETE",
        headers: { cookie: "auth_token=access-token" },
    });
}

describe("DELETE /api/clients/[id]", () => {
    beforeEach(() => {
        mockDelete.mockReset();
    });

    it("passes through the allowlisted safe detail for a coded delete conflict", async () => {
        mockDelete.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    error: "Conflict",
                    code: "CLIENT_DELETE_CONFLICT",
                    message: "연결된 데이터로 인해 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
                },
            },
        });

        const response = await DELETE(createRequest(), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "연결된 데이터로 인해 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            code: "CLIENT_DELETE_CONFLICT",
        });
    });

    it("does not expose an unrecognized upstream conflict message", async () => {
        mockDelete.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    error: "Conflict",
                    message: "relation client_private_internal_fkey failed",
                },
            },
        });

        const response = await DELETE(createRequest(), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "연결된 정보 때문에 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            code: "CLIENT_DELETE_CONFLICT",
        });
    });
});
