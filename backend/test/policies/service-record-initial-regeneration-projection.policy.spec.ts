import { Prisma } from "@prisma/client";
import { initialRegenerationProjections } from "application/policies/service-record-initial-regeneration-projection.policy";

function fixture(statusType = "049", superseded = false) {
    const state = { id: "state", revisionId: "revision", generation: "gen1", branchId: "branch", clientId: 7,
        caseId: "case", documentVersion: 3, status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" };
    const sql: Prisma.Sql[] = [];
    const tx = { $queryRaw: jest.fn(async (query: Prisma.Sql) => {
        sql.push(query);
        if (query.text.includes("FROM service_record_revision_document_state AS state")) return [state];
        if (query.text.includes('FROM "service_record_case"')) return [{ id: "case", branchId: "branch", clientId: 7 }];
        if (query.text.includes('FROM "service_record_revision_document_state"')) return [{ ...state, id: superseded ? "newer" : "state" }];
        if (query.text.includes('FROM "service_record_snapshot_chunk"')) return [{ chunkIndex: 1, chunkCount: 1, documentId: "doc" }];
        if (query.text.includes('FROM "eformsign_doc"')) return [{ documentId: "doc", statusType, voidedAt: null, permanentPurgeRequestedAt: null }];
        // A completed INITIAL whose document_id is populated must not hide the state action.
        if (query.text.includes('FROM "eformsign_document_job"')) return [{ status: "completed", leaseToken: null, documentId: "doc" }];
        return [];
    }) };
    return { tx, sql };
}

describe("INITIAL regeneration display projection", () => {
    it.each([["049", true, null], ["070", false, "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"],
        ["003", false, "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED"]] as const)("projects newest state for %s", async (status, ready, reasonCode) => {
        const f = fixture(status);
        expect(await initialRegenerationProjections(f.tx as never, "branch")).toEqual([{
            stateId: "state", revisionId: "revision", generation: "gen1", clientId: 7, ready, reasonCode,
        }]);
        expect(f.sql.every(query => !query.text.includes("FOR UPDATE"))).toBe(true);
        expect(f.sql[0]!.text).toContain("record.current_revision_id = state.revision_id");
        expect(f.sql[0]!.values).toContain("branch");
        expect(f.sql[0]!.text).toContain("newer_initial.created_at");
    });
    it("omits a state superseded between discovery and readiness", async () => {
        const f = fixture("049", true);
        expect(await initialRegenerationProjections(f.tx as never, "branch")).toEqual([]);
    });
});
