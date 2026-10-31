import {
    MANUAL_CLAIM_TTL_MS,
    buildManualClaimStep,
    classifyRecovery,
    isContractJob,
    parseManualClaim,
} from "domain/entities/eformsign-document-job.entity";

const contract = (overrides: Record<string, unknown> = {}) => ({
    source: "staff" as const,
    jobType: "create_document" as const,
    requestKey: "contract-create-1",
    payload: { clientId: 7, contractData: {} } as Record<string, unknown> | null,
    status: "failed" as const,
    progressStep: "preparing" as string | null,
    ...overrides,
});

describe("isContractJob", () => {
    it("accepts staff create and finalize jobs without a payload kind", () => {
        expect(isContractJob(contract())).toBe(true);
        expect(isContractJob(contract({ jobType: "finalize_document", payload: { documentId: "doc-1" } }))).toBe(true);
        expect(isContractJob(contract({ payload: null }))).toBe(true);
    });

    it.each([
        ["auto_finalize source", { source: "auto_finalize" }],
        ["service-record request key", { requestKey: "service-record-revision:abc" }],
        ["revision payload kind", { payload: { kind: "service_record_revision" } }],
        ["revision operations payload kind", { payload: { kind: "service_record_revision_operations" } }],
    ])("rejects %s", (_label, overrides) => {
        expect(isContractJob(contract(overrides))).toBe(false);
    });
});

describe("classifyRecovery", () => {
    it("lets staff send a failed contract job by hand", () => {
        expect(classifyRecovery(contract({ status: "failed" }))).toBe("manual_send");
        expect(classifyRecovery(contract({ status: "failed", jobType: "finalize_document" }))).toBe("manual_send");
    });

    it("only lets staff verify a requires_attention contract job, with or without a payload", () => {
        expect(classifyRecovery(contract({ status: "requires_attention" }))).toBe("verify_result");
        expect(classifyRecovery(contract({ status: "requires_attention", payload: null }))).toBe("verify_result");
    });

    it("keeps classifying a job that a staff member has claimed", () => {
        expect(classifyRecovery(contract({
            status: "requires_attention",
            progressStep: "manual_in_progress:user-1:1790000000000",
        }))).toBe("verify_result");
    });

    it.each(["queued", "processing", "reconciling", "completed"] as const)("returns null for %s", (status) => {
        expect(classifyRecovery(contract({ status }))).toBeNull();
    });

    it("returns null once the job was resolved by hand", () => {
        expect(classifyRecovery(contract({ status: "completed", progressStep: "manual_resolved" }))).toBeNull();
        expect(classifyRecovery(contract({ status: "failed", progressStep: "manual_resolved" }))).toBeNull();
    });

    it("returns null for service-record revision jobs and auto finalize jobs", () => {
        expect(classifyRecovery(contract({
            status: "failed",
            requestKey: "service-record-revision-1",
            payload: { kind: "service_record_revision_operations" },
        }))).toBeNull();
        expect(classifyRecovery(contract({ status: "requires_attention", source: "auto_finalize" }))).toBeNull();
    });
});

describe("manual recovery claim string", () => {
    it("round-trips a claim and expires it after the ttl", () => {
        const step = buildManualClaimStep("11111111-1111-4111-8111-111111111111", 1_790_000_000_000);
        expect(step).toBe(`manual_in_progress:11111111-1111-4111-8111-111111111111:${1_790_000_000_000 + MANUAL_CLAIM_TTL_MS}`);
        expect(parseManualClaim(step)).toEqual({
            userId: "11111111-1111-4111-8111-111111111111",
            expiresAtMs: 1_790_000_000_000 + MANUAL_CLAIM_TTL_MS,
        });
        expect(MANUAL_CLAIM_TTL_MS).toBe(10 * 60_000);
    });

    it.each([
        null,
        undefined,
        "",
        "preparing",
        "manual_resolved",
        "manual_in_progress",
        "manual_in_progress:",
        "manual_in_progress:user-1",
        "manual_in_progress:user-1:",
        "manual_in_progress::1790000000000",
        "manual_in_progress:user-1:abc",
        "manual_in_progress:user-1:12.5",
        "manual_in_progress:user-1:-5",
        "manual_in_progress:a:b:1790000000000",
        "manual_in_progress:user-1:1234567890123456",
        "xmanual_in_progress:user-1:1790000000000",
        "manual_in_progress:user-1:1790000000000x",
    ])("returns null for %p", (value) => {
        expect(parseManualClaim(value as string | null | undefined)).toBeNull();
    });
});
