import { spawnSync } from "node:child_process";
import { readFileSync, lstatSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocumentJobRepository } from "./sb.eformsign-document-job.repository";

const cutoff = new Date("2026-09-01T00:00:00.000Z");
const ownedUrl = "postgresql://bjj_document_jobs_test@127.0.0.1:62395/bjj_document_jobs_qa";
const databaseMode = process.env["BJJ_RETENTION_OWNED_DB"];

// Ordinary Jest never constructs a database client, even with inherited DATABASE_URL.
describe("terminal retention query contract (no database)", () => {
    // Structural safety checks execute locally; the business predicates still require psql/PG.
    function assertReadOnlySnapshot(source: string) {
        const sql = source.replace(/--[^\n]*/g, "").trim();
        expect(sql).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
        expect(sql).toMatch(/SET LOCAL row_security = off;/);
        expect(sql).toMatch(/SET LOCAL search_path = pg_catalog;/);
        expect(sql).toMatch(/SET LOCAL lock_timeout = '5s';/);
        expect(sql).toMatch(/SET LOCAL statement_timeout = '30s';/);
        expect(sql).toMatch(/COMMIT;$/);
        expect(sql).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE|ALTER\s+|DROP\s+|CREATE\s+TABLE|LOCK\s+TABLE|FOR\s+UPDATE|FOR\s+SHARE)\b/i);
        expect(sql).not.toMatch(/^\\/m);
    }
    it.each(["preflight-eformsign-contract-authority-cutover.sql", "preflight-app-rollback-contract-authority.sql"])("keeps %s read-only with a bounded repeatable snapshot and kills unsafe text controls", filename => {
        const source = readFileSync(resolve(__dirname, "../../../prisma/scripts", filename), "utf8");
        assertReadOnlySnapshot(source);
        for (const [from, to] of [
            ["REPEATABLE READ", "READ COMMITTED"], ["READ ONLY", "READ WRITE"],
            ["row_security = off", "row_security = on"], ["search_path = pg_catalog", "search_path = public"],
            ["lock_timeout = '5s'", "lock_timeout = '0'"], ["statement_timeout = '30s'", "statement_timeout = '0'"],
            ["COMMIT;", "DELETE FROM public.eformsign_contract_authority; COMMIT;"],
        ] as const) {
            expect(source).toContain(from);
            expect(() => assertReadOnlySnapshot(source.replace(from, to))).toThrow();
        }
    });
    it("excludes every current authority reference without changing the retention policy", async () => {
        const executeRaw = jest.fn().mockResolvedValue(2);
        const repository = new SbEformsignDocumentJobRepository({
            $executeRaw: executeRaw,
        } as unknown as PrismaService);
        await expect(repository.deleteExpiredTerminal(cutoff)).resolves.toBe(2);
        const query = executeRaw.mock.calls[0]?.[0] as Prisma.Sql;
        expect(query.sql).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM "eformsign_contract_authority" AS authority\s*WHERE authority.creation_job_id = "eformsign_document_job".id\s*\)/);
        expect(query.sql).toContain("completed_at < ?");
        expect(query.sql).toContain("COALESCE(jsonb_typeof(payload) = 'object', false)");
        expect(query.sql).toContain("COALESCE(payload->>'kind' = 'service_record_revision', false)");
        expect(query.sql).toContain("status IN ('completed', 'failed')");
        expect(query.values).toEqual([cutoff]);
        expect(query.sql).not.toMatch(/authority\.(phase|branch_id)\s*=/);
    });
});

