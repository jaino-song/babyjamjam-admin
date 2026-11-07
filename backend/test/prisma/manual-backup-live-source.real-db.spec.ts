import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";
import type { ManualBackupLeaseIdentity, ManualBackupRunRecord } from "domain/eformsign-backup/manual-backup-run";
import { prepareManualBackupSelection } from "application/utils/manual-backup-selection";

/** Independently enforce the approved synthetic target BEFORE any fixture SQL or client connection. */
function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"], enabled = process.env["HOLIDAY_REVIEW_REAL_DB"]): URL {
    try {
        if (enabled !== "1" || !databaseUrl || databaseUrl !== directUrl) throw new Error();
        const url = new URL(databaseUrl);
        if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "63241"
            || url.username !== "backup_test_owner" || url.pathname !== "/backup_exec_throwaway_20261106"
            || url.search || url.hash) throw new Error();
        return url;
    } catch { throw new Error("Refusing manual-backup live-source DB target"); }
}
function buildPsqlEnvironment(url: URL, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...inherited, PGHOST: url.hostname, PGHOSTADDR: url.hostname, PGPORT: url.port,
        PGUSER: url.username, PGDATABASE: url.pathname.slice(1), PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: "disable", PGSERVICE: undefined, PGSERVICEFILE: undefined, PGOPTIONS: "" };
}
function sql(statement: string): { status: number | null; stdout: string } {
    const target = assertTarget();
    const result = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align"], {
        input: statement, encoding: "utf8", env: buildPsqlEnvironment(target, process.env),
    });
    return { status: result.status, stdout: result.stdout.trim() };
}
describe("live-source independent target guard", () => {
    const good = "postgresql://backup_test_owner:synthetic@127.0.0.1:63241/backup_exec_throwaway_20261106";
    it("rejects routing, flag and direct URL changes without SQL", () => {
        expect(assertTarget(good, good, "1").port).toBe("63241");
        for (const bad of [good.replace("127.0.0.1", "localhost"), good.replace("63241", "5432"), good.replace("backup_test_owner", "app"),
            good.replace("backup_exec_throwaway_20261106", "backup_exec_throwaway_other"), good + "?hostaddr=192.0.2.1", good + "#x"]) {
            expect(() => assertTarget(bad, bad, "1")).toThrow("Refusing");
        }
        expect(() => assertTarget(good, good, "0")).toThrow("Refusing");
        expect(() => assertTarget(good, "other", "1")).toThrow("Refusing");
    });
    it("pins both host and hostaddr and clears service/options without connecting", () => {
        const inherited = Object.freeze({ PGHOST: "foreign", PGHOSTADDR: "192.0.2.123", PGPORT: "9999", PGUSER: "other", PGDATABASE: "other",
            PGPASSWORD: "other", PGSSLMODE: "require", PGSERVICE: "other", PGSERVICEFILE: "other", PGOPTIONS: "-c role=other" });
        expect(buildPsqlEnvironment(assertTarget(good, good, "1"), inherited)).toEqual({ PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: "63241",
            PGUSER: "backup_test_owner", PGDATABASE: "backup_exec_throwaway_20261106", PGPASSWORD: "synthetic", PGSSLMODE: "disable",
            PGSERVICE: undefined, PGSERVICEFILE: undefined, PGOPTIONS: "" });
        expect(inherited.PGHOSTADDR).toBe("192.0.2.123");
    });
});
const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;
const FIXED = new Date("2026-11-01T00:00:00Z");
const CONTENT = Buffer.from("synthetic-pdf");
const AUDIT = Buffer.from("synthetic-audit");
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const HASH = digest(CONTENT);
const scope = { period: "all", start: "", end: "", kind: "all", contractStages: ["created", "sent", "opened", "signed", "reviewed", "completed"], recordStages: ["created", "sent", "reviewed", "completed"] };

