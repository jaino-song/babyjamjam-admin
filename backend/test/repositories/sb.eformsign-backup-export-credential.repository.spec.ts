import { Logger } from "@nestjs/common";

import { hashExportToken } from "domain/eformsign-backup/export";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the one Prisma delegate the repository touches. */
function fakePrisma() {
    const rows: Row[] = [];
    const delegate = {
        create: jest.fn(async ({ data }: { data: Row }) => {
            const row = { id: `00000000-0000-4000-8000-00000000000${rows.length + 1}`, createdAt: new Date("2026-10-19T00:00:00Z"),
                revokedAt: null, lastUsedAt: null, ...data };
            rows.push(row);
            return row;
        }),
        findFirst: jest.fn(async ({ where }: { where: Row }) => rows.find(row =>
            Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
        updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const hits = rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
            hits.forEach(row => Object.assign(row, data));
            return { count: hits.length };
        }),
        findMany: jest.fn(async ({ select }: { select?: Record<string, boolean> }) => rows.map(row => {
            if (!select) return { ...row };
            return Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key]) => [key, row[key]]));
        })),
    };
    return { rows, delegate, prisma: { eformsign_backup_export_credential: delegate } };
}

describe("SbEformsignBackupExportCredentialRepository", () => {
    it("issue stores only the hash and returns the raw token once", async () => {
        const { prisma, rows, delegate } = fakePrisma();
        const repository = new SbEformsignBackupExportCredentialRepository(prisma as never);

        const issued = await repository.issue({ principalId: "backup-worker-1", label: "worker", companyIds: ["C1"] });

        expect(issued.token).toMatch(/^ebx_[A-Za-z0-9_-]{43}$/);
        expect(issued.id).toEqual(expect.any(String));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.["tokenHash"]).toBe(hashExportToken(issued.token));
        expect(JSON.stringify(delegate.create.mock.calls)).not.toContain(issued.token);
        expect(JSON.stringify(rows)).not.toContain(issued.token);
    });

    it("findActiveByTokenHash returns the principal view and excludes revoked rows", async () => {
        const { prisma } = fakePrisma();
        const repository = new SbEformsignBackupExportCredentialRepository(prisma as never);
        const issued = await repository.issue({ principalId: "backup-worker-1", label: "worker", companyIds: ["C1", "C2"] });
        const hash = hashExportToken(issued.token);

        await expect(repository.findActiveByTokenHash(hash)).resolves.toEqual({
            id: issued.id, principalId: "backup-worker-1", companyIds: ["C1", "C2"],
        });
        await expect(repository.findActiveByTokenHash(hashExportToken("ebx_other"))).resolves.toBeNull();

        await expect(repository.revoke(issued.id)).resolves.toBe(true);
        await expect(repository.findActiveByTokenHash(hash)).resolves.toBeNull();
    });

    it("findActiveByTokenHash filters on revokedAt in a single query", async () => {
        const { prisma, delegate } = fakePrisma();
        const repository = new SbEformsignBackupExportCredentialRepository(prisma as never);

        await repository.findActiveByTokenHash("a".repeat(64));

        expect(delegate.findFirst).toHaveBeenCalledTimes(1);
        expect(delegate.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { tokenHash: "a".repeat(64), revokedAt: null } });
    });

    it("revoke reports whether a row changed and never re-revokes", async () => {
        const { prisma, rows } = fakePrisma();
        const repository = new SbEformsignBackupExportCredentialRepository(prisma as never);
        const issued = await repository.issue({ principalId: "backup-worker-1", label: "worker", companyIds: ["C1"] });

        await expect(repository.revoke(issued.id)).resolves.toBe(true);
        const revokedAt = rows[0]?.["revokedAt"];
        expect(revokedAt).toBeInstanceOf(Date);
        await expect(repository.revoke(issued.id)).resolves.toBe(false);
        expect(rows[0]?.["revokedAt"]).toBe(revokedAt);
        await expect(repository.revoke("00000000-0000-4000-8000-0000000000ff")).resolves.toBe(false);
    });

    it("touchLastUsed swallows errors and logs neither token nor hash", async () => {
        const { prisma, delegate } = fakePrisma();
        delegate.updateMany.mockRejectedValueOnce(new Error("db down for ebx_secret " + "f".repeat(64)));
        const debug = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
        const repository = new SbEformsignBackupExportCredentialRepository(prisma as never);

        await expect(repository.touchLastUsed("cred-1")).resolves.toBeUndefined();

        expect(JSON.stringify(debug.mock.calls)).not.toMatch(/ebx_|[0-9a-f]{64}/);
        debug.mockRestore();
    });

    it("touchLastUsed sets lastUsedAt on the row", async () => {
        const { prisma, rows } = fakePrisma();
        const repository = new SbEformsignBackupExportCredentialRepository(prisma as never);
        const issued = await repository.issue({ principalId: "backup-worker-1", label: "worker", companyIds: ["C1"] });

        await repository.touchLastUsed(issued.id);

        expect(rows[0]?.["lastUsedAt"]).toBeInstanceOf(Date);
    });

    it("list never returns the token hash", async () => {
        const { prisma, delegate } = fakePrisma();
        const repository = new SbEformsignBackupExportCredentialRepository(prisma as never);
        const issued = await repository.issue({ principalId: "backup-worker-1", label: "worker", companyIds: ["C1"] });

        const listed = await repository.list();

        expect(listed).toEqual([{
            id: issued.id, principalId: "backup-worker-1", label: "worker", companyIds: ["C1"],
            createdAt: expect.any(Date), revokedAt: null, lastUsedAt: null,
        }]);
        expect(JSON.stringify(listed)).not.toContain(hashExportToken(issued.token));
        expect(Object.keys(listed[0] ?? {})).not.toContain("tokenHash");
        expect(delegate.findMany.mock.calls[0]?.[0]).toMatchObject({ select: expect.not.objectContaining({ tokenHash: true }) });
    });
});
