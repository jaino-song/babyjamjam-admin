import { readFileSync, lstatSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocumentJobRepository } from "./sb.eformsign-document-job.repository";

const cutoff = new Date("2026-09-01T00:00:00.000Z");
const ownedUrl = "postgresql://bjj_document_jobs_test@127.0.0.1:62395/bjj_document_jobs_qa";
const databaseMode = process.env["BJJ_RETENTION_OWNED_DB"];

// Ordinary Jest never constructs a database client, even with inherited DATABASE_URL.
describe("terminal retention query contract (no database)", () => {
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
    beforeAll(() => {
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
});