describeReal("manual backup exact live source (real PostgreSQL 17)", () => {
    let db: PrismaClient; let second: PrismaClient; let repo: SbEformsignBackupRunRepository;
    let branch: string; let foreignBranch: string; let docId: number; let selectedId: string; let foreignId: string; let unselectedId: string;
    const prefix = `manual-live-${randomUUID()}`; const companyId = `${prefix}-company`;
    let queries: string[] = [];
    const identity = (run: ManualBackupRunRecord): ManualBackupLeaseIdentity => ({ companyId, principalId: "synthetic-worker", runId: run.id, leaseToken: run.leaseToken! });
    const contentReads = () => queries.filter(query => /SELECT[\s\S]*"content"/.test(query)).length;
    const makeRepo = (client: PrismaClient) => new SbEformsignBackupRunRepository(client as unknown as PrismaService);
    async function seed(documentId: string, branchId: string): Promise<number> {
        return (await db.eformsign_doc.create({ data: { documentId, branchId, documentKind: "contract", templateId: "synthetic-template",
            createdDate: FIXED, updatedDate: FIXED, statusType: "003", statusDetail: "synthetic-private-detail", stepType: "", stepIndex: "",
            stepName: "synthetic-private-step", stepRecipientType: "", stepRecipientName: "synthetic-private-recipient", stepRecipientSms: "",
            expiredDate: FIXED, syncStatus: "synced", customerName: "synthetic-private-name", customerPhone: "01000000000",
            detailPayload: { private: "synthetic-private-payload" } } })).id;
    }
    async function enqueue(branchId = branch, owner = companyId, requestKey: string = randomUUID()) {
        const source = await repo.readSourceForRequest(branchId);
        const selectedSource = { ...source, documents: source.documents.filter(doc => doc.documentId === (branchId === branch ? selectedId : foreignId)) };
        const selection = prepareManualBackupSelection({ companyId: owner, branchId, scope, source: selectedSource, serviceRecordTemplateIds: new Set() });
        return repo.enqueue({ companyId: owner, branchId, requestedByUserId: null, requestKey, requestHash: HASH, scope: scope as Parameters<typeof repo.enqueue>[0]["scope"], ...selection });
    }
    async function claimed(): Promise<ManualBackupRunRecord> {
        await enqueue(); const run = await repo.claimNext(companyId, "synthetic-worker");
        if (!run) throw new Error("Synthetic claim missing"); return run;
    }
    function deferred() {
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
    }
    /** Observe a pending row lock on the second connection, with a bounded DB-only poll. */
    async function waitForLock(): Promise<void> {
        const end = Date.now() + 3000;
        while (Date.now() < end) {
            const rows = await second.$queryRaw<Array<{ waiting: boolean }>>`
                SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
                AND usename = current_user AND pid <> pg_backend_pid() AND wait_event_type = 'Lock') AS waiting`;
            if (rows[0]?.waiting) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error("Expected synthetic lock wait did not occur");
    }
    /** Pause immediately after reading bytes, while the adapter still holds branch/parent locks. */
    function pausedContent(entered: ReturnType<typeof deferred>, release: ReturnType<typeof deferred>) {
        const wrapped = new Proxy(db, { get(target, name) {
            if (name === "$transaction") return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
                target.$transaction(tx => callback(new Proxy(tx, { get(inner, key) {
                    if (key !== "eformsign_doc_file") return Reflect.get(inner, key);
                    return new Proxy(inner.eformsign_doc_file, { get(delegate, method) {
                        if (method !== "findFirst") return Reflect.get(delegate, method);
                        return async (args: Prisma.eformsign_doc_fileFindFirstArgs) => {
                            const value = await delegate.findFirst(args);
                            if (args.select?.content) { entered.resolve(); await release.promise; }
                            return value;
                        };
                    } });
                } })), options);
            const value: unknown = Reflect.get(target, name); return typeof value === "function" ? value.bind(target) : value;
        } });
        return makeRepo(wrapped);
    }
    beforeAll(async () => {
        assertTarget();
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        const connection = sql("SELECT inet_server_addr(), inet_server_port(), current_user, current_setting('server_version_num')::int / 10000;");
        expect(connection).toEqual({ status: 0, stdout: "127.0.0.1|63241|backup_test_owner|17" });
        const traced = new PrismaClient({ log: [{ level: "query", emit: "event" }] });
        traced.$on("query", event => { queries.push(event.query); });
        db = traced;
        second = new PrismaClient(); await db.$connect(); await second.$connect();
        branch = (await db.branch.create({ data: { name: "synthetic-live-source", slug: `${prefix}-a` } })).id;
        foreignBranch = (await db.branch.create({ data: { name: "synthetic-live-source", slug: `${prefix}-b` } })).id;
        repo = makeRepo(db);
    });
    beforeEach(async () => {
        selectedId = `${prefix}-selected`; foreignId = `${prefix}-foreign`; unselectedId = `${prefix}-unselected`;
        docId = await seed(selectedId, branch); await seed(foreignId, foreignBranch); await seed(unselectedId, branch);
        for (const [fileType, content] of [["document", CONTENT], ["audit_trail", AUDIT]] as const) await db.eformsign_doc_file.create({ data: {
            eformsignDocId: docId, fileType, content, sha256: digest(content), byteSize: content.length, contentType: "application/pdf", sourceUpdatedDate: FIXED,
        } });
        for (const documentId of [foreignId, unselectedId]) await db.eformsign_doc_file.create({ data: {
            eformsignDocId: (await db.eformsign_doc.findUniqueOrThrow({ where: { documentId }, select: { id: true } })).id,
            fileType: "document", content: Buffer.from("foreign-file"), sha256: digest(Buffer.from("foreign-file")), byteSize: 12, contentType: "application/pdf", sourceUpdatedDate: FIXED,
        } });
        queries = [];
    });
    afterEach(async () => {
        if (db && branch) {
            await db.eformsign_backup_run.deleteMany({ where: { branchId: { in: [branch, foreignBranch] } } });
            await db.eformsign_doc.deleteMany({ where: { documentId: { in: [selectedId, foreignId, unselectedId] } } });
        }
    });
    afterAll(async () => {
        if (db) {
            if (branch) await db.branch.deleteMany({ where: { id: { in: [branch, foreignBranch] } } });
            await db.$disconnect();
        }
        if (second) await second.$disconnect();
        jest.restoreAllMocks();
    });
    it("returns safe summary and both file metadata without loading bytes or private fields", async () => {
        const run = await claimed(); queries = [];
        const result = await repo.readClaimedSource(identity(run), selectedId);
        expect(result).toMatchObject({ run: { id: run.id }, selected: { documentId: selectedId }, source: { documentId: selectedId, branchId: branch, syncStatus: "synced", detailPayloadIsNull: false }, download: null });
        expect(result?.files.map(file => file.fileType).sort()).toEqual(["audit_trail", "document"]);
        expect(contentReads()).toBe(0);
        const serialized = JSON.stringify(result);
        for (const forbidden of ["synthetic-private", "customerName", "customerPhone", "detailPayload\"", "stepRecipientName", unselectedId, foreignId, "content\""]) expect(serialized).not.toContain(forbidden);
        for (const query of queries) expect(query).not.toMatch(/SELECT[\s\S]*"(customer_name|customer_phone|document_name|step_recipient_name|detail_payload)"(?=,| FROM)/);
    });
    it("reads the selected PDF and audit bytes only after exact metadata approval", async () => {
        const run = await claimed(); queries = [];
        for (const [fileType, expected] of [["document", CONTENT], ["audit_trail", AUDIT]] as const) {
            const result = await repo.readClaimedSource(identity(run), selectedId, { fileType, withContent: true });
            expect(result?.files).toEqual([{ documentId: selectedId, fileType, sha256: digest(expected), byteSize: expected.length }]);
            expect(result?.download).toEqual({ sha256: digest(expected), byteSize: expected.length, contentType: "application/pdf", content: Uint8Array.from(expected) });
        }
        expect(contentReads()).toBe(2);
        queries = [];
        const metadata = await repo.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: false });
        expect(metadata?.download).toEqual({ sha256: HASH, byteSize: CONTENT.length, contentType: "application/pdf" });
        expect(contentReads()).toBe(0);
    });
    it("returns null for unknown, foreign and unselected documents without existence leaks", async () => {
        const run = await claimed(); queries = [];
        for (const documentId of ["unknown", foreignId, unselectedId]) expect(await repo.readClaimedSource(identity(run), documentId, { fileType: "document", withContent: true })).toBeNull();
        expect(contentReads()).toBe(0);
    });
    it.each(["moved", "purge", "gone"])("retains the fixed candidate but no source or bytes after source is %s", async change => {
        const run = await claimed(); const before = await repo.readClaimedSource(identity(run), selectedId);
        if (change === "gone") await db.eformsign_doc.delete({ where: { id: docId } });
        else await db.eformsign_doc.update({ where: { id: docId }, data: change === "moved" ? { branchId: foreignBranch } : { permanentPurgeRequestedAt: FIXED } });
        queries = [];
        const result = await repo.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true });
        expect(result).toMatchObject({ source: null, files: [], download: null }); expect(result?.selected).toEqual(before?.selected);
        expect(contentReads()).toBe(0);
    });
    it.each(["hash", "size", "oversize", "missing"])("does not load bytes when current metadata is %s", async change => {
        const run = await claimed(); const fixed = (await repo.readClaimedSource(identity(run), selectedId))?.selected;
        const where = { eformsignDocId_fileType: { eformsignDocId: docId, fileType: "document" } };
        if (change === "missing") await db.eformsign_doc_file.delete({ where });
        else await db.eformsign_doc_file.update({ where, data: change === "hash" ? { sha256: "b".repeat(64) } : { byteSize: change === "oversize" ? 64 * 1024 * 1024 + 1 : CONTENT.length + 1 } });
        await db.eformsign_doc.update({ where: { id: docId }, data: { statusType: "072", updatedDate: new Date("2026-11-02") } });
        queries = [];
        const result = await repo.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true });
        expect(result?.download).toBeNull(); expect(result?.source?.statusType).toBe("072"); expect(result?.selected).toEqual(fixed);
        expect(contentReads()).toBe(0);
    });
    it("does not serve same-length corrupted content even when its metadata still matches", async () => {
        const run = await claimed();
        await db.eformsign_doc_file.update({ where: { eformsignDocId_fileType: { eformsignDocId: docId, fileType: "document" } }, data: { content: Buffer.alloc(CONTENT.length, 120) } });
        expect((await repo.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true }))?.download).toBeNull();
    });
    it("does not read a file added after selection or an excluded candidate's file", async () => {
        await db.eformsign_doc_file.delete({ where: { eformsignDocId_fileType: { eformsignDocId: docId, fileType: "audit_trail" } } });
        const run = await claimed();
        await db.eformsign_doc_file.create({ data: { eformsignDocId: docId, fileType: "audit_trail", content: AUDIT, sha256: digest(AUDIT), byteSize: AUDIT.length, contentType: "application/pdf", sourceUpdatedDate: FIXED } });
        queries = [];
        expect((await repo.readClaimedSource(identity(run), selectedId, { fileType: "audit_trail", withContent: true }))?.download).toBeNull();
        expect(contentReads()).toBe(0);
        await db.eformsign_backup_run.delete({ where: { id: run.id } });
        await db.eformsign_doc.update({ where: { id: docId }, data: { statusType: "060" } });
        const incomplete = await claimed(); queries = [];
        expect((await repo.readClaimedSource(identity(incomplete), selectedId, { fileType: "document", withContent: true }))?.download).toBeNull();
        expect(contentReads()).toBe(0);
    });
    it("fences wrong lease, principal, run, company and expiry before source/content reads", async () => {
        const run = await claimed(); const good = identity(run); queries = [];
        for (const invalid of [{ ...good, leaseToken: randomUUID() }, { ...good, principalId: "foreign-worker" }, { ...good, companyId: "foreign-company" }, { ...good, runId: randomUUID() }]) {
            expect(await repo.readClaimedSource(invalid, selectedId, { fileType: "document", withContent: true })).toBeNull();
        }
        await db.eformsign_backup_run.update({ where: { id: run.id }, data: { leaseExpiresAt: new Date("2000-01-01") } });
        expect(await repo.readClaimedSource(good, selectedId, { fileType: "document", withContent: true })).toBeNull();
        expect(contentReads()).toBe(0);
    });
    it("strictly validates options and document ID before querying", async () => {
        const run = await claimed(); queries = [];
        for (const options of [null, {}, { fileType: "unknown", withContent: true }, { fileType: "document", withContent: "true" }, { fileType: "document", withContent: true, extra: 1 },
            { get fileType() { throw new Error("must not invoke option getter"); }, withContent: true },
            Object.assign(Object.create({ fileType: "document" }), { withContent: true })]) {
            expect(() => repo.readClaimedSource(identity(run), selectedId, options as never)).toThrow("Manual backup operation rejected");
        }
        for (const documentId of ["", "x".repeat(4097)]) expect(() => repo.readClaimedSource(identity(run), documentId)).toThrow("Manual backup operation rejected");
        expect(queries).toHaveLength(0);
    });
    it("keeps business rows byte-for-byte unchanged across metadata and content reads", async () => {
        const businessHash = async () => (await db.$queryRaw<Array<{ hash: string }>>`
            SELECT md5(row_to_json(d)::text || coalesce((SELECT string_agg(row_to_json(f)::text, '' ORDER BY f.file_type)
            FROM public.eformsign_doc_file f WHERE f.eformsign_doc_id = d.id), '')) AS hash
            FROM public.eformsign_doc d WHERE d.id = ${docId}`)[0]?.hash;
        const run = await claimed(); const before = await businessHash();
        await repo.readClaimedSource(identity(run), selectedId);
        await repo.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true });
        expect(await businessHash()).toBe(before); expect(before).toMatch(/^[a-f0-9]{32}$/);
    });
    it("keeps request-key lookup scoped by both company and branch", async () => {
        const first = await enqueue(branch, companyId, "shared-key");
        await enqueue(foreignBranch, `${companyId}-foreign`, "shared-key");
        expect((await repo.findByRequestKey(companyId, branch, "shared-key"))?.id).toBe(first.run.id);
        expect(await repo.findByRequestKey(companyId, foreignBranch, "shared-key")).toBeNull();
        expect(await repo.findByRequestKey(`${companyId}-foreign`, branch, "shared-key")).toBeNull();
        expect(await repo.findByRequestKey(companyId, branch, "missing")).toBeNull();
        await expect(repo.findByRequestKey(companyId, "bad", "key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });
    it("pages every TIMESTAMPTZ(6) row once despite JS millisecond truncation and UUID ties", async () => {
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) {
            const row = await db.eformsign_backup_run.create({ data: { companyId, branchId: branch, requestedByUserId: null, requestKey: `page-${i}`, requestHash: HASH, status: "blocked", finishedAt: FIXED,
                scope, sourceCounts: { total: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0 }, snapshotAt: FIXED } }); ids.push(row.id);
        }
        // Literal SQL preserves precision that JS Date cannot represent; .123100 ties use stored UUID order.
        expect(sql(`UPDATE public.eformsign_backup_run SET created_at = TIMESTAMPTZ '2026-11-01 00:00:00.123900+00' WHERE id = '${ids[0]}';
            UPDATE public.eformsign_backup_run SET created_at = TIMESTAMPTZ '2026-11-01 00:00:00.123100+00' WHERE id IN ('${ids[1]}','${ids[2]}');
            UPDATE public.eformsign_backup_run SET created_at = TIMESTAMPTZ '2026-11-01 00:00:00.123000+00' WHERE id = '${ids[3]}';`).status).toBe(0);
        const expected = [ids[0], ...[ids[1]!, ids[2]!].sort().reverse(), ids[3]];
        const actual: string[] = []; let cursor: { createdAt: Date; id: string } | undefined;
        for (let i = 0; i < 4; i++) {
            const page = await repo.listForBranch({ companyId, branchId: branch, limit: 1, ...(cursor ? { cursor } : {}) });
            expect(page.items).toHaveLength(1); expect(page.hasMore).toBe(i < 3);
            const item = page.items[0]!; actual.push(item.id); cursor = { id: item.id, createdAt: item.createdAt };
            expect(item.createdAt.toISOString()).toBe("2026-11-01T00:00:00.123Z");
        }
        expect(actual).toEqual(expected); expect(new Set(actual).size).toBe(4);
        expect((await repo.listForBranch({ companyId, branchId: branch, limit: 1, cursor })).items).toEqual([]);
        await expect(repo.listForBranch({ companyId, branchId: branch, limit: 1, cursor: { id: ids[0]!, createdAt: new Date("2026-11-01T00:00:00.124Z") } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(repo.listForBranch({ companyId, branchId: foreignBranch, limit: 1, cursor: { id: ids[0]!, createdAt: FIXED } })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(repo.listForBranch({ companyId: "foreign", branchId: branch, limit: 1, cursor: { id: ids[0]!, createdAt: FIXED } })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(repo.listForBranch({ companyId, branchId: branch, limit: 1, cursor: { id: randomUUID(), createdAt: FIXED } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
    it("checks the DB wall clock after a parent lock wait before reading content", async () => {
        const run = await claimed();
        const deadline = await db.$queryRaw<Array<{ expires: Date }>>`SELECT clock_timestamp() + interval '1 second' AS expires`;
        await db.eformsign_backup_run.update({ where: { id: run.id }, data: { leaseExpiresAt: deadline[0]!.expires } });
        const held = deferred(); const release = deferred();
        const holder = second.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM public.eformsign_backup_run WHERE id = ${run.id}::uuid FOR UPDATE`;
            held.resolve(); await release.promise;
        }, { timeout: 10_000 });
        await held.promise; queries = [];
        const read = repo.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true });
        try {
            await waitForLock();
            await second.$queryRaw`SELECT pg_sleep(1.1)::text`;
        } finally { release.resolve(); await holder; }
        expect(await read).toBeNull(); expect(contentReads()).toBe(0);
    });
    it("rejects stale ownership after a parent lock wait on a second connection", async () => {
        const run = await claimed(); const held = deferred(); const release = deferred();
        const holder = second.$transaction(async tx => {
            await tx.eformsign_backup_run.update({ where: { id: run.id }, data: { leaseOwnerPrincipalId: "replacement-worker", leaseToken: randomUUID() } });
            held.resolve(); await release.promise;
        }, { timeout: 10_000 });
        await held.promise; queries = [];
        const read = repo.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true });
        try { await waitForLock(); } finally { release.resolve(); await holder; }
        expect(await read).toBeNull(); expect(contentReads()).toBe(0);
    });
    it("discards bytes when the lease expires during the content read", async () => {
        const run = await claimed();
        await db.$executeRaw`UPDATE public.eformsign_backup_run SET lease_expires_at = clock_timestamp() + interval '1 second' WHERE id = ${run.id}::uuid`;
        const entered = deferred(); const release = deferred(); const paused = pausedContent(entered, release);
        const read = paused.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true });
        try { await entered.promise; await second.$queryRaw`SELECT pg_sleep(1.1)::text`; }
        finally { release.resolve(); }
        expect(await read).toBeNull();
    });
    it("holds the branch/purge guard through content, forcing a concurrent move to wait", async () => {
        const run = await claimed(); const entered = deferred(); const release = deferred(); const paused = pausedContent(entered, release);
        const read = paused.readClaimedSource(identity(run), selectedId, { fileType: "document", withContent: true });
        await entered.promise;
        const moved = second.eformsign_doc.update({ where: { id: docId }, data: { branchId: foreignBranch } });
        // Start Prisma's lazy query while the read holds FOR SHARE.
        const moving = Promise.resolve(moved);
        let finished = false; void moving.then(() => { finished = true; });
        try {
            // Poll from a separate pooled connection because the move itself is blocked.
            const end = Date.now() + 3000;
            let waiting = false;
            while (Date.now() < end) {
                const state = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') AS waiting`;
                if (state[0]?.waiting) { waiting = true; break; }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true); expect(finished).toBe(false);
        } finally { release.resolve(); }
        expect((await read)?.download?.content).toEqual(Uint8Array.from(CONTENT)); await moving;
        expect((await repo.readClaimedSource(identity(run), selectedId))?.source).toBeNull();
    });
});
