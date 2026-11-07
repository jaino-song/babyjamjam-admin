import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { prepareManualBackupSelection } from "application/utils/manual-backup-selection";
import type { ManualBackupLeaseIdentity, ManualBackupRunRecord } from "domain/eformsign-backup/manual-backup-run";

/** No SQL, connection or fixture exists until all independent target fences pass. */
function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"], enabled = process.env["HOLIDAY_REVIEW_REAL_DB"]): URL {
    try {
        if (enabled !== "1" || !databaseUrl || databaseUrl !== directUrl) throw new Error();
        const url = new URL(databaseUrl);
        if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "63241"
            || url.username !== "backup_test_owner" || url.pathname !== "/backup_exec_throwaway_20261106" || url.search || url.hash) throw new Error();
        return url;
    } catch { throw new Error("Refusing manual-backup delivery DB target"); }
}
function psqlEnvironment(url: URL, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...inherited, PGHOST: url.hostname, PGHOSTADDR: url.hostname, PGPORT: url.port, PGUSER: url.username,
        PGDATABASE: url.pathname.slice(1), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: "disable",
        PGSERVICE: undefined, PGSERVICEFILE: undefined, PGOPTIONS: "" };
}
describe("delivery independent target guard", () => {
    const good = "postgresql://backup_test_owner:synthetic@127.0.0.1:63241/backup_exec_throwaway_20261106";
    it("rejects changed routing, database, role, flags and direct URL before connection", () => {
        expect(assertTarget(good, good, "1").hostname).toBe("127.0.0.1");
        for (const bad of [good.replace("127.0.0.1", "localhost"), good.replace("63241", "5432"), good.replace("backup_test_owner", "app"),
            good.replace("backup_exec_throwaway_20261106", "backup_exec_throwaway_other"), good + "?hostaddr=192.0.2.1", good + "#x"]) {
            expect(() => assertTarget(bad, bad, "1")).toThrow("Refusing");
        }
        expect(() => assertTarget(good, good, "0")).toThrow("Refusing");
        expect(() => assertTarget(good, "other", "1")).toThrow("Refusing");
        expect(() => assertTarget(undefined, undefined, "0")).toThrow("Refusing");
    });
    it("pins both host settings and clears inherited service/options without SQL", () => {
        const inherited = Object.freeze({ PGHOST: "other", PGHOSTADDR: "192.0.2.1", PGSERVICE: "other", PGSERVICEFILE: "/other", PGOPTIONS: "-c role=other" });
        expect(psqlEnvironment(assertTarget(good, good, "1"), inherited)).toMatchObject({ PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1",
            PGPORT: "63241", PGUSER: "backup_test_owner", PGDATABASE: "backup_exec_throwaway_20261106", PGSERVICE: undefined, PGSERVICEFILE: undefined, PGOPTIONS: "" });
        expect(inherited.PGHOSTADDR).toBe("192.0.2.1");
    });
});
const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;
const FIXED = new Date("2026-11-01");
const HASH = "a".repeat(64);
const scope = { period: "all" as const, start: "", end: "", kind: "all" as const,
    contractStages: ["created", "sent", "opened", "signed", "reviewed", "completed"] as const,
    recordStages: ["created", "sent", "reviewed", "completed"] as const };

