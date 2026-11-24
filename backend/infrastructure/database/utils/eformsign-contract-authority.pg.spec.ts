import { ServiceRecordInitialNoProviderDocumentService } from "infrastructure/eformsign/service-record-initial-no-provider-document.service";
import { SERVICE_RECORD_INITIAL_NO_DOC_REASONS as NO_DOC_REASON } from "domain/constants/service-record-initial-no-provider-document";
import { ServiceRecordInitialProviderRecoveryService } from "infrastructure/eformsign/service-record-initial-provider-recovery.service";
import { initialProviderRecoveryInput, providerDocumentPage } from "../../../test/utils/service-record-initial-provider-recovery.fixture";
import { normalizeEformsignDocumentResponse } from "infrastructure/api/eformsign-response.normalizer";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import { BackfillEformsignDocsUsecase } from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import type { ServiceRecordRevisionDispatchContext, ServiceRecordRevisionGenerationInput } from "@babyjamjam/shared/types/service-record";
import { createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import type { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import {
    initialRegenerationReadiness,
    isInitialFinalizationJobIdentity,
    isInitialFinalizationRequestKeyFor,
    releaseTerminalInitialFinalizationKey,
} from "application/policies/service-record-initial-finalization.policy";
import { ServiceRecordEditRepository, assertNoBlockingRevisionDocumentStates } from "infrastructure/database/repositories/service-record-edit.repository";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import type { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { SbEformsignDocumentMirrorRepository } from "../repositories/sb.eformsign-document-mirror.repository";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { INITIAL_PROVIDER_SETTLE_MS, initialFinalizationJobSql, initialFinalizationRetryCandidateSql } from "./service-record-initial-recovery-sql";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { ConflictException } from "@nestjs/common";
import { classifyRecovery } from "domain/entities/eformsign-document-job.entity";
import { ClientEntity } from "domain/entities/client.entity";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDispatchIntentRepository } from "../repositories/sb.eformsign-dispatch-intent.repository";
import { normalizeVerifiedAuthority, retireProvenNoEffect } from "./eformsign-contract-authority-release";
import { SbClientRepository } from "../repositories/sb.client.repository";
import { SbEformsignContractRecoveryRepository } from "../repositories/sb.eformsign-contract-recovery.repository";
import { SbEformsignDocumentJobRepository } from "../repositories/sb.eformsign-document-job.repository";
import type { EformsignService } from "application/services/eformsign.service";
import type { ContractDocumentEvidence } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import { data, workflowPlan } from "../../../test/utils/eformsign-contract-recovery.fixture";
import {
    AuthorityConflictError, AuthorityExpected, AuthorityPatch, AuthorityReservation, AuthorityState,
    assertAuthorityPointerWrite, assertNoUnresolvedAuthorityForDocuments, compareAndSetAuthority,
    discoverAuthorityClientIds, lockAuthorityScope, reserveAuthority,
} from "./eformsign-contract-authority";

const ownedUrl = "postgresql://bjj_document_jobs_test@127.0.0.1:62395/bjj_document_jobs_qa";
function ownedMarkers(): boolean {
    try {
        const owner = process.env["BJJ_RETENTION_OWNER"] ?? "", pid = process.env["BJJ_RETENTION_OWNER_PID"] ?? "";
        if (process.env["BJJ_RETENTION_OWNED_DB"] !== ownedUrl || !/^\d+$/.test(pid) || Number(pid) <= 1 ||
            !/^\/tmp\/bjj-authority-retention-pg-[A-Za-z0-9]+$/.test(owner)) return false;
        const directory = lstatSync(owner);
        if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 ||
            readFileSync(`${owner}/owner`, "utf8") !== pid) return false;
        const postmaster = readFileSync(`${owner}/data/postmaster.pid`, "utf8").split("\n");
        if (!/^\d+$/.test(postmaster[0] ?? "") || Number(postmaster[0]) <= 1 ||
            realpathSync(postmaster[1] ?? "") !== realpathSync(`${owner}/data`) || postmaster[3] !== "62395") return false;
        process.kill(Number(pid), 0); process.kill(Number(postmaster[0]), 0);
        return true;
    } catch { return false; }
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Barrier timeout")), ms); })]); }
    finally { clearTimeout(timer); }
}

// This decision occurs before constructing any client; DATABASE_URL is never read.
(ownedMarkers() ? describe : describe.skip)("owned PostgreSQL authority primitives", () => {
    let db: PrismaClient, a: PrismaClient, b: PrismaClient;
    let branches: string[], users: string[], clients: number[], documents: string[], jobs: AuthorityReservation[], employees: number[];
    let beforeCounts: unknown;
    // Match test/integrity/helpers/tracker.ts: append-only revisions pin their case
    // and branch until the owned runner drops its throwaway cluster. Keep exact IDs
    // across tests so counts exclude only these fixtures, never an entire table.
    const retained = { branches: new Set<string>(), cases: new Set<string>(), revisions: new Set<string>() };
    function retainRevision(revision: { id: string; branchId: string; serviceRecordCaseId: string }) {
        retained.revisions.add(revision.id);
        retained.cases.add(revision.serviceRecordCaseId);
        retained.branches.add(revision.branchId);
    }
    const excludingRetained = (ids: Set<string>) => ids.size
        ? Prisma.sql`WHERE id::text NOT IN (${Prisma.join([...ids])})` : Prisma.empty;
    const transaction = <T>(connection: PrismaClient, callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        connection.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`;
            return callback(tx);
        }, { maxWait: 5000, timeout: 15000 });
    const counts = () => db.$queryRaw`SELECT jsonb_build_object(
        'branches',(SELECT count(*) FROM branch ${excludingRetained(retained.branches)}),'users',(SELECT count(*) FROM "user"),
        'clients',(SELECT count(*) FROM client),'documents',(SELECT count(*) FROM eformsign_doc),
        'jobs',(SELECT count(*) FROM eformsign_document_job),'intents',(SELECT count(*) FROM eformsign_dispatch_intent),
        'employees',(SELECT count(*) FROM employee),'schedules',(SELECT count(*) FROM employee_schedule),
        'authorities',(SELECT count(*) FROM eformsign_contract_authority),
        'cases',(SELECT count(*) FROM service_record_case ${excludingRetained(retained.cases)}),
        'revisions',(SELECT count(*) FROM service_record_revision ${excludingRetained(retained.revisions)}),
        'revisionDocumentStates',(SELECT count(*) FROM service_record_revision_document_state)) AS counts`;
    const read = (client = clients[0]!, branch = branches[0]!) => transaction(db, (tx) => lockAuthorityScope(tx, branch, [client]));
    const reserve = (job = jobs[0]!) => transaction(db, (tx) => reserveAuthority(tx, job));
    const expected = (state: AuthorityState): AuthorityExpected => ({ branchId: state.branchId, clientId: state.clientId,
        generation: state.generation, creationJobId: state.creationJobId, phase: state.phase, claimEpoch: state.claimEpoch });
    const cas = (state: AuthorityState, patch: AuthorityPatch) => transaction(db, (tx) => compareAndSetAuthority(tx, expected(state), patch));
    const pointer = async (generation?: string, document = documents[0]!, ids = [clients[0]!], branch = branches[0]!) => transaction(db, async (tx) => {
        const prior = await tx.client.findUniqueOrThrow({ where: { id: clients[0]! }, select: { eDocId: true } });
        await assertAuthorityPointerWrite(tx, { branchId: branch, clientIds: ids, generation, documentIds: [document, ...(prior.eDocId ? [prior.eDocId] : [])] });
        await tx.client.update({ where: { id: clients[0]! }, data: { eDocId: document } });
    });
    const currentPointer = () => db.client.findUniqueOrThrow({ where: { id: clients[0]! }, select: { eDocId: true } });
    async function lockObserved(pid: number) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const rows = await db.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
            if (rows[0]?.wait_event_type === "Lock") { expect(rows[0].wait_event_type).toBe("Lock"); return; }
            await new Promise((done) => setTimeout(done, 20));
        }
        throw new Error("Known contender never entered PostgreSQL Lock wait");
    }
    async function contend(first: (tx: Prisma.TransactionClient) => Promise<unknown>, second: (tx: Prisma.TransactionClient) => Promise<unknown>) {
        const ready = deferred<void>(), release = deferred<void>(), started = deferred<number>();
        const pa = transaction(a, async (tx) => { const result = await first(tx); ready.resolve(); await bounded(release.promise, 9000); return result; });
        void pa.catch(() => undefined);
        let pb: Promise<unknown> | undefined;
        try {
            await bounded(ready.promise, 5000);
            pb = transaction(b, async (tx) => {
                const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                started.resolve(row!.pid); return second(tx);
            });
            void pb.catch(() => undefined);
            await lockObserved(await bounded(started.promise, 5000));
        } finally { release.resolve(); await Promise.allSettled([pa, ...(pb ? [pb] : [])]); }
        return Promise.allSettled([pa, pb!]);
    }
    const digest = (text: string) => createHash("sha256").update(text).digest("hex");
    const canonical = (value: unknown): string => value && typeof value === "object"
        ? `{${Object.entries(value).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
        : JSON.stringify(value) ?? "null"; // Fixture-only object/string/number shape.
    const identity = { companyId: "company-abc", creatorId: "service@example.test", workflow: workflowPlan };
    const evidence = (documentId: string, confirmed = false): ContractDocumentEvidence => ({ documentId, templateId: workflowPlan.templateId,
        ...identity, statusType: confirmed ? "060" : "001", stepType: confirmed ? "05" : "00", stepIndex: confirmed ? "2" : "1",
        stepName: "synthetic", confirmed, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date("2030-01-01") });
    async function runtime(index = 0, prior?: { id: number; documentId: string }) {
        // Only provider/config JSON is controlled; both repositories and every SQL operation are real.
        const options = { resolveEffectiveTemplateId: (id?: string) => id ?? workflowPlan.templateId,
            generateDocumentOptions: () => ({ company: { id: identity.companyId }, user: { id: identity.creatorId } }) } as unknown as EformsignService;
        const recovery = new SbEformsignContractRecoveryRepository(db as unknown as PrismaService, options);
        const jobRepository = new SbEformsignDocumentJobRepository(db as unknown as PrismaService);
        // A second generation reuses its provider; branch/normalized-phone is unique.
        const employee = prior ? await db.employee.findFirstOrThrow({ where: { branchId: branches[0]!, phone: data.caretaker1Contact } })
            : await db.employee.create({ data: { name: "Synthetic PG provider", workArea: [], phone: data.caretaker1Contact, grade: "synthetic", branchId: branches[0]! } });
        if (!prior) employees.push(employee.id);
        const schedule = await db.employee_schedule.create({ data: { primaryEmployeeId: employee.id, clientId: clients[index]!, branchId: branches[0]!,
            workAddress: "synthetic", startDate: new Date("2026-11-01"), endDate: new Date("2026-11-10"), replaced: false } });
        const payload = { clientId: clients[index]!, contractData: data }, key = randomUUID();
        const enqueue = { branchId: branches[0]!, clientId: clients[index]!, jobType: "create_document" as const, source: "staff" as const,
            requestKey: `runtime-request-${key}`, activeKey: `runtime-active-${key}`, payload, payloadFingerprint: digest(canonical(payload)), createdByUserId: users[0]! };
        const queued = await jobRepository.enqueue(enqueue), leaseToken = randomUUID();
        await db.eformsign_document_job.update({ where: { id: queued.job.id }, data: { status: "processing", leaseToken } });
        const contractData = ((await db.eformsign_document_job.findUniqueOrThrow({ where: { id: queued.job.id } })).payload as { contractData: typeof data }).contractData;
        const worker = { jobId: queued.job.id, leaseToken, contractGeneration: queued.job.contractGeneration! };
        const generation = prior?.documentId ?? "initial", localDocumentId = prior?.id ?? null;
        const input = { branchId: branches[0]!, clientId: clients[index]!, action: "create" as const, generation, localDocumentId,
            assignmentId: schedule.id, templateId: null, businessKey: digest([branches[0], clients[index], localDocumentId ?? "-", schedule.id, "-", "create", generation].join("|")),
            fingerprint: digest(JSON.stringify({ contractData, generation })) };
        const effect = { contractData, workflow: workflowPlan };
        return { recovery, jobRepository, queued, enqueue, worker, input, effect, options };
    }
    async function failed(s: Awaited<ReturnType<typeof runtime>>, reconciled: boolean) {
        const result = await s.recovery.claimCreation(s.input, s.worker, s.effect);
        if (reconciled) await db.eformsign_dispatch_intent.update({ where: { id: result.intent.id }, data: { status: "reconciled_not_delivered",
            reconciledOutcome: "not_delivered", reconciledAt: new Date(), reconciledByUserId: users[0]! } });
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "failed", leaseToken: null, completedAt: new Date(), activeKey: null } });
        const opened = await s.recovery.open(s.worker.jobId, branches[0]!, users[0]!);
        return { intent: result.intent, opened, claim: { jobId: opened.jobId, branchId: opened.branchId, userId: users[0]!, claimEpoch: opened.claimEpoch } };
    }
    beforeAll(() => {
        if (!ownedMarkers()) throw new Error("Owned cluster markers changed before client construction");
        const make = () => new PrismaClient({ datasources: { db: { url: `${ownedUrl}?connection_limit=1&pool_timeout=5` } }, transactionOptions: { timeout: 15000, maxWait: 5000 } });
        db = make(); a = make(); b = make();
    });
    beforeEach(async () => {
        beforeCounts = await counts(); branches = [randomUUID(), randomUUID()]; users = [randomUUID(), randomUUID()];
        documents = [0, 1, 2].map(() => `authority-pg-${randomUUID()}`); clients = []; jobs = []; employees = [];
        for (const id of branches) await db.branch.create({ data: { id, name: "Synthetic authority PG", slug: `authority-pg-${id}` } });
        for (const id of users) await db.user.create({ data: { id, name: "Synthetic authority PG" } });
        for (let i = 0; i < 3; i++) {
            clients.push((await db.client.create({ data: { name: "Synthetic authority PG", voucherClient: false, branchId: branches[i === 2 ? 1 : 0]! } })).id);
            await db.eformsign_doc.create({ data: { documentId: documents[i]!, branchId: branches[i === 2 ? 1 : 0]!,
                createdDate: new Date(), updatedDate: new Date(), expiredDate: new Date(), statusType: "001", statusDetail: "synthetic",
                stepType: "00", stepIndex: "0", stepName: "synthetic", stepRecipientType: "01", stepRecipientName: "synthetic", stepRecipientSms: "" } });
        }
        for (const index of [0, 0, 1, 2]) {
            const job = { branchId: branches[index === 2 ? 1 : 0]!, clientId: clients[index]!, jobId: randomUUID(),
                generation: randomUUID(), fingerprint: createHash("sha256").update(randomUUID()).digest("hex"), priorDocumentId: null };
            jobs.push(job);
            await db.eformsign_document_job.create({ data: { id: job.jobId, branchId: job.branchId, clientId: job.clientId,
                contractGeneration: job.generation, payloadFingerprint: job.fingerprint, jobType: "create_document", source: "staff", requestKey: `authority-pg-${job.jobId}` } });
        }
    });
    afterEach(async () => {
        // Transactions really commit; remove mutable fixtures in FK order, including
        // partial setup. Revisions and only their pinned parents survive cluster-wide.
        try {
            await db.eformsign_contract_authority.deleteMany({ where: { branchId: { in: branches } } });
            await db.eformsign_document_job.deleteMany({ where: { branchId: { in: branches } } });
            await db.eformsign_dispatch_intent.deleteMany({ where: { branchId: { in: branches } } });
            await db.client.updateMany({ where: { branchId: { in: branches } }, data: { eDocId: null } });
            await db.service_record_snapshot_chunk.deleteMany({ where: { branchId: { in: branches } } });
            await db.eformsign_doc.deleteMany({ where: { documentId: { in: documents } } });
            await db.service_record_day.deleteMany({ where: { branchId: { in: branches } } });
            await db.service_record_assignment.deleteMany({ where: { branchId: { in: branches } } });
            await db.service_record_edit_draft.deleteMany({ where: { branchId: { in: branches } } });
            await db.employee_schedule.deleteMany({ where: { branchId: { in: branches } } });
            await db.service_record_revision_document_state.deleteMany({ where: { branchId: { in: branches } } });
            await db.service_record_case.deleteMany({ where: { branchId: { in: branches }, id: { notIn: [...retained.cases] } } });
            // Append-only revisions keep these parents alive after their mutable data is
            // removed. Make them idle so they cannot fill a later test's scheduler batch.
            await db.service_record_case.updateMany({
                where: { branchId: { in: branches }, id: { in: [...retained.cases] } },
                data: { status: "WAITING_FOR_DETAILS", nextAttemptAt: null },
            });
            await db.client.deleteMany({ where: { branchId: { in: branches } } });
            await db.employee.deleteMany({ where: { id: { in: employees } } });
            await db.user.deleteMany({ where: { id: { in: users } } });
            await db.branch.deleteMany({ where: { id: { in: branches, notIn: [...retained.branches] } } });
            expect(await counts()).toEqual(beforeCounts);
        } finally { await Promise.all([a.$disconnect(), b.$disconnect()]); }
    });
    afterAll(async () => { await Promise.all([db?.$disconnect(), a?.$disconnect(), b?.$disconnect()]); });

    it("P1 locks a reversed client set ascending and permits an absent-authority pointer update", async () => {
        expect(await transaction(db, (tx) => lockAuthorityScope(tx, branches[0]!, [clients[1]!, clients[0]!, clients[1]!]))).toEqual([]);
        await pointer(); expect(await currentPointer()).toEqual({ eDocId: documents[0] });
        await db.client.update({ where: { id: clients[0]! }, data: { eDocId: null } });
        await reserve(); await reserve(jobs[2]!);
        const rows = await transaction(db, (tx) => lockAuthorityScope(tx, branches[0]!, [clients[1]!, clients[0]!]));
        expect(rows.map((row) => row.clientId)).toEqual([...clients.slice(0, 2)].sort((x, y) => x - y));
    });
    it("P2 reserves the exact durable operation idempotently and rotates only closed authority to a durable job", async () => {
        await pointer(); const first = { ...jobs[0]!, priorDocumentId: documents[0]! };
        const saved = await reserve(first);
        expect(saved).toMatchObject({ phase: "reserved", generation: first.generation, creationJobId: first.jobId, fingerprint: first.fingerprint, priorDocumentId: documents[0] });
        expect(await reserve(first)).toEqual(saved);
        const next = { ...jobs[1]!, priorDocumentId: documents[0]! };
        await expect(reserve(next)).rejects.toBeInstanceOf(AuthorityConflictError);
        await expect(reserve({ ...first, generation: randomUUID() })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(await cas(saved, { phase: "closed" })).toBe(true);
        await expect(reserve({ ...next, jobId: randomUUID() })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(await reserve(next)).toMatchObject({ generation: next.generation, creationJobId: next.jobId, phase: "reserved" });
        expect((await db.eformsign_document_job.findUniqueOrThrow({ where: { id: first.jobId } })).contractGeneration).toBe(first.generation);
    });
    it("P3 performs exact epoch/phase CAS once, preserves BigInt and refuses wrong identity/claimant and immutable patches", async () => {
        const initial = await reserve(), expires = new Date("2030-01-01T00:00:00.000Z");
        expect(await cas(initial, { phase: "creation_pending", claimEpoch: 42n, claimUserId: users[0]!, claimExpiresAt: expires })).toBe(true);
        const state = (await read())[0]!, old = { ...expected(state), claimUserId: users[0]! };
        expect(state.claimEpoch).toBe(42n);
        expect(await transaction(db, (tx) => compareAndSetAuthority(tx, old, { claimEpoch: 43n }))).toBe(true);
        expect(await transaction(db, (tx) => compareAndSetAuthority(tx, old, { claimEpoch: 43n }))).toBe(false);
        for (const delta of [{ branchId: branches[1]! }, { generation: randomUUID() }, { creationJobId: jobs[1]!.jobId }, { phase: "reserved" as const }, { claimUserId: users[1]! }]) {
            expect(await transaction(db, (tx) => compareAndSetAuthority(tx, { ...old, claimEpoch: 43n, ...delta }, { claimEpoch: 44n }))).toBe(false);
        }
        const current = (await read())[0]!;
        await expect(cas(current, { generation: randomUUID() } as AuthorityPatch)).rejects.toBeInstanceOf(AuthorityConflictError);
        expect((await read())[0]).toEqual(current);
        expect(await cas(current, { claimEpoch: 9007199254740993n })).toBe(true);
        expect((await read())[0]).toMatchObject({ claimEpoch: 9007199254740993n, claimUserId: users[0], claimExpiresAt: expires });
    });
    it("P4 requires exact generation only in permitted phases and leaves the pointer unchanged on every denial", async () => {
        let state = await reserve();
        await expect(pointer()).rejects.toBeInstanceOf(AuthorityConflictError);
        await expect(pointer(randomUUID())).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(await currentPointer()).toEqual({ eDocId: null });
        const intent = await db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!,
            action: "manual_process", generation: state.generation, businessKey: createHash("sha256").update(randomUUID()).digest("hex"), fingerprint: state.fingerprint } });
        for (const phase of ["reserved", "creation_pending", "document_ready", "creation_uncertain", "human_exposed", "verified", "blocked"] as const) {
            expect(await cas(state, { phase, providerDocumentId: documents[0]!, humanIntentId: intent.id, claimUserId: users[0]!, claimExpiresAt: new Date("2030-01-01") })).toBe(true);
            state = (await read())[0]!; const prior = await currentPointer();
            if (["reserved", "creation_pending", "document_ready"].includes(phase)) await pointer(state.generation);
            else { await expect(pointer(state.generation, documents[1]!)).rejects.toBeInstanceOf(AuthorityConflictError); expect(await currentPointer()).toEqual(prior); }
        }
    });
    it("P5 absent-authority race waits on a real PostgreSQL Lock then refuses after reservation commits", async () => {
        const result = await contend((tx) => reserveAuthority(tx, jobs[0]!), async (tx) => {
            await assertAuthorityPointerWrite(tx, { branchId: branches[0]!, clientIds: [clients[0]!] });
            return tx.client.update({ where: { id: clients[0]! }, data: { eDocId: documents[0]! } });
        });
        expect(result[0]!.status).toBe("fulfilled"); expect(result[1]).toMatchObject({ status: "rejected", reason: new AuthorityConflictError() });
        expect(await read()).toHaveLength(1); expect(await currentPointer()).toEqual({ eDocId: null });
    });
    it("P6 serializes competing reservations and concurrent CAS admits exactly one winner", async () => {
        const reservations = await contend((tx) => reserveAuthority(tx, jobs[0]!), (tx) => reserveAuthority(tx, jobs[1]!));
        expect(reservations[0]).toMatchObject({ status: "fulfilled", value: { generation: jobs[0]!.generation } });
        expect(reservations[1]).toMatchObject({ status: "rejected", reason: new AuthorityConflictError() });
        for (const job of jobs.slice(0, 2)) expect((await db.eformsign_document_job.findUniqueOrThrow({ where: { id: job.jobId } })).contractGeneration).toBe(job.generation);
        const state = (await read())[0]!, operation = (tx: Prisma.TransactionClient) => compareAndSetAuthority(tx, expected(state), { phase: "creation_pending", claimEpoch: 1n });
        expect(await contend(operation, operation)).toEqual([{ status: "fulfilled", value: true }, { status: "fulfilled", value: false }]);
        expect((await read())[0]).toMatchObject({ phase: "creation_pending", claimEpoch: 1n });
    });
    it("P7 refuses provider-owner and cross-branch collisions without foreign projections; closed owner permits normal write", async () => {
        const local = await reserve(jobs[2]!), foreign = await reserve(jobs[3]!);
        expect(await cas(local, { providerDocumentId: documents[1]!, phase: "closed" })).toBe(true);
        expect(await cas(foreign, { providerDocumentId: documents[2]! })).toBe(true);
        expect(await transaction(db, (tx) => discoverAuthorityClientIds(tx, branches[0]!, [documents[1]!, documents[1]!, documents[0]!]))).toEqual([clients[1]]);
        expect(await transaction(db, (tx) => discoverAuthorityClientIds(tx, branches[0]!, [documents[0]!]))).toEqual([]);
        await expect(transaction(db, (tx) => discoverAuthorityClientIds(tx, branches[0]!, [documents[2]!]))).rejects.toThrow(/^Authority conflict$/);
        await expect(transaction(db, (tx) => assertNoUnresolvedAuthorityForDocuments(tx, [documents[2]!]))).rejects.toThrow(/^Authority conflict$/);
        for (const document of [documents[0]!, documents[1]!]) {
            await expect(transaction(db, (tx) => assertNoUnresolvedAuthorityForDocuments(tx, [document]))).resolves.toBeUndefined();
        }
        try {
            await transaction(db, (tx) => discoverAuthorityClientIds(tx, branches[0]!, [documents[2]!]));
            throw new Error("Foreign discovery unexpectedly succeeded");
        } catch (error) { expect((error as AuthorityConflictError).getResponse()).toEqual({ code: "REQUEST_CONFLICT" }); }
        for (const document of [documents[1]!, documents[2]!]) {
            await expect(pointer(undefined, document)).rejects.toThrow(/^Authority conflict$/);
            expect(await currentPointer()).toEqual({ eDocId: null });
        }
        await expect(transaction(db, (tx) => lockAuthorityScope(tx, branches[1]!, [clients[0]!]))).rejects.toThrow(/^Authority conflict$/);
        await pointer(undefined, documents[1]!, [clients[1]!, clients[0]!]);
        expect(await currentPointer()).toEqual({ eDocId: documents[1] });
        expect(await cas(foreign, { phase: "closed" })).toBe(true);
        await expect(transaction(db, (tx) => assertNoUnresolvedAuthorityForDocuments(tx, [documents[2]!]))).resolves.toBeUndefined();
    });
    it("P8 caller-owned transaction catches postinsert refusal without retaining the client or pointer", async () => {
        const name = `savepoint-client-${randomUUID()}`, kept = `outer-update-${randomUUID()}`;
        const keptBefore = `outer-before-${randomUUID()}`;
        const entity = ClientEntity.reconstitute(0, name, null, "01012345678", null, null, null, null, null,
            null, null, null, false, null, null, "waiting", false, documents[2]!, new Date(), null, branches[0]!);
        const repository = new SbClientRepository(db as unknown as PrismaService);
        let insertedId: number | undefined, insertions = 0;
        await transaction(db, async (tx) => {
            await tx.user.update({ where: { id: users[1]! }, data: { name: keptBefore } });
            const delegate = tx.client, original = delegate.create;
            // Only this delegate is instrumented; insertion, guards and savepoint SQL remain real.
            delegate.create = (async (args: Prisma.clientCreateArgs) => {
                const created = await original.call(delegate, args);
                insertedId = created.id; insertions += 1;
                await transaction(a, async (foreignTx) => {
                    const state = await reserveAuthority(foreignTx, jobs[3]!);
                    expect(await compareAndSetAuthority(foreignTx, expected(state), { providerDocumentId: documents[2]! })).toBe(true);
                });
                return created;
            }) as unknown as typeof delegate.create;
            try { await expect(repository.create(branches[0]!, entity, tx)).rejects.toBeInstanceOf(AuthorityConflictError); }
            finally { delegate.create = original; }
            await tx.user.update({ where: { id: users[0]! }, data: { name: kept } });
        });
        expect(insertions).toBe(1); expect(insertedId).toBeDefined();
        expect(await db.client.findUnique({ where: { id: insertedId! } })).toBeNull();
        expect(await db.client.count({ where: { OR: [{ name }, { eDocId: documents[2]! }] } })).toBe(0);
        expect((await db.user.findUniqueOrThrow({ where: { id: users[0]! } })).name).toBe(kept);
        expect((await db.user.findUniqueOrThrow({ where: { id: users[1]! } })).name).toBe(keptBefore);
        expect((await read(clients[2]!, branches[1]!))[0]).toMatchObject({ generation: jobs[3]!.generation, providerDocumentId: documents[2] });
    });
    it("P9 actual enqueue/claim/automatic completion commits one generation and preserves legacy replay", async () => {
        const s = await runtime(), generation = s.queued.job.contractGeneration!;
        expect(generation).toMatch(/^[a-f0-9-]{36}$/);
        expect((await read())[0]).toMatchObject({ generation, creationJobId: s.worker.jobId, fingerprint: s.enqueue.payloadFingerprint, phase: "reserved" });
        const duplicate = await s.jobRepository.enqueue(s.enqueue);
        expect(duplicate).toMatchObject({ existing: true, job: { id: s.worker.jobId, contractGeneration: generation } });
        const legacyPayload = { clientId: clients[1]!, contractData: data }, legacyKey = randomUUID();
        const legacy = { ...s.enqueue, clientId: clients[1]!, requestKey: `legacy-${legacyKey}`, activeKey: `legacy-active-${legacyKey}`,
            payload: legacyPayload, payloadFingerprint: digest(canonical(legacyPayload)) };
        const legacyRow = await db.eformsign_document_job.create({ data: { ...legacy, contractGeneration: null } });
        expect(await s.jobRepository.enqueue(legacy)).toMatchObject({ existing: true, job: { id: legacyRow.id, contractGeneration: null } });
        expect(await read(clients[1]!)).toEqual([]);
        const intentCount = await db.eformsign_dispatch_intent.count();
        await expect(s.recovery.claimCreation(s.input, { ...s.worker, leaseToken: randomUUID() }, s.effect)).rejects.toThrow();
        await expect(s.recovery.claimCreation(s.input, s.worker, { ...s.effect, contractData: { ...data, customerName: "wrong" } })).rejects.toThrow();
        await expect(s.recovery.claimCreation({ ...s.input, businessKey: digest("wrong") }, s.worker, s.effect)).rejects.toThrow();
        expect(await db.eformsign_dispatch_intent.count()).toBe(intentCount); expect(await currentPointer()).toEqual({ eDocId: null });
        const started = await s.recovery.claimCreation(s.input, s.worker, s.effect);
        expect(started).toMatchObject({ disposition: "claimed", intent: { status: "started", attemptCount: 1, fingerprint: s.input.fingerprint, businessKey: s.input.businessKey } });
        expect((await read())[0]).toMatchObject({ phase: "creation_pending", creationIntentId: started.intent.id });
        const document = `automatic-${randomUUID()}`; documents.push(document);
        await db.eformsign_dispatch_intent.update({ where: { id: started.intent.id }, data: { status: "accepted", providerDocumentId: document, providerAcceptedAt: new Date() } });
        await s.recovery.completeAutomatic(s.worker, evidence(document, true));
        expect(await currentPointer()).toEqual({ eDocId: document });
        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: document } })).toMatchObject({ clientId: clients[0], branchId: branches[0] });
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ status: "completed", contractGeneration: generation, documentId: document, payload: null });
        expect((await read())[0]).toMatchObject({ phase: "closed", generation });
        const next = await s.jobRepository.enqueue({ ...s.enqueue, requestKey: `next-${randomUUID()}`, activeKey: `next-${randomUUID()}` });
        expect(next.job.contractGeneration).not.toBe(generation);
        expect((await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).contractGeneration).toBe(generation);
    });
    it("P10 actual manual draft/human completion binds once and closes authority for reissue", async () => {
        const s = await runtime(), f = await failed(s, true);
        expect(f.opened).toMatchObject({ claimUserId: users[0], claimEpoch: 1n });
        expect(f.opened.claimExpiresAt!.getTime()).toBeGreaterThan(Date.now());
        const draft = await s.recovery.beginDraft(f.claim, workflowPlan.templateId, identity);
        expect(draft).toMatchObject({ action: "create_draft", status: "started", attemptCount: 1 });
        expect(await s.recovery.beforeDraftOpen(f.claim, draft.id)).toBe(true);
        const document = `manual-${randomUUID()}`; documents.push(document);
        await s.recovery.recordDraftCandidate(f.claim, draft.id, document);
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "accepted", providerDocumentId: document });
        expect(await s.recovery.bindDocument(f.claim, evidence(document), draft.id)).toMatchObject({ phase: "document_ready", providerDocumentId: document });
        expect((await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: document } })).clientId).toBeNull();
        expect(await currentPointer()).toEqual({ eDocId: null });
        expect(await s.recovery.expose(f.claim, evidence(document))).toBe(true);
        expect((await read())[0]).toMatchObject({ phase: "human_exposed", humanIntentId: expect.any(String) });
        expect(await s.recovery.expose(f.claim, evidence(document))).toBe(false);
        expect(await db.eformsign_dispatch_intent.count({ where: { action: "manual_process", generation: s.worker.contractGeneration } })).toBe(1);
        await s.recovery.completeManual(f.claim, evidence(document, true));
        expect(await currentPointer()).toEqual({ eDocId: document });
        expect((await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: document } })).clientId).toBe(clients[0]);
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ status: "completed", documentId: document, payload: null });
        const closed = (await read())[0]!;
        expect(closed).toMatchObject({ phase: "closed" });
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: closed.humanIntentId! } })).toMatchObject({
            status: "reconciled_delivered", reconciledOutcome: "delivered", reconciledByUserId: users[0], reconciledAt: expect.any(Date),
        });
        const completedJob = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        const intents = await db.eformsign_dispatch_intent.count(), mirrors = await db.eformsign_doc.count();
        for (const status of ["failed", "requires_attention"]) {
            await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status } });
            await expect(s.recovery.open(f.claim.jobId, branches[0]!, users[0]!)).rejects.toThrow();
            expect((await read())[0]).toEqual(closed);
        }
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "completed", documentId: null } });
        await expect(s.recovery.open(f.claim.jobId, branches[0]!, users[0]!)).rejects.toThrow();
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { documentId: document } });
        await db.client.update({ where: { id: clients[0]! }, data: { eDocId: null } });
        await expect(s.recovery.open(f.claim.jobId, branches[0]!, users[0]!)).rejects.toThrow();
        expect((await read())[0]).toEqual(closed);
        await db.client.update({ where: { id: clients[0]! }, data: { eDocId: document } });
        const reopened = await s.recovery.open(f.claim.jobId, branches[0]!, users[0]!);
        expect(reopened).toMatchObject({ phase: "closed", providerDocumentId: document, payload: {}, claimUserId: users[0], claimEpoch: f.claim.claimEpoch + 1n });
        await expect(s.recovery.readClaim(f.claim)).rejects.toThrow();
        await expect(s.recovery.readClaim({ ...f.claim, claimEpoch: reopened.claimEpoch })).resolves.toMatchObject({ phase: "closed" });
        await expect(s.recovery.open(f.claim.jobId, branches[0]!, users[1]!)).rejects.toMatchObject({ code: "MANUAL_RECOVERY_CLAIMED" });
        expect((await read())[0]!.claimEpoch).toBe(reopened.claimEpoch);
        expect(await cas((await read())[0]!, { claimExpiresAt: new Date(Date.now() - 1000) })).toBe(true);
        await expect(s.recovery.readClaim({ ...f.claim, claimEpoch: reopened.claimEpoch })).rejects.toThrow();
        const taken = await s.recovery.open(f.claim.jobId, branches[0]!, users[1]!);
        expect(taken).toMatchObject({ phase: "closed", claimUserId: users[1], claimEpoch: reopened.claimEpoch + 1n });
        // Reopening changes only the fenced claim; completion and all document/intent counts are retained.
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ ...completedJob, updatedAt: expect.any(Date) });
        expect(await db.eformsign_dispatch_intent.count()).toBe(intents); expect(await db.eformsign_doc.count()).toBe(mirrors);
        expect(await currentPointer()).toEqual({ eDocId: document });
        const next = await s.jobRepository.enqueue({ ...s.enqueue, requestKey: `next-${randomUUID()}`, activeKey: `next-${randomUUID()}` });
        expect(next.job.contractGeneration).not.toBe(s.worker.contractGeneration);
        await expect(s.recovery.open(f.claim.jobId, branches[0]!, users[1]!)).rejects.toThrow();
        await expect(s.recovery.readClaim({ ...f.claim, userId: users[1]!, claimEpoch: taken.claimEpoch })).rejects.toThrow();
        expect(await db.eformsign_dispatch_intent.count({ where: { action: "manual_process", generation: s.worker.contractGeneration } })).toBe(1);
    });
    it("P11 actual stale/unknown creation, changed prior pointer and tombstone refusals leave no partial effects", async () => {
        const s = await runtime();
        await expect(s.recovery.readWorker({ ...s.worker, contractGeneration: randomUUID() })).rejects.toThrow();
        const f = await failed(s, false), intents = await db.eformsign_dispatch_intent.count(), mirrors = await db.eformsign_doc.count();
        for (const claim of [{ ...f.claim, userId: users[1]! }, { ...f.claim, claimEpoch: f.claim.claimEpoch + 1n }]) await expect(s.recovery.readClaim(claim)).rejects.toThrow();
        for (const status of ["started", "uncertain"]) {
            await db.eformsign_dispatch_intent.update({ where: { id: f.intent.id }, data: { status, uncertainAt: status === "uncertain" ? new Date() : null } });
            await expect(s.recovery.beginDraft(f.claim, workflowPlan.templateId, identity)).rejects.toThrow();
            expect(await db.eformsign_dispatch_intent.count()).toBe(intents);
        }
        const state = (await read())[0]!, originalUser = await db.user.findUniqueOrThrow({ where: { id: users[1]! } });
        await expect(transaction(db, async (tx) => {
            await tx.user.update({ where: { id: users[1]! }, data: { name: "must-rollback" } });
            if (!await compareAndSetAuthority(tx, { ...expected(state), claimEpoch: state.claimEpoch + 1n }, { phase: "closed" })) throw new Error("stale compare refused");
        })).rejects.toThrow("stale compare refused");
        expect(await db.user.findUniqueOrThrow({ where: { id: users[1]! } })).toEqual(originalUser);
        const missing = `refused-${randomUUID()}`; documents.push(missing);
        await db.client.update({ where: { id: clients[0]! }, data: { eDocId: documents[0]! } });
        await expect(s.recovery.bindDocument(f.claim, evidence(missing))).rejects.toThrow();
        expect(await db.eformsign_doc.count()).toBe(mirrors); expect(await currentPointer()).toEqual({ eDocId: documents[0] });
        await db.client.update({ where: { id: clients[0]! }, data: { eDocId: null } });
        await db.eformsign_dispatch_intent.update({ where: { id: f.intent.id }, data: { status: "accepted", providerDocumentId: documents[0]!, providerAcceptedAt: new Date() } });
        const tombstone = await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: { permanentPurgeRequestedAt: new Date() } });
        const beforeAuthority = (await read())[0]!;
        await expect(s.recovery.bindDocument(f.claim, evidence(documents[0]!))).rejects.toThrow();
        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: documents[0]! } })).toEqual(tombstone);
        expect((await read())[0]).toEqual(beforeAuthority); expect(await currentPointer()).toEqual({ eDocId: null });
        expect(await db.eformsign_doc.count()).toBe(mirrors); expect(await db.eformsign_dispatch_intent.count()).toBe(intents);
    });
    it("P12 actual automatic completion and another guarded pointer writer cannot retain two pointers", async () => {
        const s = await runtime(), started = await s.recovery.claimCreation(s.input, s.worker, s.effect);
        const document = `race-${randomUUID()}`; documents.push(document);
        await db.eformsign_dispatch_intent.update({ where: { id: started.intent.id }, data: { status: "accepted", providerDocumentId: document, providerAcceptedAt: new Date() } });
        expect((await read())[0]!.providerDocumentId).toBeNull();
        const paused = deferred<void>(), release = deferred<void>(), backend = deferred<number>();
        let interceptions = 0, bSettled = false;
        // Native Prisma query interception preserves real SQL, including interactive transactions.
        const connection = a.$extends({ query: { eformsign_contract_authority: { async findMany({ args, query }) {
            const rows = await query(args);
            if (args.where?.providerDocumentId === document) {
                interceptions += 1; paused.resolve(); await bounded(release.promise, 9000);
            }
            return rows;
        } } } });
        const options = { resolveEffectiveTemplateId: () => workflowPlan.templateId,
            generateDocumentOptions: () => ({ company: { id: identity.companyId }, user: { id: identity.creatorId } }) } as unknown as EformsignService;
        const automatic = new SbEformsignContractRecoveryRepository(connection as unknown as PrismaService, options);
        const pa = automatic.completeAutomatic(s.worker, evidence(document, true)); void pa.catch(() => undefined);
        let pb: Promise<unknown> | undefined;
        try {
            await bounded(paused.promise, 5000);
            pb = transaction(b, async (tx) => {
                const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                backend.resolve(row!.pid);
                await assertAuthorityPointerWrite(tx, { branchId: branches[0]!, clientIds: [clients[1]!], documentIds: [document] });
                return tx.client.update({ where: { id: clients[1]! }, data: { eDocId: document } });
            });
            void pb.then(() => { bSettled = true; }, () => { bSettled = true; });
            const pid = await bounded(backend.promise, 5000), deadline = Date.now() + 5000;
            let lock = false;
            while (!bSettled && Date.now() < deadline) {
                const [row] = await db.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
                if (row?.wait_event_type === "Lock") { lock = true; break; }
                await new Promise((done) => setTimeout(done, 20));
            }
            expect(bSettled || lock).toBe(true);
        } finally { release.resolve(); await Promise.allSettled([pa, ...(pb ? [pb] : [])]); }
        const outcomes = await Promise.allSettled([pa, pb!]);
        expect(interceptions).toBe(1);
        expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
        const pointers = await db.client.findMany({ where: { eDocId: document }, select: { id: true } });
        expect(pointers.length).toBeLessThanOrEqual(1);
        const mirror = await db.eformsign_doc.findUnique({ where: { documentId: document } }), state = (await read())[0]!;
        const job = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        if (outcomes[0]!.status === "fulfilled") {
            expect(pointers).toEqual([{ id: clients[0] }]); expect(mirror?.clientId).toBe(clients[0]);
            expect(state).toMatchObject({ phase: "closed", providerDocumentId: document }); expect(job.status).toBe("completed");
        } else {
            expect(state).toMatchObject({ phase: "creation_pending", providerDocumentId: null }); expect(job.status).toBe("processing");
            expect(await currentPointer()).toEqual({ eDocId: null }); expect(mirror?.clientId ?? null).toBeNull();
            expect(pointers).toEqual([{ id: clients[1] }]);
        }
    });
    async function exhaustedRuntime() {
        const s = await runtime();
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { attempts: 4 } });
        expect(await s.recovery.recoverBeforeCreation(s.worker, null, "PRE_SEND_RETRY_EXHAUSTED")).toBe("failed");
        return s;
    }
    const nextInput = (s: Awaited<ReturnType<typeof runtime>>) => ({ ...s.enqueue, requestKey: `next-${randomUUID()}`, activeKey: `next-${randomUUID()}` });
    const recoveryIn = (tx: Prisma.TransactionClient, s: Awaited<ReturnType<typeof runtime>>) =>
        new SbEformsignContractRecoveryRepository({ $transaction: (run: (tx: Prisma.TransactionClient) => unknown) => run(tx) } as unknown as PrismaService, s.options);
    const cancelInput = (s: Awaited<ReturnType<typeof runtime>>) => ({ jobId: s.worker.jobId,
        branchId: branches[0]!, userId: users[0]!, now: new Date() });
    async function projectedCancellation(s: Awaited<ReturnType<typeof runtime>>) {
        const list = await s.jobRepository.listForBranch(branches[0]!, new Date(0));
        return list.requiresAttention.find(job => job.id === s.worker.jobId)?.cancellable;
    }
    it("CANCEL real happy path clears payload/key and claim pair, hides history and admits a fresh request", async () => {
        const s = await exhaustedRuntime();
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { activeKey: s.enqueue.activeKey } });
        await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } },
            data: { claimUserId: users[0]!, claimExpiresAt: new Date(0) } });
        const before = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        expect(await projectedCancellation(s)).toBe(true);
        expect(await s.jobRepository.cancel(cancelInput(s))).toEqual({ kind: "cancelled" });
        const cancelled = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        expect(cancelled).toMatchObject({ status: "failed", progressStep: "cancelled", activeKey: null, payload: null,
            leaseToken: null, heartbeatAt: null, completedAt: before.completedAt, lastErrorCode: before.lastErrorCode, documentId: before.documentId });
        expect(cancelled.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
        expect((await read())[0]).toMatchObject({ phase: "closed", claimUserId: null, claimExpiresAt: null, providerDocumentId: null });
        expect(await s.jobRepository.cancel(cancelInput(s))).toEqual({ kind: "already_cancelled" });
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toEqual(cancelled);
        const list = await s.jobRepository.listForBranch(branches[0]!, new Date(0)), summary = await s.jobRepository.getSummary(branches[0]!);
        expect([...list.requiresAttention, ...list.recent].map(job => job.id)).not.toContain(s.worker.jobId);
        expect(summary.failedCount).toBe(0); expect(summary.unresolvedCount).toBe(0); expect(summary.unresolvedJobIds).not.toContain(s.worker.jobId);
        expect(await s.jobRepository.enqueue(s.enqueue)).toMatchObject({ existing: true, job: { id: s.worker.jobId, progressStep: "cancelled" } });
        const next = await s.jobRepository.enqueue({ ...s.enqueue, requestKey: `cancel-next-${randomUUID()}` });
        expect(next.existing).toBe(false); expect(next.job.contractGeneration).not.toBe(s.worker.contractGeneration);
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toEqual(cancelled);
    });
    it("CANCEL real reconciled_not_delivered creation projects eligible and cancels", async () => {
        const s = await runtime(), claimed = await s.recovery.claimCreation(s.input, s.worker, s.effect);
        await s.recovery.markAutomaticUncertain(s.worker);
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "requires_attention", leaseToken: null,
            progressStep: "processing", progressDetail: "info-inserted", completedAt: new Date() } });
        await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId: claimed.intent.id,
            branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Synthetic provider confirms no delivery", attemptCount: claimed.intent.attemptCount });
        expect(await projectedCancellation(s)).toBe(true);
        expect(await s.jobRepository.cancel(cancelInput(s))).toEqual({ kind: "cancelled" });
    });
    it.each(["pointer", "create-uncertain", "draft-uncertain", "creating", "sent", "leased", "live-claim", "legacy", "auto_finalize", "pending-zero"])("CANCEL real %s veto agrees with display proof (live claim is hint-only)", async defect => {
        const s = await exhaustedRuntime();
        const where = { id: s.worker.jobId }, scope = { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } };
        if (defect === "pointer") await db.client.update({ where: { id: clients[0]! }, data: { eDocId: documents[0]! } });
        if (defect === "create-uncertain" || defect === "draft-uncertain") await db.eformsign_dispatch_intent.create({ data: {
            branchId: branches[0]!, clientId: clients[0]!, businessKey: digest(`cancel-${randomUUID()}`), generation: "synthetic",
            fingerprint: "a".repeat(64), action: defect === "create-uncertain" ? "create" : "create_draft", status: "uncertain", attemptCount: 1 } });
        if (defect === "creating" || defect === "sent") await db.eformsign_document_job.update({ where, data: { progressDetail: defect } });
        if (defect === "leased") await db.eformsign_document_job.update({ where, data: { leaseToken: randomUUID() } });
        if (defect === "live-claim") await db.eformsign_contract_authority.update({ where: scope, data: { claimUserId: users[0]!, claimExpiresAt: new Date(Date.now() + 60000) } });
        // An authority FK binds generation; remove it first to represent a genuine legacy job.
        if (defect === "legacy") { await db.eformsign_contract_authority.delete({ where: scope }); await db.eformsign_document_job.update({ where, data: { contractGeneration: null } }); }
        if (defect === "auto_finalize") await db.eformsign_document_job.update({ where, data: { source: "auto_finalize", status: "requires_attention" } });
        if (defect === "pending-zero") await db.eformsign_contract_authority.update({ where: scope, data: { phase: "creation_pending" } });
        const before = await db.eformsign_document_job.findUniqueOrThrow({ where });
        expect(await projectedCancellation(s)).toBe(defect === "live-claim");
        expect(await s.jobRepository.cancel(cancelInput(s))).toMatchObject({ kind: "not_cancellable" });
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where })).toEqual(before);
    });

    describe("CANCEL projection refusing clauses", () => {
        async function cancellationSnapshot() {
            const where = { branchId: branches[0]! };
            return {
                jobs: await db.eformsign_document_job.findMany({ where, orderBy: { id: "asc" } }),
                authorities: await db.eformsign_contract_authority.findMany({ where, orderBy: { clientId: "asc" } }),
                intents: await db.eformsign_dispatch_intent.findMany({ where, orderBy: { id: "asc" } }),
                clients: await db.client.findMany({ where, orderBy: { id: "asc" } }),
            };
        }
        async function expectRefusedWithoutWrites(s: Awaited<ReturnType<typeof runtime>>, expectedReason: string) {
            const before = await cancellationSnapshot();
            expect(await projectedCancellation(s)).toBe(false);
            expect(await s.jobRepository.cancel(cancelInput(s))).toMatchObject({ kind: "not_cancellable", reason: expectedReason });
            expect(await cancellationSnapshot()).toEqual(before);
        }

        it("refuses an accepted create intent with a tab-only provider receipt", async () => {
            const s = await exhaustedRuntime();
            expect(await projectedCancellation(s)).toBe(true);
            // The storage CHECK trims spaces only; a tab receipt can be inserted directly.
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "create",
                generation: "unrelated", fingerprint: "b".repeat(64),
                businessKey: digest(`cancel-tab-${randomUUID()}`),
                status: "accepted", attemptCount: 1, providerDocumentId: "\t",
            } });
            await expectRefusedWithoutWrites(s, "effect_not_disproved");
        });

        it("allows an accepted create from an unrelated generation with a normal provider receipt", async () => {
            const s = await exhaustedRuntime();
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "create",
                generation: "unrelated", fingerprint: "b".repeat(64),
                businessKey: digest(`cancel-accepted-${randomUUID()}`),
                status: "accepted", attemptCount: 1, providerDocumentId: `prior-accepted-${randomUUID()}`,
            } });
            expect(await projectedCancellation(s)).toBe(true);
            expect(await s.jobRepository.cancel(cancelInput(s))).toEqual({ kind: "cancelled" });
        });

        it("refuses an accepted create intent with an NBSP-only provider receipt without writes", async () => {
            const s = await exhaustedRuntime();
            expect(await projectedCancellation(s)).toBe(true);
            // The storage CHECK trims spaces only; NBSP reaches the trim-based proof.
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "create",
                generation: "unrelated", fingerprint: "b".repeat(64),
                businessKey: digest(`cancel-nbsp-${randomUUID()}`),
                status: "accepted", attemptCount: 1, providerDocumentId: "\u00a0",
            } });
            await expectRefusedWithoutWrites(s, "effect_not_disproved");
        });

        it("refuses a discovered human-intent business key without an authority reference", async () => {
            const s = await exhaustedRuntime();
            expect(await projectedCancellation(s)).toBe(true);
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "manual_process",
                generation: s.worker.contractGeneration, fingerprint: s.enqueue.payloadFingerprint,
                businessKey: digest(`contract-human:${s.worker.contractGeneration}`), templateId: workflowPlan.templateId,
                status: "prepared", attemptCount: 0,
            } });
            expect((await read())[0]!.humanIntentId).toBeNull();
            await expectRefusedWithoutWrites(s, "effect_not_disproved");
        });

        it("refuses reserved authority with a prepared-zero linked create that was never reconciled", async () => {
            const s = await runtime(), claimed = await s.recovery.claimCreation(s.input, s.worker, s.effect);
            // Prepared-zero is no-effect; only the reserved linked-create boundary vetoes it.
            await db.eformsign_dispatch_intent.update({ where: { id: claimed.intent.id },
                data: { status: "prepared", attemptCount: 0, startedAt: null } });
            await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: {
                status: "requires_attention", leaseToken: null, progressStep: "processing",
                progressDetail: "info-inserted", completedAt: new Date(),
            } });
            expect(await projectedCancellation(s)).toBe(true);
            await db.eformsign_contract_authority.update({
                where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { phase: "reserved" },
            });
            expect((await read())[0]).toMatchObject({ phase: "reserved", creationIntentId: claimed.intent.id });
            await expectRefusedWithoutWrites(s, "effect_not_disproved");
        });

        it("refuses a discovered unreleased draft without an authority reference", async () => {
            const s = await exhaustedRuntime();
            expect(await projectedCancellation(s)).toBe(true);
            // Prepared-zero avoids the global uncertain-intent veto; the missing release marker is decisive.
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "create_draft",
                generation: s.worker.contractGeneration, fingerprint: s.enqueue.payloadFingerprint,
                businessKey: digest(`contract-draft:${s.worker.contractGeneration}`), templateId: workflowPlan.templateId,
                status: "prepared", attemptCount: 0, startedAt: null,
            } });
            expect((await read())[0]!.draftIntentId).toBeNull();
            await expectRefusedWithoutWrites(s, "effect_not_disproved");
        });
    });

    async function snapshot() {
        const where = { branchId: branches[0]! };
        return {
            jobs: await db.eformsign_document_job.findMany({ where, orderBy: { id: "asc" } }),
            authorities: await db.eformsign_contract_authority.findMany({ where, orderBy: { clientId: "asc" } }),
            intents: await db.eformsign_dispatch_intent.findMany({ where, orderBy: { id: "asc" } }),
            clients: await db.client.findMany({ where, orderBy: { id: "asc" } }),
        };
    }

    describe("RETRY locked non-delivery proof and display projection", () => {
        async function projected(s: Awaited<ReturnType<typeof runtime>>) {
            const list = await s.jobRepository.listForBranch(branches[0]!, new Date(0));
            return [...list.active, ...list.requiresAttention, ...list.recent].find(job => job.id === s.worker.jobId)?.retryable ?? false;
        }
        async function uncertainRuntime() {
            const s = await runtime(), claimed = await s.recovery.claimCreation(s.input, s.worker, s.effect);
            await s.recovery.markAutomaticUncertain(s.worker);
            await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "requires_attention", leaseToken: null,
                progressStep: "processing", progressDetail: "info-inserted", completedAt: new Date() } });
            return { s, claimed };
        }
        async function reconciledRuntime() {
            const { s, claimed } = await uncertainRuntime();
            await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId: claimed.intent.id,
                branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Synthetic provider confirms no delivery", attemptCount: claimed.intent.attemptCount });
            return s;
        }
        it.each(["reconciled", "pre-send"])("retries %s into exactly one new queued generation and never retries the old job twice", async scenario => {
            const s = scenario === "reconciled" ? await reconciledRuntime() : await exhaustedRuntime();
            expect(await projected(s)).toBe(true);
            const before = await snapshot();
            const result = await s.jobRepository.retry(cancelInput(s));
            expect(result).toMatchObject({ kind: "retried", status: "queued" });
            if (result.kind !== "retried") throw new Error("Expected new job");
            const after = await snapshot(), next = after.jobs.find(job => job.id === result.jobId)!;
            expect(after.jobs).toHaveLength(before.jobs.length + 1);
            expect(after.jobs.filter(job => !before.jobs.some(previous => previous.id === job.id))).toEqual([next]);
            expect(next.status).toBe("queued");
            expect(after.jobs.find(job => job.id === s.worker.jobId)).toMatchObject({ status: "failed", progressStep: "superseded" });
            expect(after.authorities[0]).toMatchObject({ creationJobId: next.id, generation: next.contractGeneration, phase: "reserved" });
            expect(next).toMatchObject({ status: "queued", attempts: 0, createdByUserId: users[0], activeKey: `create:${branches[0]}:${clients[0]}` });
            expect(next.requestKey).not.toBe(s.enqueue.requestKey);
            expect(next.payload).toEqual({ clientId: clients[0], contractData: data });
            expect(await projected(s)).toBe(false);
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(after);
            await db.eformsign_document_job.update({ where: { id: next.id }, data: { status: "completed", completedAt: new Date(), activeKey: null } });
            const completed = await snapshot();
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(completed);
        });

        it.each(["processing", "creating", "sent"])("retries a reconciled creation job with the %s marker holding the production active key and never retries it twice", async marker => {
            const s = await reconciledRuntime(), activeKey = `create:${branches[0]}:${clients[0]}`;
            await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: {
                activeKey, progressStep: marker, progressDetail: marker === "processing" ? "info-inserted" : marker,
            } });
            expect(await projected(s)).toBe(true);
            if (marker !== "processing") expect(await projectedCancellation(s)).toBe(false);
            const before = await snapshot();
            expect(before.jobs.find(job => job.id === s.worker.jobId)).toMatchObject({ status: "requires_attention", leaseToken: null, activeKey });
            const result = await s.jobRepository.retry(cancelInput(s));
            expect(result).toMatchObject({ kind: "retried", status: "queued" });
            if (result.kind !== "retried") throw new Error("Expected new job");
            const after = await snapshot(), next = after.jobs.find(job => job.id === result.jobId)!;
            expect(after.jobs).toHaveLength(before.jobs.length + 1);
            expect(after.jobs.filter(job => !before.jobs.some(previous => previous.id === job.id))).toEqual([next]);
            expect(next).toMatchObject({ status: "queued", activeKey });
            expect(after.jobs.find(job => job.id === s.worker.jobId)).toMatchObject({ status: "failed", progressStep: "superseded", activeKey: null });
            expect(after.authorities[0]).toMatchObject({ creationJobId: next.id, generation: next.contractGeneration, phase: "reserved" });
            expect(await projected(s)).toBe(false);
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(after);
        });

        it.each(["processing", "creating", "sent"])("refuses an uncertain creation job with the %s marker holding the production active key with every row unchanged", async marker => {
            const { s, claimed } = await uncertainRuntime(), activeKey = `create:${branches[0]}:${clients[0]}`;
            await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: {
                activeKey, progressStep: marker, progressDetail: marker === "processing" ? "info-inserted" : marker,
            } });
            const before = await snapshot();
            expect(before.jobs.find(job => job.id === s.worker.jobId)).toMatchObject({ status: "requires_attention", leaseToken: null, activeKey });
            expect(before.intents.find(intent => intent.id === claimed.intent.id)).toMatchObject({ status: "uncertain", reconciledOutcome: null });
            expect(await projected(s)).toBe(false);
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(before);
            expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ activeKey });
        });

        async function expectRetryRefusedWithoutWrites(s: Awaited<ReturnType<typeof runtime>>) {
            const before = await snapshot();
            expect(await projected(s)).toBe(false);
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(before);
        }

        it("refuses pre-send exhaustion with an unlinked human intent", async () => {
            const s = await exhaustedRuntime();
            expect(await projected(s)).toBe(true);
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "manual_process",
                generation: s.worker.contractGeneration, fingerprint: s.enqueue.payloadFingerprint,
                businessKey: digest(`contract-human:${s.worker.contractGeneration}`), templateId: workflowPlan.templateId,
                status: "prepared", attemptCount: 0,
            } });
            expect((await read())[0]!.humanIntentId).toBeNull();
            await expectRetryRefusedWithoutWrites(s);
        });

        it("refuses pre-send exhaustion with an unlinked unreleased draft intent", async () => {
            const s = await exhaustedRuntime();
            expect(await projected(s)).toBe(true);
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "create_draft",
                generation: s.worker.contractGeneration, fingerprint: s.enqueue.payloadFingerprint,
                businessKey: digest(`contract-draft:${s.worker.contractGeneration}`), templateId: workflowPlan.templateId,
                status: "prepared", attemptCount: 0, startedAt: null,
            } });
            expect((await read())[0]!.draftIntentId).toBeNull();
            await expectRetryRefusedWithoutWrites(s);
        });

        it.each(["create", "create_draft"])("refuses pre-send exhaustion with an uncertain %s intent for the customer", async action => {
            const s = await exhaustedRuntime();
            expect(await projected(s)).toBe(true);
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action,
                generation: "unrelated", fingerprint: "b".repeat(64),
                businessKey: digest(`retry-uncertain-${randomUUID()}`),
                status: "uncertain", attemptCount: 1, startedAt: new Date(),
            } });
            await expectRetryRefusedWithoutWrites(s);
        });

        it.each([
            ["create", "\t"], ["create", "\u00a0"], ["create_draft", "\t"], ["create_draft", "\u00a0"],
        ])("refuses pre-send exhaustion with an accepted %s receipt %j that trims to blank", async (action, receipt) => {
            const s = await exhaustedRuntime();
            expect(await projected(s)).toBe(true);
            // The storage CHECK trims spaces only; these receipts reach the strict proof.
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action,
                generation: "unrelated", fingerprint: "b".repeat(64),
                businessKey: digest(`retry-blank-${randomUUID()}`),
                status: "accepted", attemptCount: 1, providerDocumentId: receipt,
            } });
            await expectRetryRefusedWithoutWrites(s);
        });

        it.each(["legacy", "started", "uncertain", "manual-claim", "expired-manual-claim", "payload-cleared", "serialized-payload", "missing-contract-data", "client-mismatch",
            "cancelled", "manual-resolved", "leased", "document", "live-authority-claim", "missing-authority", "closed-authority", "auto-finalize", "finalize", "service-record", "processing"])("refuses %s with false projection and every row unchanged", async defect => {
            const s = await exhaustedRuntime();
            const where = { id: s.worker.jobId }, scope = { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } };
            if (defect === "legacy" || defect === "missing-authority") {
                await db.eformsign_contract_authority.delete({ where: scope });
                if (defect === "legacy") await db.eformsign_document_job.update({ where, data: { contractGeneration: null } });
            }
            if (defect === "started" || defect === "uncertain") await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, businessKey: digest(`retry-${randomUUID()}`), generation: "synthetic",
                fingerprint: "a".repeat(64), action: "create", status: defect, attemptCount: 1, startedAt: new Date() } });
            if (defect === "manual-claim" || defect === "expired-manual-claim") await db.eformsign_document_job.update({ where, data: {
                progressStep: `manual_in_progress:${users[0]}:${defect === "manual-claim" ? Date.now() + 60000 : 1}` } });
            if (defect === "payload-cleared") await db.eformsign_document_job.update({ where, data: { payload: Prisma.DbNull } });
            if (defect === "serialized-payload") await db.eformsign_document_job.update({ where, data: { payload: JSON.stringify({ clientId: clients[0]!, contractData: data }) } });
            if (defect === "missing-contract-data") await db.eformsign_document_job.update({ where, data: { payload: { clientId: clients[0]! } } });
            if (defect === "client-mismatch") await db.eformsign_document_job.update({ where, data: { payload: { clientId: clients[1]!, contractData: data } } });
            if (defect === "cancelled" || defect === "manual-resolved") await db.eformsign_document_job.update({ where, data: { progressStep: defect === "cancelled" ? "cancelled" : "manual_resolved" } });
            if (defect === "leased") await db.eformsign_document_job.update({ where, data: { leaseToken: randomUUID() } });
            if (defect === "document") await db.eformsign_document_job.update({ where, data: { documentId: documents[0]! } });
            if (defect === "live-authority-claim") await db.eformsign_contract_authority.update({ where: scope, data: { claimUserId: users[0]!, claimExpiresAt: new Date(Date.now() + 60000) } });
            if (defect === "closed-authority") await db.eformsign_contract_authority.update({ where: scope, data: { phase: "closed" } });
            if (defect === "auto-finalize") await db.eformsign_document_job.update({ where, data: { source: "auto_finalize" } });
            if (defect === "finalize") await db.eformsign_document_job.update({ where, data: { jobType: "finalize_document" } });
            if (defect === "service-record") await db.eformsign_document_job.update({ where, data: { requestKey: `service-record-${randomUUID()}` } });
            if (defect === "processing") await db.eformsign_document_job.update({ where, data: { status: "processing" } });
            const before = await snapshot();
            expect(await projected(s)).toBe(false);
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(before);
        });
        it("maps invalid stored phones to refusal without writes", async () => {
            const s = await exhaustedRuntime();
            await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { payload: { clientId: clients[0]!, contractData: { ...data, customerContact: "invalid" } } } });
            const before = await snapshot();
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(before);
        });
        it.each(["conflict", "authority", "key", "idempotency", "existing", "not-superseded", "unexpected"])("rolls back every enqueue write before handling %s", async failure => {
            const s = await exhaustedRuntime(), before = await snapshot();
            const enqueue = s.jobRepository.enqueueInTransaction.bind(s.jobRepository);
            const unexpected = new Error("Synthetic unexpected storage failure");
            const intercepted = jest.spyOn(s.jobRepository, "enqueueInTransaction").mockImplementation(async (tx, input) => {
                const result = await enqueue(tx, input);
                expect(result.existing).toBe(false);
                if (failure === "existing") return { ...result, existing: true };
                if (failure === "not-superseded") {
                    await tx.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { progressStep: "preparing" } });
                    return result;
                }
                if (failure === "conflict") throw new ConflictException({ code: "REQUEST_CONFLICT" });
                if (failure === "authority") throw new AuthorityConflictError();
                if (failure === "key") throw new Error("EFORMSIGN_DOCUMENT_JOB_KEY_CONFLICT");
                if (failure === "idempotency") throw new Error("EFORMSIGN_DOCUMENT_JOB_IDEMPOTENCY_MISMATCH");
                throw unexpected;
            });
            try {
                if (failure === "unexpected") await expect(s.jobRepository.retry(cancelInput(s))).rejects.toBe(unexpected);
                else expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
                expect(await snapshot()).toEqual(before);
            } finally { intercepted.mockRestore(); }
        });
        it("refuses an existing active job without changing the original rows", async () => {
            const s = await exhaustedRuntime();
            await db.eformsign_document_job.create({ data: { branchId: branches[0]!, clientId: clients[0]!, jobType: "create_document",
                source: "staff", requestKey: randomUUID(), activeKey: `create:${branches[0]}:${clients[0]}` } });
            const before = await snapshot();
            expect(await s.jobRepository.retry(cancelInput(s))).toEqual({ kind: "not_retryable" });
            expect(await snapshot()).toEqual(before);
        });
        it("returns not found for another branch or unknown job without writes", async () => {
            const s = await exhaustedRuntime(), before = await snapshot();
            expect(await s.jobRepository.retry({ ...cancelInput(s), branchId: branches[1]! })).toEqual({ kind: "not_found" });
            expect(await s.jobRepository.retry({ ...cancelInput(s), jobId: randomUUID() })).toEqual({ kind: "not_found" });
            const foreign = await s.jobRepository.listForBranch(branches[1]!, new Date(0));
            expect([...foreign.active, ...foreign.requiresAttention, ...foreign.recent].find(job => job.id === s.worker.jobId)).toBeUndefined();
            expect(await snapshot()).toEqual(before);
        });
    });

    describe("creation requires the strict pre-send non-delivery proof", () => {
        async function expectCreationRefusedWithoutWrites(s: Awaited<ReturnType<typeof runtime>>) {
            const input = nextInput(s), before = await snapshot();
            const attempt = s.jobRepository.enqueue(input);
            await expect(attempt).rejects.toBeInstanceOf(ConflictException);
            await expect(attempt).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" }, status: 409 });
            expect(await db.eformsign_document_job.findUnique({ where: { requestKey: input.requestKey } })).toBeNull();
            const old = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
            expect(old.progressStep).not.toBe("superseded");
            expect((await read())[0]).toMatchObject({ generation: s.worker.contractGeneration, phase: "reserved" });
            expect(await snapshot()).toEqual(before);
        }

        it("refuses pre-send exhaustion with an unlinked human intent", async () => {
            const s = await exhaustedRuntime();
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "manual_process",
                generation: s.worker.contractGeneration, fingerprint: s.enqueue.payloadFingerprint,
                businessKey: digest(`contract-human:${s.worker.contractGeneration}`), templateId: workflowPlan.templateId,
                status: "prepared", attemptCount: 0,
            } });
            expect((await read())[0]!.humanIntentId).toBeNull();
            await expectCreationRefusedWithoutWrites(s);
        });

        it("refuses pre-send exhaustion with an unlinked unreleased draft intent", async () => {
            const s = await exhaustedRuntime();
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action: "create_draft",
                generation: s.worker.contractGeneration, fingerprint: s.enqueue.payloadFingerprint,
                businessKey: digest(`contract-draft:${s.worker.contractGeneration}`), templateId: workflowPlan.templateId,
                status: "prepared", attemptCount: 0, startedAt: null,
            } });
            expect((await read())[0]!.draftIntentId).toBeNull();
            await expectCreationRefusedWithoutWrites(s);
        });

        it.each(["create", "create_draft"])("refuses pre-send exhaustion with an uncertain %s intent for the customer", async action => {
            const s = await exhaustedRuntime();
            // The repository already refuses uncertain create intents; retain that coverage here.
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action,
                generation: "unrelated", fingerprint: "b".repeat(64),
                businessKey: digest(`retry-uncertain-${randomUUID()}`),
                status: "uncertain", attemptCount: 1, startedAt: new Date(),
            } });
            await expectCreationRefusedWithoutWrites(s);
        });

        it.each([
            ["create", "\t"], ["create", "\u00a0"], ["create_draft", "\t"], ["create_draft", "\u00a0"],
        ])("refuses pre-send exhaustion with an accepted %s receipt %j that trims to blank", async (action, receipt) => {
            const s = await exhaustedRuntime();
            // The storage CHECK trims spaces only; these receipts reach the strict proof.
            await db.eformsign_dispatch_intent.create({ data: {
                branchId: branches[0]!, clientId: clients[0]!, action,
                generation: "unrelated", fingerprint: "b".repeat(64),
                businessKey: digest(`retry-blank-${randomUUID()}`),
                status: "accepted", attemptCount: 1, providerDocumentId: receipt,
            } });
            await expectCreationRefusedWithoutWrites(s);
        });
    });

    it.each([false, true])("P13 replaces pre-send exhaustion with purged payload=%s and removes stale popup entries", async purged => {
        const s = await exhaustedRuntime();
        if (purged) await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { payload: Prisma.DbNull } });
        const replay = await s.jobRepository.enqueue(s.enqueue);
        expect(replay.existing).toBe(true); expect(replay.job.contractGeneration).toBe(s.worker.contractGeneration);
        const next = await s.jobRepository.enqueue(nextInput(s));
        expect(next.job.contractGeneration).not.toBe(s.worker.contractGeneration);
        const old = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        expect(old).toMatchObject({ status: "failed", lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED", progressStep: "superseded" });
        expect(old.payload).toBeNull();
        expect(classifyRecovery({ ...old, payload: old.payload as Record<string, unknown> | null, source: "staff", jobType: "create_document", status: "failed" })).toBeNull();
        const summary = await s.jobRepository.getSummary(branches[0]!);
        expect(summary.unresolvedCount).toBe(0); expect(summary.unresolvedJobIds).not.toContain(s.worker.jobId);
        const list = await s.jobRepository.listForBranch(branches[0]!, new Date(0));
        expect(list.requiresAttention.map(job => job.id)).not.toContain(s.worker.jobId);
        const historical = list.recent.find(job => job.id === s.worker.jobId)!;
        expect(historical.status).toBe("failed"); expect(classifyRecovery(historical)).toBeNull();
        await expect(s.recovery.open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toThrow();
    });
    it.each(["claim", "rotation"])("P14 real concurrent %s winner fences the losing operation", async winner => {
        const s = await exhaustedRuntime(), next = nextInput(s);
        const claim = (tx: Prisma.TransactionClient) => recoveryIn(tx, s).open(s.worker.jobId, branches[0]!, users[0]!);
        const rotate = (tx: Prisma.TransactionClient) => s.jobRepository.enqueueInTransaction(tx, next);
        const results = winner === "claim" ? await contend(claim, rotate) : await contend(rotate, claim);
        expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
        const authority = (await read())[0]!;
        expect(authority.generation === s.worker.contractGeneration).toBe(winner === "claim");
        expect((await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).progressStep === "superseded").toBe(winner === "rotation");
        expect(await db.eformsign_document_job.count({ where: { requestKey: next.requestKey } })).toBe(winner === "rotation" ? 1 : 0);
    });
    it.each(["started", "uncertain"])("P15 confirms and atomically settles exact %s creation before reissue", async status => {
        const s = await runtime(), f = await failed(s, false), document = `settled-${randomUUID()}`; documents.push(document);
        await db.eformsign_dispatch_intent.update({ where: { id: f.intent.id }, data: { status, providerDocumentId: document } });
        await s.recovery.bindDocument(f.claim, evidence(document));
        await s.recovery.completeManual(f.claim, evidence(document, true));
        expect((await read())[0]!.phase).toBe("closed");
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: f.intent.id } })).toMatchObject({
            status: "reconciled_delivered", reconciledOutcome: "delivered", reconciledByUserId: users[0], attemptCount: f.intent.attemptCount,
        });
        expect((await s.jobRepository.enqueue(nextInput(s))).job.contractGeneration).not.toBe(s.worker.contractGeneration);
        await expect(s.recovery.readClaim(f.claim)).rejects.toThrow();
    });
    it.each(["job", "intent", "pointer", "mirror"])("P16 a real %s CAS failure rolls back generation release", async target => {
        const s = await runtime(), f = await failed(s, false), document = `rollback-${randomUUID()}`; documents.push(document);
        await db.eformsign_dispatch_intent.update({ where: { id: f.intent.id }, data: { providerDocumentId: document } });
        await s.recovery.bindDocument(f.claim, evidence(document));
        const beforeAuthority = (await read())[0]!, beforeJob = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        const beforeIntent = await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: f.intent.id } });
        const beforeMirror = await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: document } });
        const connection = db.$extends({ query: {
            eformsign_document_job: { async updateMany({ args, query }) { return target === "job" ? { count: 0 } : query(args); } },
            eformsign_dispatch_intent: { async updateMany({ args, query }) { return target === "intent" ? { count: 0 } : query(args); } },
            client: { async updateMany({ args, query }) { return target === "pointer" ? { count: 0 } : query(args); } },
            eformsign_doc: { async updateMany({ args, query }) { return target === "mirror" ? { count: 0 } : query(args); } },
        } });
        const recovery = new SbEformsignContractRecoveryRepository(connection as unknown as PrismaService, s.options);
        await expect(recovery.completeManual(f.claim, evidence(document, true))).rejects.toThrow();
        expect((await read())[0]).toEqual(beforeAuthority); expect(await currentPointer()).toEqual({ eDocId: null });
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toEqual(beforeJob);
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: f.intent.id } })).toEqual(beforeIntent);
        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: document } })).toEqual(beforeMirror);
    });
    async function terminalStart(kind: "create" | "draft", purged: boolean) {
        const s = await runtime();
        const create = await s.recovery.claimCreation(s.input, s.worker, s.effect);
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "requires_attention", leaseToken: null, completedAt: new Date() } });
        let intentId = create.intent.id;
        if (kind === "draft") {
            await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).markUncertain(intentId, branches[0]!, 1, "provider investigated");
            await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId, branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Provider console no effect", attemptCount: 1 });
            const opened = await s.recovery.open(s.worker.jobId, branches[0]!, users[0]!);
            intentId = (await s.recovery.beginDraft({ jobId: opened.jobId, branchId: opened.branchId, userId: users[0]!, claimEpoch: opened.claimEpoch }, workflowPlan.templateId, identity)).id;
            // Expire open()'s real claim while retaining its actor provenance.
            await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { claimExpiresAt: new Date(0) } });
        }
        // Automatic creation has no human claim; both columns remain NULL.
        expect((await read())[0]).toMatchObject({ claimUserId: kind === "draft" ? users[0] : null, claimExpiresAt: kind === "draft" ? new Date(0) : null });
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { completedAt: new Date(Date.now() - 8 * 86400000), ...(purged ? { payload: Prisma.DbNull } : {}) } });
        return { s, intentId };
    }
    it.each([ ["create", true], ["create", false], ["draft", true], ["draft", false] ] as const)("R4 real two-transaction day8 %s purged=%s commits repair despite410, then operator proof rotates", async (kind, purged) => {
        const { s, intentId } = await terminalStart(kind, purged), before = (await read())[0]!;
        const oldJob = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        const oldIntent = await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId } });
        await expect(s.recovery.open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toMatchObject({ code: "RECOVERY_PAYLOAD_EXPIRED", status: 410 });
        const repaired = await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId } });
        expect(repaired).toMatchObject({ status: "uncertain", attemptCount: oldIntent.attemptCount, providerDocumentId: null, uncertainReason: "stale_start_after_terminal_job" });
        expect((await read())[0]).toEqual({ ...before, phase: "creation_uncertain" });
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toEqual(oldJob);
        const jobsBefore = await db.eformsign_document_job.count();
        await expect(s.jobRepository.enqueue({ ...nextInput(s), activeKey: s.enqueue.activeKey })).resolves.toMatchObject({ existing: true });
        expect(await db.eformsign_document_job.count()).toBe(jobsBefore); expect((await read())[0]!.generation).toBe(before.generation);
        await expect(s.jobRepository.enqueue(nextInput(s))).rejects.toThrow();
        await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId, branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Provider console confirms no effect", attemptCount: repaired.attemptCount });
        await expect(s.jobRepository.enqueue({ ...nextInput(s), activeKey: s.enqueue.activeKey })).resolves.toMatchObject({ existing: false });
        expect((await read())[0]!.generation).not.toBe(before.generation);
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ activeKey: null, payload: null, progressStep: "superseded", status: "failed" });
    });
    it("R4 real inter-transaction new claim is rechecked after independently committed repair", async () => {
        const { s } = await terminalStart("create", false);
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { completedAt: new Date() } });
        let calls = 0;
        const proxy = new Proxy(db, { get(target, key) {
            if (key === "$transaction") return async (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
                const value = await target.$transaction(run);
                if (++calls === 1) await s.recovery.open(s.worker.jobId, branches[0]!, users[1]!);
                return value;
            };
            const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        await expect(new SbEformsignContractRecoveryRepository(proxy as unknown as PrismaService, s.options).open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toMatchObject({ code: "MANUAL_RECOVERY_CLAIMED" });
        expect((await read())[0]).toMatchObject({ phase: "creation_uncertain", claimUserId: users[1] });
    });
    it.each(["same", "other"])("R4 real live %s user claim keeps STARTED unchanged", async who => {
        const { s, intentId } = await terminalStart("draft", false);
        const user = users[who === "same" ? 0 : 1]!;
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { completedAt: new Date() } });
        await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { claimUserId: user, claimExpiresAt: new Date(Date.now() + 60000) } });
        const before = await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId } });
        const opened = s.recovery.open(s.worker.jobId, branches[0]!, users[0]!);
        if (who === "same") await opened; else await expect(opened).rejects.toMatchObject({ code: "MANUAL_RECOVERY_CLAIMED" });
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId } })).toEqual(before);
    });
    it("R4 current failed hold survives day8 list/count cutoff and disappears after proven close", async () => {
        const { s, intentId } = await terminalStart("create", true);
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "failed" } });
        const history = await db.eformsign_document_job.create({ data: { branchId: branches[0]!, clientId: clients[0]!, jobType: "create_document", source: "staff", requestKey: randomUUID(), status: "failed", completedAt: new Date(Date.now() - 8 * 86400000) } });
        const summary = await s.jobRepository.getSummary(branches[0]!);
        expect(summary.failedCount).toBe(0); expect(summary.unresolvedCount).toBe(1); expect(summary.unresolvedJobIds).toEqual([s.worker.jobId]);
        expect((await s.jobRepository.listForBranch(branches[0]!, new Date(0))).requiresAttention.map(job => job.id)).toEqual([s.worker.jobId]);
        expect(summary.unresolvedJobIds).not.toContain(history.id);
        expect((await s.jobRepository.getSummary(branches[1]!)).unresolvedJobIds).toEqual([]);
        await expect(s.recovery.open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toMatchObject({ status: 410 });
        await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId, branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Provider investigated", attemptCount: 1 });
        await s.jobRepository.enqueue(nextInput(s));
        expect((await s.jobRepository.getSummary(branches[0]!)).unresolvedJobIds).toEqual([]);
        expect((await s.jobRepository.listForBranch(branches[0]!, new Date(0))).requiresAttention).toEqual([]);
    });
    it("R4 real scoped conflicting request insert rolls back old key, job, refs and authority retirement", async () => {
        const { s, intentId } = await terminalStart("create", true);
        await expect(s.recovery.open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toMatchObject({ status: 410 });
        await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId, branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Provider investigated", attemptCount: 1 });
        const before = (await read())[0]!, old = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        // Simulate a conflict discovered only at INSERT, bypassing the first replay read, never DB uniqueness.
        const conflict = await db.eformsign_document_job.create({ data: { branchId: branches[1]!, jobType: "create_document", source: "staff", requestKey: "global-collision", payloadFingerprint: s.enqueue.payloadFingerprint } });
        const proxy = new Proxy(db, { get(target, key) {
            if (key === "$transaction") return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => run(new Proxy(tx, { get(t, k) {
                if (k === "$queryRaw") return (query: Prisma.Sql) => /WHERE request_key =/.test(query.text) && !query.text.includes("OR active_key") ? Promise.resolve([]) : t.$queryRaw(query);
                const value = Reflect.get(t, k); return typeof value === "function" ? value.bind(t) : value;
            } })));
            const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        await expect(new SbEformsignDocumentJobRepository(proxy as unknown as PrismaService).enqueue({ ...nextInput(s), requestKey: conflict.requestKey, activeKey: s.enqueue.activeKey })).rejects.toThrow();
        expect((await read())[0]).toEqual(before); expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: old.id } })).toEqual(old);
    });
    // Transactional DDL and a reentrant BEFORE INSERT trigger introduce a real
    // unique collision after every admission read, using only the owned branch.
    // Both the collision row and DDL roll back with the surrounding transaction.
    async function insertSameBranchCollision(tx: Prisma.TransactionClient, requestKey: string) {
        const name = `authority_collision_${randomUUID().replace(/-/g, "")}`;
        if (!/^[a-zA-Z0-9-]+$/.test(requestKey)) throw new Error("Unsafe synthetic trigger argument");
        await tx.$executeRaw(Prisma.raw(`CREATE FUNCTION pg_temp.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF pg_trigger_depth() = 1 AND NEW.request_key = TG_ARGV[0] THEN
                    INSERT INTO eformsign_document_job (branch_id, client_id, job_type, source, request_key, payload_fingerprint)
                    VALUES (NEW.branch_id, NEW.client_id, NEW.job_type, NEW.source, NEW.request_key, NEW.payload_fingerprint);
                END IF;
                RETURN NEW;
            END $$`));
        await tx.$executeRaw(Prisma.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON eformsign_document_job
            FOR EACH ROW EXECUTE FUNCTION pg_temp.${name}('${requestKey}')`));
    }
    const branchSnapshot = async () => ({
        authorities: await db.eformsign_contract_authority.findMany({ where: { branchId: branches[0]! }, orderBy: { clientId: "asc" } }),
        jobs: await db.eformsign_document_job.findMany({ where: { branchId: branches[0]! }, orderBy: { id: "asc" } }),
        intents: await db.eformsign_dispatch_intent.findMany({ where: { branchId: branches[0]! }, orderBy: { id: "asc" } }),
        clients: await db.client.findMany({ where: { branchId: branches[0]! }, orderBy: { id: "asc" } }),
        mirrors: await db.eformsign_doc.findMany({ where: { branchId: branches[0]! }, orderBy: { id: "asc" } }),
    });
    it.each(["normalization", "retirement"] as const)("P2 real same-branch same-fingerprint INSERT collision rolls back %s", async site => {
        let s: Awaited<ReturnType<typeof runtime>>;
        if (site === "normalization") ({ s } = await historicalRuntime());
        else {
            const terminal = await terminalStart("create", true); s = terminal.s;
            await expect(s.recovery.open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toMatchObject({ status: 410 });
            await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId: terminal.intentId, branchId: branches[0]!,
                outcome: "not_delivered", actorUserId: users[0]!, reason: "Provider investigated", attemptCount: 1 });
        }
        const input = { ...nextInput(s), requestKey: randomUUID(), activeKey: s.enqueue.activeKey }, before = await branchSnapshot();
        expect(await db.eformsign_document_job.count({ where: { requestKey: input.requestKey } })).toBe(0);
        const error = await transaction(db, async tx => {
            await insertSameBranchCollision(tx, input.requestKey);
            return s.jobRepository.enqueueInTransaction(tx, input);
        }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getStatus()).toBe(409);
        expect((error as ConflictException).getResponse()).toEqual({ code: "REQUEST_CONFLICT" });
        expect(await branchSnapshot()).toEqual(before);
        expect(await db.eformsign_document_job.count({ where: { requestKey: input.requestKey } })).toBe(0);

        // With no authority mutation, the identical collision really qualifies
        // for fallback (same branch, request key and fingerprint). Roll back the
        // control deliberately so neither fixtures nor trigger DDL persist.
        const rollback = new Error("positive control rollback");
        await expect(transaction(db, async tx => {
            const [authority] = await lockAuthorityScope(tx, input.branchId, [input.clientId!]);
            const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId! } });
            const closed = site === "normalization" ? await normalizeVerifiedAuthority(tx, authority!)
                : await retireProvenNoEffect(tx, authority!, client.eDocId);
            expect(closed).toBe(true);
            await insertSameBranchCollision(tx, input.requestKey);
            const result = await s.jobRepository.enqueueInTransaction(tx, input);
            expect(result).toMatchObject({ existing: true, job: { branchId: input.branchId, clientId: input.clientId,
                requestKey: input.requestKey, payloadFingerprint: input.payloadFingerprint } });
            const collision = await tx.eformsign_document_job.findUniqueOrThrow({ where: { requestKey: input.requestKey } });
            expect(collision.activeKey).toBeNull(); expect(collision.branchId).toBe(branches[0]);
            throw rollback;
        })).rejects.toBe(rollback);
        expect(await branchSnapshot()).toEqual(before);
    });
    async function plan5Hold(path: "released" | "zero" | "legacy-zero", prior?: { id: number; documentId: string }) {
        const s = await runtime(0, prior);
        if (path === "released") {
            const { claim } = await failed(s, true);
            const draft = await s.recovery.beginDraft(claim, workflowPlan.templateId, identity), intentId = draft.id;
            await s.recovery.releaseDraftBeforeOpen(claim, intentId);
            await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { claimExpiresAt: new Date(0) } });
            await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { completedAt: new Date() } });
            expect((await read())[0]).toMatchObject({ phase: "reserved", draftIntentId: null });
            expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId } })).toMatchObject({
                status: "prepared", startedAt: null, providerDocumentId: null, reconciliationReason: "draft_released_before_open" });
            return { s, intentId, claim };
        }
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "reconciling", progressStep: "processing", heartbeatAt: new Date() } });
        await s.recovery.markAutomaticUncertain(s.worker);
        if (path === "legacy-zero") await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { phase: "creation_uncertain" } });
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "requires_attention", leaseToken: null, completedAt: new Date(), lastErrorCode: "RECOVERY_PENDING" } });
        return { s, intentId: null, claim: null };
    }
    const plan5Paths = ["released", "zero", "legacy-zero"] as const;
    async function plan5AcceptedHistory(path: "released" | "zero") {
        let prior: { id: number; documentId: string } | undefined, previousIntentId = "";
        for (let index = 0; index < 2; index++) {
            const previous = await runtime(0, prior), claimed = await previous.recovery.claimCreation(previous.input, previous.worker, previous.effect);
            const documentId = `prior-accepted-${randomUUID()}`; documents.push(documentId);
            await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).markAccepted(claimed.intent.id, branches[0]!, claimed.intent.attemptCount, documentId);
            await previous.recovery.completeAutomatic(previous.worker, { ...evidence(documentId, true), createdAt: new Date(Date.now() + index * 1000) });
            prior = await db.eformsign_doc.findUniqueOrThrow({ where: { documentId } }); previousIntentId = claimed.intent.id;
            expect((await read())[0]).toMatchObject({ phase: "closed", providerDocumentId: documentId });
            expect(await currentPointer()).toEqual({ eDocId: documentId });
            expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: claimed.intent.id } })).toMatchObject({ status: "accepted", providerDocumentId: documentId });
            expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: previous.worker.jobId } })).toMatchObject({ status: "completed", documentId });
        }
        if (!prior) throw new Error("Missing completed history");
        return { ...await plan5Hold(path, prior), previousIntentId, prior };
    }
    it.each(["released", "zero"].flatMap(path => ["retained", "purged"].map(payload => ({ path: path as "released" | "zero", payload }))))("PLAN5 real $path retires beside multiple completed accepted histories with $payload payloads", async ({ path, payload }) => {
        const { s, prior } = await plan5AcceptedHistory(path);
        // Completion already purges prior payloads; explicitly exercise both current payload states.
        if (payload === "purged") await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { payload: Prisma.DbNull } });
        const before = await branchSnapshot();
        const receipts = before.intents.filter(row => row.status === "accepted").map(row => row.providerDocumentId);
        expect(receipts).toHaveLength(2); expect(new Set(receipts).size).toBe(2); expect(receipts).toContain(prior.documentId);
        const old = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        expect((await read())[0]!.priorDocumentId).toBe(prior.documentId);
        await expect(s.jobRepository.enqueue(s.enqueue)).resolves.toMatchObject({ existing: true, job: { id: old.id } });
        expect(await branchSnapshot()).toEqual(before);
        const input = nextInput(s), result = await s.jobRepository.enqueue(input), after = await branchSnapshot();
        expect(result.existing).toBe(false); expect(result.job.contractGeneration).not.toBe(old.contractGeneration);
        expect(after.intents).toEqual(before.intents); expect(after.clients).toEqual(before.clients); expect(after.mirrors).toEqual(before.mirrors);
        expect(after.jobs).toHaveLength(before.jobs.length + 1);
        expect(await db.eformsign_document_job.count({ where: { requestKey: input.requestKey } })).toBe(1);
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: old.id } })).toEqual({ ...old, status: "failed", progressStep: "superseded", activeKey: null, payload: null, leaseToken: null, heartbeatAt: null, updatedAt: expect.any(Date) });
        expect(after.jobs.filter(row => row.id !== old.id && row.id !== result.job.id)).toEqual(before.jobs.filter(row => row.id !== old.id));
        expect((await read())[0]).toMatchObject({ phase: "reserved", generation: result.job.contractGeneration, creationJobId: result.job.id, priorDocumentId: prior.documentId });
        await expect(s.jobRepository.enqueue(input)).resolves.toMatchObject({ existing: true, job: { id: result.job.id } }); expect(await branchSnapshot()).toEqual(after);
    });
    const historyDefects = ["no-prior", "null-provider", "empty-provider", "blank-provider", "started-prior", "uncertain-prior", "current-linked", "current-unlinked", "later-create-started", "later-create-uncertain", "later-draft-started", "later-draft-uncertain", "later-null-accepted", "later-empty-accepted", "later-blank-accepted"] as const;
    it.each(["released", "zero"].flatMap(path => historyDefects.map(defect => ({ path: path as "released" | "zero", defect }))))("PLAN5 real $path accepted history refuses $defect", async ({ path, defect }) => {
        const { s, prior, previousIntentId, intentId } = await plan5AcceptedHistory(path), where = { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } };
        if (defect === "no-prior") {
            await db.eformsign_contract_authority.update({ where, data: { priorDocumentId: null } });
            // Keep the latest pointer: a missing prior must still fail the pointer guard.
        }
        // Storage rejects NULL/empty receipts. Its btrim checks spaces only, so
        // whitespace containing tabs/newlines below also exercises the runtime guard.
        // Unit tests cover corrupt/legacy NULL and empty rows without bypassing checks.
        if (["null-provider", "empty-provider", "later-null-accepted", "later-empty-accepted"].includes(defect)) {
            const before = await branchSnapshot();
            const receipt = defect.includes("empty") ? "" : null;
            const write = !defect.startsWith("later-")
                ? db.eformsign_dispatch_intent.update({ where: { id: previousIntentId }, data: { providerDocumentId: receipt } })
                : db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!, action: "create_draft", generation: "later-unrelated", fingerprint: "b".repeat(64), businessKey: digest(randomUUID()), status: "accepted", attemptCount: 1, providerDocumentId: receipt } });
            await expect(write).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before); return;
        }
        if (defect === "started-prior" || defect === "uncertain-prior") await db.eformsign_dispatch_intent.update({ where: { id: previousIntentId }, data: { status: defect === "started-prior" ? "started" : "uncertain" } });
        if (defect === "current-linked") {
            if (path === "zero") await db.eformsign_contract_authority.update({ where, data: { creationIntentId: previousIntentId } });
            else await db.eformsign_dispatch_intent.update({ where: { id: (await read())[0]!.creationIntentId! }, data: { status: "accepted", providerDocumentId: prior.documentId } });
        }
        if (defect === "current-unlinked") {
            if (intentId) await db.eformsign_dispatch_intent.update({ where: { id: intentId }, data: { status: "accepted", providerDocumentId: prior.documentId } });
            else await db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!, action: "create_draft", generation: s.worker.contractGeneration,
                fingerprint: s.enqueue.payloadFingerprint, templateId: workflowPlan.templateId, businessKey: digest(`contract-draft:${s.worker.contractGeneration}`), status: "accepted", providerDocumentId: prior.documentId, attemptCount: 1 } });
        }
        if (defect === "empty-provider" || defect === "blank-provider") await db.eformsign_dispatch_intent.update({ where: { id: previousIntentId }, data: { providerDocumentId: defect === "empty-provider" ? "" : " \t\n " } });
        if (defect.startsWith("later-")) await db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!, action: defect.includes("create-") ? "create" : "create_draft", generation: "later-unrelated",
            fingerprint: "b".repeat(64), businessKey: digest(randomUUID()), status: defect.includes("accepted") ? "accepted" : defect.endsWith("started") ? "started" : "uncertain", attemptCount: 1,
            providerDocumentId: defect === "later-empty-accepted" ? "" : defect === "later-blank-accepted" ? " \t\n " : prior.documentId } });
        const before = await branchSnapshot();
        await expect(s.jobRepository.enqueue(nextInput(s))).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before);
    });
    it.each(["reserved", "creation_pending", "creation_uncertain"])("PLAN5 real linked prepared-zero create preserves %s boundary", async phase => {
        const s = await runtime(), claimed = await s.recovery.claimCreation(s.input, s.worker, s.effect);
        await db.eformsign_dispatch_intent.update({ where: { id: claimed.intent.id }, data: { status: "prepared", attemptCount: 0, startedAt: null } });
        await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { phase } });
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "failed", leaseToken: null, completedAt: new Date() } });
        const before = await branchSnapshot();
        if (phase === "reserved") { await expect(s.jobRepository.enqueue(nextInput(s))).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before); }
        else { await expect(s.jobRepository.enqueue(nextInput(s))).resolves.toMatchObject({ existing: false }); expect((await branchSnapshot()).intents).toEqual(before.intents); }
    });
    it.each(["other-error", "residual-key"].flatMap(audit => [null, "create", "create_draft"].map(action => ({ audit, action }))))("PLAN5 real zero-ref $audit unresolved=$action follows structural proof", async ({ audit, action }) => {
        const { s } = await plan5Hold("zero");
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: audit === "other-error" ? { lastErrorCode: "OTHER" } : { activeKey: "residual-key" } });
        if (action) await db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!, action, status: "uncertain", attemptCount: 1, generation: "unresolved", fingerprint: "b".repeat(64), businessKey: digest(randomUUID()) } });
        const before = await branchSnapshot(), old = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        await expect(s.jobRepository.enqueue(s.enqueue)).resolves.toMatchObject({ existing: true, job: { id: old.id } }); expect(await branchSnapshot()).toEqual(before);
        const input = nextInput(s);
        if (action) { await expect(s.jobRepository.enqueue(input)).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before); }
        else {
            const result = await s.jobRepository.enqueue(input), after = await branchSnapshot();
            expect(result.existing).toBe(false); expect(result.job.contractGeneration).not.toBe(old.contractGeneration);
            expect(after.jobs).toHaveLength(before.jobs.length + 1); expect(after.intents).toEqual(before.intents); expect(after.clients).toEqual(before.clients); expect(after.mirrors).toEqual(before.mirrors);
            expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: old.id } })).toEqual({ ...old, status: "failed", progressStep: "superseded", activeKey: null, payload: null, leaseToken: null, heartbeatAt: null, updatedAt: expect.any(Date) });
            expect((await read())[0]).toMatchObject({ phase: "reserved", creationJobId: result.job.id, generation: result.job.contractGeneration, priorDocumentId: null });
        }
    });
    it("PLAN5 real zero-ref markAutomaticUncertain preserves every authority field and issues no authority CAS", async () => {
        const s = await runtime();
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { status: "reconciling", progressStep: "processing" } });
        const before = await branchSnapshot(); let casCalls = 0;
        const proxy = new Proxy(db, { get(target, key) {
            if (key === "$transaction") return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => run(new Proxy(tx, { get(inner, method) {
                if (method === "$executeRaw") return (sql: Prisma.Sql) => { if (/UPDATE eformsign_contract_authority/.test(sql.text)) casCalls++; return inner.$executeRaw(sql); };
                const value = Reflect.get(inner, method); return typeof value === "function" ? value.bind(inner) : value;
            } })));
            const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        await new SbEformsignContractRecoveryRepository(proxy as unknown as PrismaService, s.options).markAutomaticUncertain(s.worker);
        expect((await read())[0]!.phase).toBe("reserved"); expect(await branchSnapshot()).toEqual(before); expect(casCalls).toBe(0);
    });
    it.each(["reserved", "creation_pending", "creation_uncertain"] as const)("PLAN5 real linked STARTED repair remains effective in %s", async phase => {
        const s = await runtime(), result = await s.recovery.claimCreation(s.input, s.worker, s.effect);
        await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { phase } });
        await s.recovery.markAutomaticUncertain(s.worker);
        expect((await read())[0]!.phase).toBe("creation_uncertain");
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: result.intent.id } })).toMatchObject({ status: "uncertain", attemptCount: 1, uncertainReason: "contract_creation_unverified" });
    });
    it.each(plan5Paths.flatMap(path => ["fresh", "day8-retained", "day8-purged"].map(age => ({ path, age }))))("PLAN5 real $path $age replays then retires exactly once with immutable audit/pointer", async ({ path, age }) => {
        const { s } = await plan5Hold(path);
        if (age !== "fresh") await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { completedAt: new Date(Date.now() - 8 * 86400000), ...(age === "day8-purged" ? { payload: Prisma.DbNull } : {}) } });
        const before = await branchSnapshot(), old = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        await expect(s.jobRepository.enqueue(s.enqueue)).resolves.toMatchObject({ existing: true, job: { id: old.id } });
        expect(await branchSnapshot()).toEqual(before);
        const input = { ...nextInput(s), activeKey: s.enqueue.activeKey }, result = await s.jobRepository.enqueue(input);
        expect(result.existing).toBe(false); expect(result.job.contractGeneration).not.toBe(s.worker.contractGeneration);
        expect(await db.eformsign_document_job.count({ where: { requestKey: input.requestKey } })).toBe(1);
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: "failed", progressStep: "superseded", activeKey: null, payload: null, lastErrorCode: old.lastErrorCode, contractGeneration: old.contractGeneration });
        const after = await branchSnapshot();
        expect(after.intents).toEqual(before.intents); expect(after.clients).toEqual(before.clients); expect(after.mirrors).toEqual(before.mirrors);
        expect(after.jobs).toHaveLength(before.jobs.length + 1);
        expect((await read())[0]).toMatchObject({ creationJobId: result.job.id, generation: result.job.contractGeneration, phase: "reserved", priorDocumentId: null });
        await expect(s.jobRepository.enqueue(input)).resolves.toMatchObject({ existing: true, job: { id: result.job.id } });
        expect(await branchSnapshot()).toEqual(after);
        await expect(s.recovery.readWorker(s.worker)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
    });
    it.each(plan5Paths.flatMap(path => ["same-claim", "other-claim", "lease", "active", "provider", "hidden-human", "human-ref", "pointer", "job-fingerprint"].map(defect => ({ path, defect }))))("PLAN5 real $path refuses $defect without any mutation", async ({ path, defect }) => {
        const { s } = await plan5Hold(path), where = { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } };
        if (defect.endsWith("claim")) await db.eformsign_contract_authority.update({ where, data: { claimUserId: users[defect === "same-claim" ? 0 : 1]!, claimExpiresAt: new Date(Date.now() + 60000) } });
        if (defect === "lease" || defect === "active") await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: defect === "lease" ? { leaseToken: s.worker.leaseToken } : { status: "processing", leaseToken: s.worker.leaseToken } });
        if (defect === "provider") await db.eformsign_contract_authority.update({ where, data: { providerDocumentId: documents[0]! } });
        if (defect === "pointer") await db.client.update({ where: { id: clients[0]! }, data: { eDocId: documents[0]! } });
        if (defect === "job-fingerprint") await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { payloadFingerprint: "b".repeat(64) } });
        if (defect === "hidden-human" || defect === "human-ref") {
            const human = await db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!, action: "manual_process", generation: s.worker.contractGeneration, fingerprint: s.enqueue.payloadFingerprint, businessKey: digest(`contract-human:${s.worker.contractGeneration}`), templateId: workflowPlan.templateId } });
            if (defect === "human-ref") await db.eformsign_contract_authority.update({ where, data: { humanIntentId: human.id } });
        }
        const before = await branchSnapshot();
        await expect(s.jobRepository.enqueue(nextInput(s))).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before);
    });
    it.each(["reason", "startedAt", "started", "uncertain", "accepted", "provider", "branch", "client", "generation", "fingerprint", "local", "assignment", "template", "action"])("PLAN5 real unlinked released draft refuses %s", async defect => {
        const { s, intentId } = await plan5Hold("released");
        const patch: Prisma.eformsign_dispatch_intentUpdateInput = {};
        if (defect === "reason") Object.assign(patch, { reconciliationReason: null, attemptCount: 0 });
        if (defect === "startedAt") patch.startedAt = new Date();
        if (["started", "uncertain", "accepted"].includes(defect)) patch.status = defect;
        if (defect === "accepted" || defect === "provider") patch.providerDocumentId = documents[0]!;
        if (defect === "branch") patch.branch = { connect: { id: branches[1]! } };
        if (defect === "client") patch.clientId = clients[1]!;
        if (defect === "generation") patch.generation = randomUUID();
        if (defect === "fingerprint") patch.fingerprint = "b".repeat(64);
        if (defect === "local") patch.localDocumentId = 42;
        if (defect === "assignment") patch.assignmentId = 42;
        if (defect === "template") patch.templateId = "wrong-template";
        if (defect === "action") patch.action = "manual_process";
        await db.eformsign_dispatch_intent.update({ where: { id: intentId! }, data: patch });
        // Include the foreign draft explicitly; branchSnapshot alone would omit it.
        const before = await branchSnapshot(), draft = await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId! } });
        await expect(s.jobRepository.enqueue(nextInput(s))).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before);
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId! } })).toEqual(draft);
    });
    it.each(plan5Paths.flatMap(path => ["create", "create_draft"].flatMap(action => ["started", "uncertain", "accepted"].map(status => ({ path, action, status })))))("PLAN5 real $path classifies unrelated $action $status before retirement", async ({ path, action, status }) => {
        const { s } = await plan5Hold(path);
        await db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!, action, status, attemptCount: 1,
            generation: "unrelated", businessKey: digest(randomUUID()), fingerprint: "b".repeat(64), providerDocumentId: status === "accepted" ? documents[0]! : null } });
        const before = await branchSnapshot();
        const retired = await transaction(db, async tx => { const [authority] = await lockAuthorityScope(tx, branches[0]!, [clients[0]!]); return retireProvenNoEffect(tx, authority!, null); });
        if (status === "accepted") {
            // Fixture-only unrelated definitive receipt, separate from the genuine multi-generation workflow above.
            expect(retired).toBe(true);
            const after = await branchSnapshot();
            expect(after.intents).toEqual(before.intents); expect(after.clients).toEqual(before.clients); expect(after.mirrors).toEqual(before.mirrors);
            expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ progressStep: "superseded", activeKey: null, payload: null });
            const input = nextInput(s), result = await s.jobRepository.enqueue(input), rotated = await branchSnapshot();
            expect(result.existing).toBe(false); expect(result.job.contractGeneration).not.toBe(s.worker.contractGeneration);
            expect(rotated.intents).toEqual(before.intents); expect(rotated.clients).toEqual(before.clients); expect(rotated.mirrors).toEqual(before.mirrors);
            await expect(s.jobRepository.enqueue(input)).resolves.toMatchObject({ existing: true, job: { id: result.job.id } }); expect(await branchSnapshot()).toEqual(rotated);
        } else {
            expect(retired).toBe(false); expect(await branchSnapshot()).toEqual(before);
            await expect(s.jobRepository.enqueue(nextInput(s))).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before);
        }
    });
    it("PLAN5 real zero-ref retires after unrelated create is legitimately reconciled no-effect", async () => {
        const { s } = await plan5Hold("legacy-zero");
        const unknown = await db.eformsign_dispatch_intent.create({ data: { branchId: branches[0]!, clientId: clients[0]!, action: "create", status: "uncertain", attemptCount: 1, generation: "unrelated", businessKey: digest(randomUUID()), fingerprint: "b".repeat(64) } });
        const before = await branchSnapshot();
        await expect(s.jobRepository.enqueue(nextInput(s))).rejects.toThrow(); expect(await branchSnapshot()).toEqual(before);
        await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId: unknown.id, branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Provider console confirms absence", attemptCount: 1 });
        const settled = await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: unknown.id } });
        await expect(s.jobRepository.enqueue(nextInput(s))).resolves.toMatchObject({ existing: false });
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: unknown.id } })).toEqual(settled);
    });
    it.each(plan5Paths.flatMap(path => ["cas", "insert"].map(loss => ({ path, loss }))))("PLAN5 real $path $loss conflict rolls back authority/job/keys/refs/pointer", async ({ path, loss }) => {
        const { s } = await plan5Hold(path), before = await branchSnapshot(), input = { ...nextInput(s), requestKey: randomUUID(), activeKey: s.enqueue.activeKey };
        let intercepted = 0;
        await expect(transaction(db, async tx => {
            if (loss === "insert") await insertSameBranchCollision(tx, input.requestKey);
            const connection = new Proxy(tx, { get(target, key) {
                if (key === "$executeRaw") return (sql: Prisma.Sql) => {
                    if (loss === "cas" && /UPDATE eformsign_contract_authority/.test(sql.text)) { intercepted++; return Promise.resolve(0); }
                    return target.$executeRaw(sql);
                };
                const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
            } });
            return s.jobRepository.enqueueInTransaction(connection, input);
        })).rejects.toBeInstanceOf(ConflictException);
        if (loss === "cas") expect(intercepted).toBe(1);
        expect(await branchSnapshot()).toEqual(before);
        // The exact same-branch collision would commit existing:true without a prior mutation.
        if (loss === "insert") {
            const rollback = new Error("PLAN5 collision control rollback");
            await expect(transaction(db, async tx => {
                const [authority] = await lockAuthorityScope(tx, branches[0]!, [clients[0]!]);
                expect(await retireProvenNoEffect(tx, authority!, null)).toBe(true);
                await insertSameBranchCollision(tx, input.requestKey);
                expect(await s.jobRepository.enqueueInTransaction(tx, input)).toMatchObject({ existing: true, job: { requestKey: input.requestKey } });
                throw rollback;
            })).rejects.toBe(rollback);
            expect(await branchSnapshot()).toEqual(before);
        }
    });
    it.each(["claim", "enqueue"] as const)("PLAN5 real released draft versus enqueue first=%s fences the stale writer", async first => {
        const { s, claim, intentId } = await plan5Hold("released"), input = nextInput(s);
        const writer = (tx: Prisma.TransactionClient) => recoveryIn(tx, s).open(s.worker.jobId, branches[0]!, users[0]!);
        const enqueue = (tx: Prisma.TransactionClient) => s.jobRepository.enqueueInTransaction(tx, input);
        const outcomes = await contendBeforeAction(first === "claim" ? writer : enqueue, first === "claim" ? enqueue : writer);
        expect(outcomes[0]!.status).toBe("fulfilled"); expect(outcomes[1]!.status).toBe("rejected");
        expect(await db.eformsign_document_job.count({ where: { requestKey: input.requestKey } })).toBe(first === "enqueue" ? 1 : 0);
        if (first === "enqueue") {
            const before = await branchSnapshot();
            await expect(s.recovery.recordDraftCandidate(claim!, intentId!, documents[0]!)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
            await expect(s.recovery.beginDraft(claim!, workflowPlan.templateId, identity)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
            expect(await branchSnapshot()).toEqual(before);
        }
    });
    it.each(["claim", "enqueue"] as const)("PLAN5 real zero-ref old worker claim versus enqueue first=%s cannot acquire STARTED", async first => {
        const { s } = await plan5Hold("zero"), input = nextInput(s);
        const oldClaim = (tx: Prisma.TransactionClient) => recoveryIn(tx, s).claimCreation(s.input, s.worker, s.effect);
        const enqueue = (tx: Prisma.TransactionClient) => s.jobRepository.enqueueInTransaction(tx, input);
        const outcomes = await contendBeforeAction(first === "claim" ? oldClaim : enqueue, first === "claim" ? enqueue : oldClaim);
        expect(outcomes[first === "claim" ? 0 : 1]!.status).toBe("rejected"); expect(outcomes[first === "enqueue" ? 0 : 1]!.status).toBe("fulfilled");
        expect(await db.eformsign_document_job.count({ where: { requestKey: input.requestKey } })).toBe(1);
        expect(await db.eformsign_dispatch_intent.count({ where: { branchId: branches[0]! } })).toBe(0);
    });
    it("PLAN5 real union locks linked create plus unlinked draft in sorted unique id order", async () => {
        const { s, intentId } = await plan5Hold("released"), authority = (await read())[0]!, observed: unknown[][] = [];
        const expectedIds = [authority.creationIntentId!, intentId!].sort();
        await transaction(db, async tx => {
            const proxy = new Proxy(tx, { get(target, key) {
                if (key === "$queryRaw") return (sql: Prisma.Sql) => { if (/FROM eformsign_dispatch_intent.*ORDER BY id FOR UPDATE/.test(sql.text)) observed.push(sql.values); return target.$queryRaw(sql); };
                const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
            } });
            await s.jobRepository.enqueueInTransaction(proxy, nextInput(s));
        });
        expect(observed).toEqual([expectedIds]);
    });
    it("PLAN5 real unlinked draft operator reconcile wins its row lock and retirement re-reads before refusing", async () => {
        const { s, intentId } = await plan5Hold("released"), before = await branchSnapshot();
        const outcomes = await contend(async tx => {
            await tx.$queryRaw`SELECT id FROM eformsign_dispatch_intent WHERE id = ${intentId}::uuid FOR UPDATE`;
            await tx.eformsign_dispatch_intent.update({ where: { id: intentId! }, data: { status: "reconciled_delivered", reconciledOutcome: "delivered", reconciledAt: new Date(), reconciledByUserId: users[0]!, providerDocumentId: documents[0]! } });
        }, tx => s.jobRepository.enqueueInTransaction(tx, nextInput(s)));
        expect(outcomes[0]!.status).toBe("fulfilled"); expect(outcomes[1]!.status).toBe("rejected");
        const after = await branchSnapshot();
        expect(after.authorities).toEqual(before.authorities); expect(after.jobs).toEqual(before.jobs);
        expect(after.clients).toEqual(before.clients); expect(after.mirrors).toEqual(before.mirrors);
        expect(after.intents.find(row => row.id === intentId)).toMatchObject({ status: "reconciled_delivered", providerDocumentId: documents[0] });
        expect(after.intents.filter(row => row.id !== intentId)).toEqual(before.intents.filter(row => row.id !== intentId));
    });
    async function historicalRuntime() {
        const s = await runtime(), f = await failed(s, false), document = `historical-${randomUUID()}`; documents.push(document);
        await db.eformsign_dispatch_intent.update({ where: { id: f.intent.id }, data: { providerDocumentId: document } });
        await s.recovery.bindDocument(f.claim, evidence(document)); await s.recovery.completeManual(f.claim, evidence(document, true));
        await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { phase: "verified" } });
        await db.eformsign_dispatch_intent.update({ where: { id: f.intent.id }, data: { status: "uncertain", reconciledAt: null, reconciledByUserId: null, reconciledOutcome: null } });
        await db.eformsign_doc.update({ where: { documentId: document }, data: { statusType: "064" } });
        return { s, f, document };
    }
    it.each(["complete", "enqueue"])("R4 real completeManual versus enqueue lock race, first=%s", async first => {
        const s = await runtime(), f = await failed(s, false), document = `race-${randomUUID()}`; documents.push(document);
        await db.eformsign_dispatch_intent.update({ where: { id: f.intent.id }, data: { providerDocumentId: document } });
        await s.recovery.bindDocument(f.claim, evidence(document));
        const next = nextInput(s);
        const complete = (tx: Prisma.TransactionClient) => recoveryIn(tx, s).completeManual(f.claim, evidence(document, true));
        const enqueue = (tx: Prisma.TransactionClient) => s.jobRepository.enqueueInTransaction(tx, next);
        // A failed first contender must roll back its INSERT; place the barrier before either action.
        const result = await contendBeforeAction(first === "complete" ? complete : enqueue, first === "complete" ? enqueue : complete);
        expect(result[first === "complete" ? 0 : 1]!.status).toBe("fulfilled");
        expect((await read())[0]!.phase).toBe(first === "complete" ? "reserved" : "closed");
        expect(await db.eformsign_document_job.count({ where: { requestKey: next.requestKey } })).toBe(first === "complete" ? 1 : 0);
        expect(await db.eformsign_dispatch_intent.count({ where: { branchId: branches[0]!, action: "create", status: { in: ["started", "uncertain"] } } })).toBe(0);
    });
    it.each(["normalize", "enqueue"])("R4 real historical normalize versus enqueue first=%s", async first => {
        const { s, f } = await historicalRuntime(), next = nextInput(s);
        const normalize = async (tx: Prisma.TransactionClient) => {
            const [a] = await lockAuthorityScope(tx, branches[0]!, [clients[0]!]);
            if (a!.generation !== s.worker.contractGeneration) throw new Error("stale historical generation");
            return normalizeVerifiedAuthority(tx, a!);
        };
        const enqueue = (tx: Prisma.TransactionClient) => s.jobRepository.enqueueInTransaction(tx, next);
        const result = await contendBeforeAction(first === "normalize" ? normalize : enqueue, first === "normalize" ? enqueue : normalize);
        expect(result[0]!.status).toBe("fulfilled"); expect(result[1]!.status).toBe(first === "normalize" ? "fulfilled" : "rejected");
        expect((await read())[0]!.creationJobId).not.toBe(s.worker.jobId);
        expect(await db.eformsign_document_job.count({ where: { requestKey: next.requestKey } })).toBe(1);
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: f.intent.id } })).toMatchObject({ status: "reconciled_delivered", reconciledByUserId: users[0] });
        await expect(s.recovery.readClaim(f.claim)).rejects.toThrow();
    });

    it.each(["claim", "enqueue"])("R4 real row2 open versus rotating enqueue first=%s", async first => {
        const { s, intentId } = await terminalStart("create", false);
        await expect(s.recovery.open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toMatchObject({ status: 410 });
        await new SbEformsignDispatchIntentRepository(db as unknown as PrismaService).reconcile({ intentId, branchId: branches[0]!, outcome: "not_delivered", actorUserId: users[0]!, reason: "Provider investigated", attemptCount: 1 });
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { completedAt: new Date() } });
        const next = { ...nextInput(s), activeKey: s.enqueue.activeKey };
        const claim = (tx: Prisma.TransactionClient) => recoveryIn(tx, s).open(s.worker.jobId, branches[0]!, users[0]!);
        const enqueue = (tx: Prisma.TransactionClient) => s.jobRepository.enqueueInTransaction(tx, next);
        const result = await contendBeforeAction(first === "claim" ? claim : enqueue, first === "claim" ? enqueue : claim);
        expect(result[0]!.status).toBe("fulfilled");
        expect((await read())[0]!.creationJobId === s.worker.jobId).toBe(first === "claim");
        expect(await db.eformsign_document_job.count({ where: { requestKey: next.requestKey } })).toBe(first === "claim" ? 0 : 1);
        expect(await db.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: intentId } })).toMatchObject({ status: "reconciled_not_delivered" });
    });
    it.each(["create", "draft"] as const)("R4 real postTTL %s exact document completion preserves contacts and NULL payload", async kind => {
        const s = await runtime(), f = await failed(s, kind === "draft"), document = `postttl-${randomUUID()}`; documents.push(document);
        let intentId = f.intent.id;
        if (kind === "draft") intentId = (await s.recovery.beginDraft(f.claim, workflowPlan.templateId, identity)).id;
        await db.eformsign_dispatch_intent.update({ where: { id: intentId }, data: { status: "reconciled_delivered", reconciledOutcome: "delivered", reconciledByUserId: users[0]!, reconciledAt: new Date(), providerDocumentId: document } });
        await s.recovery.bindDocument(f.claim, evidence(document), kind === "draft" ? intentId : undefined);
        // customerPhone is VARCHAR(11); deliberately invalid contacts cannot route externally.
        const storedContacts = { customerName: "QA-Stored", customerPhone: "not-a-phone", stepRecipientName: "QA-Recipient", stepRecipientSms: "invalid-sms" };
        const contactFields = { customerName: true, customerPhone: true, stepRecipientName: true, stepRecipientSms: true } as const;
        const beforeContacts = await db.eformsign_doc.update({ where: { documentId: document }, data: storedContacts, select: contactFields });
        expect(beforeContacts).toEqual(storedContacts);
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { payload: Prisma.DbNull, completedAt: new Date(Date.now() - 8 * 86400000) } });
        const opened = await s.recovery.open(s.worker.jobId, branches[0]!, users[0]!);
        expect(opened.payload).toEqual({}); expect(opened.verificationOnly).toMatchObject({ documentId: document, templateId: workflowPlan.templateId });
        await s.recovery.completeManual({ ...f.claim, claimEpoch: opened.claimEpoch }, evidence(document, true));
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ status: "completed", payload: null });
        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: document }, select: contactFields })).toEqual(beforeContacts);
    });

    it.each(["second-ref", "authority"])("R4 real repair %s CAS loss rolls back BOTH refs and phase", async target => {
        const { s } = await terminalStart("draft", true), original = (await read())[0]!;
        await db.eformsign_dispatch_intent.update({ where: { id: original.creationIntentId! }, data: { status: "started" } });
        const before = await db.eformsign_dispatch_intent.findMany({ where: { branchId: branches[0]! }, orderBy: { id: "asc" } });
        let writes = 0;
        const proxy = new Proxy(db, { get(t, k) {
            if (k === "$transaction") return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => t.$transaction(tx => run(new Proxy(tx, { get(inner, key) {
                if (key === "$executeRaw") return (query: Prisma.Sql) => target === "authority" && query.text.includes("UPDATE eformsign_contract_authority") ? Promise.resolve(0) : inner.$executeRaw(query);
                if (key === "eformsign_dispatch_intent") return new Proxy(inner.eformsign_dispatch_intent, { get(model, method) {
                    if (method === "updateMany") return (args: Prisma.eformsign_dispatch_intentUpdateManyArgs) => target === "second-ref" && ++writes === 2 ? Promise.resolve({ count: 0 }) : model.updateMany(args);
                    const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
                } });
                const value = Reflect.get(inner, key); return typeof value === "function" ? value.bind(inner) : value;
            } })));
            const value = Reflect.get(t, k); return typeof value === "function" ? value.bind(t) : value;
        } });
        await expect(new SbEformsignContractRecoveryRepository(proxy as unknown as PrismaService, s.options).open(s.worker.jobId, branches[0]!, users[0]!)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        expect((await read())[0]).toEqual(original);
        expect(await db.eformsign_dispatch_intent.findMany({ where: { branchId: branches[0]! }, orderBy: { id: "asc" } })).toEqual(before);
    });
    async function contendBeforeAction(first: (tx: Prisma.TransactionClient) => Promise<unknown>, second: (tx: Prisma.TransactionClient) => Promise<unknown>) {
        const ready = deferred<void>(), release = deferred<void>(), started = deferred<number>();
        const pa = transaction(a, async tx => { await lockAuthorityScope(tx, branches[0]!, [clients[0]!]); ready.resolve(); await bounded(release.promise, 9000); return first(tx); });
        void pa.catch(() => undefined); let pb: Promise<unknown> | undefined;
        try {
            await bounded(ready.promise, 5000);
            pb = transaction(b, async tx => { const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; started.resolve(pid!.pid); return second(tx); });
            void pb.catch(() => undefined); await lockObserved(await bounded(started.promise, 5000));
        } finally { release.resolve(); await Promise.allSettled([pa, ...(pb ? [pb] : [])]); }
        return Promise.allSettled([pa, pb!]);
    }

    async function initialRuntime(step = "preparing", code = "PRE_SEND_RETRY_EXHAUSTED", status = "failed", revisionPayload: Prisma.InputJsonObject = {}) {
        const branchId = branches[0]!, clientId = clients[0]!;
        const record = await db.service_record_case.create({ data: { branchId, clientId, status: "READY_TO_FINALIZE", formVersion: 3 } });
        const revision = await db.service_record_revision.create({ data: { branchId, serviceRecordCaseId: record.id,
            revisionNumber: 1, confirmedByUserId: users[0]!, payload: revisionPayload, plannedSessions: [], provenance: {}, formVersionAtConfirm: 3 } });
        retainRevision(revision);
        await db.service_record_case.update({ where: { id: record.id }, data: { currentRevisionId: revision.id } });
        const requestKey = `service-record-initial-finalization:${revision.id}`, generation = randomUUID();
        const immutablePayload = { frozen: true }, fingerprint = sha256CanonicalJson(immutablePayload);
        const state = await db.service_record_revision_document_state.create({ data: { branchId, clientId,
            serviceRecordCaseId: record.id, revisionId: revision.id, operation: "record_snapshot", generation,
            immutableInput: immutablePayload, inputFingerprint: fingerprint, documentVersion: 3,
            workflowScope: { generationKind: "INITIAL_FINALIZATION", requestKey },
            status: "capability_unverified", step: "capability_unverified", lastErrorCode: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" } });
        const payload = { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION", revisionId: revision.id,
            documentStateId: state.id, generation, documentVersion: 3, snapshotReference: requestKey,
            completeness: "complete", manualReviewRequired: true, immutablePayload, payloadFingerprint: fingerprint,
            context: { branchId, clientId, serviceRecordCaseId: record.id, revisionId: revision.id, revisionNumber: 1,
                businessFingerprint: fingerprint, plannedSessionCount: 1,
                plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-01" }],
                documentSyncStatus: "capability_unverified", lifecycleStatus: "READY_TO_FINALIZE", formVersion: 3 } };
        const job = await db.eformsign_document_job.create({ data: { branchId, clientId, source: "auto_finalize", jobType: "create_document",
            requestKey, payload, payloadFingerprint: fingerprint, status, progressStep: step, progressDetail: ["dispatch_authorized", "creating", "sent"].includes(step) ? "creating" : null,
            lastErrorCode: code, activeKey: `service-record-initial:${record.id}`, completedAt: new Date() } });
        const repo = new SbEformsignDocumentJobRepository(db as unknown as PrismaService);
        const input = { branchId, jobId: job.id, userId: users[0]!, now: new Date() };
        const readJob = () => db.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } });
        const readState = () => db.service_record_revision_document_state.findUniqueOrThrow({ where: { id: state.id } });
        return { repo, input, job, state, payload, readJob, readState, record };
    }
    function initialLifecycle(connection: PrismaClient = db) {
        // Terminal evaluation never reads a business-day calendar.
        return new ServiceRecordLifecycleService(connection as unknown as PrismaService, {} as HolidayCalendarService);
    }
    async function initialChunks(options: { unlinked?: boolean; completed?: boolean; dispatchAuthorized?: boolean; regenerationSource?: boolean } = {}) {
        const f = await initialRuntime("sent", "PRE_SEND_RETRY_EXHAUSTED", "failed", options.regenerationSource
            ? { plannedSessions: [{ sessionIndex: 1, originalDate: "2026-09-01" }] } : {});
        const revisionId = f.payload.revisionId, branchId = f.input.branchId;
        await db.service_record_case.update({ where: { id: f.record.id }, data: {
            status: options.completed ? "COMPLETED" : options.dispatchAuthorized ? "READY_TO_FINALIZE" : "DOCUMENTS_CREATED",
            ...(options.completed ? { currentUsableRevisionId: revisionId, currentUsableDocumentVersion: 3, documentsCompletedAt: new Date() } : {}),
        } });
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: {
            status: options.completed ? "completed" : "processing", step: options.completed ? "completed" : options.dispatchAuthorized ? "dispatch_authorized" : "documents_created",
            lastErrorCode: null,
        } });
        for (const index of [1, 2]) {
            const documentId = documents[index - 1]!;
            const linked = index === 1 || !options.unlinked;
            if (linked) await db.eformsign_doc.update({ where: { documentId }, data: { branchId, clientId: clients[0]!,
                serviceRecordCaseId: f.record.id, revisionId, snapshotVersion: 3, snapshotChunkIndex: index,
                documentKind: "service_record_snapshot", statusType: options.completed ? "003" : "070" } });
            await db.service_record_snapshot_chunk.create({ data: { branchId, serviceRecordCaseId: f.record.id, revisionId,
                snapshotVersion: 3, chunkIndex: index, chunkCount: 2, firstSessionIndex: index, lastSessionIndex: index,
                employeeNameSnapshot: "Synthetic PG provider", sourceHash: f.state.inputFingerprint,
                status: linked ? "CREATED" : "PENDING", eformsignDocumentId: linked ? documentId : null } });
        }
        const purge = async (index: number, evaluate = true) => {
            const documentId = documents[index - 1]!;
            const mirror = new SbEformsignDocumentMirrorRepository(db as unknown as PrismaService);
            await mirror.requestPermanentPurge([documentId]);
            const before = await db.eformsign_doc.findUniqueOrThrow({ where: { documentId }, select: { statusType: true } });
            await mirror.purgeContent([documentId], new Date());
            return evaluate ? initialLifecycle().evaluateInitialSnapshotTerminalOutcome({ branchId, documentId,
                deletedDocuments: [{ documentId, statusType: before.statusType }] }) : false;
        };
        const readCase = () => db.service_record_case.findUniqueOrThrow({ where: { id: f.record.id } });
        return { ...f, revisionId, branchId, purge, readCase };
    }
    it.each(["purgeContent", "markDeleted"] as const)("U1 %s satisfies the revision scope CHECK and only purge clears snapshot linkage", async writer => {
        const f = await initialChunks();
        const documentId = documents[0]!;
        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId } })).toMatchObject({
            revisionId: f.revisionId, serviceRecordCaseId: f.record.id, branchId: f.branchId,
        });
        const chunk = await db.service_record_snapshot_chunk.findFirstOrThrow({ where: { eformsignDocumentId: documentId } });
        const mirror = new SbEformsignDocumentMirrorRepository(db as unknown as PrismaService);

        await expect(mirror[writer]([documentId], new Date())).resolves.toBeUndefined();

        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId } })).toMatchObject({
            statusType: "049", branchId: f.branchId,
            ...(writer === "purgeContent" ? { revisionId: null, serviceRecordCaseId: null }
                : { revisionId: f.revisionId, serviceRecordCaseId: f.record.id }),
        });
        expect(await db.$queryRaw<Array<{ valid: boolean }>>`
            SELECT revision_id IS NULL OR (branch_id IS NOT NULL AND service_record_case_id IS NOT NULL) AS valid
            FROM eformsign_doc WHERE document_id = ${documentId}
        `).toEqual([{ valid: true }]);
        expect(await db.service_record_snapshot_chunk.findUniqueOrThrow({ where: { id: chunk.id } })).toEqual(chunk);
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(0);
        await db.eformsign_doc.update({ where: { documentId }, data: {
            updatedDate: new Date(Date.now() - INITIAL_PROVIDER_SETTLE_MS - 1000),
        } });
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(1);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
    });
    it("U1 vendor-deleted INITIAL chunk blocks ready sibling completion before terminal evaluation", async () => {
        const f = await initialChunks();
        const deletedDocumentId = documents[0]!, siblingDocumentId = documents[1]!;
        const syncedAt = new Date();
        const sibling = await db.eformsign_doc.update({ where: { documentId: siblingDocumentId }, data: {
            statusType: "003", detailPayload: {}, detailSourceUpdatedDate: syncedAt,
            detailSyncedAt: syncedAt, syncStatus: "ready",
        } });
        const content = Buffer.from("synthetic snapshot PDF");
        await db.eformsign_doc_file.createMany({ data: ["document", "audit_trail"].map(fileType => ({
            eformsignDocId: sibling.id, fileType, content, contentType: "application/pdf",
            byteSize: content.length, sha256: digest(content.toString()), sourceUpdatedDate: syncedAt, syncedAt,
        })) });
        await new SbEformsignDocumentMirrorRepository(db as unknown as PrismaService)
            .markDeleted([deletedDocumentId], syncedAt);
        const stateBeforeCompletion = await f.readState(), caseBeforeCompletion = await f.readCase();

        expect(await initialLifecycle().completeServiceRecordSnapshotIfReady({
            branchId: f.branchId, documentId: siblingDocumentId,
        })).toBe(false);
        expect(await f.readState()).toEqual(stateBeforeCompletion);
        expect(await f.readCase()).toEqual(caseBeforeCompletion);
        await db.eformsign_doc.update({ where: { documentId: deletedDocumentId }, data: {
            updatedDate: new Date(Date.now() - INITIAL_PROVIDER_SETTLE_MS - 1000),
        } });
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(1);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
        expect(await f.readCase()).toMatchObject({ status: "FINALIZATION_FAILED", currentUsableRevisionId: null });
    });
    it("U1 staff purge of an in-progress INITIAL chunk fails state/case after commit and repeated evaluation is a no-op", async () => {
        const f = await initialChunks();
        expect(await f.purge(1)).toBe(true);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
        expect(await f.readCase()).toMatchObject({ status: "FINALIZATION_FAILED", nextAttemptAt: null, currentUsableRevisionId: null });
        const tombstone = await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: documents[0]! } });
        expect(tombstone).toMatchObject({ statusType: "049", clientId: null, documentKind: null, serviceRecordCaseId: null,
            snapshotVersion: null, snapshotChunkIndex: null, revisionId: null });
        const state = await f.readState(), record = await f.readCase();
        expect(await initialLifecycle().evaluateInitialSnapshotTerminalOutcome({ branchId: f.branchId, documentId: documents[0]!,
            deletedDocuments: [{ documentId: documents[0]!, statusType: "070" }] })).toBe(false);
        expect(await f.readState()).toEqual(state);
        expect(await f.readCase()).toEqual(record);
    });
    it("U1 deleting a chunk of an already-completed record preserves completed state/case and usable pointer", async () => {
        const f = await initialChunks({ completed: true });
        expect(await f.purge(1)).toBe(false);
        expect(await f.readState()).toMatchObject({ status: "completed", step: "completed" });
        expect(await f.readCase()).toMatchObject({ status: "COMPLETED", currentUsableRevisionId: f.revisionId, currentUsableDocumentVersion: 3 });
    });
    it("U1 completed chunk deletion preserves non-ready evidence after deleting the other live sibling", async () => {
        const f = await initialChunks();
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: { statusType: "003" } });
        expect(await f.purge(1)).toBe(true);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED" });
        expect(await f.purge(2)).toBe(false);
        expect(await f.readState()).toMatchObject({ lastErrorCode: "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED" });
        expect(await f.readCase()).toMatchObject({ lastError: "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED" });
    });
    it.each([false, true])("U1 post-dispatch cancel then staff deletion respects unlinked chunk=%s", async unlinked => {
        const f = await initialChunks({ unlinked });
        // Exercise the real post-dispatch cancellation boundary, including the retained key.
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { step: "dispatch_authorized" } });
        await db.service_record_case.update({ where: { id: f.record.id }, data: { status: "READY_TO_FINALIZE" } });
        expect(await f.repo.cancel(f.input)).toMatchObject({ kind: "cancelled" });
        expect(await f.readState()).toMatchObject({ status: "manual_review", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        expect(await f.purge(1)).toBe(!unlinked);
        expect(await f.readState()).toMatchObject(unlinked
            ? { status: "manual_review", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" }
            : { status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
    });
    it.each(["manual_review", "failed"])("U1 captured completed deletion takes precedence over %s with an unlinked chunk", async status => {
        const f = await initialChunks({ unlinked: true });
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { status,
            step: status === "failed" ? "failed" : "manual_review",
            lastErrorCode: status === "failed" ? "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH" : "JOB_CANCELLED_AFTER_DISPATCH" } });
        await db.service_record_case.update({ where: { id: f.record.id }, data: { status: "FINALIZATION_FAILED" } });
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: { statusType: "003" } });
        expect(await f.purge(1)).toBe(true);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED" });
    });
    it("U1 sweep heals a pre-existing purged row with unknown status conservatively and idempotently", async () => {
        const f = await initialChunks();
        await f.purge(1, false);
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: {
            updatedDate: new Date(Date.now() - INITIAL_PROVIDER_SETTLE_MS - 1000),
        } });
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(1);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
        expect(await f.readCase()).toMatchObject({ status: "FINALIZATION_FAILED", lastError: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(0);
    });
    it("U1 sweep keeps unknown sibling evidence regardless of which terminal document sorts first", async () => {
        const f = await initialChunks();
        await f.purge(2, false);
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: { statusType: "031" } });
        // Evaluate the non-deleted sibling first, deliberately bypassing the sweep's ordering.
        expect(await initialLifecycle().evaluateInitialSnapshotTerminalOutcome({ branchId: f.branchId, documentId: documents[0]! })).toBe(true);
        expect(await f.readState()).toMatchObject({ lastErrorCode: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
    });
    it("U1 terminal failure ignores purge intent while completion still refuses a pending purge", async () => {
        const f = await initialChunks();
        await new SbEformsignDocumentMirrorRepository(db as unknown as PrismaService).requestPermanentPurge([documents[0]!]);
        await db.eformsign_doc.updateMany({ where: { documentId: { in: documents.slice(0, 2) } }, data: { statusType: "003" } });
        expect(await initialLifecycle().completeServiceRecordSnapshotIfReady({ branchId: f.branchId, documentId: documents[0]! })).toBe(false);
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: { statusType: "031" } });
        expect(await initialLifecycle().evaluateInitialSnapshotTerminalOutcome({ branchId: f.branchId, documentId: documents[0]! })).toBe(true);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
        expect((await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: documents[0]! } })).permanentPurgeRequestedAt).not.toBeNull();
    });
    it.each(["070", "003"])("U1 batch purge uses both captured statuses when the second chunk was %s", async statusType => {
        const f = await initialChunks();
        await db.eformsign_doc.update({ where: { documentId: documents[1]! }, data: { statusType } });
        await f.purge(1, false);
        await f.purge(2, false);
        expect(await initialLifecycle().evaluateInitialSnapshotTerminalOutcome({ branchId: f.branchId, documentId: documents[0]!,
            deletedDocuments: [{ documentId: documents[0]!, statusType: "070" }, { documentId: documents[1]!, statusType }],
        })).toBe(true);
        expect(await f.readState()).toMatchObject({ lastErrorCode: statusType === "003"
            ? "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED" : "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
    });
    it("U1 evaluator rejects a wrong branch or a chunk from a non-current revision", async () => {
        const f = await initialChunks();
        await f.purge(1, false);
        expect(await initialLifecycle().evaluateInitialSnapshotTerminalOutcome({ branchId: branches[1]!, documentId: documents[0]! })).toBe(false);
        await db.service_record_case.update({ where: { id: f.record.id }, data: { currentRevisionId: null } });
        expect(await initialLifecycle().evaluateInitialSnapshotTerminalOutcome({ branchId: f.branchId, documentId: documents[0]! })).toBe(false);
        expect(await f.readState()).toMatchObject({ status: "processing" });
    });
    it("U1 post-commit staff deletion before documents_created is caught within promotion's transaction", async () => {
        const f = await initialChunks({ dispatchAuthorized: true });
        const stateBeforePurge = await f.readState(), caseBeforePurge = await f.readCase();
        expect(await f.purge(2)).toBe(false);
        expect(await f.readState()).toEqual(stateBeforePurge);
        expect(await f.readCase()).toEqual(caseBeforePurge);
        const repo = new ServiceRecordEditRepository(db as unknown as PrismaService);
        expect(await repo.recordInitialFinalizationDocumentsCreated({ branchId: f.branchId, clientId: clients[0]!,
            serviceRecordCaseId: f.record.id, revisionId: f.revisionId, revisionNumber: 1, documentStateId: f.state.id,
            generation: f.state.generation, documentVersion: 3, chunkCount: 2, documentIds: documents.slice(0, 2) })).toBe(true);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
        expect(await f.readCase()).toMatchObject({ status: "FINALIZATION_FAILED" });
    });
    it("U1 concurrent webhook transition and staff purge/evaluation finish without 40P01 or lock inversion", async () => {
        const f = await initialChunks();
        await db.eformsign_doc.update({ where: { documentId: documents[1]! }, data: { statusType: "031" } });
        const held = deferred<void>(), release = deferred<void>(), purged = deferred<void>();
        const webhook = transaction(a, async tx => {
            await tx.$queryRaw`SELECT id FROM service_record_case WHERE id = ${f.record.id}::uuid FOR UPDATE`;
            held.resolve();
            await bounded(release.promise, 9000);
            return initialLifecycle(a).failInitialServiceRecordSnapshotInTransaction({ branchId: f.branchId, documentId: documents[1]! }, tx);
        });
        void webhook.catch(() => undefined);
        let deletion: Promise<boolean> | undefined;
        try {
            await bounded(held.promise, 5000);
            deletion = (async () => {
                const mirror = new SbEformsignDocumentMirrorRepository(b as unknown as PrismaService);
                await mirror.requestPermanentPurge([documents[0]!]);
                await mirror.purgeContent([documents[0]!], new Date());
                purged.resolve();
                return initialLifecycle(b).evaluateInitialSnapshotTerminalOutcome({ branchId: f.branchId,
                    documentId: documents[0]!, deletedDocuments: [{ documentId: documents[0]!, statusType: "070" }] });
            })();
            void deletion.catch(() => undefined);
            // Purge must commit even while webhook owns the case lock; evaluation waits afterwards.
            await bounded(purged.promise, 5000);
        } finally {
            release.resolve();
            await Promise.allSettled([webhook, ...(deletion ? [deletion] : [])]);
        }
        const results = await Promise.allSettled([webhook, deletion!]);
        expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
    });

    async function cancelledProviderRuntime(linked = true) {
        const f = await initialChunks({ unlinked: true });
        await completeInitialSource(f);
        const assignment = await db.service_record_assignment.findFirstOrThrow({ where: { serviceRecordCaseId: f.record.id } });
        const input = initialProviderRecoveryInput({ branchId: f.branchId, clientId: f.state.clientId, caseId: f.record.id,
            revisionId: f.revisionId, stateId: f.state.id, generation: f.state.generation });
        // Use real FK targets created in this owned PG cluster, never guessed ids.
        const immutable = input.immutablePayload as { sessions: Array<{ scheduleId: number; employeeId: number }> };
        for (const session of immutable.sessions) { session.scheduleId = assignment.scheduleId!; session.employeeId = assignment.employeeId!; }
        input.payloadFingerprint = sha256CanonicalJson(input.immutablePayload);
        input.businessFingerprint = input.payloadFingerprint;
        const settledAt = new Date(Date.now() - 11 * 60 * 1000);
        await db.service_record_case.update({ where: { id: f.record.id }, data: { status: "READY_TO_FINALIZE" } });
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: {
            status: "processing", step: "dispatch_authorized", lastErrorCode: null,
            immutableInput: input.immutablePayload as Prisma.InputJsonObject, inputFingerprint: input.payloadFingerprint,
        } });
        await db.service_record_snapshot_chunk.updateMany({ where: { serviceRecordCaseId: f.record.id }, data: { sourceHash: input.payloadFingerprint } });
        if (!linked) await db.service_record_snapshot_chunk.updateMany({ where: { serviceRecordCaseId: f.record.id, chunkIndex: 1 },
            data: { status: "CREATE_REQUESTED", eformsignDocumentId: null } });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { status: "failed", leaseToken: null,
            activeKey: `service-record-initial-finalization:${f.record.id}`, lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED",
            payloadFingerprint: input.payloadFingerprint,
            payload: { ...input, kind: "service_record_revision", context: { ...input } } as unknown as Prisma.InputJsonObject,
        } });
        // Exercise production's raw now() cancellation, then age only its timestamps.
        // Force nonzero microseconds so this regression never depends on clock luck.
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "cancelled" });
        expect(await f.readJob()).toMatchObject({ status: "failed", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH",
            activeKey: `service-record-initial-finalization:${f.record.id}`, documentId: null });
        await db.$executeRaw`UPDATE service_record_revision_document_state
            SET updated_at = date_trunc('milliseconds', updated_at - interval '11 minutes') + interval '321 microseconds'
            WHERE id = ${f.state.id}::uuid`;
        await db.$executeRaw`UPDATE eformsign_document_job
            SET updated_at = date_trunc('milliseconds', updated_at - interval '11 minutes') + interval '321 microseconds'
            WHERE id = ${f.job.id}::uuid`;
        const [precision] = await db.$queryRaw<Array<{ submillisecond: boolean }>>`SELECT
            updated_at <> date_trunc('milliseconds', updated_at) AS submillisecond
            FROM eformsign_document_job WHERE id = ${f.job.id}::uuid`;
        expect(precision?.submillisecond).toBe(true);
        const remote = (index: number) => normalizeEformsignDocumentResponse({ id: documents[index - 1]!,
            created_date: settledAt.getTime(), updated_date: Date.now(), template: { id: "synthetic-template" },
            document_name: `QA-frozen-customer (${index}/2) [SR-${f.record.id.slice(0, 8)}-r1-v3]`, creator: { name: "synthetic" },
            current_status: { status_type: "070", step_type: "06", step_index: "2" } });
        const listed = [remote(1), remote(2)];
        // The scheduled backfill mirrors this document before recovery can link it.
        await db.eformsign_doc.update({ where: { documentId: documents[1]! }, data: {
            branchId: null, statusType: "070", updatedDate: new Date(listed[1]!.updated_date),
        } });
        const emptyPage = async (_token: string, limit: number, skip: number) => providerDocumentPage([], limit, skip);
        const client = {
            getInProgressDocumentsPage: async (_token: string, limit: number, skip: number) => providerDocumentPage(listed, limit, skip),
            getCompletedDocumentsPage: emptyPage,
            getRejectedDocumentsPage: emptyPage,
            getDocument: async (_token: string, id: string) => listed.find(doc => doc.id === id)!,
        };
        const credentials = { withCredentials: async (_principal: unknown, _capability: unknown,
            callback: (credentials: { accessToken: string }) => Promise<unknown>) => callback({ accessToken: "synthetic" }) };
        const snapshots = new CreateAndSendServiceRecordSnapshotUsecase(client as never, db as unknown as PrismaService, credentials as never, {} as never);
        const recovery = new ServiceRecordInitialProviderRecoveryService(db as unknown as PrismaService, client as never,
            credentials as never, snapshots, new ServiceRecordEditRepository(db as unknown as PrismaService));
        const run = () => recovery.reconcile({ branchId: f.branchId });
        const read = async () => ({ state: await f.readState(), record: await f.readCase(), job: await f.readJob(),
            chunks: await db.service_record_snapshot_chunk.findMany({ where: { serviceRecordCaseId: f.record.id }, orderBy: { chunkIndex: "asc" } }),
            docs: await db.eformsign_doc.findMany({ where: { documentId: { in: documents.slice(0, 2) } }, orderBy: { documentId: "asc" } }) });
        return { ...f, run, read, listed, snapshots, client, credentials };
    }
    it.each([false, true])("U4 real post-dispatch cancellation with sub-ms precision recovers all matched (first already linked: %s)", async linked => {
        const f = await cancelledProviderRuntime(linked);
        await db.client.update({ where: { id: f.state.clientId }, data: { name: "QA-renamed-after-dispatch" } });
        expect(await f.run()).toBe(1);
        expect(await f.readState()).toMatchObject({ status: "processing", step: "documents_created" });
        expect(await f.readCase()).toMatchObject({ status: "DOCUMENTS_CREATED", currentUsableRevisionId: null });
        expect(await f.readJob()).toMatchObject({ status: "completed", activeKey: null, documentId: documents[0] });
        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: documents[1]! } })).toMatchObject({
            serviceRecordCaseId: f.record.id, revisionId: f.revisionId, snapshotVersion: 3, snapshotChunkIndex: 2, customerName: "QA-mom",
        });
        const before = await f.read(); expect(await f.run()).toBe(0); expect(await f.read()).toEqual(before);
    });
    it("U4 filters 105 older ineligible cancellations before selecting the newer recoverable job", async () => {
        const f = await cancelledProviderRuntime();
        const job = await f.readJob();
        const historical = Array.from({ length: 105 }, (_, index) => {
            const requestKey = `service-record-initial-finalization:${f.revisionId}:${randomUUID()}`;
            return { branchId: f.branchId, clientId: job.clientId, requestKey, jobType: "create_document", source: "auto_finalize",
                status: "failed", progressStep: "sent", progressDetail: "sent", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH",
                updatedAt: new Date(job.updatedAt.getTime() - 120000 - index), payloadFingerprint: job.payloadFingerprint,
                payload: { ...job.payload as Prisma.InputJsonObject, snapshotReference: requestKey } };
        });
        await db.eformsign_document_job.createMany({ data: historical });
        const lookup = jest.spyOn(f.client, "getInProgressDocumentsPage");
        expect(await f.run()).toBe(1);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(await f.readJob()).toMatchObject({ status: "completed", activeKey: null });
        expect(await db.eformsign_document_job.count({ where: { requestKey: { in: historical.map(row => row.requestKey) },
            status: "failed", activeKey: null } })).toBe(historical.length);
    });
    it.each(["non-INITIAL", "released key", "newer generation", "moved revision", "no chunks"])("U4 excludes %s before provider lookup", async reason => {
        const f = await cancelledProviderRuntime();
        if (reason === "non-INITIAL") await db.$executeRaw`UPDATE eformsign_document_job
            SET payload = payload || '{"generationKind":"REVISION_SNAPSHOT"}'::jsonb WHERE id = ${f.job.id}::uuid`;
        if (reason === "released key") await db.$executeRaw`UPDATE eformsign_document_job
            SET active_key = NULL WHERE id = ${f.job.id}::uuid`;
        if (reason === "newer generation") await db.service_record_revision_document_state.create({ data: {
            branchId: f.branchId, clientId: f.state.clientId, serviceRecordCaseId: f.record.id, revisionId: f.revisionId,
            operation: "record_snapshot", generation: randomUUID(), immutableInput: {}, inputFingerprint: "a".repeat(64),
            documentVersion: 4, status: "completed", workflowScope: f.state.workflowScope ?? {},
            createdAt: new Date(Date.now() + 1000),
        } });
        if (reason === "moved revision") await db.service_record_case.update({ where: { id: f.record.id }, data: { currentRevisionId: null } });
        if (reason === "no chunks") await db.service_record_snapshot_chunk.deleteMany({ where: { serviceRecordCaseId: f.record.id } });
        const lookup = jest.spyOn(f.client, "getInProgressDocumentsPage");
        expect(await f.run()).toBe(0);
        expect(lookup).not.toHaveBeenCalled();
    });
    it.each(["timestamp", "lease", "progress", "payload", "attempts"])("U4 job %s changed during provider lookup prevents all recovery writes", async change => {
        const f = await cancelledProviderRuntime();
        let afterChange: Awaited<ReturnType<typeof f.read>> | undefined;
        const getDocument = f.client.getDocument;
        jest.spyOn(f.client, "getDocument").mockImplementationOnce(async (token, id) => {
            // Keep submillisecond precision, and isolate each job predicate from
            // the independent state/chunk guards. Never mutate a fixture CHECK.
            if (change === "timestamp") await db.$executeRaw`UPDATE eformsign_document_job
                SET updated_at = updated_at + interval '1 millisecond' WHERE id = ${f.job.id}::uuid`;
            if (change === "lease") await db.$executeRaw`UPDATE eformsign_document_job
                SET lease_token = ${randomUUID()}::uuid WHERE id = ${f.job.id}::uuid`;
            if (change === "progress") await db.$executeRaw`UPDATE eformsign_document_job
                SET progress_step = 'creating' WHERE id = ${f.job.id}::uuid`;
            if (change === "payload") await db.$executeRaw`UPDATE eformsign_document_job
                SET payload = payload || '{"qaConcurrentChange":true}'::jsonb WHERE id = ${f.job.id}::uuid`;
            if (change === "attempts") await db.$executeRaw`UPDATE eformsign_document_job
                SET attempts = attempts + 1 WHERE id = ${f.job.id}::uuid`;
            afterChange = await f.read();
            return getDocument(token, id);
        });
        expect(await f.run()).toBe(0);
        expect(afterChange).toBeDefined();
        expect(await f.read()).toEqual(afterChange);
    });
    it.each(["none", "partial", "ambiguous"])("U4 %s evidence cannot prove absence: transaction/key unchanged and regenerate stays blocked", async evidence => {
        const f = await cancelledProviderRuntime(false);
        if (evidence === "none") f.listed.splice(0);
        else if (evidence === "partial") f.listed.splice(1);
        else f.listed.push({ ...f.listed[1]!, id: "synthetic-duplicate" });
        const before = await f.read();
        expect(await f.run()).toBe(0); expect(await f.read()).toEqual(before);
        await expect(initialFinalizer(f).regenerateInitialFinalization(f.branchId, {
            revisionId: f.revisionId, documentStateId: f.state.id, expectedGeneration: f.state.generation,
        })).rejects.toMatchObject({ status: 409 });
        expect(await f.read()).toEqual(before);
    });
    it("U4 a failed second link rolls back the first link and job completion in real PG", async () => {
        const f = await cancelledProviderRuntime(false), before = await f.read();
        const persist = f.snapshots.persistCancelledInitialRemoteDocument.bind(f.snapshots);
        let firstLink: string | null | undefined;
        jest.spyOn(f.snapshots, "persistCancelledInitialRemoteDocument").mockImplementation(async (...args) => {
            if (args[3] === 2) throw new Error("synthetic second link failure");
            await persist(...args);
            const chunk = await args[0].service_record_snapshot_chunk.findUniqueOrThrow({ where: { id: args[2] } });
            firstLink = chunk.eformsignDocumentId;
        });
        expect(await f.run()).toBe(0);
        expect(firstLink).toBe(documents[0]);
        expect(await f.read()).toEqual(before);
    });
    it("U4 N9-1 completed chunk deleted before provider recovery stays COMPLETED_DOCUMENT_DELETED and not ready", async () => {
        const f = await cancelledProviderRuntime();
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: { statusType: "003" } });
        expect(await f.purge(1)).toBe(true);
        const before = await f.read(); expect(await f.run()).toBe(0); expect(await f.read()).toEqual(before);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED" });
        expect(await readinessOf(f)).toMatchObject({ ready: false });
    });
    it("U4 R3-1 delete before lookup with an unproven sibling stays manual_review; later linking preserves unknown-deletion safety", async () => {
        const f = await cancelledProviderRuntime();
        expect(await f.purge(1)).toBe(false);
        const second = f.listed.pop()!;
        const before = await f.read(); expect(await f.run()).toBe(0); expect(await f.read()).toEqual(before);
        f.listed.push(second);
        expect(await f.run()).toBe(1);
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
        expect(await readinessOf(f)).toMatchObject({ ready: false });
    });

    async function terminalInitial(regenerationSource = false) {
        const f = await initialChunks({ regenerationSource });
        await db.eformsign_doc.updateMany({ where: { documentId: { in: documents.slice(0, 2) } }, data: { statusType: "011" } });
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: {
            status: "failed", step: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED",
        } });
        await db.service_record_case.update({ where: { id: f.record.id }, data: {
            status: "FINALIZATION_FAILED", nextAttemptAt: null, lastError: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED",
        } });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: {
            activeKey: `service-record-initial-finalization:${f.record.id}`, status: "requires_attention", leaseToken: null,
        } });
        return f;
    }
    const readinessOf = (f: Awaited<ReturnType<typeof initialChunks>>) => transaction(db, tx =>
        initialRegenerationReadiness(tx, f.record.id, f.revisionId));

    it.each([
        ["003", "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED", "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED"],
        ["absent", "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN", "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN"],
        ["070", "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED", null],
    ])("U7 evaluates a deferred staff purge when the vendor reports %s", async (vendorStatus, stateCode, reason) => {
        const f = await initialChunks();
        const documentId = documents[0]!;
        const mirrorRepository = new SbEformsignDocumentMirrorRepository(db as unknown as PrismaService);
        await f.purge(2);
        expect(await readinessOf(f)).toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS" });
        await mirrorRepository.requestPermanentPurge([documentId]);

        const credentials = { withCredentials: async (_principal: unknown, _capability: unknown,
            run: (value: { accessToken: string }) => Promise<unknown>) => run({ accessToken: "synthetic" }) };
        const list = async () => providerDocumentPage([], 100, 0);
        const vendor = {
            getInProgressDocumentsPage: list, getCompletedDocumentsPage: list, getRejectedDocumentsPage: list,
            getDocument: async () => {
                if (vendorStatus === "absent") throw new EformsignApiError("missing", 404);
                return { id: documentId, updated_date: 1, current_status: { status_type: vendorStatus } };
            },
        };
        const mirror = {
            findActiveDocumentIds: async () => [],
            findPermanentPurgeRequestedDocumentIds: async () => [documentId],
            syncDocumentWithToken: async () => undefined,
            requestPermanentPurge: (ids: string[]) => mirrorRepository.requestPermanentPurge(ids),
            purgeDocuments: async (ids: string[]) => {
                await mirrorRepository.purgeContent(ids, new Date());
                expect(await readinessOf(f)).toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
            },
        };
        const eformsign = { cancelDocuments: async () => ({ result: vendorStatus === "070" ? { success_result: [documentId] }
            : { fail_result: [{ document_id: documentId, code: "4000031" }] } }) };
        const sweep = new BackfillEformsignDocsUsecase(vendor as never, credentials as never, {} as never, {} as never,
            mirror as never, eformsign as never, initialLifecycle());
        await expect(sweep.execute({}, createEformsignWorkerPrincipal(f.branchId))).resolves.toMatchObject({ failed: 0 });
        expect(await f.readState()).toMatchObject({ status: "failed", lastErrorCode: stateCode });
        expect(await readinessOf(f)).toMatchObject(reason === null ? { ready: true } : { ready: false, reason });
        expect((await f.repo.getSummary(f.branchId)).initialRegenerations).toEqual([
            expect.objectContaining({ stateId: f.state.id, ready: reason === null, reasonCode: reason }),
        ]);
    });

    it("U7 heals a failed INITIAL whose sibling purge committed without an evaluator record", async () => {
        const f = await initialChunks();
        await f.purge(2);
        await f.purge(1, false);
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: { statusType: " Doc_Delete " } });
        expect(await f.readState()).toMatchObject({ lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(0);
        expect(await f.readState()).toMatchObject({ lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: {
            updatedDate: new Date(Date.now() - INITIAL_PROVIDER_SETTLE_MS - 1000),
        } });
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(1);
        expect(await f.readState()).toMatchObject({ lastErrorCode: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" });
        expect(await initialLifecycle().healInitialSnapshotTerminalOutcomes({ branchId: f.branchId })).toBe(0);
    });

    const confirmPredicate = (f: Awaited<ReturnType<typeof initialChunks>>) => transaction(db, async tx => {
        await tx.$queryRaw`SELECT id FROM service_record_case WHERE id = ${f.record.id}::uuid FOR UPDATE`;
        await assertNoBlockingRevisionDocumentStates(tx, { branchId: f.branchId, clientId: f.state.clientId, serviceRecordCaseId: f.record.id });
    });
    async function confirmInitial(f: Awaited<ReturnType<typeof initialChunks>>) {
        const repository = new ServiceRecordEditRepository(db as unknown as PrismaService);
        const draft = await db.service_record_edit_draft.create({ data: { branchId: f.branchId, serviceRecordCaseId: f.record.id,
            createdByUserId: users[0]!, updatedByUserId: users[0]!, sourceCaseVersion: 0, sourceFingerprint: "a".repeat(64), sourceSnapshot: {} } });
        const result = await repository.confirmDraft({ branchId: f.branchId, draftId: draft.id, expectedDraftVersion: 1,
            previewId: `srp_${"a".repeat(64)}`, idempotencyKey: randomUUID(), requestFingerprint: "b".repeat(64), actorUserId: users[0]!,
            prepare: ({ source }) => ({ status: "confirmed", sourceFingerprint: "a".repeat(64), caseId: source.caseId,
                clientId: source.client.id, formVersion: source.formVersion, requiredSessionCount: source.requiredSessionCount,
                startDate: source.startDate, endDate: source.endDate, header: source.header,
                plannedSessions: source.plannedSessions, sessions: [], newSessions: [], assignments: [],
                revision: { branchId: f.branchId, serviceRecordCaseId: f.record.id, actorUserId: users[0]!,
                    payload: { plannedSessions: source.plannedSessions }, plannedSessions: source.plannedSessions ?? [],
                    provenance: {}, formVersionAtConfirm: 3 },
                dispatchContext: null, documentStatus: "waiting_for_completion", documentJob: null,
            }),
        });
        expect(result).toMatchObject({ status: "confirmed", revisionNumber: 2 });
        const revision = await db.service_record_revision.findUniqueOrThrow({ where: { id: result.revisionId! } });
        retainRevision(revision);
        return revision;
    }
    async function completeInitialSource(f: Pick<Awaited<ReturnType<typeof initialChunks>>, "branchId" | "record" | "state">) {
        const serviceDate = new Date("2026-09-01");
        const employee = await db.employee.create({ data: { name: "Synthetic PG provider", phone: data.caretaker1Contact, branchId: f.branchId, workArea: [], grade: "synthetic" } });
        employees.push(employee.id);
        const schedule = await db.employee_schedule.create({ data: { primaryEmployeeId: employee.id, clientId: f.state.clientId,
            branchId: f.branchId, workAddress: "synthetic", startDate: serviceDate, endDate: serviceDate, replaced: false } });
        const assignment = await db.service_record_assignment.create({ data: { branchId: f.branchId, serviceRecordCaseId: f.record.id,
            scheduleId: schedule.id, employeeId: employee.id, employeeNameSnapshot: employee.name, startDate: serviceDate, endDate: serviceDate } });
        const plannedSessions = [{ sessionIndex: 1, serviceDate: "2026-09-01", originalDate: "2026-09-01",
            assignmentId: assignment.id, scheduleId: schedule.id, employeeId: employee.id, provenanceVersion: "revision-2" }];
        await db.service_record_case.update({ where: { id: f.record.id }, data: { requiredSessionCount: 1, plannedSessions,
            startDate: serviceDate, endDate: serviceDate, momName: "Synthetic", momBirth: "900101", babyName: "Synthetic",
            babyBirth: "260101", deliveryType: "synthetic", babyWeight: "3.2" } });
        await db.client.update({ where: { id: f.state.clientId }, data: { startDate: serviceDate, endDate: serviceDate, serviceStatus: "active" } });
        await db.service_record_day.create({ data: { branchId: f.branchId, serviceRecordCaseId: f.record.id, scheduleId: schedule.id,
            caseSessionIndex: 1, sessionIndex: 1, employeeId: employee.id, employeeNameSnapshot: employee.name, serviceDate,
            formVersion: 3, answers: { checked: true }, paymentConfirmed: true, momApproval: "approved", clientSignature: "synthetic",
            clientSignedAt: serviceDate, submittedAt: serviceDate, locked: true } });
    }
    function initialFinalizer(f: Pick<Awaited<ReturnType<typeof initialChunks>>, "repo">, connection = db) {
        const jobs = { findByRequestKeyInTransaction: f.repo.findByRequestKeyInTransaction.bind(f.repo),
            enqueueInTransaction: f.repo.enqueueInTransaction.bind(f.repo) } as unknown as EformsignDocumentJobService;
        const calendar = { forBranch: async () => KR_BUILTIN_CALENDAR } as unknown as HolidayCalendarService;
        return new ServiceRecordFinalizationService(connection as unknown as PrismaService,
            new ServiceRecordLifecycleService(connection as unknown as PrismaService, calendar), {} as never, calendar, jobs,
            new ServiceRecordEditRepository(connection as unknown as PrismaService));
    }
    async function freezeAfterConfirm(f: Awaited<ReturnType<typeof initialChunks>>, revisionId: string) {
        const finalizer = initialFinalizer(f);
        const referenceDate = new Date();
        const readJobs = () => db.eformsign_document_job.findMany({
            where: { branchId: f.branchId, source: "auto_finalize", jobType: "create_document" },
        });
        await expect(finalizer.processDueCases(referenceDate)).resolves.toBe(0);
        const jobsForRevision = (await readJobs()).filter(job => isInitialFinalizationRequestKeyFor(revisionId, job.requestKey));
        expect(jobsForRevision).toMatchObject([{
            branchId: f.branchId,
            status: "queued",
            activeKey: `service-record-initial-finalization:${f.record.id}`,
            payload: { generationKind: "INITIAL_FINALIZATION", revisionId },
        }]);
        await expect(finalizer.processDueCases(referenceDate)).resolves.toBe(0);
        const all = await readJobs();
        expect(all).toHaveLength(2);
        expect(all.filter(job => job.status === "queued").map(job => job.id)).toEqual([jobsForRevision[0]!.id]);
    }
    async function regenerationReady() {
        const f = await terminalInitial(true);
        await completeInitialSource(f);
        return { ...f, request: { revisionId: f.revisionId, documentStateId: f.state.id, expectedGeneration: f.state.generation } };
    }
    function noDocumentRequest(f: Pick<Awaited<ReturnType<typeof initialChunks>>, "state">) {
        return { branchId: f.state.branchId, revisionId: f.state.revisionId, documentStateId: f.state.id,
            expectedGeneration: f.state.generation, actorUserId: users[0]! };
    }

    async function ageCancelledInitial(jobId: string, stateId: string) {
        await db.$executeRaw`UPDATE service_record_revision_document_state
            SET updated_at = date_trunc('milliseconds', now() - interval '11 minutes') + interval '321 microseconds'
            WHERE id = ${stateId}::uuid`;
        await db.$executeRaw`UPDATE eformsign_document_job
            SET updated_at = date_trunc('milliseconds', now() - interval '11 minutes') + interval '321 microseconds'
            WHERE id = ${jobId}::uuid`;
    }

    it("U4e attests NO_PROVIDER_DOCUMENT for clean unlinked chunks and releases the case key", async () => {
        const f = await cancelledProviderRuntime(false);
        f.listed.splice(0);
        await db.eformsign_doc.update({ where: { documentId: documents[0]! }, data: {
            revisionId: null, serviceRecordCaseId: null, clientId: null, documentKind: null,
            snapshotVersion: null, snapshotChunkIndex: null,
        } });
        const service = new ServiceRecordInitialNoProviderDocumentService(db as unknown as PrismaService, f.client as never, f.credentials as never);
        const result = await service.confirmInitialNoProviderDocument(noDocumentRequest(f));
        expect(result).toMatchObject({ status: "failed", reasonCode: "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT",
            outputProof: { actorUserId: users[0], outcome: "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT", unlinkedChunkIndexes: [1, 2] } });
        expect(await f.readState()).toMatchObject({ outputProof: result.outputProof });
        expect(await f.readCase()).toMatchObject({ status: "FINALIZATION_FAILED", lastError: "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT" });
        expect(await f.readJob()).toMatchObject({ status: "failed", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH", activeKey: null });
        expect(await readinessOf(f)).toMatchObject({ ready: true });
    });

    it("U4e attests PARTIAL_DISPATCH but fences the live linked sibling", async () => {
        const f = await cancelledProviderRuntime();
        f.listed.splice(1);
        const linkedId = documents[0]!;
        const projection = { stateId: f.state.id, revisionId: f.revisionId, generation: f.state.generation,
            suffix: `[SR-${f.record.id.slice(0, 8)}-r1-v3]`, unlinkedChunkOrdinals: ["(2/2)"] };
        // A linked mirror is excluded even when its title carries the suffix.
        await db.eformsign_doc.update({ where: { documentId: linkedId }, data: { documentName: `QA-linked ${projection.suffix}` } });
        expect((await f.repo.getSummary(f.branchId)).noProviderDocumentConfirmable).toEqual([projection]);
        expect((await f.repo.listForBranch(f.branchId, new Date(0))).noProviderDocumentConfirmable).toEqual([projection]);
        const history = await new ServiceRecordEditRepository(db as unknown as PrismaService).listRevisionHistory(f.branchId, f.state.clientId);
        expect(history?.revisions[0]?.documents[0]?.noProviderDocumentConfirmable).toEqual(projection);
        const service = new ServiceRecordInitialNoProviderDocumentService(db as unknown as PrismaService, f.client as never, f.credentials as never);
        await expect(service.confirmInitialNoProviderDocument(noDocumentRequest(f))).resolves.toMatchObject({
            reasonCode: "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH",
            outputProof: { unlinkedChunkIndexes: [2], vendorCheck: { totals: { "01": 1, "03": 0, "04": 0 } } },
        });
        expect(await f.readJob()).toMatchObject({ activeKey: `service-record-initial-finalization:${f.record.id}` });
        expect(await readinessOf(f)).toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS" });
    });

    it("U4e refuses after a provider match without changing persisted rows", async () => {
        const f = await cancelledProviderRuntime();
        const before = await f.read();
        const service = new ServiceRecordInitialNoProviderDocumentService(db as unknown as PrismaService, f.client as never, f.credentials as never);
        await expect(service.confirmInitialNoProviderDocument(noDocumentRequest(f))).rejects.toMatchObject({
            status: 409, response: { reason: NO_DOC_REASON.PROVIDER_DOCUMENT_FOUND },
        });
        expect(await f.read()).toEqual(before);
    });

    it("U4e renderer throw before chunk preparation → cancel → attest → U3b regenerate and replay", async () => {
        const runtime = await initialRuntime("queued", "PRE_SEND_RETRY_EXHAUSTED", "queued",
            { plannedSessions: [{ sessionIndex: 1, originalDate: "2026-09-01" }] });
        const f = { ...runtime, branchId: runtime.state.branchId, revisionId: runtime.state.revisionId };
        await completeInitialSource(f);
        const frozen = initialProviderRecoveryInput({ branchId: f.branchId, clientId: f.state.clientId,
            caseId: f.record.id, revisionId: f.revisionId, stateId: f.state.id, generation: f.state.generation }, 1);
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: {
            immutableInput: frozen.immutablePayload as Prisma.InputJsonObject, inputFingerprint: frozen.payloadFingerprint,
        } });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: {
            payload: { ...frozen, kind: "service_record_revision", context: { ...frozen } } as unknown as Prisma.InputJsonObject,
            payloadFingerprint: frozen.payloadFingerprint, activeKey: `service-record-initial-finalization:${f.record.id}`, nextAttemptAt: new Date(0),
        } });
        const claim = (await f.repo.claimDue(1)).find(job => job.id === f.job.id)!;
        expect(await f.repo.authorizeForDispatch({ jobId: claim.id, leaseToken: claim.leaseToken!,
            expectedContext: claim.payload!["context"] as ServiceRecordRevisionDispatchContext })).toMatchObject({ kind: "allow" });
        const list = async () => providerDocumentPage([], 100, 0);
        const vendor = { getInProgressDocumentsPage: list, getCompletedDocumentsPage: list, getRejectedDocumentsPage: list, createDocument: jest.fn() };
        const credentials = { withCredentials: async (_principal: unknown, _capability: unknown,
            run: (value: { accessToken: string }) => Promise<unknown>) => run({ accessToken: "synthetic" }) };
        const failBeforePreparation = { get: () => { throw new Error("SYNTHETIC_RENDERER_FAILURE"); } };
        const renderer = new CreateAndSendServiceRecordSnapshotUsecase(vendor as never, db as unknown as PrismaService,
            credentials as never, failBeforePreparation as never);
        await expect(renderer.executeRevision(frozen, createEformsignWorkerPrincipal(f.branchId))).rejects.toThrow("SYNTHETIC_RENDERER_FAILURE");
        expect(vendor.createDocument).not.toHaveBeenCalled();
        expect(await db.service_record_snapshot_chunk.count({ where: { revisionId: f.revisionId } })).toBe(0);
        expect(await f.repo.markRequiresAttention(claim.id, claim.leaseToken!, "SERVICE_RECORD_REVISION_MANUAL_REVIEW")).toMatchObject({
            status: "requires_attention", progressStep: "dispatch_authorized", leaseToken: null,
        });
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "cancelled" });
        await ageCancelledInitial(f.job.id, f.state.id);
        const request = noDocumentRequest(f);
        expect((await f.repo.getSummary(f.branchId)).noProviderDocumentConfirmable).toEqual([{
            stateId: request.documentStateId, revisionId: request.revisionId, generation: request.expectedGeneration,
            suffix: `[SR-${f.record.id.slice(0, 8)}-r1-v3]`, unlinkedChunkOrdinals: [],
        }]);
        const service = new ServiceRecordInitialNoProviderDocumentService(db as unknown as PrismaService, vendor as never, credentials as never);
        const applied = await service.confirmInitialNoProviderDocument(request);
        expect(applied).toMatchObject({ reasonCode: "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT" });
        const regenerated = await initialFinalizer(f).regenerateInitialFinalization(f.branchId, request);
        expect(regenerated).toMatchObject({ status: "queued", state: { documentVersion: 4 } });
        expect(regenerated.state.generation).not.toBe(f.state.generation);
        expect(await service.confirmInitialNoProviderDocument({ ...request, actorUserId: users[1]! })).toEqual(applied);
    });

    it("U3b gen2 dispatch -> documents_created promotion -> completion reaches DOCUMENTS_CREATED and COMPLETED", async () => {
        const f = await regenerationReady(), finalizer = initialFinalizer(f);
        // Main production dead end: the INITIAL job completed and now has document_id.
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: {
            status: "completed", documentId: documents[0]!, activeKey: null,
        } });
        const beforeList = await f.repo.listForBranch(f.branchId, new Date(0));
        const beforeSummary = await f.repo.getSummary(f.branchId);
        const projection = { stateId: f.state.id, revisionId: f.revisionId, generation: f.state.generation,
            clientId: f.state.clientId, ready: true, reasonCode: null };
        expect(beforeList.initialRegenerations).toEqual([projection]);
        expect(beforeSummary.initialRegenerations).toEqual(beforeList.initialRegenerations);
        const history = await new ServiceRecordEditRepository(db as unknown as PrismaService).listRevisionHistory(f.branchId, f.state.clientId);
        expect(history?.revisions[0]?.documents.find(state => state.id === f.state.id)?.canRetry).toBe(true);
        const result = await finalizer.regenerateInitialFinalization(f.branchId, f.request);
        expect(result.state.documentVersion).toBe(4);
        expect(await f.readCase()).toMatchObject({ status: "FINALIZATION_FAILED", nextAttemptAt: null });
        const title = CreateAndSendServiceRecordSnapshotUsecase.prototype as unknown as {
            revisionDocumentName: (name: string, caseId: string, revision: number, version: number, index: number, count: number) => string;
        };
        const gen1Title = title.revisionDocumentName("Synthetic authority PG", f.record.id, 1, 3, 1, 1);
        const gen2Title = title.revisionDocumentName("Synthetic authority PG", f.record.id, 1, 4, 1, 1);
        expect(gen2Title).not.toBe(gen1Title);
        expect(gen2Title).toContain(`-r1-v4]`);
        await db.eformsign_document_job.update({ where: { id: result.jobId }, data: { nextAttemptAt: new Date(0) } });
        const claimed = (await f.repo.claimDue(1)).find(job => job.id === result.jobId)!;
        expect(claimed?.leaseToken).toEqual(expect.any(String));
        expect(await f.repo.authorizeForDispatch({ jobId: result.jobId, leaseToken: claimed.leaseToken!,
            expectedContext: claimed.payload!["context"] as ServiceRecordRevisionDispatchContext })).toMatchObject({ kind: "allow" });
        const documentId = randomUUID(), version = new Date("2026-09-01T00:00:00Z");
        documents.push(documentId);
        const provider = {
            getTemplateReviewer: jest.fn().mockResolvedValue({ name: "Synthetic reviewer", id: "reviewer@example.com" }),
            createDocument: jest.fn().mockResolvedValue({ documentId, status: "pending" }),
            findDocumentsByTitle: jest.fn().mockResolvedValue([]),
        };
        const credentials = { withCredentials: jest.fn(async (_principal: unknown, _capability: unknown,
            operation: (value: { accessToken: string; refreshToken: string }) => Promise<unknown>) =>
            operation({ accessToken: "synthetic", refreshToken: "synthetic" })) };
        const renderer = new CreateAndSendServiceRecordSnapshotUsecase(provider as never,
            db as unknown as PrismaService, credentials as never,
            { get: (key: string) => key === "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID" ? "synthetic-template" : undefined } as never,
            new ServiceRecordEditRepository(db as unknown as PrismaService));
        // Consume the claimed frozen envelope, with the worker's post-authorization sync status.
        const { context, ...generationInput } = claimed.payload as unknown as
            Omit<ServiceRecordRevisionGenerationInput, keyof ServiceRecordRevisionDispatchContext>
            & { context: ServiceRecordRevisionDispatchContext };
        expect(generationInput.snapshotReference).toBe(`service-record-initial-finalization:${f.revisionId}:${result.state.generation}`);
        expect(claimed.requestKey).toBe(generationInput.snapshotReference);
        expect(await renderer.executeRevision({ ...context, ...generationInput, documentSyncStatus: "pending" },
            createEformsignWorkerPrincipal(f.branchId))).toEqual({ documentIds: [documentId], documentVersion: 4, chunkCount: 1 });
        expect(provider.createDocument).toHaveBeenCalledTimes(1);
        expect(provider.createDocument).toHaveBeenCalledWith("synthetic", expect.objectContaining({
            documentName: gen2Title, idempotencyKey: `service-record-revision:${result.state.generation}:v4:c1`,
        }));
        const doc = await db.eformsign_doc.findUniqueOrThrow({ where: { documentId } });
        expect(doc).toMatchObject({ revisionId: f.revisionId, snapshotVersion: 4, statusType: "070" });
        expect(await db.service_record_snapshot_chunk.findMany({ where: { revisionId: f.revisionId, snapshotVersion: 4 } }))
            .toEqual([expect.objectContaining({ status: "CREATED", eformsignDocumentId: documentId })]);
        expect(await db.service_record_revision_document_state.findUniqueOrThrow({ where: { id: result.state.id } }))
            .toMatchObject({ status: "processing", step: "documents_created" });
        expect(await f.readCase()).toMatchObject({ status: "DOCUMENTS_CREATED" });
        expect(await f.repo.markCompleted(result.jobId, claimed.leaseToken!, documentId)).toMatchObject({ status: "completed" });
        await db.eformsign_doc.update({ where: { documentId }, data: { statusType: "003", syncStatus: "ready",
            detailPayload: { id: documentId }, detailSourceUpdatedDate: version, detailSyncedAt: version } });
        for (const fileType of ["document", "audit_trail"]) await db.eformsign_doc_file.create({ data: {
            eformsignDocId: doc.id, fileType, content: Buffer.from("synthetic"), contentType: "application/pdf",
            byteSize: 9, sha256: digest("synthetic"), sourceUpdatedDate: version,
        } });
        expect(await initialLifecycle().completeServiceRecordSnapshotIfReady({ branchId: f.branchId, documentId })).toBe(true);
        expect(await f.readCase()).toMatchObject({ status: "COMPLETED", currentUsableRevisionId: f.revisionId, currentUsableDocumentVersion: 4 });
        expect(await db.service_record_revision_document_state.findUniqueOrThrow({ where: { id: result.state.id } })).toMatchObject({ status: "completed" });
        expect(await f.readState()).toMatchObject({ status: "failed" });
    });
    it("U3b concurrent regeneration and double replay create exactly one new generation/job", async () => {
        const f = await regenerationReady();
        const [first, second] = await Promise.all([
            initialFinalizer(f, a).regenerateInitialFinalization(f.branchId, f.request),
            initialFinalizer(f, b).regenerateInitialFinalization(f.branchId, f.request),
        ]);
        expect(second.jobId).toBe(first.jobId); expect(second.state.id).toBe(first.state.id);
        const finalizer = initialFinalizer(f);
        expect((await finalizer.regenerateInitialFinalization(f.branchId, f.request)).jobId).toBe(first.jobId);
        expect((await finalizer.regenerateInitialFinalization(f.branchId, f.request)).jobId).toBe(first.jobId);
        expect(await db.eformsign_document_job.count({ where: { branchId: f.branchId, source: "auto_finalize" } })).toBe(2);
        expect(await db.service_record_revision_document_state.count({ where: { revisionId: f.revisionId } })).toBe(2);
    });
    it("U3b scheduler claim after regeneration validates each key and leaves jobs/state/case unchanged", async () => {
        const f = await regenerationReady(), finalizer = initialFinalizer(f);
        await finalizer.regenerateInitialFinalization(f.branchId, f.request);
        // Complete source and a nonzero counter distinguish freeze from the
        // incomplete-source short circuit, which always returns attempts: 0.
        await db.service_record_case.update({ where: { id: f.record.id }, data: { finalizationAttempts: 7 } });
        const read = async () => ({
            jobs: await db.eformsign_document_job.findMany({ where: { branchId: f.branchId, source: "auto_finalize" }, orderBy: { id: "asc" } }),
            states: await db.service_record_revision_document_state.findMany({ where: { revisionId: f.revisionId }, orderBy: { id: "asc" } }),
            record: await f.readCase(),
        });
        const before = await read();
        expect(before.jobs).toHaveLength(2);
        // Invoke the real claim directly: FINALIZATION_FAILED/NULL is not a due
        // candidate, and processDueCases catches claim errors instead of throwing.
        const scheduler = finalizer as unknown as {
            claimFinalizationCase: (id: string, branchId: string, reference: Date) => Promise<unknown>;
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            await expect(scheduler.claimFinalizationCase(f.record.id, f.branchId, new Date())).resolves.toEqual({
                claimed: false, attempts: before.record.finalizationAttempts, blockedGeneration: true,
            });
            expect(await read()).toEqual(before);
        }
    });
    it.each(["stale-revision", "not-newest", "active-key-collision"])("U3b %s returns 409 and rolls back", async kind => {
        const f = await regenerationReady();
        if (kind === "stale-revision") await db.service_record_case.update({ where: { id: f.record.id }, data: { currentRevisionId: null } });
        if (kind === "not-newest") await db.service_record_revision_document_state.create({ data: {
            branchId: f.branchId, clientId: f.state.clientId, serviceRecordCaseId: f.record.id, revisionId: f.revisionId,
            operation: "record_snapshot", generation: randomUUID(), immutableInput: {}, inputFingerprint: "a".repeat(64),
            documentVersion: 4, status: "completed", workflowScope: f.state.workflowScope ?? {},
        } });
        if (kind === "active-key-collision") {
            await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { activeKey: null } });
            await db.eformsign_document_job.create({ data: { branchId: f.branchId, clientId: f.state.clientId, jobType: "create_document",
                source: "staff", requestKey: randomUUID(), activeKey: `service-record-initial-finalization:${f.record.id}`, status: "failed" } });
        }
        const before = { state: await f.readState(), job: await f.readJob(), record: await f.readCase(),
            states: await db.service_record_revision_document_state.count({ where: { revisionId: f.revisionId } }),
            jobs: await db.eformsign_document_job.count({ where: { branchId: f.branchId } }) };
        const code = kind === "stale-revision" ? "SERVICE_RECORD_INITIAL_REVISION_CHANGED"
            : kind === "not-newest" ? "SERVICE_RECORD_INITIAL_GENERATION_CHANGED" : "SERVICE_RECORD_INITIAL_ACTIVE_KEY_CONFLICT";
        await expect(initialFinalizer(f).regenerateInitialFinalization(f.branchId, f.request)).rejects.toMatchObject({ status: 409, response: { code } });
        expect({ state: await f.readState(), job: await f.readJob(), record: await f.readCase(),
            states: await db.service_record_revision_document_state.count({ where: { revisionId: f.revisionId } }),
            jobs: await db.eformsign_document_job.count({ where: { branchId: f.branchId } }) }).toEqual(before);
    });
    it.each([["070", "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"], ["003", "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED"]])(
        "U3b sibling %s blocks regeneration and list/summary/admin projections", async (statusType, code) => {
            const f = await regenerationReady();
            await db.eformsign_doc.update({ where: { documentId: documents[1]! }, data: { statusType } });
            await expect(initialFinalizer(f).regenerateInitialFinalization(f.branchId, f.request)).rejects.toMatchObject({ status: 409, response: { code } });
            const list = await f.repo.listForBranch(f.branchId, new Date(0)), summary = await f.repo.getSummary(f.branchId);
            expect(list.initialRegenerations).toEqual([{ stateId: f.state.id, revisionId: f.revisionId, generation: f.state.generation,
                clientId: f.state.clientId, ready: false, reasonCode: code }]);
            expect(summary.initialRegenerations).toEqual(list.initialRegenerations);
            const history = await new ServiceRecordEditRepository(db as unknown as PrismaService).listRevisionHistory(f.branchId, f.state.clientId);
            expect(history?.revisions[0]?.documents.find(state => state.id === f.state.id)?.canRetry).toBe(false);
        });

    it.each(["pre-deploy", "completed-job"])("U2 confirm after reject creates a second INITIAL on a new revision (%s)", async shape => {
        const f = await terminalInitial();
        await completeInitialSource(f);
        if (shape === "completed-job") await db.eformsign_document_job.update({ where: { id: f.job.id }, data: {
            status: "completed", documentId: documents[0]!, activeKey: null,
        } });
        const revision = await confirmInitial(f);
        expect(revision.id).not.toBe(f.revisionId);
        expect(await f.readJob()).toMatchObject({ status: shape === "completed-job" ? "completed" : "failed", activeKey: null });
        await freezeAfterConfirm(f, revision.id);
    });
    it.each(["070", "003"])("U2 live/completed sibling %s blocks confirm with its independent reason", async statusType => {
        const f = await terminalInitial();
        await db.eformsign_doc.update({ where: { documentId: documents[1]! }, data: { statusType } });
        const reason = statusType === "003" ? "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED" : "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS";
        expect(await readinessOf(f)).toMatchObject({ ready: false, reason });
        await expect(confirmInitial(f)).rejects.toMatchObject({ lastErrorCode: reason });
        expect(await f.readJob()).toMatchObject({ activeKey: `service-record-initial-finalization:${f.record.id}`, status: "requires_attention" });
        expect(await f.readCase()).toMatchObject({ currentRevisionId: f.revisionId, nextAttemptAt: null });
    });
    it.each(["completed", "processing"])("U2 gen1 failed + gen2 %s judges only gen2 and keeps gen1 as history", async status => {
        const f = await terminalInitial();
        await db.service_record_revision_document_state.create({ data: { branchId: f.branchId, clientId: f.state.clientId,
            serviceRecordCaseId: f.record.id, revisionId: f.revisionId, operation: "record_snapshot", generation: randomUUID(),
            documentVersion: 4, immutableInput: {}, inputFingerprint: "a".repeat(64), status,
            step: status === "completed" ? "completed" : "dispatch_authorized", workflowScope: f.state.workflowScope ?? {} } });
        if (status === "completed") await expect(confirmInitial(f)).resolves.toMatchObject({ revisionNumber: 2 });
        else await expect(confirmInitial(f)).rejects.toMatchObject({ operation: "record_snapshot", status: "processing" });
        const summary = await f.repo.getSummary(f.branchId), list = await f.repo.listForBranch(f.branchId, new Date(0));
        expect(summary).toMatchObject({ requiresAttentionCount: 0, unresolvedCount: 0, unresolvedJobIds: [] });
        expect(list.requiresAttention.some(job => job.id === f.job.id)).toBe(false);
        expect(list.recent.find(job => job.id === f.job.id)).toMatchObject({ retryable: false, cancellable: false });
        expect(await f.repo.retry(f.input)).toMatchObject({ kind: "not_retryable" });
        expect(await f.repo.cancel(f.input)).toMatchObject({ kind: "not_cancellable" });
    });
    it("U2 an old usable pointer cannot complete a superseded INITIAL generation", async () => {
        const f = await initialChunks();
        const version = new Date("2026-09-01T00:00:00Z");
        for (const documentId of documents.slice(0, 2)) {
            const doc = await db.eformsign_doc.update({ where: { documentId }, data: { statusType: "003", syncStatus: "ready",
                detailPayload: { id: documentId }, detailSourceUpdatedDate: version, detailSyncedAt: version } });
            for (const fileType of ["document", "audit_trail"]) await db.eformsign_doc_file.create({ data: {
                eformsignDocId: doc.id, fileType, content: Buffer.from("synthetic"), contentType: "application/pdf",
                byteSize: 9, sha256: digest("synthetic"), sourceUpdatedDate: version,
            } });
        }
        await db.service_record_case.update({ where: { id: f.record.id }, data: {
            currentUsableRevisionId: f.revisionId, currentUsableDocumentVersion: 3,
        } });
        await db.service_record_revision_document_state.create({ data: { branchId: f.branchId, clientId: f.state.clientId,
            serviceRecordCaseId: f.record.id, revisionId: f.revisionId, operation: "record_snapshot", generation: randomUUID(),
            documentVersion: 4, immutableInput: {}, inputFingerprint: "a".repeat(64), status: "processing", step: "documents_created",
            workflowScope: f.state.workflowScope ?? {} } });
        expect(await initialLifecycle().completeServiceRecordSnapshotIfReady({ branchId: f.branchId, documentId: documents[0]! })).toBe(false);
        expect(await f.readCase()).toMatchObject({ status: "DOCUMENTS_CREATED", currentUsableDocumentVersion: 3 });
        expect(await f.readState()).toMatchObject({ status: "processing" });
    });
    it("U2 post-dispatch cancel then staff delete of all linked chunks unblocks confirm and scheduler", async () => {
        const f = await initialChunks({ dispatchAuthorized: true });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { activeKey: `service-record-initial-finalization:${f.record.id}` } });
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "cancelled" });
        await f.purge(1); await f.purge(2);
        expect(await readinessOf(f)).toMatchObject({ ready: true });
        await completeInitialSource(f);
        const revision = await confirmInitial(f);
        expect(await f.readJob()).toMatchObject({ status: "failed", activeKey: null, lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        await freezeAfterConfirm(f, revision.id);
    });
    it("U2 all siblings rejected unblocks and lazy release is idempotent", async () => {
        const f = await terminalInitial();
        expect(await readinessOf(f)).toMatchObject({ ready: true });
        await confirmPredicate(f); await confirmPredicate(f);
        expect(await f.readJob()).toMatchObject({ status: "failed", activeKey: null });
        expect(await f.readCase()).toMatchObject({ currentRevisionId: f.revisionId, nextAttemptAt: null });
    });
    it.each(["JOB_CANCELLED_AFTER_DISPATCH", "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED"])("U2 non-terminal %s still blocks", async lastErrorCode => {
        const f = await terminalInitial();
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: {
            status: lastErrorCode === "JOB_CANCELLED_AFTER_DISPATCH" ? "manual_review" : "failed", lastErrorCode,
        } });
        await expect(confirmPredicate(f)).rejects.toMatchObject({ lastErrorCode });
        expect(await f.readJob()).toMatchObject({ status: "requires_attention", activeKey: `service-record-initial-finalization:${f.record.id}` });
    });
    it("U2 a leased INITIAL is not ready and its key survives lazy release", async () => {
        const f = await terminalInitial(), leaseToken = randomUUID();
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { leaseToken } });
        expect(await transaction(db, tx => releaseTerminalInitialFinalizationKey(tx, f.record.id, f.revisionId)))
            .toMatchObject({ ready: false, reason: "SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS" });
        await expect(confirmPredicate(f)).rejects.toMatchObject({ lastErrorCode: "SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS" });
        expect(await f.readJob()).toMatchObject({ leaseToken, activeKey: `service-record-initial-finalization:${f.record.id}` });
    });

    it("keeps an older actionable INITIAL job reachable behind 51 newer report-only INITIAL jobs", async () => {
        const f = await initialRuntime();
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: {
            completedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"),
        } });
        await db.eformsign_document_job.createMany({ data: Array.from({ length: 51 }, () => {
            const revisionId = randomUUID(), requestKey = `service-record-initial-finalization:${revisionId}`;
            return { branchId: f.input.branchId, clientId: clients[0]!, source: "auto_finalize", jobType: "create_document",
                requestKey, payloadFingerprint: f.job.payloadFingerprint,
                payload: { ...f.payload, revisionId, snapshotReference: requestKey,
                    context: { ...f.payload.context, revisionId }, documentStateId: randomUUID() },
                status: "failed", progressStep: "sent", completedAt: new Date("2026-02-01"), createdAt: new Date("2026-02-01") };
        }) });
        const summary = await f.repo.getSummary(f.input.branchId);
        const list = await f.repo.listForBranch(f.input.branchId, new Date(0));
        expect(summary).toMatchObject({ requiresAttentionCount: 52, unresolvedCount: 1, unresolvedJobIds: [f.job.id] });
        expect(list.requiresAttention).toHaveLength(50);
        expect(list.requiresAttention[0]).toMatchObject({ id: f.job.id, retryable: true, cancellable: true });
        expect(summary.unresolvedJobIds.every(id => list.requiresAttention.some(job => job.id === id))).toBe(true);
        expect(list.requiresAttention.slice(1).every(job => !job.retryable && !job.cancellable)).toBe(true);
    });
    it("matches uppercase documentStateId in SQL listing/summary and the UUID retry verifier", async () => {
        const f = await initialRuntime();
        // Use alphabetic digits deterministically; randomly generated UUIDs need not contain any.
        const id = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { id } });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { payload: {
            ...f.payload, documentStateId: id.toUpperCase(),
        } } });
        expect(await f.repo.getSummary(f.input.branchId)).toMatchObject({ unresolvedCount: 1, unresolvedJobIds: [f.job.id] });
        expect((await f.repo.listForBranch(f.input.branchId, new Date(0))).requiresAttention[0])
            .toMatchObject({ id: f.job.id, retryable: true, cancellable: true });
        expect(await f.repo.retry(f.input)).toMatchObject({ kind: "retried" });
    });
    it.each(["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "PRE_SEND_RETRY_EXHAUSTED"])("INITIAL %s retry is CAS protected and branch scoped", async code => {
        const f = await initialRuntime("preparing", code, "requires_attention");
        expect(await f.repo.retry({ ...f.input, branchId: branches[1]! })).toEqual({ kind: "not_found" });
        const other = new SbEformsignDocumentJobRepository(b as unknown as PrismaService);
        const results = await Promise.all([f.repo.retry(f.input), other.retry(f.input)]);
        expect(results.filter(result => result.kind === "retried")).toHaveLength(1);
        expect(results.filter(result => result.kind === "not_retryable")).toHaveLength(1);
        expect(await f.readJob()).toMatchObject({ status: "queued", attempts: 0, createdByUserId: null });
        expect(await f.readState()).toMatchObject({ status: "pending", step: "requeued", attempts: 1 });
    });
    it.each(["dispatch_authorized", "creating", "sent"])("INITIAL %s refuses retry, preserves evidence when cancelled, and leaves all buckets", async step => {
        const f = await initialRuntime(step);
        expect(await f.repo.retry(f.input)).toEqual({ kind: "not_retryable" });
        const listed = await f.repo.listForBranch(f.input.branchId, new Date(0));
        expect(listed.requiresAttention.find(job => job.id === f.job.id)).toMatchObject({ retryable: false, cancellable: true });
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "cancelled" });
        expect(await f.readJob()).toMatchObject({ status: "failed", progressStep: step, progressDetail: f.job.progressDetail,
            payload: f.payload, activeKey: f.job.activeKey, lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        expect(await f.readState()).toMatchObject({ status: "manual_review", step: "unknown" });
        const adminBefore = await f.readState();
        expect(await new ServiceRecordEditRepository(db as unknown as PrismaService).retryRevisionDocumentState({
            branchId: f.input.branchId, clientId: f.state.clientId, revisionId: f.state.revisionId,
            stateId: f.state.id, expectedGeneration: f.state.generation,
        })).toMatchObject({ status: "manual_review", step: "unknown" });
        expect(await f.readState()).toEqual(adminBefore);
        expect(await f.repo.retry(f.input)).toEqual({ kind: "not_retryable" });
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "already_cancelled" });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { completedAt: new Date("2020-01-01") } });
        await f.repo.deleteExpiredTerminal(new Date());
        expect((await f.readJob()).payload).toEqual(f.payload);
        const summary = await f.repo.getSummary(f.input.branchId);
        expect(summary).toMatchObject({ requiresAttentionCount: 0, unresolvedCount: 0, unresolvedJobIds: [] });
        const after = await f.repo.listForBranch(f.input.branchId, new Date(0));
        expect([...after.requiresAttention, ...after.recent, ...after.active].some(job => job.id === f.job.id)).toBe(false);
        // Its case-wide key remains a deliberate fence even for a different INITIAL request key.
        await expect(db.eformsign_document_job.create({ data: { branchId: f.input.branchId, clientId: f.job.clientId,
            jobType: "create_document", source: "auto_finalize", requestKey: randomUUID(), activeKey: f.job.activeKey } })).rejects.toMatchObject({ code: "P2002" });
    });
    it.each(["pending", "capability_unverified"])("pre-dispatch INITIAL cancellation fails %s state, keeps payload across retention and releases only its key", async status => {
        const f = await initialRuntime();
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { status } });
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "cancelled" });
        expect(await f.readJob()).toMatchObject({ status: "failed", progressStep: "cancelled", payload: f.payload, activeKey: null });
        expect(await f.readState()).toMatchObject({ status: "failed", step: "unknown", lastErrorCode: f.state.lastErrorCode });
        const admin = new ServiceRecordEditRepository(db as unknown as PrismaService);
        expect((await admin.listRevisionHistory(f.input.branchId, f.state.clientId))?.revisions[0]?.documents[0])
            .toMatchObject({ status: "failed", canRetry: false });
        expect(await admin.retryRevisionDocumentState({
            branchId: f.input.branchId, clientId: f.state.clientId, revisionId: f.state.revisionId,
            stateId: f.state.id, expectedGeneration: f.state.generation,
        })).toMatchObject({ status: "failed", step: "unknown" });
        expect(await f.readState()).toMatchObject({ status: "failed", step: "unknown" });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { completedAt: new Date("2020-01-01") } });
        await f.repo.deleteExpiredTerminal(new Date());
        expect((await f.readJob()).payload).toEqual(f.payload);
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "already_cancelled" });
        expect(await f.repo.retry(f.input)).toEqual({ kind: "not_retryable" });
    });
    it.each(["completed", "not_required", "failed", "manual_review", "unknown",
        "waiting_for_completion", "waiting_for_signature"])("INITIAL cancel preserves %s state and projects cancellable false", async status => {
        const f = await initialRuntime("sent");
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { status } });
        const beforeJob = await f.readJob(), beforeState = await f.readState();
        expect((await f.repo.listForBranch(f.input.branchId, new Date(0))).requiresAttention.find(job => job.id === f.job.id))
            .toMatchObject({ retryable: false, cancellable: false });
        expect(await f.repo.cancel(f.input)).toMatchObject({ kind: "not_cancellable" });
        expect(await f.readJob()).toEqual(beforeJob);
        expect(await f.readState()).toEqual(beforeState);
        expect(await f.repo.getSummary(f.input.branchId)).toMatchObject({ requiresAttentionCount: 1, unresolvedCount: 0, unresolvedJobIds: [] });
    });
    it.each(["capability_unverified", "pending", "processing"])("INITIAL post-dispatch cancel accepts unresolved %s state in API and listing", async status => {
        const f = await initialRuntime("sent");
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { status } });
        expect((await f.repo.listForBranch(f.input.branchId, new Date(0))).requiresAttention.find(job => job.id === f.job.id))
            .toMatchObject({ retryable: false, cancellable: true });
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "cancelled" });
        expect(await f.readState()).toMatchObject({ status: "manual_review", step: "unknown" });
    });
    it("INITIAL preparing with processing state preserves evidence and active key on cancel", async () => {
        const f = await initialRuntime();
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { status: "processing" } });
        expect(await f.repo.cancel(f.input)).toEqual({ kind: "cancelled" });
        expect(await f.readJob()).toMatchObject({ progressStep: "preparing", progressDetail: null,
            payload: f.payload, activeKey: f.job.activeKey, lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        expect(await f.readState()).toMatchObject({ status: "manual_review", step: "unknown" });
    });
    it.each(["generation", "revisionId"])("INITIAL cancel preserves a later state with changed %s and projects cancellable false", async field => {
        const f = await initialRuntime("sent");
        if (field === "generation") {
            await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { generation: randomUUID() } });
        } else {
            const revision = await db.service_record_revision.create({ data: { branchId: f.input.branchId,
                serviceRecordCaseId: f.record.id, revisionNumber: 2, confirmedByUserId: users[0]!,
                payload: {}, plannedSessions: [], provenance: {}, formVersionAtConfirm: 3 } });
            retainRevision(revision);
            await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { revisionId: revision.id } });
        }
        const beforeJob = await f.readJob(), beforeState = await f.readState();
        expect((await f.repo.listForBranch(f.input.branchId, new Date(0))).requiresAttention.find(job => job.id === f.job.id))
            .toMatchObject({ retryable: false, cancellable: false });
        expect(await f.repo.cancel(f.input)).toMatchObject({ kind: "not_cancellable" });
        expect(await f.readJob()).toEqual(beforeJob);
        expect(await f.readState()).toEqual(beforeState);
    });
    it.each(["invalid", "branch", "client"])("INITIAL %s context refuses retry and listing flags and popup counts", async variant => {
        const f = await initialRuntime();
        const context = { ...f.payload.context, ...(variant === "invalid" ? { formVersion: 0 }
            : variant === "branch" ? { branchId: branches[1]! } : { clientId: clients[1]! }) };
        await db.eformsign_document_job.update({ where: { id: f.job.id },
            data: { payload: { ...f.payload, context } } });
        const beforeJob = await f.readJob();
        expect(await f.repo.retry(f.input)).toEqual({ kind: "not_retryable" });
        expect(await f.readJob()).toEqual(beforeJob);
        expect(await f.readState()).toEqual(f.state);
        expect((await f.repo.listForBranch(f.input.branchId, new Date(0))).requiresAttention.find(job => job.id === f.job.id))
            .toMatchObject({ retryable: false, cancellable: false });
        expect(await f.repo.getSummary(f.input.branchId)).toMatchObject({ requiresAttentionCount: 1, unresolvedCount: 0, unresolvedJobIds: [] });
    });
    it.each(["queued", "processing", "reconciling", "leased"])("INITIAL %s cannot be cancelled", async status => {
        const f = await initialRuntime("preparing", "PRE_SEND_RETRY_EXHAUSTED", status === "leased" ? "failed" : status);
        if (status === "leased") await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { leaseToken: randomUUID() } });
        const before = await f.readJob();
        expect(await f.repo.cancel(f.input)).toMatchObject({ kind: "not_cancellable" });
        expect(await f.readJob()).toEqual(before);
        expect(await f.readState()).toEqual(f.state);
    });
    it("INITIAL SQL identity matches the TS predicate and the script candidate guard", async () => {
        const f = await initialRuntime();
        const variants = [{}, { source: "staff" }, { jobType: "finalize_document" }, { requestKey: "service-record-other" },
            { payload: { ...f.payload, revisionId: 1 } }, { payload: { ...f.payload, context: {} } },
            { payload: { ...f.payload, snapshotReference: "wrong" } }, { payload: { ...f.payload, generationKind: "OTHER" } },
            { payload: { ...f.payload, kind: "contract" } }];
        for (const variant of variants) {
            const job = { ...f.job, ...variant };
            await db.eformsign_document_job.update({ where: { id: f.job.id }, data: {
                source: job.source, jobType: job.jobType, requestKey: job.requestKey, payload: job.payload as Prisma.InputJsonValue } });
            const [row] = await db.$queryRaw<Array<{ identity: boolean; eligible: boolean }>>(Prisma.sql`
                SELECT ${initialFinalizationJobSql("j")} AS identity, ${initialFinalizationRetryCandidateSql("j")} AS eligible
                FROM eformsign_document_job j WHERE id = ${f.job.id}::uuid`);
            expect(row?.identity).toBe(isInitialFinalizationJobIdentity(job));
            expect(row?.eligible).toBe(isInitialFinalizationJobIdentity(job));
        }
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { source: f.job.source, jobType: f.job.jobType,
            requestKey: f.job.requestKey, payload: f.payload } });
        for (const status of ["failed", "requires_attention", "queued"]) {
            for (const code of ["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "PRE_SEND_RETRY_EXHAUSTED", "UNRELATED"]) {
                for (const step of ["preparing", "dispatch_authorized"]) {
                    await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { status, lastErrorCode: code, progressStep: step } });
                    const candidates = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                        SELECT id FROM eformsign_document_job WHERE id = ${f.job.id}::uuid AND ${initialFinalizationRetryCandidateSql()}`);
                    expect(candidates.length).toBe(status !== "queued" && code !== "UNRELATED" && step === "preparing" ? 1 : 0);
                }
            }
        }
    });
    it("INITIAL listing computes verifier-backed flags and counts older failures", async () => {
        const f = await initialRuntime();
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { completedAt: new Date("2020-01-01") } });
        const listed = await f.repo.listForBranch(f.input.branchId, new Date(0));
        expect(listed.requiresAttention.find(job => job.id === f.job.id)).toMatchObject({ retryable: true, cancellable: true });
        expect(listed.recent.some(job => job.id === f.job.id)).toBe(false);
        expect(await f.repo.getSummary(f.input.branchId)).toMatchObject({ requiresAttentionCount: 1, unresolvedCount: 1, unresolvedJobIds: [f.job.id] });
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { status: "processing" } });
        expect((await f.repo.listForBranch(f.input.branchId, new Date(0))).requiresAttention.find(job => job.id === f.job.id)).toMatchObject({ retryable: false, cancellable: true });
        expect(await f.repo.getSummary(f.input.branchId)).toMatchObject({ unresolvedCount: 1, unresolvedJobIds: [f.job.id] });
        await db.service_record_revision_document_state.update({ where: { id: f.state.id }, data: { status: "manual_review" } });
        await db.eformsign_document_job.update({ where: { id: f.job.id }, data: { status: "requires_attention" } });
        expect((await f.repo.listForBranch(f.input.branchId, new Date(0))).requiresAttention.find(job => job.id === f.job.id))
            .toMatchObject({ retryable: false, cancellable: false });
        expect(await f.repo.getSummary(f.input.branchId)).toMatchObject({ requiresAttentionCount: 1, unresolvedCount: 0, unresolvedJobIds: [] });
    });
    it("INITIAL retry waits on the client before locking the job or revision state", async () => {
        const f = await initialRuntime(), ready = deferred<void>(), release = deferred<void>();
        const [connection] = await b.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        const holder = transaction(a, async tx => {
            await tx.$queryRaw`SELECT id FROM client WHERE id = ${f.job.clientId} FOR UPDATE`;
            ready.resolve(); await bounded(release.promise, 9000);
        });
        void holder.catch(() => undefined);
        let retry: Promise<unknown> | undefined;
        try {
            await bounded(ready.promise, 5000);
            retry = new SbEformsignDocumentJobRepository(b as unknown as PrismaService).retry(f.input);
            void retry.catch(() => undefined);
            await lockObserved(connection!.pid);
            await transaction(db, async tx => {
                await tx.$queryRaw`SELECT id FROM eformsign_document_job WHERE id = ${f.job.id}::uuid FOR UPDATE NOWAIT`;
                await tx.$queryRaw`SELECT id FROM service_record_revision_document_state WHERE id = ${f.state.id}::uuid FOR UPDATE NOWAIT`;
            });
        } finally { release.resolve(); await holder; }
        expect(await retry).toMatchObject({ kind: "retried" });
    });

});