(databaseMode === undefined ? describe.skip : describe)("owned PostgreSQL repository retention", () => {
    let prisma: PrismaClient;
    let postmasterProof: string;
    function assertClusterOwnership() {
        // Only the fresh-cluster harness can supply this explicit URL + live ownership marker.
        if (databaseMode !== ownedUrl) throw new Error("Unowned retention database refused");
        const owner = process.env["BJJ_RETENTION_OWNER"] ?? "";
        if (!/^\/tmp\/bjj-authority-retention-pg-[A-Za-z0-9]+$/.test(owner)
            || !lstatSync(owner).isDirectory() || (lstatSync(owner).mode & 0o077) !== 0
            || readFileSync(`${owner}/owner`, "utf8") !== process.env["BJJ_RETENTION_OWNER_PID"]) {
            throw new Error("Missing private cluster ownership");
        }
        process.kill(Number(process.env["BJJ_RETENTION_OWNER_PID"]), 0);
        process.kill(Number(readFileSync(`${owner}/data/postmaster.pid`, "utf8").split("\n")[0]), 0);
        const currentPostmaster = readFileSync(`${owner}/data/postmaster.pid`, "utf8");
        const [, dataDirectory, , port] = currentPostmaster.split("\n");
        if (dataDirectory !== `${owner}/data` || port !== "62395"
            || (postmasterProof !== undefined && postmasterProof !== currentPostmaster)) {
            throw new Error("Owned postmaster identity changed");
        }
        postmasterProof = currentPostmaster;
    }
    beforeAll(() => {
        assertClusterOwnership();
        prisma = new PrismaClient({ datasources: { db: { url: ownedUrl } } });
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    it("pins references in both branches/all phases, preserves policy edges, and releases rotated history", async () => {
        const rollback = new Error("retention fixture rollback");
        const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
        const generation = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
        const branchA = "10000000-0000-0000-0000-000000000001";
        const branchB = "10000000-0000-0000-0000-000000000002";
        let verified = false;
        await expect(prisma.$transaction(async (tx) => {
            expect(await tx.$queryRaw`SELECT id FROM eformsign_document_job`).toEqual([]);
            await tx.$executeRaw`INSERT INTO branch(id,name,slug) VALUES
                (${branchA}::uuid,'Retention A','retention-a'),(${branchB}::uuid,'Retention B','retention-b')`;
            await tx.$executeRaw`INSERT INTO client(id,name,voucher_client,branch_id) VALUES
                (-93001,'Retention A',false,${branchA}::uuid),(-93002,'Retention B',false,${branchB}::uuid)`;
            // 1/2: referenced old terminal; 3/4/13/16: eligible history in both branches;
            // 5/6/7/8: cutoff, recent, nonterminal, NULL completion;
            // 9: revision object; 10/11/12: SQL NULL, JSON null, unrelated object.
            const fixtures = [
                [1, "completed", "2026-08-01", null], [2, "failed", "2026-08-01", null],
                [3, "completed", "2026-08-01", null], [4, "failed", "2026-08-01", null],
                [5, "completed", "2026-09-01", null], [6, "failed", "2026-09-02", null],
                [7, "requires_attention", "2026-08-01", null], [8, "completed", null, null],
                [9, "completed", "2026-08-01", '{"kind":"service_record_revision"}'],
                [10, "failed", "2026-08-01", null], [11, "completed", "2026-08-01", "null"],
                [12, "completed", "2026-08-01", '{"kind":"other"}'],
                [13, "completed", "2026-08-01", null], [14, "queued", "2026-08-01", null],
                [15, "processing", "2026-08-01", null], [16, "failed", "2026-08-01", null],
                [17, "reconciling", "2026-08-01", null],
            ] as const;
            for (const [n, status, completedAt, payload] of fixtures) {
                const secondBranch = n === 2 || n === 13 || n === 16;
                await tx.$executeRaw`INSERT INTO eformsign_document_job
                    (id,branch_id,client_id,contract_generation,job_type,source,request_key,status,completed_at,payload)
                    VALUES (${id(n)}::uuid,${secondBranch ? branchB : branchA}::uuid,
                        ${secondBranch ? -93002 : -93001},${generation(n)}::uuid,
                        'create_document','staff',${`retention-${n}`},${status},${completedAt === null ? null : `${completedAt}T00:00:00.000Z`}::timestamptz,${payload}::jsonb)`;
            }
            await tx.$executeRaw`INSERT INTO eformsign_contract_authority
                (branch_id,client_id,generation,creation_job_id,fingerprint,phase) VALUES
                (${branchA}::uuid,-93001,${generation(1)}::uuid,${id(1)}::uuid,${"a".repeat(64)},'reserved'),
                (${branchB}::uuid,-93002,${generation(2)}::uuid,${id(2)}::uuid,${"b".repeat(64)},'closed')`;
            const repository = new SbEformsignDocumentJobRepository(tx as unknown as PrismaService);
            const remaining = async () => (await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM eformsign_document_job ORDER BY id`).map((row) => row.id);
            const retained = [1, 2, 5, 6, 7, 8, 9, 14, 15, 17].map(id);
            expect(await repository.deleteExpiredTerminal(cutoff)).toBe(7);
            expect(await remaining()).toEqual(retained);
            for (const phase of ["creation_pending", "creation_uncertain", "document_ready", "human_exposed", "verified", "blocked", "closed"]) {
                // human_exposed requires a durable intent; the fixture never calls a provider.
                await tx.$executeRaw`INSERT INTO eformsign_dispatch_intent
                    (id,branch_id,client_id,action,generation,business_key,fingerprint)
                    VALUES (${id(99)}::uuid,${branchA}::uuid,-93001,'manual_process','retention',${"c".repeat(64)},${"d".repeat(64)})
                    ON CONFLICT DO NOTHING`;
                await tx.$executeRaw`UPDATE eformsign_contract_authority SET phase=${phase},
                    provider_document_id='retention-document',human_intent_id=${id(99)}::uuid WHERE client_id=-93001`;
                expect(await repository.deleteExpiredTerminal(cutoff)).toBe(0);
                expect(await remaining()).toEqual(retained);
            }
            // Advancing current authority pins the replacement and releases the prior generation.
            await tx.$executeRaw`UPDATE eformsign_document_job SET status='completed',
                completed_at='2026-08-01T00:00:00.000Z' WHERE id=${id(14)}::uuid`;
            await tx.$executeRaw`UPDATE eformsign_contract_authority SET creation_job_id=${id(14)}::uuid,
                generation=${generation(14)}::uuid,phase='reserved' WHERE client_id=-93001`;
            expect(await repository.deleteExpiredTerminal(cutoff)).toBe(1);
            expect(await remaining()).toEqual(retained.filter((value) => value !== id(1)));
            verified = true;
            throw rollback;
        }, { timeout: 30000 })).rejects.toBe(rollback);
        expect(verified).toBe(true);
        expect(await prisma.$queryRaw`SELECT id FROM eformsign_document_job`).toEqual([]);
        expect(await prisma.$queryRaw`SELECT client_id FROM eformsign_contract_authority`).toEqual([]);
    }, 40000);
    // These tests run only after the same live ownership proof above. Fixtures commit
    // before psql opens a separate session; cleanup never relies on transaction rollback.
    const scripts = {
        cutover: resolve(__dirname, "../../../prisma/scripts/preflight-eformsign-contract-authority-cutover.sql"),
        rollback: resolve(__dirname, "../../../prisma/scripts/preflight-app-rollback-contract-authority.sql"),
    };
    type Tool = keyof typeof scripts;
    type Verdict = "LEGACY_CUTOVER_CLEAR" | "COMPATIBLE_FORWARD_ONLY_OLD_ROLLBACK_UNSUPPORTED" | "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR";
    const branch = "10000000-0000-0000-0000-000000000081";
    const client = -93801;
    const jobId = "20000000-0000-0000-0000-000000000081";
    const intentId = "50000000-0000-0000-0000-000000000081";
    const generationId = "30000000-0000-0000-0000-000000000081";
    const fingerprint = "e".repeat(64);
    const forward = "COMPATIBLE_FORWARD_ONLY_OLD_ROLLBACK_UNSUPPORTED" as const;

    // Full content, not just counts, for every public table. The fresh owned cluster
    // contains synthetic data only. Renamed-table failure fixtures are included too.
    async function snapshot() {
        const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
            SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`;
        return Promise.all(tables.map(async ({ tablename }) => ({
            table: tablename,
            rows: await prisma.$queryRaw(Prisma.sql`SELECT row_to_json(t)::text AS content
                FROM public.${Prisma.raw(`"${tablename.replaceAll('"', '""')}"`)} t ORDER BY row_to_json(t)::text`),
        })));
    }
    function runFile(tool: Tool, prefix?: string, path = scripts[tool]) {
        assertClusterOwnership();
        // No inherited PG*, service/password files, app URLs, Node preloads or psqlrc.
        // The URL is the literal gated owner URL, never DATABASE_URL from the shell.
        const result = spawnSync("psql", ["--no-psqlrc", "--no-password", "--dbname", ownedUrl,
            "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=terse",
            ...(prefix ? ["--command", prefix] : []), "--file", path], {
            env: { PATH: process.env["PATH"], LANG: "C", LC_ALL: "C", PGCONNECT_TIMEOUT: "3", PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null" },
            encoding: "utf8", timeout: 40000, maxBuffer: 1024 * 1024,
        });
        if (result.error) throw result.error;
        expect(result.signal).toBeNull();
        return { status: result.status, output: result.stdout + result.stderr };
    }
    async function report(tool: Tool, verdict: Verdict | null, counts: Record<string, number> = {}, prefix?: string, path?: string) {
        const before = await snapshot();
        try {
            const result = runFile(tool, prefix, path);
            expect(result.status).toBe(verdict === null ? 3 : 0);
            const verdicts = result.output.match(/VERDICT: [A-Z_]+/g) ?? [];
            expect(verdicts).toEqual(verdict === null ? [] : [`VERDICT: ${verdict}`]);
            for (const [key, value] of Object.entries(counts)) {
                expect(result.output).toMatch(new RegExp(`(?:^|[ \\n])${key}=${value}(?:[ \\n]|$)`));
            }
            // Even refusal diagnostics must not expose fixture identity or payload.
            for (const privateValue of [branch, jobId, intentId, generationId, "QA-private-payload", "QA-private-document"]) {
                expect(result.output).not.toContain(privateValue);
            }
            return result.output;
        } finally {
            expect(await snapshot()).toEqual(before);
        }
    }
    async function fixtures(run: () => Promise<void>) {
        const baseline = await snapshot();
        try {
            await prisma.$executeRaw`INSERT INTO branch(id,name,slug) VALUES (${branch}::uuid,'QA-SQL report','qa-sql-report')`;
            await prisma.$executeRaw`INSERT INTO client(id,name,voucher_client,branch_id)
                VALUES (${client},'QA-SQL report',false,${branch}::uuid)`;
            await run();
        } finally {
            await prisma.$executeRaw`DELETE FROM eformsign_contract_authority WHERE branch_id=${branch}::uuid`;
            await prisma.$executeRaw`DELETE FROM eformsign_dispatch_intent WHERE branch_id=${branch}::uuid`;
            await prisma.$executeRaw`DELETE FROM eformsign_document_job WHERE branch_id=${branch}::uuid`;
            await prisma.$executeRaw`DELETE FROM client WHERE id=${client}`;
            await prisma.$executeRaw`DELETE FROM branch WHERE id=${branch}::uuid`;
            expect(await snapshot()).toEqual(baseline);
        }
    }
    async function job(options: { status?: string; payload?: string | null; active?: boolean; bound?: boolean; requestKey?: string; source?: string; jobType?: string } = {}) {
        await prisma.$executeRaw`INSERT INTO eformsign_document_job
            (id,branch_id,client_id,contract_generation,job_type,source,request_key,status,payload,active_key,completed_at)
            VALUES (${jobId}::uuid,${branch}::uuid,${client},${options.bound ? generationId : null}::uuid,
                ${options.jobType ?? "create_document"},${options.source ?? "staff"},${options.requestKey ?? "qa-report-contract"},
                ${options.status ?? "queued"},${options.payload ?? null}::jsonb,${options.active ? "qa-report-active" : null},
                '2026-01-01T00:00:00Z'::timestamptz)`;
    }
    async function intent(action = "create", status = "uncertain") {
        await prisma.$executeRaw`INSERT INTO eformsign_dispatch_intent
            (id,branch_id,client_id,action,status,generation,business_key,fingerprint,provider_document_id,reconciled_outcome)
            VALUES (${intentId}::uuid,${branch}::uuid,${client},${action},${status},'business-generation-not-authority-uuid',
                ${fingerprint},${fingerprint},${status === "accepted" ? "QA-private-document" : null},
                ${status === "reconciled_delivered" ? "delivered" : status === "reconciled_not_delivered" ? "not_delivered" : null})`;
    }
    async function authority(phase = "reserved", action?: string) {
        await prisma.$executeRaw`INSERT INTO eformsign_contract_authority
            (branch_id,client_id,generation,creation_job_id,fingerprint,phase,provider_document_id,creation_intent_id,draft_intent_id,human_intent_id)
            VALUES (${branch}::uuid,${client},${generationId}::uuid,${jobId}::uuid,${fingerprint},${phase},
                ${["document_ready", "human_exposed", "verified"].includes(phase) ? "QA-private-document" : null},
                ${action === "create" ? intentId : null}::uuid,${action === "create_draft" ? intentId : null}::uuid,
                ${phase === "human_exposed" ? intentId : null}::uuid)`;
    }
    it("runs both actual files against the empty baseline with one zero-exit verdict each", async () => {
        await report("cutover", "LEGACY_CUTOVER_CLEAR", { authority_total: 0, legacy_unbound_recoverable_staff_create_jobs: 0 });
        await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR", { authority_total: 0, generation_bound_nonterminal_jobs: 0 });
    });
    it.each(["queued", "processing", "reconciling", "requires_attention"])("refuses legacy %s even without payload; queued includes retries", async status => {
        await fixtures(async () => {
            await job({ status });
            await report("cutover", null, { legacy_unbound_recoverable_staff_create_jobs: 1 });
            await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR");
        });
    });
    it.each([
        { name: "expired payload", payload: '{"private":"QA-private-payload"}' },
        { name: "empty object payload", payload: "{}" },
        { name: "JSON null payload", payload: "null" },
        { name: "active key after purge", active: true },
    ])("refuses failed legacy $name", async options => {
        await fixtures(async () => {
            await job({ ...options, status: "failed" });
            await report("cutover", null, { legacy_unbound_recoverable_staff_create_jobs: 1 });
        });
    });
    it("allows fully retired unbound failed history without payload/key/effect", async () => {
        await fixtures(async () => {
            await job({ status: "failed" });
            await report("cutover", "LEGACY_CUTOVER_CLEAR", { legacy_unbound_recoverable_staff_create_jobs: 0 });
            await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR");
        });
    });
    it.each(["create", "create_draft"])("counts payload-purged failed legacy work with unresolved %s", async action => {
        await fixtures(async () => {
            await job({ status: "failed" }); await intent(action);
            await report("cutover", null, { legacy_unbound_recoverable_staff_create_jobs: 1,
                legacy_payload_purged_with_unresolved_effect: 1, unresolved_unbound_create_or_draft: 1 });
            await report("rollback", null, { unresolved_unbound_create_or_draft: 1 });
        });
    });
    it.each(["queued", "processing", "reconciling", "requires_attention"])("reports bound %s work as forward-only and refuses old rollback", async status => {
        await fixtures(async () => {
            await job({ status, bound: true });
            await report("cutover", forward, { generation_bound_nonterminal_jobs: 1, authority_total: 0 });
            await report("rollback", null, { generation_bound_nonterminal_jobs: 1 });
        });
    });
    it.each(["reserved", "creation_pending", "creation_uncertain", "document_ready", "human_exposed", "verified", "blocked", "closed"])("reports ALL authority history including %s as old-rollback unsupported", async phase => {
        await fixtures(async () => {
            await job({ bound: true, status: "completed" });
            if (phase === "human_exposed") await intent("manual_process", "prepared");
            await authority(phase);
            const output = await report("cutover", forward, { authority_total: 1, generation_bound_nonterminal_jobs: 0 });
            expect(output).toContain(`"${phase}": 1`);
            await report("rollback", null, { authority_total: 1 });
        });
    });
    it.each(["create", "create_draft"].flatMap(action => ["started", "uncertain"].map(status => ({ action, status }))))("refuses unbound $action/$status even without a job", async ({ action, status }) => {
        await fixtures(async () => {
            await intent(action, status);
            await report("cutover", null, { unresolved_unbound_create_or_draft: 1, unresolved_bound_create_or_draft: 0 });
            await report("rollback", null, { unresolved_unbound_create_or_draft: 1 });
        });
    });
    it.each(["create", "create_draft"].flatMap(action => ["started", "uncertain"].map(status => ({ action, status }))))("counts scoped authority-linked $action/$status independently of business generation", async ({ action, status }) => {
        await fixtures(async () => {
            await job({ bound: true, status: "completed" }); await intent(action, status); await authority("closed", action);
            await report("cutover", forward, { unresolved_unbound_create_or_draft: 0, unresolved_bound_create_or_draft: 1 });
            await report("rollback", null, { unresolved_bound_create_or_draft: 1 });
        });
    });
    it.each(["prepared", "accepted", "reconciled_delivered", "reconciled_not_delivered"])("does not mistake %s create history for an unresolved effect", async status => {
        await fixtures(async () => {
            await intent("create", status);
            await report("cutover", "LEGACY_CUTOVER_CLEAR", { unresolved_unbound_create_or_draft: 0 });
            await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR");
        });
    });
    it.each(["finalize", "manual_process"])("does not expand the reviewed effect blocker to %s", async action => {
        await fixtures(async () => {
            await intent(action);
            await report("cutover", "LEGACY_CUTOVER_CLEAR");
            await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR");
        });
    });
    it.each([
        { name: "revision request key after purge", requestKey: "service-record-qa-report", keyCount: 1, payloadCount: 0 },
        { name: "revision payload", payload: '{"kind":"service_record_revision"}', keyCount: 0, payloadCount: 1 },
        { name: "finalize job", jobType: "finalize_document", keyCount: 0, payloadCount: 0 },
        { name: "automatic finalize", jobType: "finalize_document", source: "auto_finalize", keyCount: 0, payloadCount: 0 },
    ])("preserves $name distinction", async options => {
        await fixtures(async () => {
            await job(options);
            await report("cutover", "LEGACY_CUTOVER_CLEAR", { legacy_unbound_recoverable_staff_create_jobs: 0,
                service_record_request_key_jobs: options.keyCount, service_record_revision_payload_jobs: options.payloadCount });
            await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR");
        });
    });
    it("still refuses an unresolved create effect on a revision-classified client", async () => {
        await fixtures(async () => {
            await job({ requestKey: "service-record-qa-report" }); await intent();
            await report("cutover", null, { legacy_unbound_recoverable_staff_create_jobs: 0, unresolved_unbound_create_or_draft: 1 });
            await report("rollback", null);
        });
    });
    it("refuses an unknown payload kind instead of silently excluding an ambiguous create", async () => {
        await fixtures(async () => {
            await job({ payload: '{"kind":"unexpected"}' });
            await report("cutover", null, { unexpected_staff_create_payload_kinds: 1 });
        });
    });
    it.each([
        { table: "eformsign_document_job", constraint: "eformsign_document_job_status_check", update: "status='unknown'", setup: "job", count: "unexpected_jobs" },
        { table: "eformsign_dispatch_intent", constraint: "eformsign_dispatch_intent_action_check", update: "action='unknown'", setup: "intent", count: "unexpected_intents" },
        { table: "eformsign_contract_authority", constraint: "authority_phase_check", update: "phase='unknown'", setup: "authority", count: "unexpected_authorities" },
    ])("refuses unexpected persisted states in $table and restores its exact CHECK", async ({ table, constraint, update, setup, count }) => {
        const [check] = await prisma.$queryRaw<Array<{ definition: string }>>`
            SELECT pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
            WHERE conrelid=${`public.${table}`}::regclass AND conname=${constraint}`;
        if (!check) throw new Error("Missing fixture CHECK");
        await fixtures(async () => {
            if (setup === "intent") await intent();
            else await job({ bound: setup === "authority", status: "completed" });
            if (setup === "authority") await authority();
            await prisma.$executeRawUnsafe(`ALTER TABLE public.${table} DROP CONSTRAINT ${constraint}`);
            try {
                await prisma.$executeRawUnsafe(`UPDATE public.${table} SET ${update} WHERE branch_id='${branch}'::uuid`);
                await report("cutover", null, { [count]: 1 });
                await report("rollback", null, { [count]: 1 });
            } finally {
                // Restore valid rows before restoring the exact catalog definition.
                await prisma.$executeRawUnsafe(`UPDATE public.${table} SET ${setup === "job" ? "status='completed'" : setup === "intent" ? "action='create'" : "phase='reserved'"} WHERE branch_id='${branch}'::uuid`);
                await prisma.$executeRawUnsafe(`ALTER TABLE public.${table} ADD CONSTRAINT ${constraint} ${check.definition}`);
            }
        });
    });
    it.each([
        { name: "authority table", hide: 'ALTER TABLE public.eformsign_contract_authority RENAME TO qa_hidden_authority',
            restore: 'ALTER TABLE public.qa_hidden_authority RENAME TO eformsign_contract_authority' },
        { name: "job generation column", hide: 'ALTER TABLE public.eformsign_document_job RENAME COLUMN contract_generation TO qa_hidden_generation',
            restore: 'ALTER TABLE public.eformsign_document_job RENAME COLUMN qa_hidden_generation TO contract_generation' },
        { name: "intent action column", hide: 'ALTER TABLE public.eformsign_dispatch_intent RENAME COLUMN action TO qa_hidden_action',
            restore: 'ALTER TABLE public.eformsign_dispatch_intent RENAME COLUMN qa_hidden_action TO action' },
    ])("fails nonzero when required $name is missing and restores the schema", async ({ hide, restore }) => {
        const baseline = await snapshot();
        await prisma.$executeRawUnsafe(hide); // Fixed test-only DDL, after the owned gate.
        try {
            await report("cutover", null); await report("rollback", null);
        } finally {
            await prisma.$executeRawUnsafe(restore);
            expect(await snapshot()).toEqual(baseline);
        }
        await report("cutover", "LEGACY_CUTOVER_CLEAR");
        await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR");
    });
    it.each(["privilege", "RLS"])("fails closed on %s instead of returning filtered zero", async mode => {
        const baseline = await snapshot();
        await prisma.$executeRawUnsafe('CREATE ROLE qa_authority_report_reader NOLOGIN NOSUPERUSER NOBYPASSRLS');
        try {
            await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO qa_authority_report_reader');
            if (mode === "RLS") {
                await prisma.$executeRawUnsafe('GRANT SELECT ON public.eformsign_document_job, public.eformsign_dispatch_intent, public.eformsign_contract_authority TO qa_authority_report_reader');
            }
            for (const tool of ["cutover", "rollback"] as const) {
                const output = await report(tool, null, {}, 'SET ROLE qa_authority_report_reader');
                expect(output).toMatch(mode === "RLS" ? /row.level security/ : /permission denied/);
            }
        } finally {
            await prisma.$executeRawUnsafe('DROP OWNED BY qa_authority_report_reader');
            await prisma.$executeRawUnsafe('DROP ROLE qa_authority_report_reader');
            expect(await snapshot()).toEqual(baseline);
        }
        await report("cutover", "LEGACY_CUTOVER_CLEAR");
        await report("rollback", "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR");
    });
    it.each([
        { tool: "cutover" as const, from: "IF legacy_recoverable > 0 OR unbound_effects > 0 THEN", to: "IF false THEN", kind: "legacy" },
        { tool: "rollback" as const, from: "IF authority_total > 0 OR bound_nonterminal > 0 OR unbound_effects > 0 OR bound_effects > 0 THEN", to: "IF false THEN", kind: "closed authority" },
    ])("kills the $kind refusal mutant through the actual SQL-file exit oracle", async ({ tool, from, to }) => {
        await fixtures(async () => {
            await job({ bound: tool === "rollback", status: tool === "rollback" ? "completed" : "queued" });
            if (tool === "rollback") await authority("closed");
            await report(tool, null);
            const source = readFileSync(scripts[tool], "utf8");
            expect(source).toContain(from);
            const path = `${process.env["BJJ_RETENTION_OWNER"]}/qa-${tool}-mutant.sql`;
            writeFileSync(path, source.replace(from, to), { flag: "wx", mode: 0o600 });
            try {
                // The normal refusal oracle must fail for the deliberately unsafe mutant.
                await expect(report(tool, null, {}, undefined, path)).rejects.toThrow();
                await report(tool, tool === "cutover" ? "LEGACY_CUTOVER_CLEAR" : "OLD_APP_ROLLBACK_PREFLIGHT_CLEAR", {}, undefined, path);
            } finally { rmSync(path, { force: true }); }
        });
    });

});
