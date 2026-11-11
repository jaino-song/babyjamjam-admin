import "reflect-metadata";
import {
    EformsignDocumentJobEntity,
    type EformsignDocumentJobProps,
} from "domain/entities/eformsign-document-job.entity";
import { toEformsignDocumentJobResponse } from "./eformsign-document-job.dto";

const job = (overrides: Partial<EformsignDocumentJobProps> = {}): EformsignDocumentJobEntity =>
    new EformsignDocumentJobEntity({
        id: "job-1", branchId: "branch-a", clientId: 7, documentId: "doc-1",
        jobType: "create_document", source: "staff", status: "processing",
        requestKey: "contract-create-1", activeKey: "create:branch-a:7",
        payload: { clientId: 7, contractData: { customerName: "고객" } },
        payloadFingerprint: "private-fingerprint", progressStep: "preparing", attempts: 1,
        nextAttemptAt: new Date("2026-11-03T00:00:00.000Z"), heartbeatAt: null,
        leaseToken: "private-lease", autoFinalizeOutcomeRecordedAt: null,
        autoFinalizeOutcomeAttempts: null, startedAt: null, completedAt: null,
        lastErrorCode: null, createdByUserId: "staff-private",
        createdAt: new Date("2026-11-02T00:00:00.000Z"),
        updatedAt: new Date("2026-11-03T00:00:00.000Z"), clientName: "고객",
        ...overrides,
    });

