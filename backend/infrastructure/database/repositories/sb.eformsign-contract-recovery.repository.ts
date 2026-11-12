import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { EformsignService } from "application/services/eformsign.service";
import type { ContractDataDto } from "application/dto/contract.dto";
import type { EformsignTemplateWorkflow } from "application/utils/eformsign-template-workflow";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { normalizePhone } from "application/utils/normalize-phone";
import { encodeEformsignStepRecipientTypes } from "domain/value-objects/eformsign-step-recipient-types";
import { buildEformsignDispatchBusinessKey } from "application/services/eformsign-dispatch-boundary.service";
import { EformsignDispatchIntentEntity, type EformsignDispatchAction, type EformsignDispatchIntentStatus } from "domain/entities/eformsign-dispatch-intent.entity";
import { ContractRecoveryError, type ContractWorkerContext, type ContractRecoveryClaim, type ContractRecoveryState,
    type ContractDocumentEvidence, type IEformsignContractRecoveryRepository } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import type { PrepareEformsignDispatchIntentInput } from "domain/repositories/eformsign-dispatch-intent.repository.interface";
import { lockAuthorityScope, compareAndSetAuthority, type AuthorityState, type AuthorityPatch } from "../utils/eformsign-contract-authority";

import { assertLinkedIntent, intentIdentityWhere, linkedIntents, normalizeVerifiedAuthority } from "../utils/eformsign-contract-authority-release";

type Job = Prisma.eformsign_document_jobGetPayload<Record<string, never>>;
type Intent = Prisma.eformsign_dispatch_intentGetPayload<Record<string, never>>;
type Locked = { job: Job; authority: AuthorityState; pointer: string | null };
function fail(code = "RECOVERY_STALE", reason?: string): never { throw new ContractRecoveryError(code, 409, reason); }
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const intentEntity = (row: Intent) => new EformsignDispatchIntentEntity({ ...row, action: row.action as EformsignDispatchAction,
    status: row.status as EformsignDispatchIntentStatus, reconciledOutcome: row.reconciledOutcome as "delivered" | "not_delivered" | null });
function resumePayload(value: unknown): Record<string, unknown> {
    const payload = record(value); if (!payload) throw new ContractRecoveryError("RECOVERY_PAYLOAD_EXPIRED", 410, "payload_expired");
    const resume = { ...payload }; delete resume["contractDispatch"]; delete resume["contractDraft"]; return resume;
}

