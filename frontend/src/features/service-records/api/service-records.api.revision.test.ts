import { api } from "@/lib/api/client";

import { serviceRecordsApi } from "./service-records.api";

jest.mock("@/lib/api/client", () => ({
    api: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;

describe("service-record revision API", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("normalizes history responses to the shared safe shape", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                caseId: "case-1",
                caseVersion: 3,
                currentRevisionId: "revision-1",
                currentUsableRevisionId: null,
                revisions: [{
                    id: "revision-1",
                    revisionNumber: 1,
                    confirmedAt: "2026-09-08T01:02:03.000Z",
                    isCurrent: true,
                    documents: [{
                        id: "state-1",
                        operation: "record_snapshot",
                        generation: "generation-1",
                        status: "unknown-vendor-status",
                        documentVersion: null,
                        canRetry: false,
                        reasonCode: "provider body must not leak",
                    }],
                }],
            },
        });

        const response = await serviceRecordsApi.getClientRevisionHistory(7);

        expect(mockGet).toHaveBeenCalledWith("/admin/service-records/clients/7/revisions");
        expect(response.data.revisions[0]?.documents[0]).toEqual({
            id: "state-1",
            operation: "record_snapshot",
            generation: "generation-1",
            status: "unknown",
            documentVersion: null,
            canRetry: false,
            reasonCode: null,
        });
    });

    it("sends only expectedGeneration for a retry", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: {
                id: "state-1",
                operation: "record_snapshot",
                generation: "generation-1",
                status: "pending",
                documentVersion: 2,
                canRetry: false,
                reasonCode: null,
            },
        });

        await serviceRecordsApi.retryRevisionDocument({
            revisionId: "revision-1",
            documentStateId: "state-1",
            expectedGeneration: "generation-1",
        });

        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/revisions/revision-1/documents/state-1/retry",
            { expectedGeneration: "generation-1" },
        );
    });
});
