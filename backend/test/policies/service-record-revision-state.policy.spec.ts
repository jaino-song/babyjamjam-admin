import {
    authorizeServiceRecordDispatch,
    deriveServiceRecordDocumentSyncStatus,
    isRevisionDocumentDispatchAllowed,
    isValidServiceRecordDispatchContext,
} from "application/policies/service-record-revision-state.policy";
import type { ServiceRecordRevisionDispatchContext } from "@babyjamjam/shared/types/service-record";

const branchId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";

function context(overrides: Partial<ServiceRecordRevisionDispatchContext> = {}): ServiceRecordRevisionDispatchContext {
    return {
        branchId,
        clientId: 101,
        serviceRecordCaseId: caseId,
        revisionId: "33333333-3333-4333-8333-333333333333",
        revisionNumber: 2,
        businessFingerprint: "a".repeat(64),
        plannedSessionCount: 2,
        plannedSessionDates: [
            { sessionIndex: 1, serviceDate: "2026-09-07" },
            { sessionIndex: 2, serviceDate: "2026-09-08" },
        ],
        documentSyncStatus: "pending",
        lifecycleStatus: "IN_PROGRESS",
        formVersion: 3,
        ...overrides,
    };
}

describe("service-record revision dispatch state policy", () => {
    it("allows an unchanged complete context and ignores lifecycle-only bumps", () => {
        const expected = context({ lifecycleStatus: "IN_PROGRESS" });
        const observed = context({ lifecycleStatus: "COMPLETED" });

        expect(isValidServiceRecordDispatchContext(expected)).toBe(true);
        expect(authorizeServiceRecordDispatch(expected, observed)).toEqual({ kind: "allow" });
        // Phase0 capability is unverified for all revision-bound operations,
        // even when the captured status looks dispatchable.
        expect(isRevisionDocumentDispatchAllowed(observed)).toBe(false);
    });

    it("marks a changed revision/date context stale", () => {
        const result = authorizeServiceRecordDispatch(
            context(),
            context({
                revisionNumber: 3,
                plannedSessionDates: [
                    { sessionIndex: 1, serviceDate: "2026-09-08" },
                    { sessionIndex: 2, serviceDate: "2026-09-09" },
                ],
            }),
        );

        expect(result).toEqual({ kind: "stale", reason: "revision_or_business_state_changed" });
    });

    it("fails closed for unknown or malformed ownership state", () => {
        expect(isRevisionDocumentDispatchAllowed(context({ documentSyncStatus: "unknown" }))).toBe(false);
        expect(authorizeServiceRecordDispatch(
            context(),
            context({ branchId: "44444444-4444-4444-8444-444444444444" }),
        )).toEqual({ kind: "lost", reason: "ownership_changed" });
        expect(authorizeServiceRecordDispatch(
            context(),
            context({ plannedSessionCount: 3 }),
        )).toEqual({ kind: "lost", reason: "invalid_dispatch_context" });
    });

    it("derives synchronization from locked revision pointers and the owned job row", () => {
        const base = {
            currentRevisionId: context().revisionId,
            currentUsableRevisionId: context().revisionId,
            currentUsableDocumentVersion: 4,
            revisionJob: {
                revisionId: context().revisionId,
                payloadFingerprint: context().businessFingerprint,
                status: "queued",
                progressStep: "queued",
                completeness: "complete" as const,
                manualReviewRequired: false,
            },
        };
        expect(deriveServiceRecordDocumentSyncStatus(base)).toBe("pending");
        expect(deriveServiceRecordDocumentSyncStatus({
            ...base,
            revisionJob: { ...base.revisionJob, status: "processing", progressStep: "creating" },
        })).toBe("waiting_for_completion");
        expect(deriveServiceRecordDocumentSyncStatus({
            ...base,
            revisionJob: { ...base.revisionJob, status: "completed" },
        })).toBe("completed");
    });

    it("does not manufacture readiness from a missing or contradictory persisted row", () => {
        const revisionId = context().revisionId;
        const facts = {
            currentRevisionId: revisionId,
            currentUsableRevisionId: null,
            currentUsableDocumentVersion: null,
            revisionJob: {
                revisionId,
                payloadFingerprint: context().businessFingerprint,
                status: "completed",
                progressStep: "sent",
                completeness: "complete" as const,
                manualReviewRequired: false,
            },
        };
        expect(deriveServiceRecordDocumentSyncStatus(facts)).toBe("unknown");
        expect(deriveServiceRecordDocumentSyncStatus({
            ...facts,
            revisionJob: { ...facts.revisionJob, completeness: "partial" },
        })).toBe("unknown");
        expect(deriveServiceRecordDocumentSyncStatus({ ...facts, revisionJob: null })).toBe("unknown");
    });

    it("keeps legacy and revised identities distinct when revision rows are absent", () => {
        expect(deriveServiceRecordDocumentSyncStatus({
            currentRevisionId: null,
            currentUsableRevisionId: null,
            currentUsableDocumentVersion: null,
            revisionJob: null,
        })).toBe("not_required");
        expect(deriveServiceRecordDocumentSyncStatus({
            currentRevisionId: context().revisionId,
            currentUsableRevisionId: null,
            currentUsableDocumentVersion: null,
            revisionJob: null,
        })).toBe("unknown");
        expect(deriveServiceRecordDocumentSyncStatus({
            currentRevisionId: null,
            currentUsableRevisionId: null,
            currentUsableDocumentVersion: null,
            revisionJob: {
                revisionId: context().revisionId,
                payloadFingerprint: context().businessFingerprint,
                status: "queued",
                progressStep: "queued",
                completeness: "complete",
                manualReviewRequired: false,
            },
        })).toBe("unknown");
    });
});
