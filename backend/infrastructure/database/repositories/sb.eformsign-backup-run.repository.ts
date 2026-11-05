import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma, type eformsign_backup_run, type eformsign_backup_run_document } from "@prisma/client";
import {
    ManualBackupRunError, normalizeManualBackupEnqueue, assertBackupText, assertBackupUuid, assertBackupDate,
    assertBackupLease, assertBackupPage, assertBackupHash, assertBackupObject, requireBackupInput, canonicalBackupJson,
    MANUAL_BACKUP_OUTCOME_MAX_BYTES, MANUAL_BACKUP_REPORT_MAX_BYTES,
    type EnqueueManualBackupInput, type ManualBackupRunRecord, type ManualBackupDocumentRecord,
    type ManualBackupLeaseIdentity, type ManualBackupDocumentResult, type ManualBackupFinishInput,
} from "domain/eformsign-backup/manual-backup-run";
import type {
    EformsignBackupRunRepository, ManualBackupSource, ManualBackupSourceDocument, ManualBackupSourceFile,
    ManualBackupRunPageInput, ManualBackupDocumentPageInput, ManualBackupPage,
} from "domain/repositories/eformsign-backup-run.repository.interface";
import type { ExportFileType } from "domain/eformsign-backup/export/constants";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";

const CHUNK = 500;
const TX_OPTIONS = { timeout: 60_000, maxWait: 15_000 };
const LEASE_MS = 180_000;
type Tx = Prisma.TransactionClient;
const runRecord = (row: eformsign_backup_run): ManualBackupRunRecord => row as unknown as ManualBackupRunRecord;
const documentRecord = (row: eformsign_backup_run_document): ManualBackupDocumentRecord => row as unknown as ManualBackupDocumentRecord;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
function branchIdentity(companyId: string, branchId: string): void { assertBackupText(companyId, 256); assertBackupUuid(branchId); }
async function dbNow(tx: Tx): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const row = rows[0]; requireBackupInput(row); return row.now;
}
function page<T>(rows: readonly T[], limit: number): ManualBackupPage<T> { return { items: rows.slice(0, limit), hasMore: rows.length > limit }; }

/** Unregistered adapter. Staff operations retain tenant ALS and explicit branch/company predicates.
 * Only machine control operations enter audited system scope, with company/run/principal/lease fences.
 * No source bytes, provider calls or business-table writes belong here.
 */
@Injectable()
export class SbEformsignBackupRunRepository implements EformsignBackupRunRepository {
    constructor(private readonly prisma: PrismaService) {}

