import { Prisma } from "@prisma/client";
import { ConflictException } from "@nestjs/common";

export type AuthorityPhase = "reserved" | "creation_pending" | "creation_uncertain" | "document_ready" | "human_exposed" | "verified" | "blocked" | "closed";
export interface AuthorityState {
    branchId: string; clientId: number; generation: string; creationJobId: string; fingerprint: string;
    priorDocumentId: string | null; providerDocumentId: string | null;
    creationIntentId: string | null; draftIntentId: string | null; humanIntentId: string | null;
    phase: AuthorityPhase; claimEpoch: bigint; claimUserId: string | null; claimExpiresAt: Date | null;
}
export type AuthorityExpected = Pick<AuthorityState, "branchId" | "clientId" | "generation" | "creationJobId" | "phase" | "claimEpoch"> & { claimUserId?: string | null };
export type AuthorityPatch = Partial<Pick<AuthorityState, "phase" | "providerDocumentId" | "creationIntentId" | "draftIntentId" | "humanIntentId" | "claimEpoch" | "claimUserId" | "claimExpiresAt">>;
export interface AuthorityPointerWrite {
    branchId: string; clientIds: readonly number[];
    /** Include every stored document ID involved in the pointer change, including the prior ID. */
    documentIds?: readonly string[];
    /** Server-only permit: derive from the authoritative job inside the same locked transaction. */
    generation?: string;
}
export interface AuthorityReservation {
    branchId: string; clientId: number; jobId: string; generation: string; fingerprint: string; priorDocumentId: string | null;
}
export class AuthorityConflictError extends ConflictException {
    constructor() { super({ code: "REQUEST_CONFLICT" }); this.name = "AuthorityConflictError"; this.message = "Authority conflict"; }
}
interface RawAuthority {
    branch_id: string; client_id: number; generation: string; creation_job_id: string; fingerprint: string;
    prior_document_id: string | null; provider_document_id: string | null;
    creation_intent_id: string | null; draft_intent_id: string | null; human_intent_id: string | null;
    phase: AuthorityPhase; claim_epoch: bigint; claim_user_id: string | null; claim_expires_at: Date | null;
}
const columns = Prisma.sql`branch_id, client_id, generation, creation_job_id, fingerprint,
    prior_document_id, provider_document_id, creation_intent_id, draft_intent_id, human_intent_id,
    phase, claim_epoch, claim_user_id, claim_expires_at`;
