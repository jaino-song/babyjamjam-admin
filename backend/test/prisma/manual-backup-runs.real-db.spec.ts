import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";
import type { EnqueueManualBackupInput, ManualBackupLeaseIdentity, ManualBackupRunRecord, ManualBackupFinishInput } from "domain/eformsign-backup/manual-backup-run";

function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"], enabled = process.env["HOLIDAY_REVIEW_REAL_DB"]): URL {
    try {
        if (enabled !== "1" || !databaseUrl || databaseUrl !== directUrl) throw new Error();
        const url = new URL(databaseUrl);
        if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "63241"
            || url.username !== "backup_test_owner" || !/^\/backup_exec_throwaway_[a-z0-9_]+$/.test(url.pathname)
            || url.search || url.hash) throw new Error();
        return url;
    } catch { throw new Error("Refusing manual-backup DB target"); }
}
function buildPsqlEnvironment(url: URL, inheritedEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    // libpq can route via PGHOSTADDR even when PGHOST is set; pin both to the validated loopback host.
    return { ...inheritedEnv, PGHOST: url.hostname, PGHOSTADDR: url.hostname, PGPORT: url.port,
        PGUSER: url.username, PGDATABASE: url.pathname.slice(1), PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: "disable", PGSERVICE: undefined, PGSERVICEFILE: undefined, PGOPTIONS: "" };
}
describe("manual-backup test target guard", () => {
    it("rejects missing flag, remote, wrong port/user/database and mismatching URLs before SQL", () => {
        const good = "postgresql://backup_test_owner:synthetic@127.0.0.1:63241/backup_exec_throwaway_guard";
        expect(assertTarget(good, good, "1").port).toBe("63241");
        for (const bad of [good.replace("127.0.0.1", "localhost"), good.replace("63241", "63237"), good.replace("backup_test_owner", "app"), good.replace("backup_exec_throwaway_guard", "production"), good + "?schema=public"]) {
            expect(() => assertTarget(bad, bad, "1")).toThrow("Refusing");
        }
        expect(() => assertTarget(good, good, "0")).toThrow("Refusing");
        expect(() => assertTarget(good, "different", "1")).toThrow("Refusing");
    });
    it("pins psql routing to the validated target despite conflicting inherited settings without connecting", () => {
        const good = "postgresql://backup_test_owner:synthetic@127.0.0.1:63241/backup_exec_throwaway_guard";
        const url = assertTarget(good, good, "1");
        // Exercise only the pure builder: never put conflicting values in process.env or attempt SQL.
        const inheritedEnv = Object.freeze({ PATH: "/synthetic/bin", PGHOSTADDR: "192.0.2.123", PGHOST: "anotherhost",
            PGPORT: "9999", PGUSER: "wrong-user", PGDATABASE: "wrong-database", PGPASSWORD: "wrong-password",
            PGSSLMODE: "require", PGSERVICE: "wrong-service", PGSERVICEFILE: "/synthetic/service", PGOPTIONS: "-c role=wrong" });
        const capturedEnv = buildPsqlEnvironment(url, inheritedEnv);
        expect(capturedEnv).toEqual({ PATH: "/synthetic/bin", PGHOSTADDR: "127.0.0.1", PGHOST: "127.0.0.1",
            PGPORT: "63241", PGUSER: "backup_test_owner", PGDATABASE: "backup_exec_throwaway_guard", PGPASSWORD: "synthetic",
            PGSSLMODE: "disable", PGSERVICE: undefined, PGSERVICEFILE: undefined, PGOPTIONS: "" });
        expect(capturedEnv).not.toBe(inheritedEnv);
        expect(inheritedEnv).toEqual({ PATH: "/synthetic/bin", PGHOSTADDR: "192.0.2.123", PGHOST: "anotherhost",
            PGPORT: "9999", PGUSER: "wrong-user", PGDATABASE: "wrong-database", PGPASSWORD: "wrong-password",
            PGSSLMODE: "require", PGSERVICE: "wrong-service", PGSERVICEFILE: "/synthetic/service", PGOPTIONS: "-c role=wrong" });
        expect(url.href).toBe("postgresql://backup_test_owner:synthetic@127.0.0.1:63241/backup_exec_throwaway_guard");
    });
});
const MIGRATION = readFileSync(resolve(__dirname, "../../prisma/migrations/20261106020000_add_manual_eformsign_backup_runs/migration.sql"), "utf8");
const VERIFY = readFileSync(resolve(__dirname, "../../prisma/scripts/verify-manual-eformsign-backup-runs.sql"), "utf8");
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const FIXED = new Date("2026-11-01T00:00:00Z");
const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;
describeReal("manual backup durable persistence (real PostgreSQL)", () => {
    let db: PrismaClient; let second: PrismaClient;
    let repo: SbEformsignBackupRunRepository; let other: SbEformsignBackupRunRepository;
    let branches: string[] = []; let unassignedId: number | undefined;
    const prefix = `manual-backup-test-${randomUUID()}`;
    const company = `${prefix}-company`; const foreignCompany = `${prefix}-foreign`;
    const rolesCreated: string[] = [];
    let sequence = 0;
    const branch = (index = 0): string => { const id = branches[index]; if (!id) throw new Error("fixture missing"); return id; };
    function sql(text: string): { status: number | null; stdout: string } {
        const url = assertTarget();
        const result = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align"], {
            input: text, encoding: "utf8", env: buildPsqlEnvironment(url, process.env),
        });
        // Do not relay child stderr/connection strings; assertions identify the failing contract.
        return { status: result.status, stdout: result.stdout.trim() };
    }
    function input(index = 0, ids = [`${prefix}-d0`], companyId = company): EnqueueManualBackupInput {
        return { companyId, branchId: branch(index), requestedByUserId: null, requestKey: `key-${sequence++}`, requestHash: HASH,
            scope: { period: "all", start: "", end: "", kind: "all", contractStages: ["created", "sent", "opened", "signed", "reviewed", "completed"], recordStages: ["created", "sent", "reviewed", "completed"] },
            sourceCounts: { total: ids.length, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: ids.length },
            snapshotAt: FIXED, documents: [...ids].sort().map((documentId, index) => ({ documentId, ordinal: index + 1, kind: "contract", currentMilestone: "completed", documentCreatedAt: FIXED,
                candidate: { documentId, ordinal: index + 1, classification: "included", reasons: [], statusType: "003", documentKind: "contract", metadataRevision: HASH,
                    artifacts: [{ fileType: "document", artifactIdentity: OTHER_HASH, sha256: HASH, byteSize: 4 }] } })) };
    }
    const identity = (run: ManualBackupRunRecord, principalId = "worker-a"): ManualBackupLeaseIdentity => {
        if (!run.leaseToken) throw new Error("lease missing");
        return { companyId: run.companyId, principalId, runId: run.id, leaseToken: run.leaseToken };
    };
    const finishInput: ManualBackupFinishInput = { status: "unverified", workerRunId: "synthetic-worker-run", reportHash: OTHER_HASH, result: { status: "unverified", backupComplete: false } };
    async function claimed(ids?: string[]): Promise<ManualBackupRunRecord> {
        await repo.enqueue(input(0, ids)); const run = await repo.claimNext(company, "worker-a");
        if (!run) throw new Error("claim missing"); return run;
    }
    async function expire(run: ManualBackupRunRecord): Promise<void> {
        await db.eformsign_backup_run.update({ where: { id: run.id }, data: { leaseExpiresAt: new Date("2000-01-01") } });
    }
    async function seedDoc(documentId: string, branchId: string | null, extra: Partial<Prisma.eformsign_docUncheckedCreateInput> = {}): Promise<number> {
        return (await db.eformsign_doc.create({ data: { documentId, branchId, documentKind: "contract", createdDate: FIXED, updatedDate: FIXED,
            statusType: "003", statusDetail: "", stepType: "", stepIndex: "", stepName: "", stepRecipientType: "", stepRecipientName: "", stepRecipientSms: "", expiredDate: FIXED, ...extra } })).id;
    }
    beforeAll(async () => {
        assertTarget();
        const connection = sql("SELECT inet_server_addr(), inet_server_port(), current_user;");
        expect(connection.status).toBe(0);
        expect(connection.stdout).toBe("127.0.0.1|63241|backup_test_owner");
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        db = new PrismaClient(); second = new PrismaClient(); await db.$connect(); await second.$connect();
        const roleRows = await db.$queryRaw<Array<{ rolname: string }>>`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`;
        for (const role of ["anon", "authenticated", "service_role"]) if (!roleRows.some(row => row.rolname === role)) {
            // Literal allowlist above; only synthetic NOLOGIN roles in the approved private cluster.
            expect(sql(`CREATE ROLE ${role} NOLOGIN;`).status).toBe(0); rolesCreated.push(role);
        }
        // Simulate inherited Supabase default grants on first creation, then restore defaults atomically.
        expect(sql(`BEGIN; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO anon, authenticated;\n${MIGRATION}\nALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE ON TABLES FROM anon, authenticated; COMMIT;`).status).toBe(0);
        expect(sql(VERIFY).status).toBe(0);
        branches = await Promise.all([0, 1, 2].map(async index => (await db.branch.create({ data: { name: "synthetic-backup-test", slug: `${prefix}-${index}` } })).id));
        for (let i = 0; i < 3; i++) await seedDoc(`${prefix}-d${i}`, branch(i));
        await seedDoc(`${prefix}-purged`, branch(), { permanentPurgeRequestedAt: FIXED });
        unassignedId = await seedDoc(`${prefix}-unassigned`, null);
        await db.eformsign_doc_file.create({ data: { eformsignDocId: (await db.eformsign_doc.findUniqueOrThrow({ where: { documentId: `${prefix}-d0` } })).id,
            fileType: "document", sha256: HASH, byteSize: 4, content: Buffer.from("test"), contentType: "application/pdf", sourceUpdatedDate: FIXED } });
        repo = new SbEformsignBackupRunRepository(db as unknown as PrismaService);
        other = new SbEformsignBackupRunRepository(second as unknown as PrismaService);
    }, 30_000);
    afterEach(async () => { if (db && branches.length) await db.eformsign_backup_run.deleteMany({ where: { branchId: { in: branches } } }); });
    afterAll(async () => {
        if (db) {
            if (branches.length) {
                await db.eformsign_backup_run.deleteMany({ where: { branchId: { in: branches } } });
                await db.eformsign_doc.deleteMany({ where: { branchId: { in: branches } } });
                await db.branch.deleteMany({ where: { id: { in: branches } } });
            }
            if (unassignedId !== undefined) await db.eformsign_doc.deleteMany({ where: { id: unassignedId } });
            for (const role of rolesCreated) expect(sql(`REVOKE ALL ON TABLE public.eformsign_backup_run, public.eformsign_backup_run_document FROM ${role}; DROP ROLE ${role};`).status).toBe(0);
            await db.$disconnect();
        }
        if (second) await second.$disconnect(); jest.restoreAllMocks();
    });
    it("applies twice with identical catalog, and verifies role table/column fences and RLS", async () => {
        const catalog = () => sql(`SELECT md5(string_agg(x, E'\\n' ORDER BY x)) FROM (
            SELECT pg_get_constraintdef(oid) x FROM pg_constraint WHERE conrelid IN ('eformsign_backup_run'::regclass,'eformsign_backup_run_document'::regclass)
            UNION ALL SELECT indexdef FROM pg_indexes WHERE tablename IN ('eformsign_backup_run','eformsign_backup_run_document')) q;`).stdout;
        const before = catalog(); expect(before).toMatch(/^[0-9a-f]{32}$/);
        expect(sql(MIGRATION).status).toBe(0); expect(sql(VERIFY).status).toBe(0); expect(catalog()).toBe(before);
        for (const role of ["anon", "authenticated"]) for (const table of ["eformsign_backup_run", "eformsign_backup_run_document"]) {
            expect(sql(`SELECT has_table_privilege('${role}', '${table}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), has_any_column_privilege('${role}', '${table}', 'SELECT,INSERT,UPDATE,REFERENCES');`).stdout).toBe("f|f");
        }
    });
    it("verifier fails on table grants, column grants, PUBLIC column grants, disabled RLS and wrong index columns", () => {
        for (const tamper of ["GRANT SELECT ON eformsign_backup_run TO anon;", "GRANT MAINTAIN ON eformsign_backup_run TO anon;",
            "ALTER TABLE eformsign_backup_run DROP CONSTRAINT eformsign_backup_run_pkey; CREATE UNIQUE INDEX eformsign_backup_run_pkey ON eformsign_backup_run(id);", "GRANT SELECT (request_hash) ON eformsign_backup_run TO authenticated;",
            "GRANT SELECT (request_hash) ON eformsign_backup_run TO PUBLIC;", "ALTER TABLE eformsign_backup_run DISABLE ROW LEVEL SECURITY;",
            "DROP INDEX idx_manual_backup_company_status_created; CREATE INDEX idx_manual_backup_company_status_created ON eformsign_backup_run(company_id,created_at,status);",
            "ALTER TABLE eformsign_backup_run DROP CONSTRAINT chk_manual_backup_status; ALTER TABLE eformsign_backup_run ADD CONSTRAINT chk_manual_backup_status CHECK (true);",
            "ALTER TABLE eformsign_backup_run DROP CONSTRAINT chk_manual_backup_hash; ALTER TABLE eformsign_backup_run ADD CONSTRAINT chk_manual_backup_hash CHECK (request_hash IS NOT NULL);",
            "ALTER TABLE eformsign_backup_run_document DROP CONSTRAINT manual_backup_document_run_branch_fkey; ALTER TABLE eformsign_backup_run_document ADD CONSTRAINT manual_backup_document_run_branch_fkey FOREIGN KEY (run_id,branch_id) REFERENCES eformsign_backup_run(id,branch_id) ON DELETE SET NULL;",
            "ALTER TABLE eformsign_backup_run ALTER COLUMN snapshot_at DROP NOT NULL;"]) {
            expect(sql(`BEGIN; ${tamper}\n${VERIFY}\nROLLBACK;`).status).not.toBe(0);
        }
        expect(sql(VERIFY).status).toBe(0);
    });
    it("replay migration removes explicit table and column grants from API roles and PUBLIC", () => {
        expect(sql(`BEGIN;
            GRANT SELECT ON eformsign_backup_run TO anon;
            GRANT SELECT (request_hash) ON eformsign_backup_run TO authenticated;
            GRANT SELECT (document_id) ON eformsign_backup_run_document TO PUBLIC;
            ${MIGRATION}
            ${VERIFY}
            ROLLBACK;`).status).toBe(0);
    });
    it("converges a same-key race on separate connections into one parent and exact immutable items", async () => {
        const request = input();
        let arrivals = 0; let release: () => void = () => undefined;
        const bothRead = new Promise<void>(resolve => { release = resolve; });
        const timeout = setTimeout(release, 5000);
        // Both independent transactions must read the missing idempotency row before either inserts.
        const racing = (client: PrismaClient): SbEformsignBackupRunRepository => {
            const wrapped = new Proxy(client, { get(target, key) {
                if (key === "$transaction") return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
                    target.$transaction(tx => callback(new Proxy(tx, { get(inner, name) {
                        if (name !== "eformsign_backup_run") return Reflect.get(inner, name);
                        return new Proxy(inner.eformsign_backup_run, { get(delegate, method) {
                            if (method !== "findFirst") return Reflect.get(delegate, method);
                            return async (args: Prisma.eformsign_backup_runFindFirstArgs) => {
                                const row = await delegate.findFirst(args);
                                if (args.where?.requestKey === request.requestKey) {
                                    expect(row).toBeNull(); arrivals++;
                                    if (arrivals === 2) release();
                                    await bothRead;
                                }
                                return row;
                            };
                        } });
                    } })), options);
                const value: unknown = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
            } });
            return new SbEformsignBackupRunRepository(wrapped as unknown as PrismaService);
        };
        let results: Awaited<ReturnType<SbEformsignBackupRunRepository["enqueue"]>>[];
        try { results = await Promise.all([racing(db).enqueue(request), racing(second).enqueue(request)]); }
        finally { clearTimeout(timeout); release(); }
        expect(arrivals).toBe(2);
        expect(results.map(row => row.replayed).sort()).toEqual([false, true]);
        expect(results[0]?.run.id).toBe(results[1]?.run.id);
        expect(await db.eformsign_backup_run.count({ where: { companyId: company } })).toBe(1);
        expect(await db.eformsign_backup_run_document.count({ where: { branchId: branch() } })).toBe(1);
        await expect(repo.enqueue({ ...request, requestHash: OTHER_HASH })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await expect(repo.enqueue({ ...request, companyId: foreignCompany })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await expect(repo.enqueue({ ...request, requestKey: "different" })).rejects.toMatchObject({ code: "RUN_ACTIVE" });
    });
    it("isolates the same request key across branches and staff company/branch reads", async () => {
        const a = input(); const b = { ...input(1, [`${prefix}-d1`]), requestKey: a.requestKey };
        const first = await repo.enqueue(a); const next = await repo.enqueue(b);
        expect(first.run.id).not.toBe(next.run.id);
        expect(await repo.findForBranch(company, branch(1), first.run.id)).toBeNull();
        expect(await repo.findForBranch(foreignCompany, branch(), first.run.id)).toBeNull();
        expect((await repo.listDocumentsForBranch({ companyId: foreignCompany, branchId: branch(), runId: first.run.id, afterOrdinal: 0, limit: 10 })).items).toEqual([]);
        expect((await repo.listForBranch({ companyId: company, branchId: branch(), limit: 10 })).items.map(row => row.id)).toEqual([first.run.id]);
    });
    it("guards foreign, missing, unassigned and purge-requested source rows atomically", async () => {
        for (const id of [`${prefix}-d1`, `${prefix}-missing`, `${prefix}-purged`, `${prefix}-unassigned`]) {
            await expect(repo.enqueue(input(0, [id]))).rejects.toMatchObject({ code: "SOURCE_SCOPE_CHANGED" });
        }
        expect(await db.eformsign_backup_run.count({ where: { companyId: company } })).toBe(0);
    });
    it("reads every page with branch/purge bounds and metadata only, including null-kind legacy rows", async () => {
        const ids = Array.from({ length: 501 }, (_, i) => `${prefix}-page-${i.toString().padStart(3, "0")}`);
        for (const documentId of ids) await seedDoc(documentId, branch(), { documentKind: null, statusType: "049", detailPayload: Prisma.DbNull });
        try {
            const source = await repo.readSourceForRequest(branch());
            expect(source.documents).toHaveLength(502); expect(source.observedAt).toBeInstanceOf(Date);
            expect(source.documents.every(doc => doc.branchId === branch() && doc.permanentPurgeRequestedAt === null)).toBe(true);
            expect(source.documents.filter(doc => doc.documentKind === null && doc.detailPayloadIsNull)).toHaveLength(501);
            expect(source.files).toEqual([{ documentId: `${prefix}-d0`, fileType: "document", sha256: HASH, byteSize: 4 }]);
            expect(Object.keys(source.documents[0] ?? {}).sort()).toEqual(["documentId", "branchId", "documentKind", "serviceRecordCaseId", "templateId", "createdDate", "updatedDate", "statusType", "stepType", "stepIndex", "voidedAt", "permanentPurgeRequestedAt", "detailPayloadIsNull"].sort());
            expect((await repo.readSourceForRequest(branch(), { gte: new Date("2026-11-02") })).documents).toEqual([]);
            const { run } = await repo.enqueue(input(0, ids));
            expect(await db.eformsign_backup_run_document.count({ where: { runId: run.id } })).toBe(501);
            const last = await repo.listDocumentsForBranch({ companyId: company, branchId: branch(), runId: run.id, afterOrdinal: 500, limit: 100 });
            expect(last.items.map(row => row.ordinal)).toEqual([501]); expect(last.hasMore).toBe(false);
        } finally { await db.eformsign_doc.deleteMany({ where: { branchId: branch(), documentId: { in: ids } } }); }
    }, 30_000);
    it("keeps a candidate fixed after business-row mutation and deletion", async () => {
        const id = `${prefix}-mutable`; await seedDoc(id, branch());
        const request = input(0, [id]); const { run } = await repo.enqueue(request);
        await db.eformsign_doc.update({ where: { documentId: id }, data: { statusType: "049", updatedDate: new Date(), permanentPurgeRequestedAt: new Date() } });
        await db.eformsign_doc.delete({ where: { documentId: id } });
        expect((await repo.listDocumentsForBranch({ companyId: company, branchId: branch(), runId: run.id, afterOrdinal: 0, limit: 10 })).items[0]?.candidate).toEqual(request.documents[0]?.candidate);
    });
    it("claims at most one running job per company across two connections and independent branches", async () => {
        await repo.enqueue(input()); await repo.enqueue(input(1, [`${prefix}-d1`])); await repo.enqueue(input(2, [`${prefix}-d2`], foreignCompany));
        const runs = await Promise.all([repo.claimNext(company, "worker-a"), other.claimNext(company, "worker-b")]);
        expect(runs.filter(Boolean)).toHaveLength(1);
        expect(await db.eformsign_backup_run.count({ where: { companyId: company, status: "running" } })).toBe(1);
        const foreign = await other.claimNext(foreignCompany, "worker-c"); expect(foreign?.companyId).toBe(foreignCompany);
        const run = runs.find(Boolean)!;
        expect(run.attempts).toBe(1); expect(run.startedAt).not.toBeNull(); expect(run.leaseExpiresAt!.getTime() - run.heartbeatAt!.getTime()).toBe(180000);
    });
    it("returns no claim for an empty company and handles zero-target runs safely", async () => {
        expect(await repo.claimNext(company, "worker-a")).toBeNull();
        const run = await claimed([]); expect(await repo.finish(identity(run), finishInput)).toBe(true);
        expect(await repo.claimNext(company, "worker-a")).toBeNull();
    });
    it("rejects wrong token/principal/company with zero heartbeat/result/finish writes and no claimed data", async () => {
        const run = await claimed(); const good = identity(run);
        const before = await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } });
        for (const change of [{ leaseToken: randomUUID() }, { principalId: "foreign-worker" }, { companyId: foreignCompany }]) {
            const bad = { ...good, ...change };
            expect(await repo.heartbeat(bad)).toBe(false); expect(await repo.findClaimed(bad)).toBeNull();
            expect(await repo.listClaimedDocuments(bad, 0, 10)).toEqual({ items: [], hasMore: false });
            expect(await repo.writeDocumentResults(bad, [{ documentId: `${prefix}-d0`, outcome: { code: "gone" } }])).toBe(false);
            expect(await repo.finish(bad, { ...finishInput, status: "failed" })).toBe(false);
        }
        expect(await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).toEqual(before);
        expect((await repo.listClaimedDocuments(good, 0, 1)).items).toHaveLength(1);
        expect(await repo.findClaimed(good)).toMatchObject({ id: run.id }); expect(await repo.heartbeat(good)).toBe(true);
    });
    it("does not revive a lease that expires while heartbeat waits for a row lock", async () => {
        const run = await claimed(); const lease = identity(run);
        await db.$executeRaw`UPDATE eformsign_backup_run SET lease_expires_at = clock_timestamp() + interval '500 milliseconds' WHERE id = ${run.id}::uuid`;
        const before = await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } });
        let acquired: () => void = () => undefined; let release: () => void = () => undefined;
        const locked = new Promise<void>(resolve => { acquired = resolve; });
        const released = new Promise<void>(resolve => { release = resolve; });
        const holder = second.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM eformsign_backup_run WHERE id = ${run.id}::uuid FOR UPDATE`;
            acquired(); await released;
        }, { timeout: 5000 });
        await locked;
        const heartbeat = repo.heartbeat(lease);
        try { await new Promise(resolve => setTimeout(resolve, 650)); }
        finally { release(); await holder; }
        expect(await heartbeat).toBe(false);
        expect(await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).toEqual(before);
    });
    it("serializes competing outcomes and different finishing reports across connections", async () => {
        const run = await claimed(); const lease = identity(run); const documentId = `${prefix}-d0`;
        const writes = await Promise.all([
            repo.writeDocumentResults(lease, [{ documentId, outcome: { code: "gone" } }]),
            other.writeDocumentResults(lease, [{ documentId, outcome: { code: "unverified" } }]),
        ]);
        expect(writes.sort()).toEqual([false, true]);
        const finishes = await Promise.all([repo.finish(lease, finishInput), other.finish(lease, { ...finishInput, reportHash: HASH, result: { different: true } })]);
        expect(finishes.sort()).toEqual([false, true]);
    });
    it("rolls back any result batch containing unknown IDs and accepts only identical JSONB replays", async () => {
        const run = await claimed(); const lease = identity(run); const id = `${prefix}-d0`;
        expect(await repo.writeDocumentResults(lease, [{ documentId: id, outcome: { code: "gone" } }, { documentId: "unknown", outcome: {} }])).toBe(false);
        expect((await db.eformsign_backup_run_document.findFirstOrThrow({ where: { runId: run.id } })).outcome).toBeNull();
        expect(await repo.writeDocumentResults(lease, [{ documentId: id, outcome: { code: "gone", details: { b: 2, a: 1 } } }])).toBe(true);
        expect(await repo.writeDocumentResults(lease, [{ documentId: id, outcome: { details: { a: 1, b: 2 }, code: "gone" } }])).toBe(true);
        expect(await repo.writeDocumentResults(lease, [{ documentId: id, outcome: { code: "changed" } }])).toBe(false);
    });
    it("rejects incomplete normal finish and replays the same finishing lease without overwriting payloads", async () => {
        const run = await claimed(); const lease = identity(run);
        expect(await repo.finish(lease, finishInput)).toBe(false);
        expect(await repo.finish(lease, { ...finishInput, status: "partial" })).toBe(false);
        expect(await repo.writeDocumentResults(lease, [{ documentId: `${prefix}-d0`, outcome: { code: "unverified" } }])).toBe(true);
        expect(await repo.finish(lease, finishInput)).toBe(true); expect(await other.finish(lease, finishInput)).toBe(true);
        const finished = await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } });
        expect(finished.activeKey).toBeNull(); expect(finished.finishedAt).not.toBeNull(); expect(finished.leaseToken).toBe(lease.leaseToken);
        for (const change of [{ reportHash: HASH }, { workerRunId: "other" }, { result: { changed: true } }, { status: "failed" as const }, { failureCode: "other" }]) {
            expect(await repo.finish(lease, { ...finishInput, ...change })).toBe(false);
        }
        expect(await repo.finish({ ...lease, leaseToken: randomUUID() }, finishInput)).toBe(false);
        expect(await repo.heartbeat(lease)).toBe(false); expect(await repo.findClaimed(lease)).toBeNull();
        expect(await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).toEqual(finished);
        expect((await repo.enqueue(input())).run.status).toBe("queued");
    });
    it("allows blocked/failed early finish without claiming full coverage", async () => {
        const run = await claimed();
        expect(await repo.finish(identity(run), { ...finishInput, status: "blocked", failureCode: "SOURCE_MISSING" })).toBe(true);
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("blocked");
    });
    it("expires only the requested company's stale leases, preserves evidence and rejects late callbacks without requeue", async () => {
        const run = await claimed(); const lease = identity(run);
        await repo.writeDocumentResults(lease, [{ documentId: `${prefix}-d0`, outcome: { code: "unverified" } }]);
        await repo.enqueue(input(1, [`${prefix}-d1`]));
        await repo.enqueue(input(2, [`${prefix}-d2`], foreignCompany)); const foreign = await other.claimNext(foreignCompany, "worker-b");
        await expire(run); await expire(foreign!);
        expect(await repo.heartbeat(lease)).toBe(false); expect(await repo.findClaimed(lease)).toBeNull();
        expect(await repo.writeDocumentResults(lease, [{ documentId: `${prefix}-d0`, outcome: {} }])).toBe(false);
        expect(await repo.finish(lease, { ...finishInput, status: "failed" })).toBe(false);
        expect(await repo.expireStale(company)).toBe(1); expect(await repo.expireStale(company)).toBe(0);
        const expired = await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: run.id } });
        expect(expired).toMatchObject({ status: "blocked", activeKey: null, leaseToken: null, failureCode: "WORKER_LEASE_EXPIRED", attempts: 1 });
        expect(expired.finishedAt).not.toBeNull(); expect(expired.scope).toEqual(run.scope);
        expect((await db.eformsign_backup_run_document.findFirstOrThrow({ where: { runId: run.id } })).outcome).toEqual({ code: "unverified" });
        expect((await db.eformsign_backup_run.findUniqueOrThrow({ where: { id: foreign!.id } })).status).toBe("running");
        expect(await db.eformsign_backup_run.count({ where: { companyId: company, status: "queued" } })).toBe(1);
    });
    it("paginates tied timestamps by descending UUID and document ordinal", async () => {
        const created: string[] = [];
        for (let i = 0; i < 3; i++) { const run = await claimed([]); created.push(run.id); await repo.finish(identity(run), finishInput); }
        await db.eformsign_backup_run.updateMany({ where: { id: { in: created } }, data: { createdAt: FIXED } });
        const first = await repo.listForBranch({ companyId: company, branchId: branch(), limit: 2 });
        expect(first.items.map(row => row.id)).toEqual([...created].sort().reverse().slice(0, 2)); expect(first.hasMore).toBe(true);
        const last = first.items[1]!;
        const next = await repo.listForBranch({ companyId: company, branchId: branch(), limit: 2, cursor: { id: last.id, createdAt: last.createdAt } });
        expect(next.items.map(row => row.id)).toEqual([...created].sort().slice(0, 1)); expect(next.hasMore).toBe(false);
        const targetIds = [`${prefix}-ordinal-a`, `${prefix}-ordinal-b`]; for (const id of targetIds) await seedDoc(id, branch());
        const { run } = await repo.enqueue(input(0, targetIds));
        const docs = await repo.listDocumentsForBranch({ companyId: company, branchId: branch(), runId: run.id, afterOrdinal: 0, limit: 1 });
        expect(docs.items.map(row => row.documentId)).toEqual([targetIds[0]]); expect(docs.hasMore).toBe(true);
        expect((await repo.listDocumentsForBranch({ companyId: company, branchId: branch(), runId: run.id, afterOrdinal: 1, limit: 1 })).items.map(row => row.ordinal)).toEqual([2]);
    });
    it("enforces SQL hashes/status/active lease/JSON/ordinal/kind/stage/UUID/FK checks", async () => {
        const { run } = await repo.enqueue(input());
        for (const data of [{ status: "completed" }, { requestHash: "z".repeat(64) }, { reportHash: "bad" }, { companyId: " " }, { requestKey: "" }, { attempts: -1 },
            { status: "running" }, { status: "failed", finishedAt: new Date() }, { activeKey: "wrong" }, { activeKey: null }, { status: "failed", activeKey: null },
            { scope: [] }, { sourceCounts: [] }, { result: [] }, { branchId: randomUUID() }, { leaseToken: "not-uuid" }]) {
            await expect(db.eformsign_backup_run.update({ where: { id: run.id }, data: data as never })).rejects.toBeDefined();
        }
        for (const data of [{ ordinal: 0 }, { kind: "other" }, { currentMilestone: "other" }, { kind: "record", currentMilestone: "signed" }, { candidate: [] }, { outcome: [] }, { branchId: branch(1) }]) {
            await expect(db.eformsign_backup_run_document.update({ where: { runId_documentId: { runId: run.id, documentId: `${prefix}-d0` } }, data: data as never })).rejects.toBeDefined();
        }
        const doc = await db.eformsign_backup_run_document.findFirstOrThrow({ where: { runId: run.id } });
        await expect(db.eformsign_backup_run_document.create({ data: { ...doc, candidate: {}, outcome: Prisma.DbNull, ordinal: 2 } })).rejects.toMatchObject({ code: "P2002" });
        await expect(db.eformsign_backup_run_document.create({ data: { ...doc, candidate: {}, outcome: Prisma.DbNull, documentId: "duplicate-ordinal" } })).rejects.toMatchObject({ code: "P2002" });
        await expect(db.eformsign_backup_run_document.create({ data: { runId: randomUUID(), branchId: branch(), documentId: "missing-parent", ordinal: 1, kind: "contract", documentCreatedAt: FIXED, candidate: {} } })).rejects.toBeDefined();
        await db.eformsign_backup_run.delete({ where: { id: run.id } });
        expect(await db.eformsign_backup_run_document.count({ where: { runId: run.id } })).toBe(0);
    });
    it("does not change business documents or stored file hashes/bytes while queueing, claiming and finishing", async () => {
        const digest = async () => {
            const docs = await db.eformsign_doc.findMany({ where: { branchId: branch() }, orderBy: { id: "asc" } });
            const files = await db.eformsign_doc_file.findMany({ where: { eformsignDoc: { branchId: branch() } }, orderBy: { id: "asc" } });
            return createHash("sha256").update(JSON.stringify({ docs, files })).digest("hex");
        };
        const before = await digest(); const run = await claimed();
        await repo.heartbeat(identity(run)); await repo.writeDocumentResults(identity(run), [{ documentId: `${prefix}-d0`, outcome: { code: "unverified" } }]);
        expect(await repo.finish(identity(run), finishInput)).toBe(true); expect(await digest()).toBe(before);
    });
});
