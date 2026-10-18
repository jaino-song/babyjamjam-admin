import { api } from "@/lib/api/client";

import { eformsignApi } from "../eformsign";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

describe("getLinkConfirmations", () => {
    beforeEach(() => jest.clearAllMocks());

    it("sends the client ID for a per-client read", async () => {
        jest.mocked(api.get).mockResolvedValue({ data: [] });
        await expect(eformsignApi.getLinkConfirmations(7)).resolves.toEqual([]);
        expect(api.get).toHaveBeenCalledWith("/eformsign-docs/link-confirmations", {
            params: { clientId: 7 },
        });
    });

    it("omits params for a branch-wide read", async () => {
        jest.mocked(api.get).mockResolvedValue({ data: [] });
        await expect(eformsignApi.getLinkConfirmations()).resolves.toEqual([]);
        expect(api.get).toHaveBeenCalledWith("/eformsign-docs/link-confirmations", {});
    });
});