function state(row: RawAuthority): AuthorityState {
    return {
        branchId: row.branch_id, clientId: row.client_id, generation: row.generation, creationJobId: row.creation_job_id,
        fingerprint: row.fingerprint, priorDocumentId: row.prior_document_id, providerDocumentId: row.provider_document_id,
        creationIntentId: row.creation_intent_id, draftIntentId: row.draft_intent_id, humanIntentId: row.human_intent_id,
        phase: row.phase, claimEpoch: row.claim_epoch, claimUserId: row.claim_user_id, claimExpiresAt: row.claim_expires_at,
    };
}
function uuid(value: string): void {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new AuthorityConflictError();
}
function scopeIds(branchId: string, ids: readonly number[]): number[] {
    uuid(branchId);
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new AuthorityConflictError();
    return [...new Set(ids)].sort((a, b) => a - b);
}
/** Discovery only: callers merge these owners before acquiring any client/document locks. */
export async function discoverAuthorityClientIds(tx: Prisma.TransactionClient, branchId: string, documentIds: readonly string[]): Promise<number[]> {
    uuid(branchId);
    if (!Array.isArray(documentIds) || documentIds.some(id => typeof id !== "string")) throw new AuthorityConflictError();
    if (!documentIds.length) return [];
    const owners = await tx.$queryRaw<Array<{ client_id: number }>>(Prisma.sql`
        SELECT client_id FROM eformsign_contract_authority WHERE branch_id = ${branchId}::uuid
        AND provider_document_id IN (${Prisma.join(documentIds)}) ORDER BY client_id`);
    const [foreign] = await tx.$queryRaw<Array<{ conflict: boolean }>>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE branch_id <> ${branchId}::uuid
        AND provider_document_id IN (${Prisma.join(documentIds)})) AS conflict`);
    if (!foreign || foreign.conflict) throw new AuthorityConflictError();
    return [...new Set(owners.map(owner => owner.client_id))].sort((a, b) => a - b);
}
/** Privileged purge fence, including branchless mirrors. This boolean alone is not a document-binding lock. */
export async function assertNoUnresolvedAuthorityForDocuments(tx: Prisma.TransactionClient, documentIds: readonly string[]): Promise<void> {
    if (!Array.isArray(documentIds) || documentIds.some(id => typeof id !== "string")) throw new AuthorityConflictError();
    if (!documentIds.length) return;
    const [row] = await tx.$queryRaw<Array<{ conflict: boolean }>>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE provider_document_id IN (${Prisma.join(documentIds)})
        AND phase <> 'closed') AS conflict`);
    if (!row || row.conflict) throw new AuthorityConflictError();
}
// Caller owns the transaction. Client locks serialize both existing and absent authorities.
async function lockedScope(tx: Prisma.TransactionClient, branchId: string, ids: readonly number[]) {
    const sorted = scopeIds(branchId, ids);
    const clients = await tx.$queryRaw<Array<{ id: number; e_doc_id: string | null }>>(Prisma.sql`
        SELECT id, e_doc_id FROM client WHERE branch_id = ${branchId}::uuid
        AND id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`);
    if (clients.length !== sorted.length || clients.some((client, i) => client.id !== sorted[i])) throw new AuthorityConflictError();
    const rows = await tx.$queryRaw<RawAuthority[]>(Prisma.sql`
        SELECT ${columns} FROM eformsign_contract_authority WHERE branch_id = ${branchId}::uuid
        AND client_id IN (${Prisma.join(sorted)}) ORDER BY client_id FOR UPDATE`);
    return { clients, authorities: rows.map(state) };
}
/** Lock every affected client in one ascending set before locking its authority. */
export async function lockAuthorityScope(tx: Prisma.TransactionClient, branchId: string, clientIds: readonly number[]): Promise<AuthorityState[]> {
    return (await lockedScope(tx, branchId, clientIds)).authorities;
}
async function checkDocumentOwners(tx: Prisma.TransactionClient, branchId: string, ids: readonly number[], documents: readonly string[]) {
    if (!documents.length) return;
    const owners = await tx.$queryRaw<Array<{ client_id: number }>>(Prisma.sql`
        SELECT client_id FROM eformsign_contract_authority WHERE branch_id = ${branchId}::uuid
        AND provider_document_id IN (${Prisma.join(documents)}) ORDER BY client_id`);
    // Only a boolean crosses the foreign-tenant boundary, never an authority projection.
    const [foreign] = await tx.$queryRaw<Array<{ conflict: boolean }>>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE branch_id <> ${branchId}::uuid
        AND provider_document_id IN (${Prisma.join(documents)})) AS conflict`);
    if (!foreign || foreign.conflict || owners.some(owner => !ids.includes(owner.client_id))) throw new AuthorityConflictError();
}
/** Guard and pointer mutation must share this transaction; the caller supplies the complete affected scope. */
export async function assertAuthorityPointerWrite(tx: Prisma.TransactionClient, input: AuthorityPointerWrite): Promise<void> {
    const ids = scopeIds(input.branchId, input.clientIds), documents = input.documentIds ?? [];
    if (!Array.isArray(documents) || documents.some(id => typeof id !== "string")) throw new AuthorityConflictError();
    if (input.generation !== undefined) uuid(input.generation);
    await checkDocumentOwners(tx, input.branchId, ids, documents);
    const { authorities } = await lockedScope(tx, input.branchId, ids);
    for (const authority of authorities) {
        if (authority.phase === "closed") continue;
        if (authority.generation !== input.generation || !["reserved", "creation_pending", "document_ready"].includes(authority.phase)) throw new AuthorityConflictError();
    }
    if (documents.length) {
        const unique = [...new Set(documents)];
        const parents = await tx.$queryRaw<Array<{ document_id: string }>>(Prisma.sql`
            SELECT document_id FROM eformsign_doc WHERE document_id IN (${Prisma.join(unique)}) ORDER BY id FOR UPDATE`);
        if (parents.length !== unique.length || unique.some(id => !parents.some(parent => parent.document_id === id))) throw new AuthorityConflictError();
    }
    // Rediscovery after locks refuses changed ownership; it never takes a late client lock.
    await checkDocumentOwners(tx, input.branchId, ids, documents);
}
const patchColumns = {
    phase: (value: unknown) => Prisma.sql`phase = ${value}`,
    providerDocumentId: (value: unknown) => Prisma.sql`provider_document_id = ${value}`,
    creationIntentId: (value: unknown) => Prisma.sql`creation_intent_id = ${value}::uuid`,
    draftIntentId: (value: unknown) => Prisma.sql`draft_intent_id = ${value}::uuid`,
    humanIntentId: (value: unknown) => Prisma.sql`human_intent_id = ${value}::uuid`,
    claimEpoch: (value: unknown) => Prisma.sql`claim_epoch = ${value}::bigint`,
    claimUserId: (value: unknown) => Prisma.sql`claim_user_id = ${value}::uuid`,
    claimExpiresAt: (value: unknown) => Prisma.sql`claim_expires_at = ${value}::timestamptz`,
};
const expectedKeys = ["branchId", "clientId", "generation", "creationJobId", "phase", "claimEpoch", "claimUserId"];
/** Immutable identity is always part of the CAS; a stale row returns false. */
export async function compareAndSetAuthority(tx: Prisma.TransactionClient, expected: AuthorityExpected, patch: AuthorityPatch): Promise<boolean> {
    scopeIds(expected.branchId, [expected.clientId]); uuid(expected.generation); uuid(expected.creationJobId);
    if (Object.keys(expected).some(key => !expectedKeys.includes(key)) || typeof expected.claimEpoch !== "bigint") throw new AuthorityConflictError();
    const keys = Object.keys(patch) as Array<keyof AuthorityPatch>;
    if (!keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(patchColumns, key) || patch[key] === undefined)) throw new AuthorityConflictError();
    const assignments = keys.map(key => patchColumns[key](patch[key]));
    const claimant = expected.claimUserId === undefined ? Prisma.empty : Prisma.sql`AND claim_user_id IS NOT DISTINCT FROM ${expected.claimUserId}::uuid`;
    const affected = await tx.$executeRaw(Prisma.sql`
        UPDATE eformsign_contract_authority SET ${Prisma.join(assignments)}, updated_at = CURRENT_TIMESTAMP
        WHERE branch_id = ${expected.branchId}::uuid AND client_id = ${expected.clientId}
        AND generation = ${expected.generation}::uuid AND creation_job_id = ${expected.creationJobId}::uuid
        AND phase = ${expected.phase} AND claim_epoch = ${expected.claimEpoch}::bigint ${claimant}`);
    return affected === 1;
}
export async function reserveAuthority(tx: Prisma.TransactionClient, input: AuthorityReservation): Promise<AuthorityState> {
    uuid(input.jobId); uuid(input.generation);
    if (!/^[a-f0-9]{64}$/.test(input.fingerprint) || (input.priorDocumentId !== null && typeof input.priorDocumentId !== "string")) throw new AuthorityConflictError();
    const { clients, authorities } = await lockedScope(tx, input.branchId, [input.clientId]);
    if (clients[0]?.e_doc_id !== input.priorDocumentId) throw new AuthorityConflictError();
    const [job] = await tx.$queryRaw<Array<{
        id: string; branch_id: string; client_id: number | null; contract_generation: string | null;
        payload_fingerprint: string | null; job_type: string;
    }>>(Prisma.sql`
        SELECT id, branch_id, client_id, contract_generation, payload_fingerprint, job_type
        FROM eformsign_document_job WHERE id = ${input.jobId}::uuid AND branch_id = ${input.branchId}::uuid
        AND client_id = ${input.clientId} FOR SHARE`);
    if (!job || job.id !== input.jobId || job.branch_id !== input.branchId || job.client_id !== input.clientId
        || job.contract_generation !== input.generation || job.payload_fingerprint !== input.fingerprint || job.job_type !== "create_document") throw new AuthorityConflictError();
    const current = authorities[0];
    if (current?.generation === input.generation && current.creationJobId === input.jobId && current.fingerprint === input.fingerprint) {
        if (current.priorDocumentId !== input.priorDocumentId) throw new AuthorityConflictError();
        return current;
    }
    if (current && current.phase !== "closed") {
        // A fresh enqueue may replace only a proven pre-provider terminal failure.
        // Client/authority locks serialize this with recovery claims and intent admission.
        // Payload retention is deliberately irrelevant to this durable proof.
        if (current.phase !== "reserved" || current.priorDocumentId !== input.priorDocumentId
            || current.providerDocumentId || current.creationIntentId || current.draftIntentId || current.humanIntentId
            || (current.claimExpiresAt && current.claimExpiresAt.getTime() > Date.now())) throw new AuthorityConflictError();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_document_job
            WHERE id = ${current.creationJobId}::uuid AND branch_id = ${current.branchId}::uuid FOR UPDATE`);
        const previous = await tx.eformsign_document_job.findUnique({ where: { id: current.creationJobId } });
        if (!previous || previous.branchId !== current.branchId || previous.clientId !== current.clientId
            || previous.contractGeneration !== current.generation || previous.payloadFingerprint !== current.fingerprint
            || previous.jobType !== "create_document" || previous.source !== "staff" || previous.requestKey.startsWith("service-record-")
            || (previous.payload && typeof previous.payload === "object" && Object.prototype.hasOwnProperty.call(previous.payload, "kind"))
            || previous.documentId || previous.status !== "failed" || previous.lastErrorCode !== "PRE_SEND_RETRY_EXHAUSTED"
            || previous.progressStep === "superseded") throw new AuthorityConflictError();
        const unresolved = await tx.eformsign_dispatch_intent.findFirst({ where: { branchId: current.branchId,
            clientId: current.clientId, action: "create", status: { in: ["started", "uncertain"] } }, select: { id: true } });
        if (unresolved) throw new AuthorityConflictError();
        const superseded = await tx.eformsign_document_job.updateMany({ where: { id: previous.id, branchId: current.branchId,
            clientId: current.clientId, contractGeneration: current.generation, payloadFingerprint: current.fingerprint,
            status: "failed", lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED", progressStep: previous.progressStep, documentId: null },
            data: { progressStep: "superseded" } });
        if (superseded.count !== 1 || !await compareAndSetAuthority(tx, { branchId: current.branchId, clientId: current.clientId,
            generation: current.generation, creationJobId: current.creationJobId, phase: current.phase,
            claimEpoch: current.claimEpoch, claimUserId: current.claimUserId }, { phase: "closed" })) throw new AuthorityConflictError();
    }
    const rows = await tx.$queryRaw<RawAuthority[]>(current ? Prisma.sql`
        UPDATE eformsign_contract_authority SET generation = ${input.generation}::uuid,
        creation_job_id = ${input.jobId}::uuid, fingerprint = ${input.fingerprint}, prior_document_id = ${input.priorDocumentId},
        provider_document_id = NULL, creation_intent_id = NULL, draft_intent_id = NULL, human_intent_id = NULL,
        phase = 'reserved', claim_epoch = 0, claim_user_id = NULL, claim_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE branch_id = ${input.branchId}::uuid AND client_id = ${input.clientId}
        AND generation = ${current.generation}::uuid AND phase = 'closed' RETURNING ${columns}` : Prisma.sql`
        INSERT INTO eformsign_contract_authority (branch_id, client_id, generation, creation_job_id, fingerprint, prior_document_id, phase)
        VALUES (${input.branchId}::uuid, ${input.clientId}, ${input.generation}::uuid, ${input.jobId}::uuid,
        ${input.fingerprint}, ${input.priorDocumentId}, 'reserved') RETURNING ${columns}`);
    if (rows.length !== 1 || !rows[0]) throw new AuthorityConflictError();
    return state(rows[0]);
}
