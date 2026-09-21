import { PrismaClient } from "@prisma/client";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
    applyRepair,
    readBackup,
    readTargetManifest,
    rollbackRepair,
    type EformsignBranchRepairDatabase,
} from "../../scripts/repair-eformsign-branch-ownership";

const syntheticTargetDocumentId = "0123456789abcdef0123456789abcdef";
const syntheticCustomerName = "홍가람";

async function writeTargetManifest(directory: string): Promise<string> {
    const path = join(directory, "target.json");
    await writeFile(path, JSON.stringify({
        documentId: syntheticTargetDocumentId,
        customerQuery: syntheticCustomerName,
    }), { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
    return path;
}

const databaseUrl = process.env["EFORMSIGN_BRANCH_REPAIR_TEST_DATABASE_URL"];
const integrationEnabled = process.env["EFORMSIGN_BRANCH_REPAIR_INTEGRATION"] === "1";
const isApprovedDisposableDatabase = (() => {
    if (!databaseUrl) return false;
    try {
        const parsed = new URL(databaseUrl);
        return (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
            && parsed.port === "55439"
            && decodeURIComponent(parsed.pathname.replace(/^\//u, "")) === "bjj_eformsign_branch_repair";
    } catch {
        return false;
    }
})();
const describeDisposable = integrationEnabled && isApprovedDisposableDatabase ? describe : describe.skip;

const target = {
    environment: "test",
    databaseHost: "127.0.0.1",
    databaseTarget: "127.0.0.1:55439/bjj_eformsign_branch_repair",
};

describeDisposable("eformsign branch repair transaction (disposable PostgreSQL)", () => {
    let prisma: PrismaClient;
    let hqBranchId: string;
    let qaBranchId: string;
    let candidateDocumentId: string;
    let otherOwnedDocumentId: string;
    let tempDirectory: string;
    let seeded = false;

    beforeAll(async () => {
        prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
        await prisma.$connect();

        const [branchCount, documentCount] = await Promise.all([
            prisma.branch.count(),
            prisma.eformsign_doc.count(),
        ]);
        if (branchCount !== 0 || documentCount !== 0) {
            throw new Error(
                "Refusing eformsign branch repair integration test: disposable database must be empty",
            );
        }

        const [hqBranch, qaBranch] = await Promise.all([
            prisma.branch.create({ data: { name: "Incheon HQ repair test", slug: "incheon", isActive: true } }),
            prisma.branch.create({ data: { name: "QA repair test", slug: "qa", isActive: true } }),
        ]);
        hqBranchId = hqBranch.id;
        qaBranchId = qaBranch.id;
        candidateDocumentId = `repair-candidate-${randomUUID()}`;
        otherOwnedDocumentId = `repair-other-owned-${randomUUID()}`;
        const now = new Date();
        await prisma.eformsign_doc.createMany({
            data: [
                {
                    documentId: syntheticTargetDocumentId,
                    documentName: "repair target",
                    templateName: "legacy maternity",
                    customerName: syntheticCustomerName,
                    createdDate: now,
                    updatedDate: now,
                    statusType: "060",
                    statusDetail: "서명 요청됨",
                    stepType: "01",
                    stepIndex: "1",
                    stepName: "이용자 서명",
                    stepRecipientType: "05",
                    stepRecipientName: "제공기관 검토자",
                    stepRecipientSms: "01012345678",
                    expiredDate: new Date(now.getTime() + 86_400_000),
                    templateId: "d1591da29590495d800f55f1d1fc1378",
                    branchId: null,
                },
                {
                    documentId: candidateDocumentId,
                    documentName: "repair candidate",
                    createdDate: now,
                    updatedDate: now,
                    statusType: "060",
                    statusDetail: "서명 요청됨",
                    stepType: "01",
                    stepIndex: "1",
                    stepName: "이용자 서명",
                    stepRecipientType: "05",
                    stepRecipientName: "제공기관 검토자",
                    stepRecipientSms: "01012345678",
                    expiredDate: new Date(now.getTime() + 86_400_000),
                    templateId: "active-template",
                    branchId: null,
                },
                {
                    documentId: otherOwnedDocumentId,
                    documentName: "repair QA owned",
                    createdDate: now,
                    updatedDate: now,
                    statusType: "060",
                    statusDetail: "서명 요청됨",
                    stepType: "01",
                    stepIndex: "1",
                    stepName: "이용자 서명",
                    stepRecipientType: "05",
                    stepRecipientName: "제공기관 검토자",
                    stepRecipientSms: "01012345678",
                    expiredDate: new Date(now.getTime() + 86_400_000),
                    templateId: "active-template",
                    branchId: qaBranchId,
                },
            ],
        });
        seeded = true;
        tempDirectory = await mkdtemp(join(process.cwd(), ".eformsign-branch-repair-test-"));
    }, 30_000);

    afterAll(async () => {
        if (!prisma) return;
        if (seeded) {
            await prisma.eformsign_doc.deleteMany({
                where: { documentId: { in: [syntheticTargetDocumentId, candidateDocumentId, otherOwnedDocumentId] } },
            });
            await prisma.branch.deleteMany({ where: { id: { in: [hqBranchId, qaBranchId] } } });
        }
        await prisma.$disconnect();
        if (tempDirectory) {
            await rm(tempDirectory, { recursive: true, force: true });
        }
    });

    it("updates only null ownership and preserves another branch in one real transaction", async () => {
        const backupPath = join(tempDirectory, "apply-backup.json");
        const targetInputFile = await writeTargetManifest(tempDirectory);
        await applyRepair(
            prisma as unknown as EformsignBranchRepairDatabase,
            { mode: "apply", backupPath, targetInputFile },
            { id: hqBranchId, slug: "incheon", isActive: true },
            target,
            await readTargetManifest(targetInputFile),
        );

        const rows = await prisma.eformsign_doc.findMany({
            where: { documentId: { in: [syntheticTargetDocumentId, candidateDocumentId, otherOwnedDocumentId] } },
            select: { documentId: true, branchId: true },
        });
        expect(rows).toEqual(expect.arrayContaining([
            { documentId: syntheticTargetDocumentId, branchId: hqBranchId },
            { documentId: candidateDocumentId, branchId: hqBranchId },
            { documentId: otherOwnedDocumentId, branchId: qaBranchId },
        ]));

        await rollbackRepair(
            prisma as unknown as EformsignBranchRepairDatabase,
            await readBackup(backupPath),
            { id: hqBranchId, slug: "incheon", isActive: true },
        );

        const restoredRows = await prisma.eformsign_doc.findMany({
            where: { documentId: { in: [syntheticTargetDocumentId, candidateDocumentId, otherOwnedDocumentId] } },
            select: { documentId: true, branchId: true },
        });
        expect(restoredRows).toEqual(expect.arrayContaining([
            { documentId: syntheticTargetDocumentId, branchId: null },
            { documentId: candidateDocumentId, branchId: null },
            { documentId: otherOwnedDocumentId, branchId: qaBranchId },
        ]));
    });

    it("rolls back the target-fence failure without changing other unassigned rows", async () => {
        await prisma.eformsign_doc.update({
            where: { documentId: syntheticTargetDocumentId },
            data: { branchId: null, templateId: "not-approved" },
        });
        await prisma.eformsign_doc.update({
            where: { documentId: candidateDocumentId },
            data: { branchId: null },
        });

        const targetInputFile = await writeTargetManifest(tempDirectory);
        await expect(applyRepair(
            prisma as unknown as EformsignBranchRepairDatabase,
            {
                mode: "apply",
                backupPath: join(tempDirectory, "fence-backup.json"),
                targetInputFile,
            },
            { id: hqBranchId, slug: "incheon", isActive: true },
            target,
            await readTargetManifest(targetInputFile),
        )).rejects.toThrow("approved historical maternity template");

        const rows = await prisma.eformsign_doc.findMany({
            where: { documentId: { in: [syntheticTargetDocumentId, candidateDocumentId, otherOwnedDocumentId] } },
            select: { documentId: true, branchId: true, templateId: true },
        });
        expect(rows).toEqual(expect.arrayContaining([
            { documentId: syntheticTargetDocumentId, branchId: null, templateId: "not-approved" },
            { documentId: candidateDocumentId, branchId: null, templateId: "active-template" },
            { documentId: otherOwnedDocumentId, branchId: qaBranchId, templateId: "active-template" },
        ]));
    });

    it("rolls back every write when a test-only post-update hook fails", async () => {
        await prisma.eformsign_doc.update({
            where: { documentId: syntheticTargetDocumentId },
            data: { branchId: null, templateId: "d1591da29590495d800f55f1d1fc1378" },
        });
        await prisma.eformsign_doc.update({
            where: { documentId: candidateDocumentId },
            data: { branchId: null },
        });
        const targetInputFile = await writeTargetManifest(tempDirectory);
        await expect(applyRepair(
            prisma as unknown as EformsignBranchRepairDatabase,
            {
                mode: "apply",
                backupPath: join(tempDirectory, "forced-failure-backup.json"),
                targetInputFile,
            },
            { id: hqBranchId, slug: "incheon", isActive: true },
            target,
            await readTargetManifest(targetInputFile),
            {
                afterUpdateMany: () => {
                    throw new Error("forced post-update failure");
                },
            },
        )).rejects.toThrow("forced post-update failure");

        const rows = await prisma.eformsign_doc.findMany({
            where: { documentId: { in: [syntheticTargetDocumentId, candidateDocumentId, otherOwnedDocumentId] } },
            select: { documentId: true, branchId: true },
        });
        expect(rows).toEqual(expect.arrayContaining([
            { documentId: syntheticTargetDocumentId, branchId: null },
            { documentId: candidateDocumentId, branchId: null },
            { documentId: otherOwnedDocumentId, branchId: qaBranchId },
        ]));
    });
});
