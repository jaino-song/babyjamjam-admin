import { createHash, randomUUID } from "crypto";
import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { BackupRunInput } from "domain/repositories/eformsign-backup.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignBackupRepository } from "infrastructure/database/repositories/sb.eformsign-backup.repository";
import { tenantIsolationExtension } from "infrastructure/database/tenant-isolation.extension";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;
function assertThrowawayTarget(): void {
    const url = process.env["DATABASE_URL"];
    const direct = process.env["DIRECT_URL"];
    if (!url || !direct) throw new Error("Refusing real-DB spec without DATABASE_URL and DIRECT_URL");
    if (url !== direct) throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL differ");
    if (!THROWAWAY_URL.test(url)) throw new Error("Refusing real-DB spec: not a local throwaway database");
}

// Deliberately requires an HTTP-origin store with no branch. Without it the extension bypasses
// tenant checks and this regression would not catch a removed runSystemScope in the repository.
describeReal("eformsign backup repository (real PostgreSQL, tenant enforce)", () => {
    let raw: PrismaClient;
    let scoped: PrismaService;
    let repository: SbEformsignBackupRepository;
    const branches: string[] = [];
    const documents: number[] = [];
    const eligible: number[] = [];
    const runs: string[] = [];
    let fileId: string;
    let baselineCursor: number;
    const bytes = Buffer.from([37, 80, 68, 70, 0, 255, 10]);
    const date = new Date("2026-11-07T00:00:00.000Z");
    const previousMode = process.env["TENANT_ISOLATION_MODE"];
    const asHttp = <T>(fn: () => Promise<T>): Promise<T> => tenantContextStore.run({ origin: "http" }, fn);

    beforeAll(async () => {
        assertThrowawayTarget();
        process.env["TENANT_ISOLATION_MODE"] = "enforce";
        for (const level of ["log", "warn", "debug", "error"] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
        }
        raw = new PrismaClient();
        await raw.$connect();
        scoped = new PrismaClient().$extends(tenantIsolationExtension()) as unknown as PrismaService;
        repository = new SbEformsignBackupRepository(scoped);
        baselineCursor = (await raw.eformsign_doc.aggregate({ _max: { id: true } }))._max.id ?? 0;
        for (const name of ["A", "B"]) {
            branches.push((await raw.branch.create({ data: { name, slug: `throwaway-backup-${randomUUID()}` } })).id);
        }
        const seed = async (patch: Partial<Prisma.eformsign_docUncheckedCreateInput>) => {
            const row = await raw.eformsign_doc.create({ data: {
                documentId: randomUUID(), createdDate: date, updatedDate: date, expiredDate: date,
                statusType: "003", statusDetail: "완료", stepType: "", stepIndex: "", stepName: "",
                stepRecipientType: "", stepRecipientName: "", stepRecipientSms: "",
                syncStatus: "ready", detailSourceUpdatedDate: date, ...patch,
            } });
            documents.push(row.id);
            return row;
        };
        const first = await seed({ branchId: branches[0] }); eligible.push(first.id);
        eligible.push((await seed({ branchId: branches[1], statusType: "050" })).id);
        eligible.push((await seed({ branchId: null, statusType: "072" })).id);
        eligible.push((await seed({ branchId: branches[0], voidedAt: date })).id);
        // "partial" is a valid sync-status CHECK value; such docs stay listed with no ready files.
        eligible.push((await seed({ branchId: branches[1], syncStatus: "partial" })).id);
        await seed({ branchId: branches[0], statusType: "001" });
        await seed({ branchId: branches[1], permanentPurgeRequestedAt: date });
        fileId = (await raw.eformsign_doc_file.create({ data: {
            eformsignDocId: first.id, fileType: "document", content: bytes, contentType: "application/pdf",
            byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), sourceUpdatedDate: date,
        } })).id;
    });
    afterAll(async () => {
        try {
            if (raw) {
                await raw.eformsign_backup_daily_run.deleteMany({ where: { id: { in: runs } } });
                await raw.eformsign_doc_file.deleteMany({ where: { eformsignDocId: { in: documents } } });
                await raw.eformsign_doc.deleteMany({ where: { id: { in: documents } } });
                await raw.branch.deleteMany({ where: { id: { in: branches } } });
            }
        } finally {
            await scoped?.$disconnect();
            await raw?.$disconnect();
            if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
            else process.env["TENANT_ISOLATION_MODE"] = previousMode;
            jest.restoreAllMocks();
        }
    });

    it("rejects an unscoped tenant read with http_no_tenant (negative control)", async () => {
        await expect(asHttp(() => scoped.eformsign_doc.findMany({ take: 1 })))
            .rejects.toMatchObject({ kind: "http_no_tenant" });
    });
    it("lists completed docs from both branches, null branch and voided docs, excluding purged/open docs", async () => {
        const rows = await asHttp(() => repository.listDocuments(baselineCursor, 200));
        expect(rows.map((row) => row.id)).toEqual(eligible);
        const listed = rows.find((row) => row.id === eligible[0]);
        expect(listed?.files[0]?.id).toBe(fileId);
        expect(listed).not.toHaveProperty("customerPhone");
        expect(listed).not.toHaveProperty("detailPayload");
        expect(listed?.files[0]).not.toHaveProperty("content");
    });
    it("walks every row exactly once with limit 2", async () => {
        let cursor = baselineCursor;
        const seen: number[] = [];
        for (;;) {
            const rows = await asHttp(() => repository.listDocuments(cursor, 2));
            seen.push(...rows.map((row) => row.id));
            if (rows.length < 2) break;
            cursor = rows[rows.length - 1]?.id ?? cursor;
        }
        expect(seen).toEqual(eligible);
        expect(new Set(seen).size).toBe(seen.length);
    });
    it("reads the exact bytes inside an HTTP-origin scope without a branch", async () => {
        const file = await asHttp(() => repository.findFile(fileId));
        expect(Buffer.from(file?.content ?? [])).toEqual(bytes);
        expect(file?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    });
    it("inserts and lists daily runs newest first without a tenant scope", async () => {
        const input: BackupRunInput = { startedAt: date, finishedAt: date, status: "success", limited: false,
            totalDocs: 5, savedFiles: 2, skippedFiles: 0, failedFiles: 0, driveStatus: "ok", failures: [] };
        // Far-future fixture times sort before unrelated existing throwaway fixture rows.
        const older = await asHttp(() => repository.createRun({ ...input, startedAt: new Date("2098-01-01") }));
        runs.push(older.id);
        const newer = await asHttp(() => repository.createRun({ ...input, startedAt: new Date("2099-01-01") }));
        runs.push(newer.id);
        expect((await asHttp(() => repository.listRuns(2))).map((row) => row.id)).toEqual([newer.id, older.id]);
    });
});
