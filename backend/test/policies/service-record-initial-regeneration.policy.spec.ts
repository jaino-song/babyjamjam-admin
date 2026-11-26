import { Prisma } from "@prisma/client";
import {
    initialRegenerationReadiness,
    releaseTerminalInitialFinalizationKey,
} from "application/policies/service-record-initial-finalization.policy";

const state = { id: "state", branchId: "branch", clientId: 7, revisionId: "revision", generation: "gen2",
    documentVersion: 2, status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" };
const terminal = { documentId: "doc", statusType: "049", voided: false, purgePending: false, tombstoneEvaluated: true };
function fixture(overrides = {}, chunks: Record<string, unknown>[] = [terminal], jobs: Record<string, unknown>[] = []) {
    const queries: Prisma.Sql[] = [];
    const tx = {
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            queries.push(sql);
            if (sql.text.includes('FROM "service_record_case"')) return [{ id: "case", branchId: "branch", clientId: 7 }];
            if (sql.text.includes('FROM "service_record_revision_document_state"')) return [{ ...state, ...overrides }];
            if (sql.text.includes('FROM "service_record_snapshot_chunk"')) return chunks.map((chunk, index) => ({ chunkIndex: index + 1, chunkCount: chunks.length, ...chunk }));
            if (sql.text.includes('FROM "eformsign_doc"')) return chunks.filter(chunk => chunk["documentId"]);
            if (sql.text.includes('FROM "eformsign_document_job"')) return jobs;
            return [];
        }),
        $executeRaw: jest.fn().mockResolvedValue(1),
    };
    return { tx, queries };
}

describe("INITIAL regeneration readiness", () => {
    it.each(["SERVICE_RECORD_REVISION_DOCUMENT_REJECTED", "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED",
        "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT", "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH"])("accepts the deployed terminal code %s", async lastErrorCode => {
        const f = fixture({ lastErrorCode });
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: true, state: { generation: "gen2" } });
        expect(f.queries[1]!.text).toContain("ORDER BY state.created_at DESC, state.id DESC");
        expect(f.queries[1]!.text).toContain("LIMIT 1");
    });
    it.each(["SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT", "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH"])("accepts unlinked chunks only with transactional absence proof %s", async lastErrorCode => {
        const f = fixture({ lastErrorCode }, [{ documentId: null }]);
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: true });
    });
    it.each([
        [{ documentId: null }, "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"],
        [{ ...terminal, statusType: "070" }, "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"],
        [{ ...terminal, purgePending: true }, "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"],
        [{ ...terminal, statusType: "003" }, "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED"],
    ])("blocks unsafe sibling %#", async (chunk, reason) => {
        const f = fixture({}, [terminal, chunk as Record<string, unknown>]);
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: false, reason });
    });
    it("blocks regeneration immediately after purge even before the evaluator or sweep runs", async () => {
        const f = fixture({}, [{ ...terminal, statusType: " DOC_DELETE ", tombstoneEvaluated: false }]);
        expect(await releaseTerminalInitialFinalizationKey(f.tx as never, "case", "revision")).toMatchObject({
            ready: false, reason: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN",
        });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    });
    it("prioritizes a completed sibling over an in-progress sibling", async () => {
        const f = fixture({}, [{ ...terminal, statusType: "070" }, { ...terminal, statusType: "003" }]);
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED" });
    });
    it.each(["SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED", "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN",
        "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "JOB_CANCELLED_AFTER_DISPATCH"])("never permits %s", async lastErrorCode => {
        const f = fixture({ lastErrorCode });
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: false });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    });
    it.each(["queued", "processing", "reconciling", "leased"])("blocks any case INITIAL job that is %s", async status => {
        const f = fixture({}, [terminal], [{ status: status === "leased" ? "failed" : status, leaseToken: status === "leased" ? "lease" : null }]);
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS" });
    });
    it.each(["SERVICE_RECORD_REVISION_DOCUMENT_REJECTED", "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH"])("refuses missing chunk coverage under %s", async lastErrorCode => {
        const f = fixture({ lastErrorCode }, []);
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS" });
    });
    it("accepts zero chunk rows with the NO_PROVIDER_DOCUMENT attestation outcome", async () => {
        const f = fixture({ lastErrorCode: "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT" }, []);
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: true });
    });
    it.each(["processing", "manual_review", "completed", "waiting_for_completion", "not_required"])("never treats the newest %s state as terminal-ready", async status => {
        const f = fixture({ status, lastErrorCode: null });
        expect(await initialRegenerationReadiness(f.tx as never, "case", "revision")).toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_STATE_NOT_READY" });
        expect(f.queries).toHaveLength(2);
    });
    it("allows a completed dispatch job while preserving its completed status", async () => {
        const f = fixture({}, [terminal], [{ status: "completed", leaseToken: null }]);
        expect(await releaseTerminalInitialFinalizationKey(f.tx as never, "case", "revision")).toMatchObject({ ready: true });
        const sql = f.tx.$executeRaw.mock.calls[0]![0] as Prisma.Sql;
        expect(sql.text).toContain("status IN ('failed', 'requires_attention')");
    });
    it("rechecks readiness before releasing only unleased failed/attention jobs of that generation", async () => {
        const f = fixture();
        expect(await releaseTerminalInitialFinalizationKey(f.tx as never, "case", "revision")).toMatchObject({ ready: true });
        const sql = f.tx.$executeRaw.mock.calls[0]![0] as Prisma.Sql;
        expect(sql.text).toContain("status IN ('failed', 'requires_attention')");
        expect(sql.text).toContain("lease_token IS NULL");
        expect(sql.text).toContain("active_key = NULL");
        expect(sql.values).toContain("gen2");
        expect(sql.text).not.toContain("status = 'completed'");
    });
    it("does not mutate a blocked or leased generation", async () => {
        const f = fixture({}, [terminal], [{ status: "requires_attention", leaseToken: "lease" }]);
        expect(await releaseTerminalInitialFinalizationKey(f.tx as never, "case", "revision")).toMatchObject({ ready: false });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    });
});
