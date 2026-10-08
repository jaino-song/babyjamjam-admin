import { api } from "@/lib/api/client";

import { messageTriggersApi } from "./message-triggers.api";

jest.mock("@/lib/api/client", () => ({
    api: {
        get: jest.fn(),
    },
}));

const mockGet = api.get as jest.MockedFunction<typeof api.get>;

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
