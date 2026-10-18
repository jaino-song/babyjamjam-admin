import { api } from "@/lib/api/client";

import { messageTriggersApi } from "./message-triggers.api";

jest.mock("@/lib/api/client", () => ({
    api: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = api.get as jest.MockedFunction<typeof api.get>;
const mockPost = api.post as jest.MockedFunction<typeof api.post>;

describe("messageTriggersApi.resendJob", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("posts to the resend endpoint with the bare job uuid", async () => {
        mockPost.mockResolvedValue({ data: { id: "job-uuid", status: "sent", reason: null } });

        await messageTriggersApi.resendJob("6f0c7a52-6d41-4c63-9d0e-3a5b8a5f2b11");

        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mockPost).toHaveBeenCalledWith(
            "/message-trigger-jobs/6f0c7a52-6d41-4c63-9d0e-3a5b8a5f2b11/resend",
        );
    });
});

describe("messageTriggersApi.listClientHistory", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("reads the client-scoped history endpoint with the default page size", async () => {
        mockGet.mockResolvedValue({ data: { items: [], page: { nextCursor: null } } });

        await messageTriggersApi.listClientHistory(42);

        expect(mockGet).toHaveBeenCalledWith("/message-logs/client/42", { params: { limit: 50 } });
    });

    it("forwards the opaque cursor and a custom page size", async () => {
        mockGet.mockResolvedValue({ data: { items: [], page: { nextCursor: null } } });

        await messageTriggersApi.listClientHistory(42, { limit: 25, cursor: "opaque-cursor" });

        expect(mockGet).toHaveBeenCalledWith("/message-logs/client/42", {
            params: { limit: 25, cursor: "opaque-cursor" },
        });
    });
});
