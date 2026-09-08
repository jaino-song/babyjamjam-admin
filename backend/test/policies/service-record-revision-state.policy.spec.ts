import {
    authorizeServiceRecordDispatch,
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
        expect(isRevisionDocumentDispatchAllowed(observed)).toBe(true);
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
});
