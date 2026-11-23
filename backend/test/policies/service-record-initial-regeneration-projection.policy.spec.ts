import { Prisma } from "@prisma/client";
import { initialRegenerationProjections } from "application/policies/service-record-initial-regeneration-projection.policy";

const state = { id: "state", revisionId: "revision", generation: "gen1", branchId: "branch", clientId: 7,
    caseId: "case", documentVersion: 3, status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" };

function candidate(statusType: string, tombstoneEvaluated = true) {
    return { ...state, jobInProgress: false, chunks: [{ chunkIndex: 1, chunkCount: 1, documentId: "doc",
        document: { documentId: "doc", statusType, voided: false, purgePending: false, tombstoneEvaluated } }] };
}

function fixture(rows: unknown[]) {
    const tx = { $queryRaw: jest.fn<Promise<unknown[]>, [Prisma.Sql]>().mockResolvedValue(rows) };
    return { tx };
}

describe("INITIAL regeneration display projection", () => {
    it.each([["049", true, null], ["070", false, "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"],
        [" doc_complete ", false, "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED"]] as const)("projects newest state for %s", async (status, ready, reasonCode) => {
        const f = fixture([candidate(status)]);
        expect(await initialRegenerationProjections(f.tx as never, "branch")).toEqual([{
            stateId: "state", revisionId: "revision", generation: "gen1", clientId: 7, ready, reasonCode,
        }]);
        const [sql] = f.tx.$queryRaw.mock.calls[0]!;
        expect(sql.text).not.toContain("FOR UPDATE");
        expect(sql.text).toContain("record.current_revision_id = state.revision_id");
        expect(sql.values).toContain("branch");
        expect(sql.text).toContain("newer_initial.created_at");
    });

    it("batches a branch's candidates in one snapshot and excludes never-ready codes from chunk/job reads", async () => {
        const complete = "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED";
        const unknown = "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN";
        const f = fixture([
            ...Array.from({ length: 20 }, (_, index) => ({ ...candidate("doc_reject_approval"), id: `state-${index}` })),
            { ...candidate("049", false), id: "unassessed" },
            { ...candidate("049"), jobInProgress: true, id: "busy" },
            { ...state, id: "completed-delete", lastErrorCode: complete },
            { ...state, id: "unknown-delete", lastErrorCode: unknown },
        ]);
        const result = await initialRegenerationProjections(f.tx as never, "branch");
        expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(result.filter(item => item.ready)).toHaveLength(20);
        expect(result.slice(-4).map(item => item.reasonCode)).toEqual([
            unknown, "SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS", "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED", unknown,
        ]);
        const [query] = f.tx.$queryRaw.mock.calls[0]!;
        expect(query.values).not.toContain(complete);
        expect(query.values).not.toContain(unknown);
        expect(query.text.match(/FROM eligible AS state/g)).toHaveLength(2);
    });
});
