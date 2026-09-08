import { AdminServiceRecordEditApiError } from "../types";
import {
    adminServiceRecordEditApi,
    normalizeAdminServiceRecordEditPreview,
    normalizeAdminServiceRecordEditState,
} from "./admin-service-record-edit.api";

const originalFetch = global.fetch;

function response(body: unknown, status: number) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response;
}

const strictMetadata = {
    signatureMetadata: {
        treatment: "preserve_existing",
        evidence: "observed",
        sessions: [{ sessionIndex: 1, hasSignature: true, signedAt: "2026-07-11T01:00:00.000Z", submittedAt: "2026-07-11T02:00:00.000Z" }],
    },
    documentScope: {
        evidence: "observed",
        serviceRecordSnapshot: {
            documentIds: ["doc-1"],
            snapshotVersion: 2,
            chunks: [{ documentId: "doc-1", snapshotVersion: 2, snapshotChunkIndex: 1 }],
        },
        currentRevision: { id: "revision-1", revisionNumber: 1, formVersion: 1 },
        form: { version: 1 },
        contract: { currentDocumentId: "contract-1", stage: "in_progress" },
    },
};

function strictPreview(overrides: Record<string, unknown> = {}) {
    const sessions = Array.from({ length: 13 }, (_, index) => ({
        sessionIndex: index + 1,
        serviceDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        originalDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        assignmentId: "assignment-1",
        scheduleId: 7,
        employeeId: 12,
        provenanceVersion: "case-7",
    }));
    return {
        previewId: "preview-13",
        draftId: "draft-13",
        draftVersion: 2,
        sourceCaseVersion: 7,
        sourceFingerprint: "source-13",
        requiredSessionCount: 13,
        calendarVersion: "kr-2026",
        before: { startDate: "2026-07-01", endDate: "2026-07-20", sessions },
        after: { startDate: "2026-07-01", endDate: "2026-07-20", sessions },
        provenance: [{
            assignmentId: "assignment-1",
            scheduleId: 7,
            employeeId: 12,
            startDate: "2026-07-01",
            endDate: "2026-07-20",
            provenanceVersion: "case-7",
        }],
        contentChanges: { headerChanged: false, changedSessionIndexes: [] },
        impactedAssignments: [],
        blockingReasons: [],
        ...strictMetadata,
        ...overrides,
    };
}

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe("admin service-record edit API adapter", () => {
    it("uses explicit start, no-write GET, CAS patch, and CAS discard routes", async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response({ draft: null }, 200))
            .mockResolvedValueOnce(response({ draft: { id: "d-1", status: "ACTIVE", changes: {} } }, 201))
            .mockResolvedValueOnce(response({ draft: { id: "d-1", status: "ACTIVE", changes: {}, draftVersion: 2 } }, 200))
            .mockResolvedValueOnce(response({ draft: { id: "d-1", status: "DISCARDED", changes: {}, draftVersion: 3 } }, 200));

        await adminServiceRecordEditApi.getDraft("client/1");
        await adminServiceRecordEditApi.startDraft("client/1");
        await adminServiceRecordEditApi.updateDraft("draft/1", 1, { sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10", notes: "memo" }] });
        await adminServiceRecordEditApi.discardDraft("draft/1", 2);

        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            "/api/admin/service-records/client/client%2F1/draft",
            expect.objectContaining({ method: "GET", cache: "no-store" }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            "/api/admin/service-records/client/client%2F1/draft",
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            3,
            "/api/admin/service-records/drafts/draft%2F1",
            expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedDraftVersion: 1, changes: { sessions: [{ sessionIndex: 1, notes: "memo" }] } }) }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            4,
            "/api/admin/service-records/drafts/draft%2F1/discard",
            expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedDraftVersion: 2 }) }),
        );
    });

    it("preserves a 409 response body for explicit conflict handling", async () => {
        global.fetch = jest.fn().mockResolvedValue(response({
            code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT",
            latestDraft: { id: "d-1", status: "ACTIVE", changes: {}, draftVersion: 4 },
            sourceChanged: true,
            sourceCaseVersion: 9,
            sourceFingerprint: "source-9",
        }, 409));

        await expect(adminServiceRecordEditApi.updateDraft("d-1", 3, {})).rejects.toEqual(
            expect.objectContaining({
                status: 409,
                body: expect.objectContaining({ code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT" }),
            }),
        );
        await expect(adminServiceRecordEditApi.updateDraft("d-1", 3, {})).rejects.toBeInstanceOf(AdminServiceRecordEditApiError);
    });

    it("sends an explicit dateMove and reads a typed preview without inferring dates", async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response({ draft: { id: "d-1", status: "ACTIVE", changes: {}, draftVersion: 2 } }, 200))
            .mockResolvedValueOnce(response({
                previewId: "preview-1",
                draftId: "d-1",
                draftVersion: 2,
                sourceCaseVersion: 3,
                sourceFingerprint: "source-3",
                requiredSessionCount: 3,
                calendarVersion: "kr-2026",
                before: {
                    startDate: "2026-07-10",
                    endDate: "2026-07-14",
                    sessions: [],
                },
                after: {
                    startDate: "2026-07-13",
                    endDate: "2026-07-17",
                    sessions: [],
                },
                provenance: [],
                contentChanges: { headerChanged: false, changedSessionIndexes: [2] },
                impactedAssignments: ["assignment-1"],
                blockingReasons: [],
            }, 200));

        await adminServiceRecordEditApi.updateDraft(
            "d-1",
            1,
            { sessions: [{ sessionIndex: 1, answers: { notes: "keep" } }] },
            { sessionIndex: 2, toDate: "2026-07-13" },
        );
        const preview = await adminServiceRecordEditApi.previewDraft("d-1", 2);

        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            "/api/admin/service-records/drafts/d-1",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({
                    expectedDraftVersion: 1,
                    changes: { sessions: [{ sessionIndex: 1, answers: { notes: "keep" } }] },
                    dateMove: { sessionIndex: 2, toDate: "2026-07-13" },
                }),
            }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            "/api/admin/service-records/drafts/d-1/preview",
            expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedDraftVersion: 2 }) }),
        );
        expect(preview).toEqual(expect.objectContaining({
            previewId: "preview-1",
            draftVersion: 2,
            requiredSessionCount: 3,
            impactedAssignments: ["assignment-1"],
            contentChanges: { headerChanged: false, changedSessionIndexes: [2] },
        }));
    });

    it("sends the exact preview-bound confirm body and rejects a malformed success", async () => {
        const result = {
            status: "confirmed",
            caseId: "case-1",
            clientId: 42,
            draftId: "draft-1",
            draftVersion: 3,
            caseVersion: 8,
            revisionId: "revision-1",
            revisionNumber: 2,
            documentStatus: "waiting_for_completion",
            confirmedAt: "2026-09-08T01:02:03.000Z",
        };
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(result, 200))
            .mockResolvedValueOnce(response({ status: "confirmed" }, 200));

        await expect(adminServiceRecordEditApi.confirmDraft(
            "draft/1",
            3,
            "preview-1",
            "11111111-1111-4111-8111-111111111111",
        )).resolves.toEqual(result);
        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            "/api/admin/service-records/drafts/draft%2F1/confirm",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    expectedDraftVersion: 3,
                    previewId: "preview-1",
                    idempotencyKey: "11111111-1111-4111-8111-111111111111",
                }),
            }),
        );
        await expect(adminServiceRecordEditApi.confirmDraft(
            "draft-1",
            3,
            "preview-1",
            "11111111-1111-4111-8111-111111111111",
        )).rejects.toThrow("Invalid service record confirm response");
    });

    it("turns a malformed preview envelope into a blocked preview instead of throwing", () => {
        expect(normalizeAdminServiceRecordEditPreview(null).blockingReasons).toEqual([
            { code: "INVALID_PREVIEW_RESPONSE", message: "미리보기 응답을 확인할 수 없습니다." },
        ]);
    });

    it("fails closed when a required N=13 preview is missing, duplicated, or has bad provenance", () => {
        const missing = normalizeAdminServiceRecordEditPreview(strictPreview({
            before: { ...strictPreview().before, sessions: strictPreview().before.sessions.slice(0, 12) },
        }));
        expect((missing.blockingReasons as Array<{ code: string }>).map((reason) => reason.code)).toContain("INVALID_PREVIEW_RESPONSE");

        const duplicateSessions = [...strictPreview().before.sessions];
        duplicateSessions[12] = { ...duplicateSessions[11] };
        const duplicate = normalizeAdminServiceRecordEditPreview(strictPreview({
            before: { ...strictPreview().before, sessions: duplicateSessions },
        }));
        expect((duplicate.blockingReasons as Array<{ code: string }>).map((reason) => reason.code)).toContain("INVALID_PREVIEW_RESPONSE");

        const badProvenance = normalizeAdminServiceRecordEditPreview(strictPreview({
            provenance: [{
                ...strictPreview().provenance[0],
                employeeId: 0,
            }],
        }));
        expect((badProvenance.blockingReasons as Array<{ code: string }>).map((reason) => reason.code)).toContain("INVALID_PREVIEW_RESPONSE");
    });

    it("rejects omitted metadata while preserving an explicit unverified response", () => {
        const { signatureMetadata: omittedSignatureMetadata, ...withoutSignatureMetadata } = strictPreview();
        expect(omittedSignatureMetadata).toBeDefined();
        const missing = normalizeAdminServiceRecordEditPreview(withoutSignatureMetadata);
        expect(missing.blockingReasons.map((reason) => reason.code)).toContain("INVALID_PREVIEW_RESPONSE");

        const explicitUnverified = normalizeAdminServiceRecordEditPreview(strictPreview({
            signatureMetadata: {
                treatment: "manual_review",
                evidence: "unverified",
                sessions: [],
            },
            documentScope: {
                evidence: "unverified",
                serviceRecordSnapshot: { documentIds: [], snapshotVersion: null, chunks: [] },
                currentRevision: { id: null, revisionNumber: null, formVersion: null },
                form: { version: null },
                contract: { currentDocumentId: null, stage: null },
            },
        }));
        expect(explicitUnverified.blockingReasons).toEqual([]);
        expect(explicitUnverified.signatureMetadata.evidence).toBe("unverified");
        expect(explicitUnverified.documentScope.contract.stage).toBeNull();
    });

    it("keeps a legitimate blocked projection without replacing its server reasons", () => {
        const preview = normalizeAdminServiceRecordEditPreview({
            ...strictPreview(),
            before: { startDate: null, endDate: null, sessions: [] },
            after: { startDate: null, endDate: null, sessions: [] },
            provenance: [],
            blockingReasons: [{ code: "UNSUPPORTED_SESSION_COUNT", message: "회차 수를 확인할 수 없습니다." }],
        });

        expect(preview.blockingReasons).toEqual([
            { code: "UNSUPPORTED_SESSION_COUNT", message: "회차 수를 확인할 수 없습니다." },
        ]);
        expect(preview.before.sessions).toEqual([]);
        expect(preview.after.sessions).toEqual([]);
    });

    it.each([undefined, "13", 0, -1, 1.5, Number.NaN])("rejects malformed blocked-preview count %s while preserving explicit null", (count) => {
        const blocked = strictPreview({
            requiredSessionCount: null,
            before: { startDate: null, endDate: null, sessions: [] },
            after: { startDate: null, endDate: null, sessions: [] },
            provenance: [],
            blockingReasons: [{ code: "UNSUPPORTED_SESSION_COUNT", message: "회차 수를 확인할 수 없습니다." }],
        });
        expect(normalizeAdminServiceRecordEditPreview(blocked).blockingReasons.map((reason) => reason.code))
            .toEqual(["UNSUPPORTED_SESSION_COUNT"]);
        const malformed = { ...blocked, requiredSessionCount: count };
        if (count === undefined) Reflect.deleteProperty(malformed, "requiredSessionCount");
        expect(normalizeAdminServiceRecordEditPreview(malformed).blockingReasons.map((reason) => reason.code))
            .toEqual(["UNSUPPORTED_SESSION_COUNT", "INVALID_PREVIEW_RESPONSE"]);
    });

    it("does not waive malformed metadata, rejects duplicate current dates, and accepts shifted originals and chunk index zero", () => {
        const { signatureMetadata, documentScope, ...withoutMetadata } = strictPreview();
        expect(signatureMetadata).toBeDefined();
        expect(documentScope).toBeDefined();
        const blockedMissingMetadata = normalizeAdminServiceRecordEditPreview({
            ...withoutMetadata,
            before: { startDate: null, endDate: null, sessions: [] },
            after: { startDate: null, endDate: null, sessions: [] },
            provenance: [],
            blockingReasons: [{ code: "UNSUPPORTED_SESSION_COUNT", message: "회차 수를 확인할 수 없습니다." }],
        });
        expect(blockedMissingMetadata.blockingReasons.map((reason) => reason.code)).toEqual([
            "UNSUPPORTED_SESSION_COUNT",
            "INVALID_PREVIEW_RESPONSE",
        ]);

        const { sourceFingerprint: _sourceFingerprint, ...withoutSourceFingerprint } = strictPreview();
        const blockedMissingEnvelope = normalizeAdminServiceRecordEditPreview({
            ...withoutSourceFingerprint,
            before: { startDate: null, endDate: null, sessions: [] },
            after: { startDate: null, endDate: null, sessions: [] },
            provenance: [],
            blockingReasons: [{ code: "UNSUPPORTED_SESSION_COUNT", message: "회차 수를 확인할 수 없습니다." }],
        });
        expect(blockedMissingEnvelope.blockingReasons.map((reason) => reason.code)).toEqual([
            "UNSUPPORTED_SESSION_COUNT",
            "INVALID_PREVIEW_RESPONSE",
        ]);

        const duplicateSessions = [...strictPreview().before.sessions];
        duplicateSessions[12] = {
            ...duplicateSessions[12],
            serviceDate: duplicateSessions[11].serviceDate,
        };
        const duplicateDates = normalizeAdminServiceRecordEditPreview(strictPreview({
            before: { ...strictPreview().before, sessions: duplicateSessions },
        }));
        expect(duplicateDates.blockingReasons.map((reason) => reason.code)).toContain("INVALID_PREVIEW_RESPONSE");

        const shiftedAfterSessions = strictPreview().after.sessions.map((session) => ({
            ...session,
            serviceDate: `2026-07-${String(session.sessionIndex + 1).padStart(2, "0")}`,
        }));
        const shifted = normalizeAdminServiceRecordEditPreview(strictPreview({
            after: { startDate: "2026-07-02", endDate: "2026-07-21", sessions: shiftedAfterSessions },
            provenance: [{
                ...strictPreview().provenance[0],
                startDate: "2026-07-02",
                endDate: "2026-07-21",
            }],
            documentScope: {
                ...strictMetadata.documentScope,
                serviceRecordSnapshot: {
                    ...strictMetadata.documentScope.serviceRecordSnapshot,
                    chunks: [{ documentId: "doc-1", snapshotVersion: 2, snapshotChunkIndex: 0 }],
                },
            },
        }));
        expect(shifted.blockingReasons).toEqual([]);
        expect(shifted.after.sessions[0]).toEqual(expect.objectContaining({
            serviceDate: "2026-07-02",
            originalDate: "2026-07-01",
        }));

        const invalidStage = normalizeAdminServiceRecordEditPreview(strictPreview({
            documentScope: {
                ...strictMetadata.documentScope,
                contract: { currentDocumentId: "contract-1", stage: "sent" },
            },
        }));
        expect(invalidStage.blockingReasons.map((reason) => reason.code)).toContain("INVALID_PREVIEW_RESPONSE");
    });

    it("normalizes a discarded draft without applying provenance fields", () => {
        const state = normalizeAdminServiceRecordEditState({
            draft: {
                id: "d-1",
                status: "DISCARDED",
                changes: { sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] },
                sourceSnapshot: { answers: { secret: true } },
                discardedAt: "2026-07-11T00:00:00.000Z",
            },
            sourceChanged: false,
            sourceCaseVersion: 2,
            sourceFingerprint: "f-2",
        });

        expect(state.draft?.status).toBe("DISCARDED");
        expect(state.draft?.changes).toEqual({ sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] });
        expect(state.draft?.sourceSnapshot).toEqual({ answers: { secret: true } });
    });
});
