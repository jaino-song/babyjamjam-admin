import { Prisma } from "@prisma/client";

import type { InitialDocumentRegenerationProjection } from "domain/repositories/eformsign-document-job.repository.interface";
import { initialFinalizationStateSql, initialRegenerationReadiness, newestInitialFinalizationStateSql } from "./service-record-initial-finalization.policy";

/** 완료된 job의 document_id와 무관하게 현재 revision의 실패 상태를 표시한다. */
export async function initialRegenerationProjections(
    tx: Prisma.TransactionClient, branchId: string,
): Promise<InitialDocumentRegenerationProjection[]> {
    const candidates = await tx.$queryRaw<Array<{
        id: string; revisionId: string; generation: string; clientId: number; caseId: string;
    }>>(Prisma.sql`
        SELECT state.id, state.revision_id AS "revisionId", state.generation,
            state.client_id AS "clientId", state.service_record_case_id AS "caseId"
        FROM service_record_revision_document_state AS state
        JOIN service_record_case AS record ON record.id = state.service_record_case_id
            AND record.branch_id = state.branch_id AND record.client_id = state.client_id
            AND record.current_revision_id = state.revision_id
        WHERE state.branch_id = ${branchId}::uuid AND state.status = 'failed'
          AND ${initialFinalizationStateSql("state")} AND ${newestInitialFinalizationStateSql("state")}
        ORDER BY state.client_id, state.id
    `);
    const result: InitialDocumentRegenerationProjection[] = [];
    for (const state of candidates) {
        const readiness = await initialRegenerationReadiness(tx, state.caseId, state.revisionId, { lock: false });
        // 발견 후 새 세대가 생겼으면 오래된 액션을 표시하지 않는다.
        if (readiness.state?.id !== state.id) continue;
        result.push({ stateId: state.id, revisionId: state.revisionId, generation: state.generation,
            clientId: state.clientId, ready: readiness.ready, reasonCode: readiness.ready ? null : readiness.reason });
    }
    return result;
}
