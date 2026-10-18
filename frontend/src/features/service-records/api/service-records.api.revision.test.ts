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

    describe("revision changes", () => {
        const validChanges = {
            revisionId: "revision-2",
            revisionNumber: 2,
            confirmedAt: "2026-09-09T16:30:00.000Z",
            formVersion: 1,
            beforeAvailable: true,
            basicInfo: [{ path: "header.momName", before: "김산모", after: "이산모" }],
            sessions: [{
                sessionIndex: 2,
                kind: "changed",
                serviceDateBefore: "2026-07-12",
                serviceDateAfter: null,
                changes: [
                    { path: "session.answers.perineum", before: ["이상없음"], after: ["열상"] },
                    { path: "session.paymentConfirmed", before: false, after: true },
                    { path: "session.answers.meals_meal", before: null, after: 4 },
                ],
            }],
        };

        it("requests the revision's changes and returns the validated shape", async () => {
            mockGet.mockResolvedValue({ status: 200, data: validChanges });

            const response = await serviceRecordsApi.getClientRevisionChanges(7, "revision/2");

            expect(mockGet).toHaveBeenCalledWith("/admin/service-records/clients/7/revisions/revision%2F2/changes");
            expect(response.data).toEqual(validChanges);
        });

        it("accepts a revision without stored before content", async () => {
            mockGet.mockResolvedValue({ status: 200, data: { ...validChanges, beforeAvailable: false, basicInfo: [], sessions: [] } });

            const response = await serviceRecordsApi.getClientRevisionChanges(7, "revision-2");

            expect(response.data.beforeAvailable).toBe(false);
        });

        it.each([
            ["a non-object body", "nope"],
            ["a missing beforeAvailable flag", { ...validChanges, beforeAvailable: undefined }],
            ["a non-boolean beforeAvailable", { ...validChanges, beforeAvailable: "true" }],
            ["a missing revisionId", { ...validChanges, revisionId: "" }],
            ["a zero revisionNumber", { ...validChanges, revisionNumber: 0 }],
            ["an unparseable confirmedAt", { ...validChanges, confirmedAt: "yesterday" }],
            ["a missing formVersion", { ...validChanges, formVersion: undefined }],
            ["a non-array basicInfo", { ...validChanges, basicInfo: {} }],
            ["a non-array sessions", { ...validChanges, sessions: null }],
            ["a basic change without a path", { ...validChanges, basicInfo: [{ path: "", before: "a", after: "b" }] }],
            ["a change value that is an object", { ...validChanges, basicInfo: [{ path: "header.momName", before: { a: 1 }, after: "b" }] }],
            ["a change value list holding non-strings", { ...validChanges, basicInfo: [{ path: "header.momName", before: [1], after: "b" }] }],
            ["a change with a missing after", { ...validChanges, basicInfo: [{ path: "header.momName", before: "a" }] }],
            ["an unknown session kind", { ...validChanges, sessions: [{ ...validChanges.sessions[0], kind: "moved" }] }],
            ["a session without an index", { ...validChanges, sessions: [{ ...validChanges.sessions[0], sessionIndex: 0 }] }],
            ["a malformed session date", { ...validChanges, sessions: [{ ...validChanges.sessions[0], serviceDateBefore: "07/12" }] }],
            ["a missing session date", { ...validChanges, sessions: [{ ...validChanges.sessions[0], serviceDateAfter: undefined }] }],
            ["session changes that are not a list", { ...validChanges, sessions: [{ ...validChanges.sessions[0], changes: null }] }],
        ])("rejects %s", async (_name, data) => {
            mockGet.mockResolvedValue({ status: 200, data });

            await expect(serviceRecordsApi.getClientRevisionChanges(7, "revision-2")).rejects.toThrow(
                /Invalid service-record revision/,
            );
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

    it("preserves the root authoritative schedule projection for the regular client overview", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                record: { totalSessions: 2 },
                assignments: [],
                scheduleProjection: {
                    entries: [
                        {
                            sessionIndex: 1,
                            serviceDate: "2026-09-08",
                            originalDate: "2026-09-01",
                            assignmentId: "assignment-1",
                            scheduleId: 7,
                            employeeId: 12,
                            provenanceVersion: "case-7",
                        },
                        {
                            sessionIndex: 2,
                            serviceDate: "2026-09-09",
                            originalDate: "2026-09-02",
                            assignmentId: "assignment-1",
                            scheduleId: 7,
                            employeeId: 12,
                            provenanceVersion: "case-7",
                        },
                    ],
                    blockingReasons: [],
                },
            },
        });

        const response = await serviceRecordsApi.getClientOverview(7);

        expect(mockGet).toHaveBeenCalledWith("/admin/service-records/client/7");
        expect(response.data.scheduleProjection).toEqual({
            entries: [
                expect.objectContaining({
                    sessionIndex: 1,
                    serviceDate: "2026-09-08",
                    originalDate: "2026-09-01",
                }),
                expect.objectContaining({
                    sessionIndex: 2,
                    serviceDate: "2026-09-09",
                    originalDate: "2026-09-02",
                }),
            ],
            blockingReasons: [],
        });
        expect(response.data.record).toEqual({ totalSessions: 2 });
    });

    it("turns a malformed authoritative projection into a blocker instead of legacy fallback", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                record: null,
                assignments: [],
                scheduleProjection: {
                    entries: [{
                        sessionIndex: 2,
                        serviceDate: "2026-09-09",
                        originalDate: "2026-09-02",
                        assignmentId: "assignment-1",
                        scheduleId: 7,
                        employeeId: 12,
                        provenanceVersion: "case-7",
                    }],
                    blockingReasons: [],
                },
            },
        });

        const response = await serviceRecordsApi.getClientOverview(7);

        expect(response.data.scheduleProjection).toEqual({
            entries: [],
            blockingReasons: [{
                code: "INVALID_SCHEDULE_PROJECTION",
                message: "서비스 예정 회차 근거를 확인할 수 없습니다.",
            }],
        });
    });
});
