import { Prisma } from "@prisma/client";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";

const branchId = "00000000-0000-4000-8000-000000000010";
const jobId = "00000000-0000-4000-8000-000000000011";
const caseId = "00000000-0000-4000-8000-000000000020";
const revisionId = "00000000-0000-4000-8000-000000000030";
const stateId = "00000000-0000-4000-8000-000000000070";
const requestKey = `service-record-initial-finalization:${revisionId}`;
const fingerprint = sha256CanonicalJson({ frozen: true });
const context = { branchId, clientId: 7, serviceRecordCaseId: caseId, revisionId, revisionNumber: 1,
    businessFingerprint: fingerprint, plannedSessionCount: 1,
    plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-01" }],
    documentSyncStatus: "capability_unverified", lifecycleStatus: "READY_TO_FINALIZE", formVersion: 3 };
export const input = { branchId, jobId, userId: "staff-user", now: new Date() };
export function setup(overrides: Record<string, unknown> = {}, stateOverrides: Record<string, unknown> = {}) {
    const job = { id: jobId, branchId, clientId: 7, documentId: null, jobType: "create_document", source: "auto_finalize",
        requestKey, status: "failed", activeKey: `service-record-initial:${caseId}`, progressStep: "preparing", progressDetail: "rendering",
        payload: { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION", revisionId, context,
            completeness: "complete", manualReviewRequired: true, documentStateId: stateId, generation: "generation-1", documentVersion: 3, snapshotReference: requestKey,
            immutablePayload: { frozen: true }, payloadFingerprint: fingerprint }, payloadFingerprint: fingerprint,
        leaseToken: null, lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED", attempts: 4, createdByUserId: null,
        createdAt: new Date(), updatedAt: new Date(), completedAt: new Date(), nextAttemptAt: new Date(), ...overrides };
    const raw = () => Object.fromEntries(Object.entries(job).map(([key, value]) => [key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), value]));
    const state = { id: stateId, branchId, clientId: 7, serviceRecordCaseId: caseId, revisionId, operation: "record_snapshot",
        generation: "generation-1", documentVersion: 3, inputFingerprint: fingerprint,
        workflowScope: { generationKind: "INITIAL_FINALIZATION", requestKey }, status: "capability_unverified", version: 0,
        immutableInput: { frozen: true }, sourceDocumentId: null, targetDocumentId: null, templateId: null, templateVersion: null,
        mirrorGeneration: null, outputProof: null, attempts: 0, nextAttemptAt: null, createdAt: new Date(), updatedAt: new Date(),
        lastErrorCode: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", step: "preparing", ...stateOverrides };
    const queries: Prisma.Sql[] = [];
    const tx = {
        eformsign_document_job: { findUnique: jest.fn(async () => ({ ...job })) },
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            queries.push(sql);
            if (sql.text.includes('UPDATE "eformsign_document_job"')) {
                Object.assign(job, { status: "queued", progressStep: "queued", lastErrorCode: null, attempts: 0 });
                return [raw()];
            }
            if (sql.text.includes('FROM "eformsign_document_job"')) return [raw()];
            if (sql.text.includes('FROM "service_record_revision_document_state"')) return [{ ...state }];
            if (sql.text.includes('FROM "service_record_case" AS record')) return [{ currentRevisionId: revisionId,
                currentUsableRevisionId: null, currentUsableDocumentVersion: null, status: "READY_TO_FINALIZE",
                revisionNumber: 1, formVersion: 3, formVersionAtConfirm: 3 }];
            if (sql.text.includes('FROM "client"')) return [{ id: 7 }];
            if (sql.text.includes('FROM "service_record_case"')) return [{ id: caseId, currentRevisionId: revisionId }];
            return [];
        }),
        $executeRaw: jest.fn(async (sql: Prisma.Sql) => {
            queries.push(sql);
            if (sql.text.includes('UPDATE "service_record_revision_document_state"')) {
                if (sql.text.includes("status = 'pending'")) Object.assign(state, { status: "pending", step: "requeued" });
                else if (sql.text.includes("manual_review")) Object.assign(state, { status: "manual_review", step: "unknown", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
                else Object.assign(state, { status: "failed", step: "cancelled" });
            }
            if (sql.text.includes('UPDATE "eformsign_document_job"')) {
                job.status = "failed";
                if (sql.text.includes("active_key = NULL")) Object.assign(job, { activeKey: null, progressStep: "cancelled" });
                else job.lastErrorCode = "JOB_CANCELLED_AFTER_DISPATCH";
            }
            return 1;
        }),
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const beforeJob = structuredClone(job), beforeState = structuredClone(state);
        try { return await callback(tx); }
        catch (error) { Object.assign(job, beforeJob); Object.assign(state, beforeState); throw error; }
    }) };
    return { repo: new SbEformsignDocumentJobRepository(prisma as never), job, state, tx, prisma, queries, raw };
}

