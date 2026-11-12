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
    const transaction = <T>(connection: PrismaClient, callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        connection.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`;
            return callback(tx);
        }, { maxWait: 5000, timeout: 15000 });
    const counts = () => db.$queryRaw`SELECT jsonb_build_object(
        'branches',(SELECT count(*) FROM branch),'users',(SELECT count(*) FROM "user"),
        'clients',(SELECT count(*) FROM client),'documents',(SELECT count(*) FROM eformsign_doc),
        'jobs',(SELECT count(*) FROM eformsign_document_job),'intents',(SELECT count(*) FROM eformsign_dispatch_intent),
        'employees',(SELECT count(*) FROM employee),'schedules',(SELECT count(*) FROM employee_schedule),
        'authorities',(SELECT count(*) FROM eformsign_contract_authority)) AS counts`;
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
    async function runtime(index = 0) {
        // Only provider/config JSON is controlled; both repositories and every SQL operation are real.
        const options = { resolveEffectiveTemplateId: (id?: string) => id ?? workflowPlan.templateId,
            generateDocumentOptions: () => ({ company: { id: identity.companyId }, user: { id: identity.creatorId } }) } as unknown as EformsignService;
        const recovery = new SbEformsignContractRecoveryRepository(db as unknown as PrismaService, options);
        const jobRepository = new SbEformsignDocumentJobRepository(db as unknown as PrismaService);
        const employee = await db.employee.create({ data: { name: "Synthetic PG provider", workArea: [], phone: data.caretaker1Contact, grade: "synthetic", branchId: branches[0]! } });
        employees.push(employee.id);
        const schedule = await db.employee_schedule.create({ data: { primaryEmployeeId: employee.id, clientId: clients[index]!, branchId: branches[0]!,
            workAddress: "synthetic", startDate: new Date("2026-11-01"), endDate: new Date("2026-11-10"), replaced: false } });
        const payload = { clientId: clients[index]!, contractData: data }, key = randomUUID();
        const enqueue = { branchId: branches[0]!, clientId: clients[index]!, jobType: "create_document" as const, source: "staff" as const,
            requestKey: `runtime-request-${key}`, activeKey: `runtime-active-${key}`, payload, payloadFingerprint: digest(canonical(payload)), createdByUserId: users[0]! };
        const queued = await jobRepository.enqueue(enqueue), leaseToken = randomUUID();
        await db.eformsign_document_job.update({ where: { id: queued.job.id }, data: { status: "processing", leaseToken } });
        const contractData = ((await db.eformsign_document_job.findUniqueOrThrow({ where: { id: queued.job.id } })).payload as { contractData: typeof data }).contractData;
        const worker = { jobId: queued.job.id, leaseToken, contractGeneration: queued.job.contractGeneration! };
        const input = { branchId: branches[0]!, clientId: clients[index]!, action: "create" as const, generation: "initial", localDocumentId: null,
            assignmentId: schedule.id, templateId: null, businessKey: digest([branches[0], clients[index], "-", schedule.id, "-", "create", "initial"].join("|")),
            fingerprint: digest(JSON.stringify({ contractData, generation: "initial" })) };
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
        // Transactions really commit; remove every fixture explicitly in FK order, including partial setup.
        try {
            await db.eformsign_contract_authority.deleteMany({ where: { branchId: { in: branches } } });
            await db.eformsign_document_job.deleteMany({ where: { branchId: { in: branches } } });
            await db.eformsign_dispatch_intent.deleteMany({ where: { branchId: { in: branches } } });
            await db.client.updateMany({ where: { branchId: { in: branches } }, data: { eDocId: null } });
            await db.eformsign_doc.deleteMany({ where: { documentId: { in: documents } } });
            await db.employee_schedule.deleteMany({ where: { branchId: { in: branches } } });
            await db.client.deleteMany({ where: { branchId: { in: branches } } });
            await db.employee.deleteMany({ where: { id: { in: employees } } });
            await db.user.deleteMany({ where: { id: { in: users } } });
            await db.branch.deleteMany({ where: { id: { in: branches } } });
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
    it.each([false, true])("P13 replaces pre-send exhaustion with purged payload=%s and removes stale popup entries", async purged => {
        const s = await exhaustedRuntime();
        if (purged) await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { payload: Prisma.DbNull } });
        const replay = await s.jobRepository.enqueue(s.enqueue);
        expect(replay.existing).toBe(true); expect(replay.job.contractGeneration).toBe(s.worker.contractGeneration);
        const next = await s.jobRepository.enqueue(nextInput(s));
        expect(next.job.contractGeneration).not.toBe(s.worker.contractGeneration);
        const old = await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } });
        expect(old).toMatchObject({ status: "failed", lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED", progressStep: "superseded" });
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
        }
        await db.eformsign_contract_authority.update({ where: { branchId_clientId: { branchId: branches[0]!, clientId: clients[0]! } }, data: { claimExpiresAt: new Date(0) } });
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
        await db.eformsign_doc.update({ where: { documentId: document }, data: { customerName: "Stored", customerPhone: "stored-phone", stepRecipientName: "Stored", stepRecipientSms: "stored-sms" } });
        await db.eformsign_document_job.update({ where: { id: s.worker.jobId }, data: { payload: Prisma.DbNull, completedAt: new Date(Date.now() - 8 * 86400000) } });
        const opened = await s.recovery.open(s.worker.jobId, branches[0]!, users[0]!);
        expect(opened.payload).toEqual({}); expect(opened.verificationOnly).toMatchObject({ documentId: document, templateId: workflowPlan.templateId });
        await s.recovery.completeManual({ ...f.claim, claimEpoch: opened.claimEpoch }, evidence(document, true));
        expect(await db.eformsign_document_job.findUniqueOrThrow({ where: { id: s.worker.jobId } })).toMatchObject({ status: "completed", payload: null });
        expect(await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: document } })).toMatchObject({ customerName: "Stored", customerPhone: "stored-phone", stepRecipientName: "Stored", stepRecipientSms: "stored-sms" });
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

});
