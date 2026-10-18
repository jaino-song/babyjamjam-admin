import { PrismaClient } from "@prisma/client";

import { hashExportToken } from "domain/eformsign-backup/export";
import { createExtendedPrismaService } from "infrastructure/database/database.module";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";

function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl || databaseUrl !== directUrl
        || !/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing credential real-DB spec: matching local throwaway targets required");
    }
}
describe("credential real-DB target guard", () => {
    it("refuses missing, mismatched and non-disposable targets", () => {
        const url = "postgresql://test@localhost/throwaway_credential";
        expect(() => assertTarget(url, url)).not.toThrow();
        for (const [a, b] of [["", ""], [url, "other"], ["postgresql://test@remote/throwaway_credential", "postgresql://test@remote/throwaway_credential"],
            ["postgresql://test@localhost/production", "postgresql://test@localhost/production"]]) {
            expect(() => assertTarget(a, b)).toThrow("Refusing");
        }
    });
});

// Synthetic principal prefix: cleanup only ever touches rows this spec wrote.
const PRINCIPAL = "u33-credential-spec";

const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;
describeReal("SbEformsignBackupExportCredentialRepository (real PostgreSQL)", () => {
    let raw: PrismaClient;
    // The extended client is what the application injects; using it here proves
    // the tenant-isolation extension lets this non-tenant table through untouched.
    let extended: ReturnType<typeof createExtendedPrismaService>;
    let repository: SbEformsignBackupExportCredentialRepository;

    beforeAll(async () => {
        assertTarget();
        raw = new PrismaClient();
        await raw.$connect();
        extended = createExtendedPrismaService();
        await extended.$connect();
        repository = new SbEformsignBackupExportCredentialRepository(extended);
    });
    afterAll(async () => {
        if (raw) {
            await raw.eformsign_backup_export_credential.deleteMany({ where: { principalId: { startsWith: PRINCIPAL } } });
            await raw.$disconnect();
        }
        if (extended) await extended.$disconnect();
    });
    afterEach(async () => {
        await raw.eformsign_backup_export_credential.deleteMany({ where: { principalId: { startsWith: PRINCIPAL } } });
    });

    it("issue then lookup by hash finds it; the column holds a 64-hex hash that is not the raw token", async () => {
        const issued = await repository.issue({ principalId: PRINCIPAL, label: "real-db", companyIds: ["company-test"] });

        await expect(repository.findActiveByTokenHash(hashExportToken(issued.token))).resolves.toEqual({
            id: issued.id, principalId: PRINCIPAL, companyIds: ["company-test"],
        });
        const stored = await raw.eformsign_backup_export_credential.findUniqueOrThrow({ where: { id: issued.id } });
        expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(stored.tokenHash).not.toBe(issued.token);
        expect(stored.tokenHash).toBe(hashExportToken(issued.token));
        expect(JSON.stringify(stored)).not.toContain(issued.token);
    });

    it("revoke makes the next lookup null, and is a no-op the second time", async () => {
        const issued = await repository.issue({ principalId: PRINCIPAL, label: "real-db", companyIds: ["company-test"] });
        const hash = hashExportToken(issued.token);

        await expect(repository.revoke(issued.id)).resolves.toBe(true);
        await expect(repository.findActiveByTokenHash(hash)).resolves.toBeNull();
        const revokedAt = (await raw.eformsign_backup_export_credential.findUniqueOrThrow({ where: { id: issued.id } })).revokedAt;
        expect(revokedAt).toBeInstanceOf(Date);
        await expect(repository.revoke(issued.id)).resolves.toBe(false);
        expect((await raw.eformsign_backup_export_credential.findUniqueOrThrow({ where: { id: issued.id } })).revokedAt).toEqual(revokedAt);
    });

    it("rotation precondition: two credentials for one principal are both active, then one is revoked", async () => {
        const first = await repository.issue({ principalId: PRINCIPAL, label: "old", companyIds: ["company-test"] });
        const second = await repository.issue({ principalId: PRINCIPAL, label: "new", companyIds: ["company-test"] });

        await expect(repository.findActiveByTokenHash(hashExportToken(first.token))).resolves.toMatchObject({ principalId: PRINCIPAL });
        await expect(repository.findActiveByTokenHash(hashExportToken(second.token))).resolves.toMatchObject({ principalId: PRINCIPAL });

        await repository.revoke(first.id);

        await expect(repository.findActiveByTokenHash(hashExportToken(first.token))).resolves.toBeNull();
        await expect(repository.findActiveByTokenHash(hashExportToken(second.token))).resolves.toMatchObject({ id: second.id, principalId: PRINCIPAL });
    });

    it("touchLastUsed stamps the row; list returns the new fields and never the hash", async () => {
        const issued = await repository.issue({ principalId: PRINCIPAL, label: "real-db", companyIds: ["company-test", "company-two"] });

        await repository.touchLastUsed(issued.id);
        const listed = (await repository.list()).filter(item => item.principalId === PRINCIPAL);

        expect(listed).toHaveLength(1);
        expect(listed[0]).toEqual({
            id: issued.id, principalId: PRINCIPAL, label: "real-db", companyIds: ["company-test", "company-two"],
            createdAt: expect.any(Date), revokedAt: null, lastUsedAt: expect.any(Date),
        });
        expect(JSON.stringify(listed)).not.toContain(hashExportToken(issued.token));
    });

    it("touchLastUsed on an unknown id does not throw", async () => {
        await expect(repository.touchLastUsed("00000000-0000-4000-8000-0000000000ff")).resolves.toBeUndefined();
    });
});