    readSourceForRequest(branchId: string, range?: { readonly gte?: Date; readonly lt?: Date }): Promise<ManualBackupSource> {
        assertBackupUuid(branchId);
        if (range !== undefined) requireBackupInput(range !== null && typeof range === "object" && Object.keys(range).every(key => key === "gte" || key === "lt"));
        if (range?.gte !== undefined) assertBackupDate(range.gte);
        if (range?.lt !== undefined) assertBackupDate(range.lt);
        requireBackupInput(!range?.gte || !range.lt || range.gte < range.lt);
        const dateRange = { ...(range?.gte ? { gte: new Date(range.gte) } : {}), ...(range?.lt ? { lt: new Date(range.lt) } : {}) };
        return this.prisma.$transaction(async tx => {
            // The first statement establishes the RepeatableRead snapshot and its DB timestamp.
            const cut = await tx.$queryRaw<Array<{ observedAt: Date }>>`SELECT transaction_timestamp() AS "observedAt"`;
            const observedAt = cut[0]?.observedAt; requireBackupInput(observedAt);
            const documents: ManualBackupSourceDocument[] = [];
            const files: ManualBackupSourceFile[] = [];
            let afterId = 0;
            for (;;) {
                const where = { branchId, permanentPurgeRequestedAt: null, id: { gt: afterId }, ...(range ? { createdDate: dateRange } : {}) };
                const docs = await tx.eformsign_doc.findMany({ where, take: CHUNK, orderBy: { id: "asc" }, select: {
                    id: true, documentId: true, branchId: true, documentKind: true, serviceRecordCaseId: true, templateId: true,
                    createdDate: true, updatedDate: true, statusType: true, stepType: true, stepIndex: true, voidedAt: true,
                    permanentPurgeRequestedAt: true,
                } });
                if (!docs.length) break;
                const ids = docs.map(doc => doc.id);
                const nulls = await tx.eformsign_doc.findMany({
                    where: { branchId, id: { in: ids }, detailPayload: { equals: Prisma.DbNull } }, select: { id: true },
                });
                const nullIds = new Set(nulls.map(doc => doc.id));
                const byId = new Map(docs.map(doc => [doc.id, doc.documentId]));
                const metadata = await tx.eformsign_doc_file.findMany({
                    where: { eformsignDocId: { in: ids }, eformsignDoc: { branchId, permanentPurgeRequestedAt: null } },
                    select: { eformsignDocId: true, fileType: true, sha256: true, byteSize: true },
                });
                for (const { id, branchId: ownedBranch, ...doc } of docs) {
                    // WHERE guarantees a non-null, exact branch; keep that fact explicit in the port.
                    if (ownedBranch === branchId) documents.push({ ...doc, branchId, detailPayloadIsNull: nullIds.has(id) });
                }
                for (const file of metadata) {
                    const documentId = byId.get(file.eformsignDocId);
                    if (documentId !== undefined) files.push({ documentId, fileType: file.fileType as ExportFileType, sha256: file.sha256, byteSize: file.byteSize });
                }
                const last = docs[docs.length - 1]; requireBackupInput(last); afterId = last.id;
            }
            return { observedAt, documents, files };
        }, { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }

    async enqueue(raw: EnqueueManualBackupInput): Promise<{ run: ManualBackupRunRecord; replayed: boolean }> {
        // Copy caller-owned JSON before the first await: later mutation cannot change the fixed selection.
        const normalized = normalizeManualBackupEnqueue(raw);
        const input = { ...normalized, scope: JSON.parse(canonicalBackupJson(normalized.scope)),
            sourceCounts: JSON.parse(canonicalBackupJson(normalized.sourceCounts)), snapshotAt: new Date(normalized.snapshotAt),
            documents: normalized.documents.map(doc => ({ ...doc, documentCreatedAt: new Date(doc.documentCreatedAt), candidate: JSON.parse(canonicalBackupJson(doc.candidate)) })) };
        try {
            return await this.prisma.$transaction(async tx => {
                const existing = await tx.eformsign_backup_run.findFirst({ where: { branchId: input.branchId, requestKey: input.requestKey } });
                if (existing) return this.replay(existing, input);
                const active = await tx.eformsign_backup_run.findFirst({ where: { branchId: input.branchId, activeKey: `manual-backup:${input.branchId}` } });
                if (active) {
                    // A same-key winner may have committed between the two ReadCommitted reads.
                    if (active.requestKey === input.requestKey) return this.replay(active, input);
                    throw new ManualBackupRunError("RUN_ACTIVE");
                }
                // Lock only selected source rows. A concurrent purge/branch move must wait until the enqueue commits.
                for (let offset = 0; offset < input.documents.length; offset += CHUNK) {
                    const ids = input.documents.slice(offset, offset + CHUNK).map(doc => doc.documentId);
                    const owned = await tx.$queryRaw<Array<{ document_id: string }>>(Prisma.sql`
                        SELECT document_id FROM public.eformsign_doc
                        WHERE branch_id = ${input.branchId}::uuid AND permanent_purge_requested_at IS NULL
                        AND document_id IN (${Prisma.join(ids)}) ORDER BY document_id FOR SHARE`);
                    if (owned.length !== ids.length) throw new ManualBackupRunError("SOURCE_SCOPE_CHANGED");
                }
                const created = await tx.eformsign_backup_run.create({ data: {
                    companyId: input.companyId, branchId: input.branchId, requestedByUserId: input.requestedByUserId,
                    requestKey: input.requestKey, requestHash: input.requestHash, scope: json(input.scope), sourceCounts: json(input.sourceCounts),
                    snapshotAt: input.snapshotAt, activeKey: `manual-backup:${input.branchId}`,
                } });
                for (let offset = 0; offset < input.documents.length; offset += CHUNK) {
                    await tx.eformsign_backup_run_document.createMany({ data: input.documents.slice(offset, offset + CHUNK).map(doc => ({
                        ...doc, candidate: json(doc.candidate), runId: created.id, branchId: input.branchId,
                    })) });
                }
                return { run: runRecord(created), replayed: false };
            }, TX_OPTIONS);
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
            // Unique conflicts wait for the winner's transaction. One bounded reread converges both unique fences.
            const existing = await this.prisma.eformsign_backup_run.findFirst({ where: { branchId: input.branchId, requestKey: input.requestKey } });
            if (existing) return this.replay(existing, input);
            // The active-key winner can already have finished by this read. Do not bind a new key
            // to that winner, and do not retry an unbound request; the observed conflict still stands.
            throw new ManualBackupRunError("RUN_ACTIVE");
        }
    }
    private replay(row: eformsign_backup_run, input: EnqueueManualBackupInput): { run: ManualBackupRunRecord; replayed: true } {
        if (row.companyId !== input.companyId || row.requestHash !== input.requestHash) throw new ManualBackupRunError("IDEMPOTENCY_CONFLICT");
        return { run: runRecord(row), replayed: true };
    }
    async findForBranch(companyId: string, branchId: string, id: string): Promise<ManualBackupRunRecord | null> {
        branchIdentity(companyId, branchId); assertBackupUuid(id);
        const row = await this.prisma.eformsign_backup_run.findFirst({ where: { companyId, branchId, id } });
        return row ? runRecord(row) : null;
    }
    async listForBranch(input: ManualBackupRunPageInput): Promise<ManualBackupPage<ManualBackupRunRecord>> {
        requireBackupInput(input && typeof input === "object");
        branchIdentity(input.companyId, input.branchId); assertBackupPage(0, input.limit);
        if (input.cursor) { assertBackupDate(input.cursor.createdAt); assertBackupUuid(input.cursor.id); }
        const rows = await this.prisma.eformsign_backup_run.findMany({ where: {
            companyId: input.companyId, branchId: input.branchId,
            ...(input.cursor ? { OR: [{ createdAt: { lt: input.cursor.createdAt } }, { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } }] } : {}),
        }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.limit + 1 });
        return page(rows.map(runRecord), input.limit);
    }
    async listDocumentsForBranch(input: ManualBackupDocumentPageInput): Promise<ManualBackupPage<ManualBackupDocumentRecord>> {
        requireBackupInput(input && typeof input === "object");
        branchIdentity(input.companyId, input.branchId); assertBackupUuid(input.runId); assertBackupPage(input.afterOrdinal, input.limit);
        const rows = await this.prisma.eformsign_backup_run_document.findMany({ where: {
            runId: input.runId, branchId: input.branchId, run: { id: input.runId, companyId: input.companyId, branchId: input.branchId }, ordinal: { gt: input.afterOrdinal },
        }, orderBy: { ordinal: "asc" }, take: input.limit + 1 });
        return page(rows.map(documentRecord), input.limit);
    }
    claimNext(companyId: string, principalId: string): Promise<ManualBackupRunRecord | null> {
        assertBackupText(companyId, 256); assertBackupText(principalId, 64);
        return runSystemScope(() => this.prisma.$transaction(async tx => {
            // Transaction-scoped company mutex: queued jobs on different branches cannot both be claimed.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${companyId}, 677643))::text`;
            if (await tx.eformsign_backup_run.findFirst({ where: { companyId, status: "running" }, select: { id: true } })) return null;
            const rows = await tx.$queryRaw<Array<{ id: string; branch_id: string }>>`
                SELECT id, branch_id FROM public.eformsign_backup_run WHERE company_id = ${companyId} AND status = 'queued'
                ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
            const selected = rows[0]; if (!selected) return null;
            const now = await dbNow(tx);
            const row = await tx.eformsign_backup_run.update({ where: { id: selected.id, companyId, branchId: selected.branch_id, status: "queued" }, data: {
                status: "running", leaseToken: randomUUID(), leaseOwnerPrincipalId: principalId,
                startedAt: now, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 },
            } });
            return runRecord(row);
        }, TX_OPTIONS));
    }
    heartbeat(rawIdentity: ManualBackupLeaseIdentity): Promise<boolean> {
        assertBackupLease(rawIdentity);
        const identity = { ...rawIdentity };
        return runSystemScope(() => this.prisma.$transaction(async tx => {
            // UPDATE predicates can be evaluated before a row-lock wait. Lock first, then read the clock,
            // so a heartbeat blocked past its deadline cannot revive the expired lease.
            if (!await this.lockLease(tx, identity)) return false;
            const changed = await tx.$executeRaw`
                UPDATE public.eformsign_backup_run SET heartbeat_at = clock_timestamp(),
                lease_expires_at = clock_timestamp() + interval '180000 milliseconds', updated_at = clock_timestamp()
                WHERE id = ${identity.runId}::uuid AND company_id = ${identity.companyId}
                AND lease_owner_principal_id = ${identity.principalId} AND lease_token = ${identity.leaseToken}::uuid
                AND status = 'running' AND lease_expires_at > clock_timestamp()`;
            return changed === 1;
        }, TX_OPTIONS));
    }

    findClaimed(rawIdentity: ManualBackupLeaseIdentity): Promise<ManualBackupRunRecord | null> {
        assertBackupLease(rawIdentity);
        const identity = { ...rawIdentity };
        return runSystemScope(() => this.prisma.$transaction(async tx => {
            const row = await this.lockLease(tx, identity);
            return row ? runRecord(row) : null;
        }, TX_OPTIONS));
    }
    listClaimedDocuments(rawIdentity: ManualBackupLeaseIdentity, afterOrdinal: number, limit: number): Promise<ManualBackupPage<ManualBackupDocumentRecord>> {
        assertBackupLease(rawIdentity);
        const identity = { ...rawIdentity };
        assertBackupPage(afterOrdinal, limit);
        return runSystemScope(() => this.prisma.$transaction(async tx => {
            const row = await this.lockLease(tx, identity);
            if (!row) return { items: [], hasMore: false };
            const rows = await tx.eformsign_backup_run_document.findMany({ where: { runId: row.id, branchId: row.branchId, ordinal: { gt: afterOrdinal } }, orderBy: { ordinal: "asc" }, take: limit + 1 });
            return page(rows.map(documentRecord), limit);
        }, TX_OPTIONS));
    }
    async writeDocumentResults(rawIdentity: ManualBackupLeaseIdentity, results: readonly ManualBackupDocumentResult[]): Promise<boolean> {
        assertBackupLease(rawIdentity);
        const identity = { ...rawIdentity };
        requireBackupInput(Array.isArray(results) && results.length >= 1 && results.length <= 100);
        const ids = new Set<string>();
        const copied = results.map(item => {
            requireBackupInput(item && typeof item === "object");
            assertBackupText(item.documentId, 4096); requireBackupInput(!ids.has(item.documentId)); ids.add(item.documentId);
            assertBackupObject(item.outcome, MANUAL_BACKUP_OUTCOME_MAX_BYTES);
            return { documentId: item.documentId, outcome: JSON.parse(canonicalBackupJson(item.outcome)) as Prisma.InputJsonObject };
        });
        return this.withLeaseWrite(async tx => {
            const run = await this.lockLease(tx, identity); if (!run) return false;
            const rows = await tx.eformsign_backup_run_document.findMany({ where: { runId: run.id, branchId: run.branchId, documentId: { in: [...ids] } } });
            if (rows.length !== copied.length) return false;
            const byId = new Map(rows.map(row => [row.documentId, row]));
            if (copied.some(item => {
                const old = byId.get(item.documentId)?.outcome;
                return old !== null && canonicalBackupJson(old) !== canonicalBackupJson(item.outcome);
            })) return false;
            for (const item of copied) {
                await tx.eformsign_backup_run_document.updateMany({ where: { runId: run.id, branchId: run.branchId, documentId: item.documentId, outcome: { equals: Prisma.DbNull } }, data: { outcome: item.outcome } });
            }
            await this.finalLeaseFence(tx, identity);
            return true;
        });
    }
    async finish(rawIdentity: ManualBackupLeaseIdentity, raw: ManualBackupFinishInput): Promise<boolean> {
        assertBackupLease(rawIdentity);
        const identity = { ...rawIdentity };
        requireBackupInput(raw && typeof raw === "object");
        requireBackupInput(["partial", "blocked", "failed", "unverified"].includes(raw.status));
        assertBackupText(raw.workerRunId, 128); assertBackupHash(raw.reportHash); assertBackupObject(raw.result, MANUAL_BACKUP_REPORT_MAX_BYTES);
        if (raw.failureCode !== undefined) assertBackupText(raw.failureCode, 80);
        const input = { ...raw, result: JSON.parse(canonicalBackupJson(raw.result)) as Prisma.InputJsonObject };
        return this.withLeaseWrite(async tx => {
            // Terminal ACK replay uses the preserved private identity, and compares the entire finishing payload.
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM public.eformsign_backup_run WHERE id = ${identity.runId}::uuid
                AND company_id = ${identity.companyId} AND lease_owner_principal_id = ${identity.principalId}
                AND lease_token = ${identity.leaseToken}::uuid FOR UPDATE`;
            if (!rows.length) return false;
            const run = await tx.eformsign_backup_run.findFirstOrThrow({ where: { id: identity.runId, companyId: identity.companyId } });
            if (run.status !== "running") return run.status === input.status && run.reportHash === input.reportHash
                && run.workerRunId === input.workerRunId && run.failureCode === (input.failureCode ?? null)
                && canonicalBackupJson(run.result) === canonicalBackupJson(input.result);
            if ((input.status === "partial" || input.status === "unverified") && await tx.eformsign_backup_run_document.count({ where: { runId: run.id, branchId: run.branchId, outcome: { equals: Prisma.DbNull } } }) > 0) return false;
            // The final mutation itself checks expiration against the DB clock, after all lock waits and reads.
            const changed = await tx.$executeRaw`
                UPDATE public.eformsign_backup_run SET status = ${input.status}, active_key = NULL,
                finished_at = clock_timestamp(), updated_at = clock_timestamp(), worker_run_id = ${input.workerRunId},
                report_hash = ${input.reportHash}, result = ${JSON.stringify(input.result)}::jsonb,
                failure_code = ${input.failureCode ?? null}
                WHERE id = ${identity.runId}::uuid AND branch_id = ${run.branchId}::uuid AND company_id = ${identity.companyId}
                AND lease_owner_principal_id = ${identity.principalId} AND lease_token = ${identity.leaseToken}::uuid
                AND status = 'running' AND lease_expires_at > clock_timestamp()`;
            return changed === 1;
        });
    }
    expireStale(companyId: string): Promise<number> {
        assertBackupText(companyId, 256);
        return runSystemScope(() => this.prisma.$executeRaw`
            UPDATE public.eformsign_backup_run SET status = 'blocked', failure_code = 'WORKER_LEASE_EXPIRED',
            finished_at = clock_timestamp(), updated_at = clock_timestamp(), active_key = NULL, lease_token = NULL
            WHERE company_id = ${companyId} AND status = 'running' AND lease_expires_at <= clock_timestamp()`);
    }
    /** Parent row lock serializes result/finish/expiry; check the DB clock AFTER any lock wait. */
    private async lockLease(tx: Tx, identity: ManualBackupLeaseIdentity): Promise<eformsign_backup_run | null> {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM public.eformsign_backup_run WHERE id = ${identity.runId}::uuid
            AND company_id = ${identity.companyId} AND lease_owner_principal_id = ${identity.principalId}
            AND lease_token = ${identity.leaseToken}::uuid AND status = 'running' FOR UPDATE`;
        if (!rows.length) return null;
        const now = await dbNow(tx);
        return tx.eformsign_backup_run.findFirst({ where: { id: identity.runId, companyId: identity.companyId,
            leaseOwnerPrincipalId: identity.principalId, leaseToken: identity.leaseToken, status: "running", leaseExpiresAt: { gt: now } } });
    }
    private async finalLeaseFence(tx: Tx, identity: ManualBackupLeaseIdentity): Promise<void> {
        const changed = await tx.$executeRaw`
            UPDATE public.eformsign_backup_run SET updated_at = updated_at WHERE id = ${identity.runId}::uuid
            AND company_id = ${identity.companyId} AND lease_owner_principal_id = ${identity.principalId}
            AND lease_token = ${identity.leaseToken}::uuid AND status = 'running' AND lease_expires_at > clock_timestamp()`;
        if (changed !== 1) throw new ManualBackupRunError("LEASE_LOST");
    }
    private async withLeaseWrite(fn: (tx: Tx) => Promise<boolean>): Promise<boolean> {
        try { return await runSystemScope(() => this.prisma.$transaction(fn, TX_OPTIONS)); }
        catch (error) { if (error instanceof ManualBackupRunError && error.code === "LEASE_LOST") return false; throw error; }
    }
}
