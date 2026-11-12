import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { buildEformsignDispatchBusinessKey } from "application/services/eformsign-dispatch-boundary.service";
import { ContractRecoveryError } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import { SUPERSEDED_PROGRESS_STEP } from "domain/entities/eformsign-document-job.entity";
import { compareAndSetAuthority, type AuthorityState } from "./eformsign-contract-authority";

type Job = Prisma.eformsign_document_jobGetPayload<Record<string, never>>;
type Intent = Prisma.eformsign_dispatch_intentGetPayload<Record<string, never>>;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function conflict(): never { throw new ContractRecoveryError("REQUEST_CONFLICT"); }
const validActor = (id: string | null) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const intentIdentityWhere = (row: Intent) => ({ id: row.id, branchId: row.branchId, clientId: row.clientId, action: row.action,
    businessKey: row.businessKey, generation: row.generation, fingerprint: row.fingerprint, localDocumentId: row.localDocumentId,
    assignmentId: row.assignmentId, templateId: row.templateId, providerDocumentId: row.providerDocumentId, status: row.status, attemptCount: row.attemptCount });
/** The automatic intent's business generation is deliberately different from the authority UUID. */
export function assertLinkedIntent(a: AuthorityState, job: Job, row: Intent, action: "create" | "create_draft" | "manual_process"): void {
    if (row.branchId !== a.branchId || row.clientId !== a.clientId || row.action !== action) conflict();
    if (action === "create") {
        if (row.businessKey !== buildEformsignDispatchBusinessKey({ ...row, action: "create" })) conflict();
        const frozen = object(object(job.payload)?.["contractDispatch"]);
        if (frozen && (["branchId", "clientId", "localDocumentId", "assignmentId", "templateId", "action", "generation", "fingerprint"] as const)
            .some(key => (row[key] ?? null) !== (frozen[key] ?? null))) conflict();
    } else if (row.generation !== a.generation || row.fingerprint !== a.fingerprint || row.localDocumentId !== null || row.assignmentId !== null
        || row.businessKey !== digest(`contract-${action === "create_draft" ? "draft" : "human"}:${a.generation}`)) conflict();
    if (action !== "create") {
        const frozen = object(object(job.payload)?.["contractDraft"]) ?? object(object(job.payload)?.["contractDispatch"]);
        if (!row.templateId || (frozen && row.templateId !== (frozen["effectiveTemplateId"] ?? frozen["templateId"]))) conflict();
    }
}
export async function lockedAuthorityJob(tx: Prisma.TransactionClient, a: AuthorityState): Promise<Job> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_document_job WHERE id = ${a.creationJobId}::uuid AND branch_id = ${a.branchId}::uuid FOR UPDATE`);
    const job = await tx.eformsign_document_job.findUnique({ where: { id: a.creationJobId } });
    if (!job || job.branchId !== a.branchId || job.clientId !== a.clientId || job.contractGeneration !== a.generation || job.payloadFingerprint !== a.fingerprint
        || job.jobType !== "create_document" || job.source !== "staff" || job.requestKey.startsWith("service-record-") || Object.prototype.hasOwnProperty.call(object(job.payload) ?? {}, "kind")) conflict();
    return job;
}
export async function linkedIntents(tx: Prisma.TransactionClient, a: AuthorityState, job: Job, extraIds: string[] = []): Promise<Intent[]> {
    const refs = [a.creationIntentId, a.draftIntentId, a.humanIntentId].filter((id): id is string => id !== null).sort();
    if (new Set(refs).size !== refs.length) conflict();
    const locks = [...new Set([...refs, ...extraIds])].sort();
    if (locks.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_dispatch_intent WHERE id IN (${Prisma.join(locks.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const rows: Intent[] = [];
    for (const [id, action] of [[a.creationIntentId, "create"], [a.draftIntentId, "create_draft"], [a.humanIntentId, "manual_process"]] as const) {
        if (!id) continue;
        const row = await tx.eformsign_dispatch_intent.findUnique({ where: { id } });
        if (!row) conflict();
        assertLinkedIntent(a, job, row, action); rows.push(row);
    }
    return rows;
}
export function provenNoEffect(row: Intent): boolean {
    return row.providerDocumentId === null && ((row.status === "prepared" && (row.attemptCount === 0
        || (row.startedAt === null && row.reconciliationReason === "draft_released_before_open")))
        || (row.status === "reconciled_not_delivered" && row.reconciledOutcome === "not_delivered" && row.reconciledAt !== null && validActor(row.reconciledByUserId)));
}
async function close(tx: Prisma.TransactionClient, a: AuthorityState) {
    if (!await compareAndSetAuthority(tx, { branchId: a.branchId, clientId: a.clientId, generation: a.generation,
        creationJobId: a.creationJobId, phase: a.phase, claimEpoch: a.claimEpoch, claimUserId: a.claimUserId, fingerprint: a.fingerprint }, { phase: "closed" })) conflict();
    a.phase = "closed";
}
/** Caller holds client -> authority. No nested transaction, provider call, or payload restoration. */
export async function retireProvenNoEffect(tx: Prisma.TransactionClient, a: AuthorityState, pointer: string | null): Promise<boolean> {
    if (!["reserved", "creation_pending", "creation_uncertain"].includes(a.phase) || a.humanIntentId || a.providerDocumentId || a.priorDocumentId !== pointer
        || (a.claimExpiresAt && a.claimExpiresAt.getTime() > Date.now())) return false;
    const job = await lockedAuthorityJob(tx, a);
    if (!["failed", "requires_attention"].includes(job.status) || job.leaseToken || job.documentId || job.progressStep === SUPERSEDED_PROGRESS_STEP) return false;
    const draftKey = digest(`contract-draft:${a.generation}`), humanKey = digest(`contract-human:${a.generation}`);
    // Discovery is serialized with every draft writer by the caller's client/authority locks.
    // Operator reconciliation only changes state; re-read after locking the sorted union.
    const discovered = await tx.eformsign_dispatch_intent.findUnique({ where: { businessKey: draftKey }, select: { id: true } });
    const refs = await linkedIntents(tx, a, job, discovered ? [discovered.id] : []);
    const draft = await tx.eformsign_dispatch_intent.findUnique({ where: { businessKey: draftKey } });
    if ((draft?.id ?? null) !== (discovered?.id ?? null)) conflict();
    if (draft) {
        assertLinkedIntent(a, job, draft, "create_draft");
        if (draft.id !== a.draftIntentId && !(draft.status === "prepared" && draft.startedAt === null
            && draft.providerDocumentId === null && draft.reconciliationReason === "draft_released_before_open")) return false;
    }
    if (await tx.eformsign_dispatch_intent.findUnique({ where: { businessKey: humanKey }, select: { id: true } })) return false;
    if ((!refs.length && !["reserved", "creation_uncertain"].includes(a.phase)) || !refs.every(provenNoEffect)) return false;
    // Atomic claimCreation links STARTED before any send. A terminal lease-free zero-ref
    // job is no-effect only when no other unresolved client creation can be hidden by rotation.
    const unresolved = await tx.eformsign_dispatch_intent.findFirst({ where: { branchId: a.branchId, clientId: a.clientId,
        action: { in: ["create", "create_draft"] }, status: { in: ["started", "uncertain", "accepted"] } }, select: { id: true } });
    if (unresolved) return false;
    const retired = await tx.eformsign_document_job.updateMany({ where: { id: job.id, branchId: a.branchId, clientId: a.clientId,
        contractGeneration: a.generation, payloadFingerprint: a.fingerprint, status: job.status, leaseToken: null, activeKey: job.activeKey,
        documentId: null, progressStep: job.progressStep }, data: { status: "failed", progressStep: SUPERSEDED_PROGRESS_STEP,
        activeKey: null, payload: Prisma.DbNull, leaseToken: null, heartbeatAt: null } });
    if (retired.count !== 1) conflict();
    await close(tx, a); return true;
}
/** Previously atomic verified+completed is the proof; mutable mirror status is only a safety veto. */
export async function normalizeVerifiedAuthority(tx: Prisma.TransactionClient, a: AuthorityState): Promise<boolean> {
    if (a.phase !== "verified") return false;
    const job = await lockedAuthorityJob(tx, a);
    const client = await tx.client.findUnique({ where: { id: a.clientId }, select: { branchId: true, eDocId: true } });
    if (job.status !== "completed" || !job.completedAt || job.leaseToken || job.activeKey || !a.providerDocumentId
        || job.documentId !== a.providerDocumentId || client?.branchId !== a.branchId || client.eDocId !== a.providerDocumentId) conflict();
    const refs = await linkedIntents(tx, a, job);
    if (!refs.some(row => row.providerDocumentId === a.providerDocumentId)) conflict();
    const [owner] = await tx.$queryRaw<Array<{ conflict: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM client WHERE e_doc_id = ${a.providerDocumentId}
        AND (id <> ${a.clientId} OR branch_id IS DISTINCT FROM ${a.branchId}::uuid))
        OR EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE provider_document_id = ${a.providerDocumentId} AND branch_id <> ${a.branchId}::uuid) AS conflict`);
    if (!owner || owner.conflict) conflict();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_doc WHERE document_id = ${a.providerDocumentId} FOR UPDATE`);
    const doc = await tx.eformsign_doc.findUnique({ where: { documentId: a.providerDocumentId } });
    if (!doc || doc.branchId !== a.branchId || doc.clientId !== a.clientId || doc.documentKind !== "contract" || !doc.templateId
        || doc.permanentPurgeRequestedAt || doc.voidedAt || doc.serviceRecordCaseId || doc.revisionId
        || ["001", "047", "049", "099"].includes(doc.statusType) || doc.stepType === "00") conflict();
    for (const row of refs) {
        if (provenNoEffect(row)) continue;
        const frozen = object(object(job.payload)?.[row.action === "create" ? "contractDispatch" : "contractDraft"]);
        if (row.providerDocumentId !== a.providerDocumentId || (row.action === "create" ? (row.templateId ?? frozen?.["effectiveTemplateId"] ?? doc.templateId) : row.templateId) !== doc.templateId
            || !["started", "uncertain", "accepted", "reconciled_delivered"].includes(row.status)) conflict();
        if (["started", "uncertain"].includes(row.status)) {
            if (!a.claimUserId || !validActor(a.claimUserId)) conflict();
            const updated = await tx.eformsign_dispatch_intent.updateMany({ where: intentIdentityWhere(row), data: {
                status: "reconciled_delivered", reconciledOutcome: "delivered", reconciledAt: new Date(), reconciledByUserId: a.claimUserId,
                reconciliationReason: "Historical atomic verified completion confirmed same-document provider delivery" } });
            if (updated.count !== 1) conflict();
        }
    }
    await close(tx, a); return true;
}
