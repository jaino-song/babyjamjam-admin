import { Prisma } from "@prisma/client";

import {
    cancelledInitialSuffix,
    type InitialNoProviderDocumentProjection,
} from "domain/constants/service-record-initial-no-provider-document";
import {
    cancelledInitialCandidateSql,
    cancelledInitialCandidatesSettledSql,
    cancelledInitialSuffixScopeSql,
    INITIAL_PROVIDER_SETTLE_MS,
} from "./service-record-initial-recovery-sql";

/** Local hint only. The POST revalidates under locks and performs a fresh provider scan. */
export async function noProviderDocumentConfirmable(
    db: Prisma.TransactionClient, branchId: string, caseId?: string, now = new Date(),
): Promise<InitialNoProviderDocumentProjection[]> {
    const settledAt = new Date(now.getTime() - INITIAL_PROVIDER_SETTLE_MS);
    const rows = await db.$queryRaw<Array<{
        stateId: string; revisionId: string; generation: string; caseId: string; documentVersion: number;
        revisionNumber: number; chunks: Array<{ index: number; count: number; linked: boolean }>;
    }>>(Prisma.sql`
        SELECT s.id AS "stateId", s.revision_id AS "revisionId", s.generation, c.id AS "caseId",
            s.document_version AS "documentVersion", (j.payload->'revisionNumber')::int AS "revisionNumber",
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object('index', chunk.chunk_index, 'count', chunk.chunk_count,
                    'linked', chunk.document_id IS NOT NULL) ORDER BY chunk.chunk_index, chunk.id)
                FROM service_record_snapshot_chunk chunk
                WHERE chunk.branch_id = s.branch_id AND chunk.service_record_case_id = c.id
                  AND chunk.revision_id = s.revision_id AND chunk.snapshot_version = s.document_version
            ), '[]'::jsonb) AS chunks
        ${cancelledInitialCandidateSql()}
          AND s.branch_id = ${branchId}::uuid AND ${cancelledInitialCandidatesSettledSql(settledAt)}
          AND ${cancelledInitialSuffixScopeSql()}
          ${caseId ? Prisma.sql`AND c.id = ${caseId}::uuid` : Prisma.empty}
        ORDER BY s.id
    `);
    return rows.flatMap(({ stateId, revisionId, generation, caseId, revisionNumber, documentVersion, chunks }) => {
        const unlinkedChunkOrdinals = chunks.filter(chunk => !chunk.linked).map(chunk => `(${chunk.index}/${chunk.count})`);
        if (chunks.length > 0 && unlinkedChunkOrdinals.length === 0) return [];
        return [{ stateId, revisionId, generation, suffix: cancelledInitialSuffix(caseId, revisionNumber, documentVersion),
            unlinkedChunkOrdinals }];
    });
}