/** Methods own their transactions. open deliberately commits stale-start repair before its separate, TTL-bound claim transaction. */
@Injectable()
export class SbEformsignContractRecoveryRepository implements IEformsignContractRecoveryRepository {
    constructor(private readonly prisma: PrismaService, private readonly options: EformsignService) {}
    private async load(tx: Prisma.TransactionClient, id: string, branchId?: string, documentId?: string): Promise<Locked> {
        const peek = await tx.eformsign_document_job.findUnique({ where: { id } });
        if (!peek || (branchId && peek.branchId !== branchId)) throw new ContractRecoveryError("RESOURCE_NOT_FOUND", 404);
        if (!peek.contractGeneration) fail("RECOVERY_UNSUPPORTED", "legacy_unbound");
        if (!peek.clientId || peek.jobType !== "create_document" || peek.source !== "staff" || peek.requestKey.startsWith("service-record-") || Object.prototype.hasOwnProperty.call(record(peek.payload) ?? {}, "kind")) fail("RECOVERY_UNSUPPORTED", "unsupported_job");
        const client = await tx.client.findUnique({ where: { id: peek.clientId }, select: { branchId: true, eDocId: true } });
        const before = await tx.eformsign_contract_authority.findUnique({ where: { branchId_clientId: { branchId: peek.branchId, clientId: peek.clientId } } });
        if (!client || client.branchId !== peek.branchId || !before) fail();
        const documents = [...new Set([documentId, client.eDocId, before.providerDocumentId].filter((id): id is string => typeof id === "string"))];
        if (documents.length) {
            const [owners, pointers, mirrors] = await Promise.all([
                tx.eformsign_contract_authority.findMany({ where: { branchId: peek.branchId, providerDocumentId: { in: documents } }, select: { clientId: true, providerDocumentId: true, phase: true } }),
                tx.client.findMany({ where: { branchId: peek.branchId, eDocId: { in: documents } }, select: { id: true } }),
                tx.eformsign_doc.findMany({ where: { OR: [{ branchId: peek.branchId }, { branchId: null }], documentId: { in: documents } }, select: { clientId: true } }),
            ]);
            const [foreign] = await tx.$queryRaw<Array<{ conflict: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE branch_id <> ${peek.branchId}::uuid AND provider_document_id IN (${Prisma.join(documents)}))
                OR EXISTS (SELECT 1 FROM client WHERE branch_id IS DISTINCT FROM ${peek.branchId}::uuid AND e_doc_id IN (${Prisma.join(documents)}))
                OR EXISTS (SELECT 1 FROM eformsign_doc WHERE branch_id <> ${peek.branchId}::uuid AND document_id IN (${Prisma.join(documents)})) AS conflict`);
            if (!foreign || foreign.conflict || owners.some(row => row.clientId !== peek.clientId && !(row.phase === "closed" && row.providerDocumentId === client.eDocId && row.providerDocumentId !== documentId && row.providerDocumentId !== before.providerDocumentId))
                || pointers.some(row => row.id !== peek.clientId) || mirrors.some(row => row.clientId !== null && row.clientId !== peek.clientId)) fail("REQUEST_CONFLICT", "document_mismatch");
        }
        const [authority] = await lockAuthorityScope(tx, peek.branchId, [peek.clientId]);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_document_job WHERE id = ${id}::uuid AND branch_id = ${peek.branchId}::uuid FOR UPDATE`);
        const job = await tx.eformsign_document_job.findUnique({ where: { id } });
        const current = await tx.client.findUnique({ where: { id: peek.clientId }, select: { branchId: true, eDocId: true } });
        if (!job || !authority || !current || current.branchId !== job.branchId || current.eDocId !== client.eDocId
            || authority.generation !== job.contractGeneration || authority.creationJobId !== job.id
            || authority.fingerprint !== job.payloadFingerprint || authority.branchId !== job.branchId || authority.clientId !== job.clientId) fail();
        const refs = [authority.creationIntentId, authority.draftIntentId, authority.humanIntentId].filter((id): id is string => id !== null).sort();
        if (refs.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_dispatch_intent WHERE id IN (${Prisma.join(refs.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
        return { job, authority, pointer: current.eDocId };
    }
    private async change(tx: Prisma.TransactionClient, state: Locked, patch: AuthorityPatch) {
        const a = state.authority;
        if (!await compareAndSetAuthority(tx, { branchId: a.branchId, clientId: a.clientId, generation: a.generation,
            creationJobId: a.creationJobId, phase: a.phase, claimEpoch: a.claimEpoch, claimUserId: a.claimUserId, fingerprint: a.fingerprint }, patch)) fail();
        Object.assign(a, patch);
    }
    private worker(state: Locked, input: ContractWorkerContext) {
        if (state.job.id !== input.jobId || state.job.leaseToken !== input.leaseToken || state.job.contractGeneration !== input.contractGeneration
            || !["processing", "reconciling"].includes(state.job.status) || state.pointer !== state.authority.priorDocumentId) fail();
    }
    private async liveAssignment(tx: Prisma.TransactionClient, state: Locked, data: Record<string, unknown>) {
        const schedule = await tx.employee_schedule.findFirst({ where: { branchId: state.job.branchId, clientId: state.job.clientId!, replaced: false }, orderBy: { id: "desc" }, include: { primaryEmployee: true } });
        const client = await tx.client.findUnique({ where: { id: state.job.clientId! }, select: { branchId: true, serviceStatus: true, deletedAt: true } });
        const employee = schedule?.primaryEmployee;
        if (!schedule || schedule.terminatedAt || !client || client.branchId !== state.job.branchId || client.deletedAt || client.serviceStatus === "terminated"
            || !employee || employee.deletedAt || employee.branchId !== state.job.branchId
            || !normalizePhone(String(data["caretaker1Contact"] ?? "")) || normalizePhone(employee.phone) !== normalizePhone(String(data["caretaker1Contact"] ?? ""))) fail();
        return schedule;
    }
    private noCreationEffects(state: Locked) {
        const a = state.authority;
        return a.phase === "reserved" && !a.creationIntentId && !a.draftIntentId && !a.humanIntentId && !a.providerDocumentId;
    }
    private async unresolvedCreation(tx: Prisma.TransactionClient, state: Locked) {
        return tx.eformsign_dispatch_intent.findFirst({ where: { branchId: state.job.branchId, clientId: state.job.clientId, action: "create", status: { in: ["started", "uncertain"] } }, select: { id: true } });
    }
    private configuration(data: Record<string, unknown>, templateId: string, value: unknown) {
        const workflow = record(value);
        if (!workflow || workflow["templateId"] !== templateId || !Array.isArray(workflow["steps"]) || !Array.isArray(workflow["recipients"])) fail();
        const plan = { templateId, steps: workflow["steps"].map(step => { const row = record(step); if (!row) fail(); return { seq: row["seq"], type: row["type"], stepGroup: row["stepGroup"] }; }),
            recipients: workflow["recipients"].map(recipient => { const row = record(recipient); if (!row) fail(); return { seq: row["seq"], type: row["type"], identity: row["identity"] }; }) };
        const options = this.options.generateDocumentOptions(data as unknown as ContractDataDto, "", "", templateId, plan as EformsignTemplateWorkflow);
        const companyId = options.company.id, creatorId = options.user.id;
        if (!companyId || !creatorId) fail();
        return { companyId, creatorId, workflow: plan };
    }
    private claimed(state: Locked, claim: ContractRecoveryClaim) {
        const a = state.authority;
        if (state.job.id !== claim.jobId || a.branchId !== claim.branchId || a.claimEpoch !== claim.claimEpoch || a.claimUserId !== claim.userId
            || !a.claimExpiresAt || a.claimExpiresAt.getTime() <= Date.now()
            || !(["failed", "requires_attention"].includes(state.job.status) || (["verified", "closed"].includes(a.phase) && state.job.status === "completed"))
            || state.pointer !== (["verified", "closed"].includes(a.phase) ? a.providerDocumentId : a.priorDocumentId)) fail();
    }
    private async snapshot(tx: Prisma.TransactionClient, state: Locked): Promise<ContractRecoveryState> {
        const a = state.authority, settled = ["verified", "closed"].includes(a.phase);
        const expired = !state.job.payload || Date.now() - (state.job.completedAt ?? state.job.createdAt).getTime() > 7 * 24 * 60 * 60_000;
        let verificationOnly: ContractRecoveryState["verificationOnly"];
        if (!settled && expired) {
            const refs = await linkedIntents(tx, a, state.job);
            const candidates = [...new Set([a.providerDocumentId, ...refs.map(row => row.providerDocumentId)].filter((id): id is string => !!id))];
            if (candidates.length === 0) throw new ContractRecoveryError("RECOVERY_PAYLOAD_EXPIRED", 410, "payload_expired");
            if (candidates.length !== 1 || !["creation_pending", "creation_uncertain", "document_ready", "human_exposed"].includes(a.phase)) fail("REQUEST_CONFLICT");
            const id = candidates[0]!;
            await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_doc WHERE document_id = ${id} FOR UPDATE`);
            const [owner] = await tx.$queryRaw<Array<{ conflict: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM client WHERE e_doc_id = ${id}
                AND (id <> ${a.clientId} OR branch_id IS DISTINCT FROM ${a.branchId}::uuid))
                OR EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE provider_document_id = ${id} AND branch_id <> ${a.branchId}::uuid) AS conflict`);
            if (!owner || owner.conflict) fail("REQUEST_CONFLICT", "document_mismatch");
            const doc = await tx.eformsign_doc.findUnique({ where: { documentId: id } });
            if (!doc || doc.branchId !== a.branchId || (doc.clientId !== a.clientId && !(doc.clientId === null && a.providerDocumentId === id)) || doc.documentKind !== "contract" || !doc.templateId
                || doc.permanentPurgeRequestedAt || doc.voidedAt || doc.serviceRecordCaseId || doc.revisionId || ["047", "049", "099"].includes(doc.statusType)) fail("REQUEST_CONFLICT", "document_mismatch");
            const effects = refs.filter(row => row.providerDocumentId === id);
            if (!effects.length || effects.some(row => !["started", "uncertain", "accepted", "reconciled_delivered"].includes(row.status)
                || (row.templateId && row.templateId !== doc.templateId))) fail("REQUEST_CONFLICT");
            const frozen = record(record(state.job.payload)?.[a.draftIntentId ? "contractDraft" : "contractDispatch"]);
            if (frozen && (frozen["effectiveTemplateId"] ?? frozen["templateId"]) !== doc.templateId) fail("REQUEST_CONFLICT");
            verificationOnly = { documentId: id, templateId: doc.templateId,
                ...(typeof frozen?.["companyId"] === "string" ? { companyId: frozen["companyId"] } : {}),
                ...(typeof frozen?.["creatorId"] === "string" ? { creatorId: frozen["creatorId"] } : {}),
                ...(frozen?.["workflow"] ? { workflow: frozen["workflow"] } : {}) };
        }
        const payload = settled || expired ? {} : record(state.job.payload)!;
        const read = async (id: string | null) => { const row = id ? await tx.eformsign_dispatch_intent.findUnique({ where: { id } }) : null; return row ? intentEntity(row) : null; };
        return { jobId: state.job.id, branchId: a.branchId, clientId: a.clientId, generation: a.generation, fingerprint: a.fingerprint,
            payload, ...(verificationOnly ? { verificationOnly } : {}), phase: a.phase, priorDocumentId: a.priorDocumentId, providerDocumentId: a.providerDocumentId,
            claimEpoch: a.claimEpoch, claimUserId: a.claimUserId, claimExpiresAt: a.claimExpiresAt,
            creationIntent: await read(a.creationIntentId), draftIntent: await read(a.draftIntentId) };
    }
    private async startIntent(tx: Prisma.TransactionClient, input: PrepareEformsignDispatchIntentInput) {
        let row = await tx.eformsign_dispatch_intent.findUnique({ where: { businessKey: input.businessKey } });
        if (!row) row = await tx.eformsign_dispatch_intent.create({ data: { ...input, status: "prepared" } });
        for (const key of ["branchId", "clientId", "localDocumentId", "assignmentId", "templateId", "action", "generation", "fingerprint"] as const) {
            if ((row[key] ?? null) !== (input[key] ?? null)) fail("REQUEST_CONFLICT");
        }
        if (input.providerDocumentId && row.providerDocumentId && row.providerDocumentId !== input.providerDocumentId) fail("REQUEST_CONFLICT");
        if (input.providerDocumentId && !row.providerDocumentId) {
            const bound = await tx.eformsign_dispatch_intent.updateMany({ where: { id: row.id, providerDocumentId: null, fingerprint: row.fingerprint }, data: { providerDocumentId: input.providerDocumentId } });
            if (bound.count !== 1) fail();
            row = { ...row, providerDocumentId: input.providerDocumentId };
        }
        if (["accepted", "reconciled_delivered"].includes(row.status)) return { intent: intentEntity(row), disposition: "already_accepted" as const };
        if (["started", "uncertain"].includes(row.status)) return { intent: intentEntity(row), disposition: "uncertain" as const };
        const updated = await tx.eformsign_dispatch_intent.updateMany({ where: { id: row.id, status: row.status, attemptCount: row.attemptCount },
            data: { status: "started", attemptCount: { increment: 1 }, startedAt: new Date(), uncertainAt: null, uncertainReason: null } });
        if (updated.count !== 1) fail();
        return { intent: intentEntity({ ...row, status: "started", attemptCount: row.attemptCount + 1, startedAt: new Date() }), disposition: "claimed" as const };
    }
    async claimCreation(input: PrepareEformsignDispatchIntentInput, worker: ContractWorkerContext, effect: { contractData: unknown; force?: boolean; workflow?: unknown }) {
        return this.prisma.$transaction(async tx => {
            const state = await this.load(tx, worker.jobId, input.branchId); this.worker(state, worker);
            if (!["reserved", "creation_pending"].includes(state.authority.phase) || state.authority.humanIntentId) fail();
            const payload = resumePayload(state.job.payload), data = record(payload["contractData"]);
            if (!data || payload["clientId"] !== state.job.clientId || sha256CanonicalJson(payload) !== state.job.payloadFingerprint
                || sha256CanonicalJson(data) !== sha256CanonicalJson(effect.contractData) || (payload["force"] === true) !== (effect.force === true)) fail();
            const schedule = await this.liveAssignment(tx, state, data);
            const template = typeof data["area"] === "string" && data["area"] ? await tx.doc_template.findFirst({ where: { areaId: data["area"], area: { branchId: input.branchId } } }) : null;
            const documents = await tx.eformsign_doc.findMany({ where: { branchId: input.branchId, clientId: state.job.clientId, permanentPurgeRequestedAt: null } });
            const local = documents.sort((left, right) => right.createdDate.getTime() - left.createdDate.getTime())[0];
            const generation = local?.documentId ?? (payload["force"] ? "force-initial" : "initial"), templateId = template?.templateId;
            const fingerprint = createHash("sha256").update(JSON.stringify({ contractData: data, templateId, generation })).digest("hex");
            const identity = { branchId: input.branchId, clientId: state.job.clientId, localDocumentId: local?.id ?? null, assignmentId: schedule.id, templateId: templateId ?? null, action: "create" as const, generation, fingerprint };
            if (input.businessKey !== buildEformsignDispatchBusinessKey(identity) || input.fingerprint !== fingerprint || input.generation !== generation
                || input.clientId !== identity.clientId || (input.templateId ?? null) !== identity.templateId || (input.localDocumentId ?? null) !== identity.localDocumentId || input.assignmentId !== schedule.id) fail();
            const result = await this.startIntent(tx, input);
            if (state.authority.creationIntentId && state.authority.creationIntentId !== result.intent.id) fail();
            const effectiveTemplateId = this.options.resolveEffectiveTemplateId(templateId);
            const savedIdentity = { ...identity, effectiveTemplateId, ...this.configuration(data, effectiveTemplateId, effect.workflow) };
            const frozen = record(state.job.payload)?.["contractDispatch"];
            if (frozen && sha256CanonicalJson(frozen) !== sha256CanonicalJson(savedIdentity)) fail();
            await this.change(tx, state, { creationIntentId: result.intent.id, phase: result.disposition === "uncertain" ? "creation_uncertain" : "creation_pending" });
            if (!frozen) await tx.eformsign_document_job.update({ where: { id: state.job.id }, data: { payload: { ...payload, contractDispatch: savedIdentity } as Prisma.InputJsonValue } });
            return result;
        });
    }
    async claimLegacyCreation(input: PrepareEformsignDispatchIntentInput) {
        return this.prisma.$transaction(async tx => {
            if (!input.clientId) fail("REQUEST_CONFLICT");
            const authorities = await lockAuthorityScope(tx, input.branchId, [input.clientId]);
            for (const a of authorities) await normalizeVerifiedAuthority(tx, a);
            if (authorities.some(a => a.phase !== "closed")) fail("REQUEST_CONFLICT");
            return this.startIntent(tx, input);
        });
    }
    async claimProvider(input: PrepareEformsignDispatchIntentInput) {
        return this.prisma.$transaction(async tx => {
            const documentId = input.providerDocumentId; if (!documentId) fail();
            const [doc, authority] = await Promise.all([
                tx.eformsign_doc.findUnique({ where: { documentId }, select: { branchId: true, clientId: true } }),
                tx.eformsign_contract_authority.findUnique({ where: { providerDocumentId: documentId }, select: { branchId: true, clientId: true } }),
            ]);
            if ((doc?.branchId && doc.branchId !== input.branchId) || (authority && authority.branchId !== input.branchId)) fail("REQUEST_CONFLICT");
            const ids = [...new Set([input.clientId, doc?.clientId, authority?.clientId].filter((id): id is number => typeof id === "number"))].sort((a, b) => a - b);
            if (ids.length) {
                const authorities = await lockAuthorityScope(tx, input.branchId, ids);
                for (const a of authorities) await normalizeVerifiedAuthority(tx, a);
            }
            await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_doc WHERE document_id = ${documentId} FOR UPDATE`);
            const current = await tx.eformsign_contract_authority.findUnique({ where: { providerDocumentId: documentId }, select: { humanIntentId: true, phase: true } });
            if (current?.humanIntentId && current.phase !== "closed") fail("REQUEST_CONFLICT");
            return this.startIntent(tx, input);
        });
    }
    async readWorker(worker: ContractWorkerContext) { return this.prisma.$transaction(async tx => { const state = await this.load(tx, worker.jobId); this.worker(state, worker); return this.snapshot(tx, state); }); }
    private async settleStaleStart(tx: Prisma.TransactionClient, state: Locked, ref: string | null, action: "create" | "create_draft", reason: string): Promise<boolean> {
        if (!ref) return false;
        const row = await tx.eformsign_dispatch_intent.findUnique({ where: { id: ref } });
        if (!row) fail("REQUEST_CONFLICT");
        assertLinkedIntent(state.authority, state.job, row, action);
        if (row.status !== "started" || row.providerDocumentId !== null) return false;
        const result = await tx.eformsign_dispatch_intent.updateMany({ where: intentIdentityWhere(row),
            data: { status: "uncertain", uncertainAt: new Date(), uncertainReason: reason } });
        if (result.count !== 1) fail();
        return true;
    }
    async markAutomaticUncertain(worker: ContractWorkerContext) { await this.prisma.$transaction(async tx => {
        const state = await this.load(tx, worker.jobId); this.worker(state, worker);
        if (!["reserved", "creation_pending", "creation_uncertain"].includes(state.authority.phase)) return;
        await this.settleStaleStart(tx, state, state.authority.creationIntentId, "create", "contract_creation_unverified");
        if (state.authority.phase !== "creation_uncertain") await this.change(tx, state, { phase: "creation_uncertain" });
    }); }
    async recoverBeforeCreation(worker: ContractWorkerContext, nextAttemptAt: Date | null, errorCode: string) {
        return this.prisma.$transaction(async tx => {
            const state = await this.load(tx, worker.jobId); this.worker(state, worker);
            if (!this.noCreationEffects(state) || state.job.status !== "processing" || await this.unresolvedCreation(tx, state)) return null;
            if (Boolean(nextAttemptAt) !== (state.job.attempts <= 3)) fail();
            const result = await tx.eformsign_document_job.updateMany({ where: { id: worker.jobId, leaseToken: worker.leaseToken, contractGeneration: worker.contractGeneration, status: "processing" },
                data: { status: nextAttemptAt ? "queued" : "failed", nextAttemptAt: nextAttemptAt ?? state.job.nextAttemptAt,
                    lastErrorCode: nextAttemptAt ? errorCode : "PRE_SEND_RETRY_EXHAUSTED", leaseToken: null, heartbeatAt: null,
                    ...(nextAttemptAt ? {} : { completedAt: new Date(), activeKey: null }) } });
            if (result.count !== 1) fail();
            return nextAttemptAt ? "retry" as const : "failed" as const;
        });
    }
    async open(jobId: string, branchId: string, userId: string) {
        // This commit must survive snapshot's later 410. A live claim by ANY user still owns its attempt.
        await this.prisma.$transaction(async tx => {
            const state = await this.load(tx, jobId, branchId), a = state.authority;
            if (!["failed", "requires_attention"].includes(state.job.status) || state.job.leaseToken || a.providerDocumentId || a.humanIntentId
                || !["reserved", "creation_pending", "creation_uncertain"].includes(a.phase)
                || (a.claimExpiresAt && a.claimExpiresAt.getTime() > Date.now())) return;
            const refs = await linkedIntents(tx, a, state.job);
            if (refs.some(row => row.providerDocumentId)) return;
            const createChanged = await this.settleStaleStart(tx, state, a.creationIntentId, "create", "stale_start_after_terminal_job");
            const draftChanged = await this.settleStaleStart(tx, state, a.draftIntentId, "create_draft", "stale_start_after_terminal_job");
            if ((createChanged || draftChanged) && a.phase !== "creation_uncertain") await this.change(tx, state, { phase: "creation_uncertain" });
        });
        return this.prisma.$transaction(async tx => {
            const state = await this.load(tx, jobId, branchId), a = state.authority;
            const completedClosed = state.job.status === "completed" && a.phase === "closed" && a.providerDocumentId !== null
                && state.job.documentId === a.providerDocumentId && state.pointer === a.providerDocumentId;
            if (!["failed", "requires_attention"].includes(state.job.status) && a.phase !== "verified" && !completedClosed) fail("RECOVERY_UNSUPPORTED", "unsupported_job");
            if (a.phase === "blocked" || (a.phase === "closed" && !completedClosed)) fail("RECOVERY_UNSUPPORTED", "unverified_creation");
            await this.snapshot(tx, state);
            if (a.claimUserId && a.claimUserId !== userId && a.claimExpiresAt && a.claimExpiresAt.getTime() > Date.now()) throw new ContractRecoveryError("MANUAL_RECOVERY_CLAIMED", 409, "claim_conflict", a.claimExpiresAt);
            if (a.claimEpoch >= 9223372036854775807n) fail();
            await this.change(tx, state, { claimEpoch: a.claimEpoch + 1n, claimUserId: userId, claimExpiresAt: new Date(Date.now() + 600_000) });
            return this.snapshot(tx, state);
        });
    }
    async readClaim(claim: ContractRecoveryClaim) { return this.prisma.$transaction(async tx => { const state = await this.load(tx, claim.jobId, claim.branchId); this.claimed(state, claim); return this.snapshot(tx, state); }); }
    async beginDraft(claim: ContractRecoveryClaim, templateId: string, identity: { companyId: string; creatorId: string; workflow: unknown }) {
        return this.prisma.$transaction(async tx => {
            const state = await this.load(tx, claim.jobId, claim.branchId); this.claimed(state, claim);
            const snapshot = await this.snapshot(tx, state), creation = snapshot.creationIntent;
            if (await this.unresolvedCreation(tx, state)) fail("RECOVERY_UNSUPPORTED", "unverified_creation");
            if (snapshot.providerDocumentId || snapshot.draftIntent || !["reserved", "creation_pending", "creation_uncertain"].includes(snapshot.phase)
                || (!this.noCreationEffects(state) && (!creation || creation.status !== "reconciled_not_delivered" || creation.reconciledOutcome !== "not_delivered"
                || !creation.reconciledAt || !creation.reconciledByUserId || creation.providerDocumentId))) fail("RECOVERY_UNSUPPORTED", "unverified_creation");
            const payload = resumePayload(state.job.payload), data = record(payload["contractData"]);
            if (!data || sha256CanonicalJson(payload) !== state.job.payloadFingerprint) fail();
            await this.liveAssignment(tx, state, data);
            const template = typeof data["area"] === "string" && data["area"] ? await tx.doc_template.findFirst({ where: { areaId: data["area"], area: { branchId: claim.branchId } } }) : null;
            if (this.options.resolveEffectiveTemplateId(template?.templateId) !== templateId) fail();
            const savedIdentity = this.configuration(data, templateId, identity.workflow);
            if (identity.companyId !== savedIdentity.companyId || identity.creatorId !== savedIdentity.creatorId) fail();
            const result = await this.startIntent(tx, { branchId: claim.branchId, clientId: snapshot.clientId, action: "create_draft", generation: snapshot.generation,
                templateId, businessKey: createHash("sha256").update(`contract-draft:${snapshot.generation}`).digest("hex"), fingerprint: snapshot.fingerprint });
            if (result.disposition !== "claimed") fail("RECOVERY_UNSUPPORTED", "unverified_creation");
            await this.change(tx, state, { phase: "creation_pending", draftIntentId: result.intent.id });
            await tx.eformsign_document_job.update({ where: { id: state.job.id }, data: { payload: { ...record(state.job.payload), contractDraft: { templateId, ...savedIdentity } } as Prisma.InputJsonValue } });
            return result.intent;
        });
    }
    async beforeDraftOpen(claim: ContractRecoveryClaim, intentId: string) {
        try { return await this.prisma.$transaction(async tx => { const state = await this.load(tx, claim.jobId, claim.branchId); this.claimed(state, claim);
            const data = record(resumePayload(state.job.payload)["contractData"]); if (!data) fail();
            await this.liveAssignment(tx, state, data);
            const intent = await tx.eformsign_dispatch_intent.findUnique({ where: { id: intentId } });
            return state.authority.phase === "creation_pending" && state.authority.draftIntentId === intentId && intent?.status === "started"; }); } catch { return false; }
    }
    async releaseDraftBeforeOpen(claim: ContractRecoveryClaim, intentId: string) {
        await this.prisma.$transaction(async tx => {
            const state = await this.load(tx, claim.jobId, claim.branchId);
            if (state.authority.draftIntentId !== intentId || state.authority.phase !== "creation_pending") fail();
            const released = await tx.eformsign_dispatch_intent.updateMany({ where: { id: intentId, action: "create_draft", generation: state.authority.generation, status: "started", providerDocumentId: null }, data: { status: "prepared", startedAt: null, reconciliationReason: "draft_released_before_open" } });
            if (released.count !== 1) fail();
            await this.change(tx, state, { draftIntentId: null, phase: "reserved" });
            const payload = { ...record(state.job.payload) }; delete payload["contractDraft"];
            await tx.eformsign_document_job.update({ where: { id: state.job.id }, data: { payload: payload as Prisma.InputJsonValue } });
        });
    }
    async markDraftUncertain(claim: ContractRecoveryClaim, intentId: string) {
        await this.prisma.$transaction(async tx => { const state = await this.load(tx, claim.jobId, claim.branchId);
            if (state.authority.draftIntentId !== intentId || state.authority.phase !== "creation_pending") return;
            await tx.eformsign_dispatch_intent.updateMany({ where: { id: intentId, status: "started" }, data: { status: "uncertain", uncertainAt: new Date(), uncertainReason: "draft_outcome_unverified" } });
            await this.change(tx, state, { phase: "creation_uncertain" }); });
    }
    async recordDraftCandidate(claim: ContractRecoveryClaim, intentId: string, documentId: string) {
        await this.prisma.$transaction(async tx => {
            const state = await this.load(tx, claim.jobId, claim.branchId); this.claimed(state, claim);
            if (state.authority.draftIntentId !== intentId || state.authority.phase !== "creation_pending") fail();
            const result = await tx.eformsign_dispatch_intent.updateMany({ where: { id: intentId, action: "create_draft", generation: state.authority.generation, status: "started" },
                data: { status: "accepted", providerDocumentId: documentId, providerAcceptedAt: new Date(), providerReceipt: { action: "01", code: "-1", documentId } } });
            if (result.count !== 1) fail();
        });
    }
    private async document(tx: Prisma.TransactionClient, state: Locked, evidence: ContractDocumentEvidence) {
        const a = state.authority, id = evidence.documentId;
        const before = await tx.eformsign_doc.findUnique({ where: { documentId: id } });
        if (before && ((before.branchId !== null && before.branchId !== a.branchId) || (before.clientId !== null && before.clientId !== a.clientId))) fail("REQUEST_CONFLICT", "document_mismatch");
        await tx.eformsign_doc.upsert({ where: { documentId: id }, update: {}, create: {
            documentId: id, branchId: a.branchId, clientId: null, templateId: evidence.templateId, documentKind: "contract",
            createdDate: evidence.createdAt, updatedDate: evidence.updatedAt, expiredDate: evidence.expiresAt,
            statusType: evidence.statusType, statusDetail: evidence.statusType, stepType: evidence.stepType, stepIndex: evidence.stepIndex,
            stepName: evidence.stepName, stepRecipientType: "01", stepRecipientName: "", stepRecipientSms: "",
        } });
        await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_doc WHERE document_id = ${id} FOR UPDATE`);
        const current = await tx.eformsign_doc.findUnique({ where: { documentId: id } });
        const owners = await tx.eformsign_contract_authority.findMany({ where: { branchId: a.branchId, providerDocumentId: id }, select: { clientId: true } });
        const [pointer] = await tx.$queryRaw<Array<{ conflict: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM client WHERE e_doc_id = ${id}
            AND (id <> ${a.clientId} OR branch_id IS DISTINCT FROM ${a.branchId}::uuid))
            OR EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE provider_document_id = ${id} AND branch_id <> ${a.branchId}::uuid) AS conflict`);
        if (!current || current.permanentPurgeRequestedAt || current.voidedAt || ["047", "049", "099"].includes(current.statusType)
            || current.serviceRecordCaseId || current.revisionId || current.documentKind === "service_record"
            || (current.branchId !== null && current.branchId !== a.branchId) || (current.clientId !== null && current.clientId !== a.clientId)
            || !pointer || pointer.conflict || owners.some(row => row.clientId !== a.clientId)) fail("REQUEST_CONFLICT", "document_mismatch");
        return current;
    }
    async bindDocument(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence, draftIntentId?: string) {
        return this.prisma.$transaction(async tx => {
            const state = await this.load(tx, claim.jobId, claim.branchId, evidence.documentId); this.claimed(state, claim);
            const a = state.authority, ref = draftIntentId ?? a.creationIntentId;
            if (!ref || !["reserved", "creation_pending", "creation_uncertain", "document_ready"].includes(a.phase) || a.humanIntentId
                || (draftIntentId && a.draftIntentId !== draftIntentId) || (a.providerDocumentId && a.providerDocumentId !== evidence.documentId)) fail();
            const intent = await tx.eformsign_dispatch_intent.findUnique({ where: { id: ref } });
            if (!intent || intent.branchId !== a.branchId || intent.clientId !== a.clientId || intent.action !== (draftIntentId ? "create_draft" : "create")
                || (draftIntentId && (intent.generation !== a.generation || intent.templateId !== evidence.templateId)) || (intent.providerDocumentId && intent.providerDocumentId !== evidence.documentId)
                || intent.providerDocumentId !== evidence.documentId || !["accepted", "reconciled_delivered", "uncertain", "started"].includes(intent.status)) fail();
            await this.document(tx, state, evidence);
            const phase = a.phase === "creation_uncertain" || (!draftIntentId && ["started", "uncertain"].includes(intent.status)) ? "creation_uncertain" : "document_ready";
            await this.change(tx, state, { providerDocumentId: evidence.documentId, phase }); return this.snapshot(tx, state);
        });
    }
    async expose(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence) {
        return this.prisma.$transaction(async tx => {
            const state = await this.load(tx, claim.jobId, claim.branchId, evidence.documentId); this.claimed(state, claim);
            if (["human_exposed", "verified"].includes(state.authority.phase)) return false;
            if (state.authority.phase !== "document_ready" || state.authority.providerDocumentId !== evidence.documentId || evidence.confirmed) fail();
            await this.document(tx, state, evidence);
            const pending = await tx.eformsign_dispatch_intent.findFirst({ where: { providerDocumentId: evidence.documentId, action: "finalize", status: { in: ["started", "uncertain"] } } });
            if (pending) fail("REQUEST_CONFLICT");
            const intent = await this.startIntent(tx, { branchId: claim.branchId, clientId: state.authority.clientId, action: "manual_process", generation: state.authority.generation,
                providerDocumentId: evidence.documentId, templateId: evidence.templateId, businessKey: createHash("sha256").update(`contract-human:${state.authority.generation}`).digest("hex"), fingerprint: state.authority.fingerprint });
            if (intent.disposition !== "claimed") fail();
            await this.change(tx, state, { humanIntentId: intent.intent.id, phase: "human_exposed" }); return true;
        });
    }
    async reexposeHuman(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence) {
        await this.prisma.$transaction(async tx => {
            const state = await this.load(tx, claim.jobId, claim.branchId, evidence.documentId); this.claimed(state, claim);
            const a = state.authority;
            if (a.phase !== "human_exposed" || !a.humanIntentId || a.providerDocumentId !== evidence.documentId
                || evidence.confirmed || evidence.statusType !== "001" || evidence.stepType !== "00") fail();
            await this.document(tx, state, evidence);
            const pending = await tx.eformsign_dispatch_intent.findFirst({ where: { providerDocumentId: evidence.documentId, action: "finalize", status: { in: ["started", "uncertain"] } } });
            if (pending) fail("REQUEST_CONFLICT");
            const intent = await tx.eformsign_dispatch_intent.findUnique({ where: { id: a.humanIntentId } });
            if (!intent || intent.branchId !== a.branchId || intent.clientId !== a.clientId || intent.action !== "manual_process"
                || intent.status !== "started" || intent.providerDocumentId !== a.providerDocumentId
                || intent.generation !== a.generation || intent.templateId !== evidence.templateId) fail();
            const bumped = await tx.eformsign_dispatch_intent.updateMany({
                where: { id: intent.id, branchId: a.branchId, clientId: a.clientId, action: "manual_process", status: "started",
                    providerDocumentId: a.providerDocumentId, generation: a.generation, templateId: evidence.templateId, attemptCount: intent.attemptCount },
                data: { attemptCount: { increment: 1 }, startedAt: new Date() },
            });
            if (bumped.count !== 1) fail();
        });
    }
    private async complete(tx: Prisma.TransactionClient, state: Locked, evidence: ContractDocumentEvidence, automatic: boolean) {
        const a = state.authority;
        if (!evidence.confirmed || (a.providerDocumentId && a.providerDocumentId !== evidence.documentId)) fail();
        if (!automatic && a.phase === "closed" && state.job.status === "completed" && state.job.documentId === evidence.documentId
            && state.pointer === evidence.documentId && a.providerDocumentId === evidence.documentId) return;
        if (automatic ? !["creation_pending", "document_ready"].includes(a.phase) || a.humanIntentId !== null : !["human_exposed", "document_ready", "creation_uncertain", "verified"].includes(a.phase)) fail();
        const ref = automatic ? a.creationIntentId : a.humanIntentId ?? a.draftIntentId ?? a.creationIntentId;
        const intent = ref ? await tx.eformsign_dispatch_intent.findUnique({ where: { id: ref } }) : null;
        if (!intent || intent.branchId !== a.branchId || intent.clientId !== a.clientId || intent.providerDocumentId !== evidence.documentId
            || intent.action !== (!automatic && a.humanIntentId ? "manual_process" : !automatic && a.draftIntentId ? "create_draft" : "create")
            || (!automatic && intent.action !== "create" && (intent.generation !== a.generation || intent.fingerprint !== a.fingerprint || intent.templateId !== evidence.templateId))
            || !["started", "uncertain", "accepted", "reconciled_delivered"].includes(intent.status)
            || (automatic && !["accepted", "reconciled_delivered"].includes(intent.status))) fail();
        const verifyCreationIdentity = (creation: Intent) => {
            const frozen = record(record(state.job.payload)?.["contractDispatch"]);
            if (!frozen) {
                if (!state.job.payload || Date.now() - (state.job.completedAt ?? state.job.createdAt).getTime() > 7 * 86400000) {
                    assertLinkedIntent(a, state.job, creation, "create");
                    if (creation.providerDocumentId !== evidence.documentId || (creation.templateId && creation.templateId !== evidence.templateId)) fail();
                    return;
                }
                fail();
            }
            if (creation.branchId !== a.branchId || creation.clientId !== a.clientId || creation.action !== "create"
                || creation.providerDocumentId !== evidence.documentId || frozen["effectiveTemplateId"] !== evidence.templateId
                || frozen["companyId"] !== evidence.companyId || frozen["creatorId"] !== evidence.creatorId
                || (["branchId", "clientId", "localDocumentId", "assignmentId", "templateId", "action", "generation", "fingerprint"] as const)
                    .some(key => (creation[key] ?? null) !== (frozen[key] ?? null))) fail();
        };
        const settleDelivered = async (row: Intent) => {
            if (!["started", "uncertain"].includes(row.status)) return;
            if (automatic || !a.claimUserId) fail();
            const settled = await tx.eformsign_dispatch_intent.updateMany({ where: {
                id: row.id, branchId: row.branchId, clientId: row.clientId, action: row.action,
                businessKey: row.businessKey, generation: row.generation, fingerprint: row.fingerprint,
                localDocumentId: row.localDocumentId, assignmentId: row.assignmentId, templateId: row.templateId,
                providerDocumentId: evidence.documentId, status: row.status, attemptCount: row.attemptCount,
            }, data: { status: "reconciled_delivered", reconciledOutcome: "delivered", reconciledAt: new Date(),
                reconciledByUserId: a.claimUserId, reconciliationReason: "Contract recovery confirmed same-document provider delivery" } });
            if (settled.count !== 1) fail();
        };
        const refs = await linkedIntents(tx, a, state.job);
        const retentionExpired = !state.job.payload || Date.now() - (state.job.completedAt ?? state.job.createdAt).getTime() > 7 * 86400000;
        if (retentionExpired) {
            const context = (await this.snapshot(tx, state)).verificationOnly;
            if (!context || context.documentId !== evidence.documentId || context.templateId !== evidence.templateId) fail();
        }
        if (intent.action === "create") verifyCreationIdentity(intent);
        await settleDelivered(intent);
        for (const row of refs) {
            if (row.id === intent.id || !["started", "uncertain"].includes(row.status)) continue;
            if (row.action === "create") verifyCreationIdentity(row);
            else if (row.providerDocumentId !== evidence.documentId || row.templateId !== evidence.templateId) fail();
            await settleDelivered(row);
        }
        const doc = await this.document(tx, state, evidence);
        const data = retentionExpired ? null : record(record(state.job.payload)?.["contractData"]);
        if (!retentionExpired && !data) fail();
        await this.change(tx, state, { providerDocumentId: evidence.documentId, phase: "closed" });
        const moved = await tx.client.updateMany({ where: { id: a.clientId, branchId: a.branchId, eDocId: a.priorDocumentId }, data: { eDocId: evidence.documentId } });
        if (moved.count !== 1) fail();
        const mirrored = await tx.eformsign_doc.updateMany({ where: { id: doc.id, documentId: evidence.documentId, branchId: doc.branchId,
            clientId: doc.clientId, templateId: doc.templateId, permanentPurgeRequestedAt: null, voidedAt: null }, data: { branchId: a.branchId, clientId: a.clientId, documentKind: "contract", templateId: evidence.templateId,
            documentName: evidence.documentName || (data ? `${evidence.templateName || "계약서"} - ${String(data["customerName"] ?? "")}` : doc.documentName), documentNumber: evidence.documentNumber ?? null,
            templateName: evidence.templateName ?? null,
            ...(data ? { customerName: String(data["customerName"] ?? ""), customerPhone: normalizePhone(String(data["customerContact"] ?? "")),
                stepRecipientName: String(data["customerName"] ?? ""), stepRecipientSms: String(data["customerContact"] ?? "") } : {}),
            creatorName: evidence.creatorName ?? null, lastEditorName: evidence.lastEditorName ?? null, stepRecipientTypes: encodeEformsignStepRecipientTypes(evidence.stepRecipientTypes ?? null),
            statusType: evidence.statusType, statusDetail: evidence.statusType, stepType: evidence.stepType, stepIndex: evidence.stepIndex, stepName: evidence.stepName,
            stepRecipientType: "01",
            createdDate: evidence.createdAt, updatedDate: evidence.updatedAt, expiredDate: evidence.expiresAt, expired: evidence.expired ?? false } });
        if (mirrored.count !== 1) fail();
        const completed = await tx.eformsign_document_job.updateMany({ where: { id: state.job.id, branchId: a.branchId, clientId: a.clientId,
            contractGeneration: a.generation, payloadFingerprint: a.fingerprint, documentId: state.job.documentId, activeKey: state.job.activeKey,
            status: { in: automatic ? ["processing", "reconciling"] : ["failed", "requires_attention", "completed"] }, leaseToken: state.job.leaseToken },
            data: { status: "completed", documentId: evidence.documentId, completedAt: new Date(), activeKey: null, leaseToken: null, heartbeatAt: null, progressStep: "verified", lastErrorCode: null, payload: Prisma.DbNull } });
        if (completed.count !== 1) fail();
    }
    async completeAutomatic(worker: ContractWorkerContext, evidence: ContractDocumentEvidence) { await this.prisma.$transaction(async tx => { const state = await this.load(tx, worker.jobId, undefined, evidence.documentId); this.worker(state, worker); await this.complete(tx, state, evidence, true); }); }
    async completeManual(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence) { await this.prisma.$transaction(async tx => { const state = await this.load(tx, claim.jobId, claim.branchId, evidence.documentId); this.claimed(state, claim); await this.complete(tx, state, evidence, false); }); }
}