describe("toEformsignDocumentJobResponse display projection", () => {
    it.each([
        ["staff create", {}, "service_contract", "generate"],
        ["staff finalize", { jobType: "finalize_document", payload: { documentId: "doc-1" } }, "service_contract", "review"],
        ["scheduler finalize", { source: "auto_finalize", jobType: "finalize_document", payload: { documentId: "doc-1" } }, "service_contract", "review"],
        ["initial record generation needing manual review", {
            source: "auto_finalize", requestKey: "service-record-initial-finalization:1",
            payload: { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION", manualReviewRequired: true },
        }, "service_record", "generate"],
    ] as const)("labels known %s", (_label, overrides, documentKind, displayOperation) => {
        expect(toEformsignDocumentJobResponse(job(overrides))).toMatchObject({ documentKind, displayOperation });
    });

    describe.each(["completed", "reconciling"] as const)("cleared payload after %s", (status) => {
        it.each([
            ["staff", "create_document", "contract-create-1", "generate"],
            ["staff", "finalize_document", "contract-finalize-1", "review"],
            ["auto_finalize", "finalize_document", "auto_finalize:doc-1:2026-11-03", "review"],
        ] as const)("keeps %s %s label", (source, jobType, requestKey, displayOperation) => {
            expect(toEformsignDocumentJobResponse(job({
                source, jobType, requestKey, status, payload: null,
            }))).toMatchObject({ documentKind: "service_contract", displayOperation, recoveryKind: null });
        });
    });

    it.each([
        ["staff", "create_document", "contract-create-1", "generate"],
        ["staff", "finalize_document", "contract-finalize-1", "review"],
        ["auto_finalize", "finalize_document", "auto_finalize:doc-1:2026-11-03", "review"],
    ] as const)("preserves legacy cancelled %s %s label", (source, jobType, requestKey, displayOperation) => {
        expect(toEformsignDocumentJobResponse(job({
            source, jobType, requestKey, payload: null, status: "failed",
            lastErrorCode: "SERVICE_RECORD_REVISION_SUPERSEDED",
        }))).toMatchObject({ documentKind: "service_contract", displayOperation, failureReasonCode: null });
    });

    it.each([
        { requestKey: "service-record-initial-finalization:1" },
        { source: "auto_finalize", requestKey: "service-record-revision:1" },
        { source: "future" as EformsignDocumentJobProps["source"], jobType: "finalize_document", requestKey: "auto_finalize:doc-1:2026-11-03" },
        { source: "auto_finalize", jobType: "finalize_document", documentId: "doc 1", requestKey: "auto_finalize:doc 1:2026-11-03" },
        { source: "auto_finalize", jobType: "finalize_document", requestKey: "auto_finalize:doc-2:2026-11-03" },
        { source: "auto_finalize", jobType: "finalize_document", requestKey: "auto_finalize:doc-1:2026-02-30" },
        { source: "auto_finalize", jobType: "finalize_document", requestKey: "auto_finalize:doc-1:2026-02-29" },
        { source: "auto_finalize", jobType: "finalize_document", requestKey: "auto_finalize:doc-1:2026-11-3" },
        { source: "auto_finalize", jobType: "finalize_document", requestKey: "auto_finalize:doc-1:2026-11-03:extra" },
        { source: "auto_finalize", jobType: "finalize_document", requestKey: "auto_finalize:doc-1:2026-11-03", documentId: null },
        { source: "auto_finalize", jobType: "finalize_document", requestKey: "fake_auto_finalize:doc-1:2026-11-03" },
        { source: "auto_finalize", requestKey: "auto_finalize:doc-1:2026-11-03" },
    ] as const)("rejects insufficient null-payload producer evidence %j", (overrides) => {
        expect(toEformsignDocumentJobResponse(job({ payload: null, ...overrides })))
            .toMatchObject({ documentKind: "unknown", displayOperation: "unknown" });
    });

    it.each([
        { payload: { kind: "future_document", contractData: {} } },
        { payload: { generationKind: "FUTURE", contractData: {} } },
        { payload: { kind: "service_record_revision", generationKind: "FUTURE" }, source: "auto_finalize" },
        { payload: { kind: "service_record_revision_operations" }, source: "auto_finalize" },
        { payload: { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION" } },
        { payload: { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION" }, source: "auto_finalize", jobType: "finalize_document" },
        { payload: {} },
        { payload: { contractData: "invalid" } },
        { payload: { contractData: [] } },
        { source: "future" as EformsignDocumentJobProps["source"], jobType: "finalize_document", payload: { documentId: "doc-1" } },
        { source: "auto_finalize" },
        { jobType: "finalize_document", payload: { documentId: "" } },
    ] as const)("does not turn unknown payloads into contract or record review %j", (overrides) => {
        expect(toEformsignDocumentJobResponse(job(overrides)))
            .toMatchObject({ documentKind: "unknown", displayOperation: "unknown" });
    });

    it("fails closed for a future source or jobType, including null payloads", () => {
        for (const payload of [null, { documentId: "doc-1" }]) {
            // Deliberately exercise future persisted values outside today's TypeScript vocabulary.
            const unknownSource = job({ source: "future" as EformsignDocumentJobProps["source"], payload });
            const unknownType = job({ jobType: "future" as EformsignDocumentJobProps["jobType"], payload });
            for (const fixture of [unknownSource, unknownType]) {
                expect(toEformsignDocumentJobResponse(fixture))
                    .toMatchObject({ documentKind: "unknown", displayOperation: "unknown" });
            }
        }
    });

    it("validates a real leap-day scheduler date independently of the current date", () => {
        expect(toEformsignDocumentJobResponse(job({
            source: "auto_finalize", jobType: "finalize_document", payload: null,
            requestKey: "auto_finalize:doc-1:2028-02-29",
        }))).toMatchObject({ documentKind: "service_contract", displayOperation: "review" });
    });

    it("does not grant recovery authority from an auto-finalize display label", () => {
        expect(toEformsignDocumentJobResponse(job({
            source: "auto_finalize", jobType: "finalize_document", payload: null,
            requestKey: "auto_finalize:doc-1:2026-11-03", status: "requires_attention",
        }))).toMatchObject({ documentKind: "service_contract", displayOperation: "review", recoveryKind: null });
    });

    it.each([
        "PROVIDER_STATE_UNAVAILABLE", "PRE_SEND_RETRY_EXHAUSTED",
        "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED",
        "JOB_TARGET_NOT_OWNED_BY_BRANCH", "RECOVERY_PAYLOAD_EXPIRED",
    ])("exposes only the safe reason %s in failure or attention states", (lastErrorCode) => {
        for (const status of ["failed", "requires_attention"] as const) {
            expect(toEformsignDocumentJobResponse(job({ status, lastErrorCode })))
                .toMatchObject({ failureReasonCode: lastErrorCode });
        }
    });

    it.each(["queued", "processing", "reconciling", "completed"] as const)("clears stale reasons in %s", (status) => {
        expect(toEformsignDocumentJobResponse(job({ status, lastErrorCode: "PROVIDER_STATE_UNAVAILABLE" })))
            .toMatchObject({ failureReasonCode: null });
    });

    it.each([null, "MANUAL_REVIEW_REQUIRED", "raw provider error with private-contact", "PROVIDER_STATE_UNAVAILABLE:private-token"])(
        "redacts unknown reasons %s", (lastErrorCode) => {
            expect(toEformsignDocumentJobResponse(job({ status: "failed", lastErrorCode })))
                .toMatchObject({ failureReasonCode: null });
        },
    );

    it("exposes safe record reasons without exposing the coordinator's original error field", () => {
        expect(toEformsignDocumentJobResponse(job({
            source: "auto_finalize", requestKey: "service-record-initial-finalization:1", status: "requires_attention",
            payload: { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION" },
            lastErrorCode: "SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED",
        }))).toMatchObject({
            documentKind: "service_record", displayOperation: "generate", recoveryKind: null,
            failureReasonCode: "SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED", lastErrorCode: null,
        });
    });

    it("preserves existing fields and masks the manual claim without leaking internal inputs", () => {
        const response = toEformsignDocumentJobResponse(job({
            payload: { contractData: { customerContact: "private-contact", accessToken: "private-token", templateId: "private-template" } },
            progressStep: "manual_in_progress:staff-private:1793664600000",
            status: "requires_attention", lastErrorCode: "PROVIDER_STATE_UNAVAILABLE",
        }));
        expect(response).toMatchObject({
            jobId: "job-1", jobType: "create_document", source: "staff", status: "requires_attention",
            clientId: 7, documentId: "doc-1", progressStep: "manual_in_progress", attempts: 1,
            nextAttemptAt: "2026-11-03T00:00:00.000Z", startedAt: null, completedAt: null,
            createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z",
            clientName: "고객", recoveryKind: "verify_result", lastErrorCode: "PROVIDER_STATE_UNAVAILABLE",
        });
        for (const key of ["payload", "requestKey", "payloadFingerprint", "leaseToken", "activeKey", "createdByUserId", "branchId"]) {
            expect(response).not.toHaveProperty(key);
        }
        expect(JSON.stringify(response)).not.toMatch(/private-|staff-private|1793664600000/);
    });
});
