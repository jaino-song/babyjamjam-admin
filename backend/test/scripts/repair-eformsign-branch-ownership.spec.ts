import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
    applyRepair,
    assertPostApplyTargetVerification,
    createBackup,
    parseRepairOptions,
    readBranchCounts,
    resolveTargetBranch,
    rollbackRepair,
    validateBackup,
    verifyTargetDocument,
    writeBackup,
    type EformsignBranchRepairBackup,
    type EformsignBranchRepairDatabase,
} from "../../scripts/repair-eformsign-branch-ownership";

const execFileAsync = promisify(execFile);

const branch = { id: "branch-incheon", slug: "incheon", isActive: true } as const;
const target = {
    environment: "development",
    databaseHost: "db.example.com",
    databaseTarget: "db.example.com:5432/app?schema=public&tenant=project",
};

function createDatabase(options: {
    candidateRows?: Array<{ id: number; documentId: string; branchId: string | null }>;
    targetRow?: {
        id: number;
        documentId: string;
        branchId: string | null;
        templateId: string | null;
        customerName: string | null;
    };
} = {}): EformsignBranchRepairDatabase & {
    branch: { findMany: jest.Mock };
    eformsign_doc: {
        findMany: jest.Mock;
        groupBy: jest.Mock;
        updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
} {
    const candidateRows = options.candidateRows ?? [
        { id: 1, documentId: "doc-1", branchId: null },
        { id: 2, documentId: "doc-2", branchId: null },
    ];
    const targetRow = options.targetRow ?? {
        id: 99,
        documentId: "a16f415f80bc4dfe834ca2882f103b25",
        branchId: null,
        templateId: "d1591da29590495d800f55f1d1fc1378",
        customerName: "배진경",
    };
    const databaseRef: { current?: {
        branch: { findMany: jest.Mock };
        eformsign_doc: {
            findMany: jest.Mock;
            groupBy: jest.Mock;
            updateMany: jest.Mock;
        };
        $transaction: jest.Mock;
    } } = {};
    const database = {
        branch: {
            findMany: jest.fn((args: { where?: { slug?: string } }) =>
                args.where?.slug ? [branch] : [branch, { id: "branch-qa", slug: "qa", isActive: true }]),
        },
        eformsign_doc: {
            findMany: jest.fn((args: {
                where?: {
                    documentId?: string;
                    branchId?: string | null;
                    id?: { in: number[] };
                };
            }) => {
                if (args.where?.documentId) return [targetRow];
                if (args.where?.id) {
                    return candidateRows.map((row) => ({ ...row, branchId: branch.id }));
                }
                return candidateRows;
            }),
            groupBy: jest.fn().mockResolvedValue([
                { branchId: null, _count: { _all: candidateRows.length } },
                { branchId: branch.id, _count: { _all: 3 } },
            ]),
            updateMany: jest.fn((args: { data?: { branchId?: string | null } }) => {
                if (args.data?.branchId === branch.id) {
                    targetRow.branchId = branch.id;
                }
                return Promise.resolve({ count: candidateRows.length });
            }),
        },
        $transaction: jest.fn(async (callback: (transaction: EformsignBranchRepairDatabase) => Promise<unknown>) =>
            callback(databaseRef.current as unknown as EformsignBranchRepairDatabase)),
    };
    databaseRef.current = database;
    return database as unknown as EformsignBranchRepairDatabase & {
        branch: { findMany: jest.Mock };
        eformsign_doc: {
            findMany: jest.Mock;
            groupBy: jest.Mock;
            updateMany: jest.Mock;
        };
        $transaction: jest.Mock;
    };
}

describe("repair-eformsign-branch-ownership operator", () => {
    it("runs through the documented package command without a path-alias module failure", async () => {
        const environment = { ...process.env };
        delete environment["NODE_PATH"];

        let executionError: unknown;
        try {
            await execFileAsync(
                "pnpm",
                [
                    "--filter",
                    "./backend",
                    "repair:eformsign-branch-ownership",
                    "--help",
                ],
                {
                    cwd: resolve(__dirname, "../../.."),
                    env: environment,
                },
            );
        } catch (error: unknown) {
            executionError = error;
        }

        expect(executionError).toBeDefined();
        const output = executionError as { stdout?: string; stderr?: string };
        const combinedOutput = `${output.stdout ?? ""}${output.stderr ?? ""}`;
        expect(combinedOutput).toContain("Usage:");
        expect(combinedOutput).not.toContain("Cannot find module");
    });

    it("defaults to a read-only dry-run and requires strong mutation flags", () => {
        expect(parseRepairOptions([])).toEqual({ mode: "dry-run" });
        expect(() => parseRepairOptions([
            "--apply",
            "--backup-path",
            "/tmp/backup.json",
            "--confirm-target",
            "development@db.example.com:5432/app?schema=public&tenant=project",
            "--confirm-branch-slug",
            "incheon",
        ])).not.toThrow();
        expect(() => parseRepairOptions(["--apply", "--backup-path", "/tmp/backup.json"]))
            .toThrow("Mutation requires --confirm-target");
        expect(() => parseRepairOptions([
            "--rollback",
            "/tmp/backup.json",
            "--confirm-target",
            "target",
            "--confirm-branch-slug",
            "qa",
        ])).toThrow("--confirm-branch-slug incheon");
    });

    it("writes a minimum-field chmod-600 backup and rejects extra payload fields", async () => {
        const rows = [{ id: 1, documentId: "doc-1", branchId: null }];
        const backup = createBackup(rows, branch, target, "2026-09-21T00:00:00.000Z");
        const directory = await mkdtemp(join(tmpdir(), "eformsign-branch-repair-"));
        const backupPath = join(directory, "backup.json");
        try {
            await writeBackup(backupPath, backup);
            expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
            const parsed = JSON.parse(await readFile(backupPath, "utf8")) as Record<string, unknown>;
            expect(JSON.stringify(parsed)).not.toContain("customerName");
            expect(validateBackup(parsed)).toEqual(backup);
            expect(() => validateBackup({ ...parsed, createdAt: "2026-09-21" })).toThrow(
                "Backup createdAt is invalid",
            );
            expect(() => validateBackup({ ...parsed, customerName: "배진경" })).toThrow(
                "contains unsupported fields",
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("resolves exactly one active HQ branch and reports sanitized branch counts", async () => {
        const database = createDatabase();
        await expect(resolveTargetBranch(database)).resolves.toEqual(branch);
        await expect(readBranchCounts(database)).resolves.toEqual({
            unassigned: 2,
            incheon: 3,
        });
    });

    it("verifies the target branch, list-only template, and persisted Korean customer search", async () => {
        const database = createDatabase();
        await expect(verifyTargetDocument(database, branch.id)).resolves.toEqual({
            found: true,
            currentBranchMatchesTarget: false,
            templateIsListOnlyHistoricalMaternity: true,
            customerNameMatchesExactQuery: true,
            customerNameMatchesChosungQuery: true,
        });
    });

    it("writes the secure backup before a fenced one-transaction apply", async () => {
        const database = createDatabase();
        const directory = await mkdtemp(join(tmpdir(), "eformsign-branch-repair-"));
        const backupPath = join(directory, "backup.json");
        try {
            await applyRepair(
                database,
                { mode: "apply", backupPath },
                branch,
                target,
            );
            expect(database.$transaction).toHaveBeenCalledTimes(1);
            expect(database.$transaction.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
                isolationLevel: "Serializable",
            }));
            expect(database.eformsign_doc.updateMany).toHaveBeenCalledWith({
                where: { branchId: null },
                data: { branchId: branch.id },
            });
            const backup = JSON.parse(await readFile(backupPath, "utf8")) as EformsignBranchRepairBackup;
            expect(backup.rows).toHaveLength(2);
            expect(backup.rows[0]).toEqual({ id: 1, documentId: "doc-1", priorBranchId: null });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it.each([
        {
            name: "other branch ownership",
            targetRow: {
                id: 99,
                documentId: "a16f415f80bc4dfe834ca2882f103b25",
                branchId: "branch-qa",
                templateId: "d1591da29590495d800f55f1d1fc1378",
                customerName: "배진경",
            },
            error: "already owned by another branch",
        },
        {
            name: "unapproved template",
            targetRow: {
                id: 99,
                documentId: "a16f415f80bc4dfe834ca2882f103b25",
                branchId: null,
                templateId: "active-template",
                customerName: "배진경",
            },
            error: "not an approved historical maternity template",
        },
        {
            name: "customer search mismatch",
            targetRow: {
                id: 99,
                documentId: "a16f415f80bc4dfe834ca2882f103b25",
                branchId: null,
                templateId: "e63c528b0375478d83e30ff8a9ed1967",
                customerName: "김고객",
            },
            error: "customer name does not satisfy",
        },
    ])("fences apply before bulk update for $name", async ({ targetRow, error }) => {
        const database = createDatabase({ targetRow });
        const directory = await mkdtemp(join(tmpdir(), "eformsign-branch-repair-"));
        const backupPath = join(directory, "backup.json");
        try {
            await expect(applyRepair(database, { mode: "apply", backupPath }, branch, target))
                .rejects.toThrow(error);
            expect(database.eformsign_doc.updateMany).not.toHaveBeenCalled();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("fails when the target is not HQ-owned after the bulk update", async () => {
        const database = createDatabase();
        database.eformsign_doc.updateMany.mockImplementationOnce(() =>
            Promise.resolve({ count: 2 }));
        const directory = await mkdtemp(join(tmpdir(), "eformsign-branch-repair-"));
        const backupPath = join(directory, "backup.json");
        try {
            await expect(applyRepair(database, { mode: "apply", backupPath }, branch, target))
                .rejects.toThrow("was not assigned to the selected HQ branch");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("treats every false post-apply verification field as a failure", () => {
        expect(() => assertPostApplyTargetVerification({
            found: true,
            currentBranchMatchesTarget: false,
            templateIsListOnlyHistoricalMaternity: true,
            customerNameMatchesExactQuery: true,
            customerNameMatchesChosungQuery: true,
        })).toThrow("Post-apply target verification failed");
    });

    it("rolls back only the exact rows still owned by the applied branch", async () => {
        const database = createDatabase();
        const backup = createBackup([
            { id: 1, documentId: "doc-1", branchId: null },
            { id: 2, documentId: "doc-2", branchId: null },
        ], branch, target);

        await rollbackRepair(database, backup, branch);

        expect(database.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: { id: { in: [1, 2] }, branchId: branch.id },
            data: { branchId: null },
        });
    });
});
