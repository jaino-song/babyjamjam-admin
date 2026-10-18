import { api } from "@/lib/api/client";

import { eformsignApi } from "../eformsign";

jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));

describe("voidContractDocument", () => {
    beforeEach(() => jest.clearAllMocks());

    it("posts to the void proxy without a request body and returns the payload", async () => {
        const payload = {
            documentId: "doc-1",
            voidedAt: "2026-10-13T01:02:03.000Z",
            voidedByName: "김지원",
            displayStatus: "voided" as const,
        };
        jest.mocked(api.post).mockResolvedValue({ data: payload });

        await expect(eformsignApi.voidContractDocument("doc-1")).resolves.toEqual(payload);

        expect(api.post).toHaveBeenCalledTimes(1);
        expect(jest.mocked(api.post).mock.calls[0]).toEqual(["/eformsign/documents/doc-1/void"]);
    });

    it("url-encodes the document id", async () => {
        jest.mocked(api.post).mockResolvedValue({ data: {} });

        await eformsignApi.voidContractDocument("a/b c");

        expect(jest.mocked(api.post).mock.calls[0][0]).toBe("/eformsign/documents/a%2Fb%20c/void");
    });

    it("lets a failure reach the caller so it can branch on the status", async () => {
        const failure = Object.assign(new Error("conflict"), { response: { status: 409 } });
        jest.mocked(api.post).mockRejectedValue(failure);

        await expect(eformsignApi.voidContractDocument("doc-1")).rejects.toBe(failure);
    });
});