describeReal("manual delivery and atomic worker binding (real PostgreSQL 17, two connections)", () => {
    let db: PrismaClient; let second: PrismaClient; let repo: SbEformsignBackupRunRepository; let other: SbEformsignBackupRunRepository;
    let branch: string;
    const prefix = `manual-delivery-${randomUUID()}`; const companyId = `${prefix}-company`;
    const ids = [`${prefix}-a`, `${prefix}-b`];
    const identity = (run: ManualBackupRunRecord): ManualBackupLeaseIdentity => {
        if (!run.leaseToken) throw new Error("Synthetic lease missing");
        return { companyId, principalId: "verified-worker", runId: run.id, leaseToken: run.leaseToken };
    };
    const makeRepo = (client: PrismaClient) => new SbEformsignBackupRunRepository(client as unknown as PrismaService);
    const result = (documentId: string, tag = "one") => ({ documentId, outcome: { synthetic: tag } });
    const finishInput = (workerRunId = randomUUID()) => ({ status: "unverified" as const, workerRunId, reportHash: HASH,
        result: { report: { coverage: "unverified", backupComplete: false } } });
    async function queued(): Promise<ManualBackupRunRecord> {
        const prepared = prepareManualBackupSelection({ companyId, branchId: branch, scope,
            source: await repo.readSourceForRequest(branch), serviceRecordTemplateIds: new Set() });
        return (await repo.enqueue({ companyId, branchId: branch, requestedByUserId: null, requestKey: randomUUID(), requestHash: HASH, scope, ...prepared })).run;
    }
    async function claimed(): Promise<ManualBackupRunRecord> {
        await queued(); const run = await repo.claimNext(companyId, "verified-worker");
        if (!run) throw new Error("Synthetic claim missing"); return run;
    }
    async function expire(run: ManualBackupRunRecord): Promise<void> {
        await db.eformsign_backup_run.update({ where: { id: run.id }, data: { leaseExpiresAt: new Date("2000-01-01") } });
    }
    function deferred() {
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
    }
    async function waitForLock(): Promise<void> {
        const until = Date.now() + 3000;
        while (Date.now() < until) {
            const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`
                SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
                    AND usename = current_user AND pid <> pg_backend_pid() AND wait_event_type = 'Lock') AS waiting`;
            if (rows[0]?.waiting) return;
            await new Promise(done => setTimeout(done, 10));
        }
        throw new Error("Synthetic row lock was not observed");
    }
    beforeAll(async () => {
        const target = assertTarget();
        const checked = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align"], {
            input: "SELECT inet_server_addr(), inet_server_port(), current_user, current_setting('server_version_num')::int / 10000;",
            encoding: "utf8", env: psqlEnvironment(target, process.env),
        });
        expect(checked.status).toBe(0); expect(checked.stdout.trim()).toBe("127.0.0.1|63241|backup_test_owner|17");
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        db = new PrismaClient(); second = new PrismaClient(); await db.$connect(); await second.$connect();
        repo = makeRepo(db); other = makeRepo(second);
        branch = (await db.branch.create({ data: { name: "synthetic-delivery", slug: prefix } })).id;
    });
    beforeEach(async () => {
        for (const documentId of ids) await db.eformsign_doc.create({ data: { documentId, branchId: branch, documentKind: "contract",
            createdDate: FIXED, updatedDate: FIXED, statusType: "001", statusDetail: "", stepType: "", stepIndex: "", stepName: "",
            stepRecipientType: "", stepRecipientName: "", stepRecipientSms: "", expiredDate: FIXED, detailPayload: { synthetic: true } } });
    });
    afterEach(async () => {
        if (db && branch) {
            await db.eformsign_backup_run.deleteMany({ where: { branchId: branch, companyId } });
            await db.eformsign_doc.deleteMany({ where: { branchId: branch, documentId: { in: ids } } });
        }
    });
    afterAll(async () => {
        if (db) { if (branch) await db.branch.delete({ where: { id: branch } }); await db.$disconnect(); }
        if (second) await second.$disconnect(); jest.restoreAllMocks();
    });
    it("atomically binds only one worker across concurrent disjoint batches; loser writes zero and winner can finish", async () => {
        const run = await claimed(); const lease = identity(run); const a = randomUUID(); const b = randomUUID();
        const accepted = await Promise.all([repo.writeDocumentResults(lease, [result(ids[0]!)], a), other.writeDocumentResults(lease, [result(ids[1]!)], b)]);
        expect(accepted.filter(Boolean)).toHaveLength(1);
        const winner = accepted[0] ? a : b; const loser = accepted[0] ? b : a; const index = accepted[0] ? 0 : 1;
        const stored = await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } });
        expect(stored.workerRunId).toBe(winner);
        const docs = await db.eformsign_backup_run_document.findMany({ where: { runId: run.id }, orderBy: { ordinal: "asc" } });
        expect(docs[index]?.outcome).toEqual({ synthetic: "one" }); expect(docs[1 - index]?.outcome).toBeNull();
        expect(await other.writeDocumentResults(lease, [result(ids[1 - index]!)], loser)).toBe(false);
        expect(await repo.finish(lease, finishInput(loser))).toBe(false);
        expect(await repo.writeDocumentResults(lease, [result(ids[1 - index]!)], winner)).toBe(true);
        expect(await repo.finish(lease, finishInput(winner))).toBe(true);
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("unverified");
    });
    it("unknown-ID and conflicting-payload batches leave binding null and all other rows untouched", async () => {
        const run = await claimed(); const lease = identity(run);
        expect(await repo.writeDocumentResults(lease, [result(ids[0]!), result("unknown")], randomUUID())).toBe(false);
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).workerRunId).toBeNull();
        expect(await db.eformsign_backup_run_document.count({ where: { runId: run.id, outcome: { equals: Prisma.DbNull } } })).toBe(2);
        expect(await repo.writeDocumentResults(lease, [result(ids[0]!, "legacy")])).toBe(true);
        expect(await repo.writeDocumentResults(lease, [result(ids[0]!, "conflict"), result(ids[1]!)], randomUUID())).toBe(false);
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).workerRunId).toBeNull();
        expect(await db.eformsign_backup_run_document.count({ where: { runId: run.id, outcome: { equals: Prisma.DbNull } } })).toBe(1);
    });
    it("same worker replay is stable; missing or different worker argument cannot mutate a bound run", async () => {
        const run = await claimed(); const lease = identity(run); const workerRunId = randomUUID();
        expect(await repo.writeDocumentResults(lease, [result(ids[0]!)], workerRunId)).toBe(true);
        const before = await db.eformsign_backup_run_document.findMany({ where: { runId: run.id }, orderBy: { ordinal: "asc" } });
        expect(await other.writeDocumentResults(lease, [result(ids[0]!)], workerRunId)).toBe(true);
        expect(await other.writeDocumentResults(lease, [result(ids[1]!)])).toBe(false);
        expect(await other.writeDocumentResults(lease, [result(ids[1]!)], randomUUID())).toBe(false);
        expect(await db.eformsign_backup_run_document.findMany({ where: { runId: run.id }, orderBy: { ordinal: "asc" } })).toEqual(before);
    });
    it("expired and stale identity CAS cannot bind or write", async () => {
        const run = await claimed(); const lease = identity(run);
        for (const stale of [{ ...lease, principalId: "foreign" }, { ...lease, companyId: "foreign" }, { ...lease, leaseToken: randomUUID() }]) {
            expect(await other.writeDocumentResults(stale, [result(ids[0]!)], randomUUID())).toBe(false);
        }
        await expire(run);
        expect(await repo.writeDocumentResults(lease, [result(ids[0]!)], randomUUID())).toBe(false);
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).workerRunId).toBeNull();
        expect(await db.eformsign_backup_run_document.count({ where: { runId: run.id, outcome: { equals: Prisma.DbNull } } })).toBe(2);
    });
    it("final DB clock fence rolls back the new binding together with document results", async () => {
        const run = await claimed(); const lease = identity(run);
        const wrapped = new Proxy(db, { get(target, key) {
            if (key === "$transaction") return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => target.$transaction(tx => callback(new Proxy(tx, { get(inner, name) {
                if (name === "eformsign_backup_run_document") return new Proxy(inner.eformsign_backup_run_document, { get(model, method) {
                    if (method === "updateMany") return async (args: Prisma.eformsign_backup_run_documentUpdateManyArgs) => {
                        const value = await model.updateMany(args); await tx.$executeRaw`SELECT pg_sleep(0.8)`; return value;
                    };
                    return Reflect.get(model, method);
                } });
                return Reflect.get(inner, name);
            } })), options);
            const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        await db.$executeRaw`UPDATE public.eformsign_backup_run SET lease_expires_at = clock_timestamp() + interval '600 milliseconds' WHERE id = ${run.id}::uuid`;
        expect(await makeRepo(wrapped).writeDocumentResults(lease, [result(ids[0]!)], randomUUID())).toBe(false);
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).workerRunId).toBeNull();
        expect(await db.eformsign_backup_run_document.count({ where: { runId: run.id, outcome: { equals: Prisma.DbNull } } })).toBe(2);
    });
    it("returns exact fixed records with no source reads, renewals or state mutations", async () => {
        const run = await claimed(); const lease = identity(run);
        const before = await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } });
        await db.eformsign_doc.deleteMany({ where: { branchId: branch, documentId: { in: ids } } });
        expect(await repo.findClaimedDocument(lease, ids[0]!)).toMatchObject({ runId: run.id, branchId: branch, ordinal: 1, documentId: ids[0] });
        expect(await repo.findClaimedDocument(lease, "unknown")).toBeNull();
        expect(await repo.findForDelivery(lease)).toMatchObject({ id: run.id, leaseToken: lease.leaseToken });
        expect(await repo.listDeliveryDocuments(lease, 0, 1)).toMatchObject({ items: [{ ordinal: 1 }], hasMore: true });
        expect(await repo.listDeliveryDocuments(lease, 1, 1)).toMatchObject({ items: [{ ordinal: 2 }], hasMore: false });
        expect(await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).toEqual(before);
    });
    it("supports terminal same-lease delivery and identical finish ACK after deadline with no mutation", async () => {
        const run = await claimed(); const lease = identity(run); const input = finishInput();
        expect(await repo.writeDocumentResults(lease, ids.map(id => result(id)), input.workerRunId)).toBe(true);
        expect(await repo.finish(lease, input)).toBe(true); await expire(run);
        const before = await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } });
        expect(await repo.findClaimedDocument(lease, ids[0]!)).toBeNull();
        expect(await repo.findForDelivery(lease)).toMatchObject({ status: "unverified", reportHash: HASH });
        expect((await repo.listDeliveryDocuments(lease, 0, 100)).items).toHaveLength(2);
        expect(await other.finish(lease, input)).toBe(true);
        expect(await other.finish(lease, { ...input, reportHash: "b".repeat(64) })).toBe(false);
        expect(await repo.writeDocumentResults(lease, [result(ids[0]!)], input.workerRunId)).toBe(false);
        expect(await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).toEqual(before);
    });
    it.each(["running", "terminal"])("fences company, principal, token and foreign run for %s private delivery", async status => {
        const run = await claimed(); const lease = identity(run);
        if (status === "terminal") { const input = finishInput(); await repo.writeDocumentResults(lease, ids.map(id => result(id)), input.workerRunId); await repo.finish(lease, input); await expire(run); }
        for (const wrong of [{ ...lease, companyId: "foreign" }, { ...lease, principalId: "foreign" }, { ...lease, runId: randomUUID() }, { ...lease, leaseToken: randomUUID() }]) {
            expect(await other.findForDelivery(wrong)).toBeNull();
            expect(await other.listDeliveryDocuments(wrong, 0, 100)).toEqual({ items: [], hasMore: false });
            expect(await other.findClaimedDocument(wrong, ids[0]!)).toBeNull();
        }
    });
    it("rejects queued, expired running and stale-cleared leases for private delivery", async () => {
        const queuedRun = await queued(); const lease = { companyId, principalId: "verified-worker", runId: queuedRun.id, leaseToken: randomUUID() };
        expect(await repo.findForDelivery(lease)).toBeNull();
        const run = await repo.claimNext(companyId, "verified-worker"); if (!run) throw new Error("fixture"); const claimedLease = identity(run);
        await expire(run);
        expect(await repo.findForDelivery(claimedLease)).toBeNull(); expect((await repo.listDeliveryDocuments(claimedLease, 0, 100)).items).toHaveLength(0);
        expect(await repo.expireStale(companyId)).toBe(1);
        expect(await repo.findForDelivery(claimedLease)).toBeNull();
    });
    it.each(["run", "documents", "fixed-document"])("rechecks DB expiry after parent lock wait for %s read", async operation => {
        const run = await claimed(); const lease = identity(run); const entered = deferred(); const release = deferred();
        const holder = db.$transaction(async tx => {
            await tx.$executeRaw`UPDATE public.eformsign_backup_run SET lease_expires_at = clock_timestamp() + interval '400 milliseconds' WHERE id = ${run.id}::uuid`;
            entered.resolve(); await release.promise;
        });
        await entered.promise;
        const waiting = operation === "run" ? other.findForDelivery(lease) : operation === "documents"
            ? other.listDeliveryDocuments(lease, 0, 100) : other.findClaimedDocument(lease, ids[0]!);
        try { await waitForLock(); await db.$executeRaw`SELECT pg_sleep(0.5)`; } finally { release.resolve(); }
        await holder;
        expect(await waiting).toEqual(operation === "documents" ? { items: [], hasMore: false } : null);
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).workerRunId).toBeNull();
    });
    it("rechecks the DB clock after reading a delivery page and before returning its output", async () => {
        const run = await claimed(); const lease = identity(run);
        const wrapped = new Proxy(db, { get(target, key) {
            if (key === "$transaction") return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => target.$transaction(tx => callback(new Proxy(tx, { get(inner, name) {
                if (name === "eformsign_backup_run_document") return new Proxy(inner.eformsign_backup_run_document, { get(model, method) {
                    if (method === "findMany") return async (args: Prisma.eformsign_backup_run_documentFindManyArgs) => {
                        const value = await model.findMany(args); await tx.$executeRaw`SELECT pg_sleep(0.8)`; return value;
                    };
                    return Reflect.get(model, method);
                } });
                return Reflect.get(inner, name);
            } })), options);
            const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        await db.$executeRaw`UPDATE public.eformsign_backup_run SET lease_expires_at = clock_timestamp() + interval '600 milliseconds' WHERE id = ${run.id}::uuid`;
        expect(await makeRepo(wrapped).listDeliveryDocuments(lease, 0, 100)).toEqual({ items: [], hasMore: false });
    });
});
