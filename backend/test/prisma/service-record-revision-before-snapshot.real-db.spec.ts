import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";

// Matches the opt-in used by CI's test/prisma runner. This spec never opens a
// connection unless both URLs independently identify the same disposable DB.
const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;

export function assertThrowawayTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl) throw new Error("Refusing real-DB spec without DATABASE_URL and DIRECT_URL");
    if (databaseUrl !== directUrl) throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL differ");
    if (!/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing real-DB spec: target must be a loopback throwaway database");
    }
}

describe("revision before-snapshot DB target guard", () => {
    it("accepts loopback throwaway targets and rejects missing, mismatched or remote targets", () => {
        const ok = "postgresql://jaino@127.0.0.1/throwaway_p447be";
        expect(() => assertThrowawayTarget(ok, ok)).not.toThrow();
        expect(() => assertThrowawayTarget("", "")).toThrow(/without/);
        expect(() => assertThrowawayTarget(ok, `${ok}_other`)).toThrow(/differ/);
        for (const bad of ["postgresql://jaino@localhost/production", "postgresql://jaino@db.example.com/throwaway_p447be", `${ok}?schema=public`, "postgresql://user:pw@localhost/throwaway_p447be"]) {
            expect(() => assertThrowawayTarget(bad, bad)).toThrow(/throwaway/);
        }
    });
});

describeReal("service-record revision before snapshot (real PostgreSQL)", () => {
    let prisma: PrismaClient;
    let repository: ServiceRecordEditRepository;

    beforeAll(async () => {
        assertThrowawayTarget();
        prisma = new PrismaClient();
        await prisma.$connect();
        repository = new ServiceRecordEditRepository(prisma as never);
    });
    // Revisions are append-only. Do not weaken the trigger for fixture cleanup;
    // the caller drops the disposable database after this run.
    afterAll(async () => { await prisma?.$disconnect(); });

    it("replays the column patch twice and verifies nullable JSONB", async () => {
        const sql = readFileSync(resolve(__dirname, "../../prisma/migrations/20261016000000_add_service_record_revision_before_snapshot/migration.sql"), "utf8");
        await prisma.$executeRawUnsafe(sql);
        await prisma.$executeRawUnsafe(sql);
        const columns = await prisma.$queryRaw<Array<{ data_type: string; is_nullable: string }>>`
            SELECT data_type, is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'service_record_revision' AND column_name = 'before_snapshot'
        `;
        expect(columns).toEqual([{ data_type: "jsonb", is_nullable: "YES" }]);
        await prisma.$executeRawUnsafe(readFileSync(resolve(__dirname, "../../prisma/scripts/verify-service-record-revision-before-snapshot.sql"), "utf8"));
    });

    it("retains before content and fails closed for other branches, clients, unknown and malformed revisions", async () => {
        const suffix = randomUUID();
        const branch = await prisma.branch.create({ data: { name: "snapshot A", slug: `p447be-a-${suffix}` } });
        const otherBranch = await prisma.branch.create({ data: { name: "snapshot B", slug: `p447be-b-${suffix}` } });
        const client = await prisma.client.create({ data: { branchId: branch.id, name: "snapshot client", voucherClient: false } });
        const otherClient = await prisma.client.create({ data: { branchId: branch.id, name: "other client", voucherClient: false } });
        const record = await prisma.service_record_case.create({ data: { branchId: branch.id, clientId: client.id } });
        const beforeSnapshot = { snapshotVersion: 1, header: { momName: "Before" } };
        const input = { branchId: branch.id, serviceRecordCaseId: record.id, actorUserId: randomUUID(), payload: { header: { momName: "After" } }, plannedSessions: [], provenance: {}, formVersionAtConfirm: 1 };
        const revision = await repository.appendRevision({ ...input, beforeSnapshot });
        expect(await repository.findRevisionForChanges(branch.id, client.id, revision.id)).toMatchObject({ beforeSnapshot });
        expect(await repository.findRevisionForChanges(otherBranch.id, client.id, revision.id)).toBeNull();
        expect(await repository.findRevisionForChanges(branch.id, otherClient.id, revision.id)).toBeNull();
        expect(await repository.findRevisionForChanges(branch.id, client.id, randomUUID())).toBeNull();
        expect(await repository.findRevisionForChanges(branch.id, client.id, "malformed")).toBeNull();
        const legacy = await repository.appendRevision(input);
        expect(await repository.findRevisionForChanges(branch.id, client.id, legacy.id)).toMatchObject({ beforeSnapshot: null });
        expect(await repository.findRevisionForChanges(branch.id, client.id, revision.id)).toMatchObject({ beforeSnapshot });
    });
});
