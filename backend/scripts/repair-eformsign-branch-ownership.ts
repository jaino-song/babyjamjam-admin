/**
 * Repair historical eformsign mirror rows whose branch ownership was never persisted.
 *
 * Dry-run (the default; read-only):
 *   pnpm --filter ./backend repair:eformsign-branch-ownership \
 *     --target-document-id <32-hex-document-id> \
 *     --target-customer-query '<customer-query>'
 *
 * Apply (requires an explicit target and branch confirmation):
 *   pnpm --filter ./backend repair:eformsign-branch-ownership \
 *     --apply --backup-path /absolute/path/eformsign-branch-backup.json \
 *     --target-document-id <32-hex-document-id> \
 *     --target-customer-query '<customer-query>' \
 *     --confirm-target '<environment>@<sanitized-db-target>' \
 *     --confirm-branch-slug incheon
 *
 * Rollback uses only the secure backup produced by --apply and the same confirmations:
 *   pnpm --filter ./backend repair:eformsign-branch-ownership \
 *     --rollback /absolute/path/eformsign-branch-backup.json \
 *     --confirm-target '<environment>@<sanitized-db-target>' \
 *     --confirm-branch-slug incheon
 *
 * The script never writes doc_template/area_template rows. Historical template IDs are
 * list-only, and the branch repair is fenced to rows whose branch_id is NULL at execution.
 */
import { chmod, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import {
    isListOnlyHistoricalMaternityTemplateId,
    LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS,
} from "../application/utils/eformsign-historical-template-policy";
import { getChosung, matchesKoreanSearch } from "../application/utils/eformsign-document-list";
import {
    assertEformsignBackfillConfirmation,
    resolveEformsignBackfillTarget,
    type EformsignBackfillTarget,
} from "../application/utils/eformsign-backfill-safety";
import { createPrismaClientConfig } from "../infrastructure/database/prisma-url.utils";

export const TARGET_BRANCH_SLUG = "incheon";

const BACKUP_VERSION = 1 as const;
const BACKUP_OPERATION = "eformsign-branch-ownership" as const;
const MUTATION_TRANSACTION_OPTIONS = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 120_000,
};

type BranchRow = {
    id: string;
    slug: string;
    isActive: boolean | null;
};

type RepairRow = {
    id: number;
    documentId: string;
    branchId: string | null;
};

type TargetDocumentRow = RepairRow & {
    templateId: string | null;
    customerName: string | null;
};

export interface EformsignBranchRepairDatabase {
    branch: {
        findMany(args: unknown): Promise<BranchRow[]>;
    };
    eformsign_doc: {
        findMany(args: unknown): Promise<Array<RepairRow | TargetDocumentRow>>;
        groupBy(args: unknown): Promise<Array<{
            branchId: string | null;
            _count: { _all: number };
        }>>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
    $transaction<T>(
        callback: (transaction: EformsignBranchRepairDatabase) => Promise<T>,
        options?: unknown,
    ): Promise<T>;
}

export interface EformsignBranchRepairOptions {
    mode: "dry-run" | "apply" | "rollback";
    backupPath?: string;
    confirmTarget?: string;
    confirmBranchSlug?: string;
    targetDocumentId?: string;
    targetCustomerQuery?: string;
}

export interface EformsignTargetVerificationInput {
    documentId: string;
    customerQuery: string;
    customerChosungQuery: string;
}

export interface EformsignBranchRepairBackupRow {
    id: number;
    documentId: string;
    priorBranchId: null;
}

export interface EformsignBranchRepairBackup {
    version: typeof BACKUP_VERSION;
    operation: typeof BACKUP_OPERATION;
    createdAt: string;
    target: {
        environment: string;
        databaseTarget: string;
        branchSlug: typeof TARGET_BRANCH_SLUG;
        branchId: string;
    };
    counts: {
        unassignedBefore: number;
    };
    rows: EformsignBranchRepairBackupRow[];
}

export interface EformsignBranchVerification {
    found: boolean;
    currentBranchMatchesTarget: boolean;
    templateIsListOnlyHistoricalMaternity: boolean;
    customerNameMatchesExactQuery: boolean;
    customerNameMatchesChosungQuery: boolean;
}

/** Test-only callback boundary; production invocation leaves it unset. */
export interface EformsignBranchRepairApplyHooks {
    afterUpdateMany?: (updatedCount: number) => void | Promise<void>;
}

export interface EformsignBranchCounts {
    [branchLabel: string]: number;
}

type ParsedFlag = {
    name: string;
    value?: string;
};

function normalizeTargetDocumentId(value: string | undefined): string {
    const normalized = value?.trim() ?? "";
    if (!/^[a-f\d]{32}$/iu.test(normalized)) {
        throw new Error("--target-document-id requires a nonempty 32-character hexadecimal id");
    }
    return normalized;
}

function normalizeTargetCustomerQuery(value: string | undefined): string {
    const normalized = value?.trim() ?? "";
    if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new Error("--target-customer-query requires a nonempty safe query");
    }
    return normalized;
}

function deriveTargetCustomerChosungQuery(query: string): string {
    return query.normalize("NFC").split("").map(getChosung).join("").replace(/\s/gu, "");
}

export function resolveTargetVerificationInput(
    options: EformsignBranchRepairOptions,
): EformsignTargetVerificationInput {
    if (options.mode === "rollback") {
        throw new Error("Rollback does not require target customer verification inputs");
    }
    const documentId = normalizeTargetDocumentId(options.targetDocumentId);
    const customerQuery = normalizeTargetCustomerQuery(options.targetCustomerQuery);
    return {
        documentId,
        customerQuery,
        customerChosungQuery: deriveTargetCustomerChosungQuery(customerQuery),
    };
}

const ENV_FILE_PATHS = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "backend/.env.local"),
    resolve(process.cwd(), "backend/.env"),
];

const ENV_KEYS = [
    "DATABASE_URL",
    "DIRECT_URL",
    "DATABASE_CONNECTION_MODE",
    "PRISMA_CONNECTION_LIMIT",
    "PRISMA_POOL_TIMEOUT",
    "RAILWAY_ENVIRONMENT_NAME",
    "NODE_ENV",
] as const;

function stripWrappingQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

function readEnvFileValue(path: string, key: string): string | undefined {
    let contents: string;
    try {
        contents = readFileSync(path, "utf8");
    } catch {
        return undefined;
    }

    for (const rawLine of contents.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const match = line.match(new RegExp(`^(?:export\\s+)?${key}\\s*=\\s*(.*)$`));
        if (!match?.[1]) continue;
        return stripWrappingQuotes(match[1].trim());
    }
    return undefined;
}

/** Loads only the environment keys this operator needs; values are never printed. */
export function loadOperatorEnvironment(): void {
    for (const key of ENV_KEYS) {
        if (process.env[key]) continue;
        for (const path of ENV_FILE_PATHS) {
            const value = readEnvFileValue(path, key);
            if (value !== undefined) {
                process.env[key] = value;
                break;
            }
        }
    }
}

export function resolveOperatorDatabaseTarget(): EformsignBackfillTarget {
    const mode = process.env["DATABASE_CONNECTION_MODE"] ?? "shared";
    const databaseUrl = mode === "direct"
        ? process.env["DIRECT_URL"]
        : process.env["DATABASE_URL"];
    return resolveEformsignBackfillTarget({
        railwayEnvironmentName: process.env["RAILWAY_ENVIRONMENT_NAME"],
        nodeEnv: process.env["NODE_ENV"],
        databaseUrl,
    });
}

export function operatorTargetConfirmation(target: EformsignBackfillTarget): string {
    return `${target.environment}@${target.databaseTarget}`;
}

export function parseRepairOptions(argv: string[]): EformsignBranchRepairOptions {
    let mode: EformsignBranchRepairOptions["mode"] = "dry-run";
    let backupPath: string | undefined;
    let confirmTarget: string | undefined;
    let confirmBranchSlug: string | undefined;
    let targetDocumentId: string | undefined;
    let targetCustomerQuery: string | undefined;

    const parseValue = (flag: string, index: number, inlineValue: string | undefined): ParsedFlag => {
        const value = inlineValue ?? argv[index + 1];
        if (!value || value.startsWith("--")) {
            throw new Error(`${flag} requires a value`);
        }
        return { name: flag, value };
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === undefined) continue;
        if (argument === "--apply") {
            if (mode !== "dry-run") throw new Error("--apply and --rollback are mutually exclusive");
            mode = "apply";
            continue;
        }
        if (argument === "--rollback" || argument.startsWith("--rollback=")) {
            if (mode !== "dry-run") throw new Error("--apply and --rollback are mutually exclusive");
            const flag = parseValue("--rollback", index, argument.split("=", 2)[1]);
            backupPath = flag.value;
            mode = "rollback";
            if (argument === "--rollback") index += 1;
            continue;
        }
        if (argument === "--backup-path" || argument.startsWith("--backup-path=")) {
            const flag = parseValue("--backup-path", index, argument.split("=", 2)[1]);
            backupPath = flag.value;
            if (argument === "--backup-path") index += 1;
            continue;
        }
        if (argument === "--backup" || argument.startsWith("--backup=")) {
            const flag = parseValue("--backup", index, argument.split("=", 2)[1]);
            backupPath = flag.value;
            if (argument === "--backup") index += 1;
            continue;
        }
        if (argument === "--confirm-target" || argument.startsWith("--confirm-target=")) {
            const flag = parseValue("--confirm-target", index, argument.split("=", 2)[1]);
            confirmTarget = flag.value;
            if (argument === "--confirm-target") index += 1;
            continue;
        }
        if (argument === "--target-document-id" || argument.startsWith("--target-document-id=")) {
            const flag = parseValue("--target-document-id", index, argument.split("=", 2)[1]);
            targetDocumentId = flag.value;
            if (argument === "--target-document-id") index += 1;
            continue;
        }
        if (argument === "--target-customer-query" || argument.startsWith("--target-customer-query=")) {
            const flag = parseValue("--target-customer-query", index, argument.split("=", 2)[1]);
            targetCustomerQuery = flag.value;
            if (argument === "--target-customer-query") index += 1;
            continue;
        }
        if (argument === "--confirm-branch-slug" || argument.startsWith("--confirm-branch-slug=")) {
            const flag = parseValue("--confirm-branch-slug", index, argument.split("=", 2)[1]);
            confirmBranchSlug = flag.value;
            if (argument === "--confirm-branch-slug") index += 1;
            continue;
        }
        if (argument === "--help" || argument === "-h") {
            throw new Error(
                "Usage: [--target-document-id ID --target-customer-query QUERY]"
                + " [--apply --backup-path PATH --confirm-target TARGET --confirm-branch-slug incheon]"
                + " | [--rollback PATH --confirm-target TARGET --confirm-branch-slug incheon]",
            );
        }
        throw new Error(`Unknown argument: ${argument}`);
    }

    if (mode === "apply" && !backupPath) {
        throw new Error("--apply requires --backup-path PATH");
    }
    if (mode === "rollback" && !backupPath) {
        throw new Error("--rollback requires a backup path");
    }
    if (mode !== "dry-run" && !confirmTarget) {
        throw new Error("Mutation requires --confirm-target <resolved database identity>");
    }
    if (mode !== "dry-run" && confirmBranchSlug !== TARGET_BRANCH_SLUG) {
        throw new Error(`Mutation requires --confirm-branch-slug ${TARGET_BRANCH_SLUG}`);
    }

    if (mode !== "rollback") {
        const targetVerification = resolveTargetVerificationInput({
            mode,
            targetDocumentId,
            targetCustomerQuery,
        });
        targetDocumentId = targetVerification.documentId;
        targetCustomerQuery = targetVerification.customerQuery;
    }

    return {
        mode,
        ...(backupPath ? { backupPath: resolve(backupPath) } : {}),
        ...(confirmTarget ? { confirmTarget } : {}),
        ...(confirmBranchSlug ? { confirmBranchSlug } : {}),
        ...(targetDocumentId ? { targetDocumentId } : {}),
        ...(targetCustomerQuery ? { targetCustomerQuery } : {}),
    };
}

function assertMutationConfirmation(
    options: EformsignBranchRepairOptions,
    target: EformsignBackfillTarget,
): void {
    if (options.mode === "dry-run") return;
    if (options.confirmBranchSlug !== TARGET_BRANCH_SLUG) {
        throw new Error(`Mutation requires --confirm-branch-slug ${TARGET_BRANCH_SLUG}`);
    }
    try {
        assertEformsignBackfillConfirmation(target, options.confirmTarget);
    } catch {
        throw new Error(
            `Set --confirm-target ${operatorTargetConfirmation(target)} to confirm this exact target`,
        );
    }
}

export async function resolveTargetBranch(
    database: EformsignBranchRepairDatabase,
    slug = TARGET_BRANCH_SLUG,
): Promise<BranchRow> {
    const branches = await database.branch.findMany({
        where: { slug },
        select: { id: true, slug: true, isActive: true },
    });
    if (branches.length !== 1) {
        throw new Error(`Expected exactly one branch for slug ${slug}; found ${branches.length}`);
    }
    const branch = branches[0];
    if (!branch || branch.slug !== slug || branch.isActive !== true) {
        throw new Error(`Target branch ${slug} is missing or inactive`);
    }
    return branch;
}

export async function loadUnassignedRows(
    database: EformsignBranchRepairDatabase,
): Promise<RepairRow[]> {
    const rows = await database.eformsign_doc.findMany({
        where: { branchId: null },
        select: { id: true, documentId: true, branchId: true },
        orderBy: { id: "asc" },
    });
    return rows.map((row) => ({
        id: row.id,
        documentId: row.documentId,
        branchId: row.branchId,
    }));
}

async function loadTargetDocument(
    database: EformsignBranchRepairDatabase,
    targetDocumentId: string,
): Promise<TargetDocumentRow> {
    const rows = await database.eformsign_doc.findMany({
        where: { documentId: targetDocumentId },
        select: {
            id: true,
            documentId: true,
            branchId: true,
            templateId: true,
            customerName: true,
        },
    });
    if (rows.length !== 1) {
        throw new Error(
            `Apply target document must resolve to exactly one row; found ${rows.length}`,
        );
    }
    return rows[0] as TargetDocumentRow;
}

function assertApprovedTargetTemplateAndCustomer(
    row: TargetDocumentRow,
    targetCustomerQuery: string,
): void {
    const approvedTemplate = typeof row.templateId === "string"
        && (LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS as readonly string[]).includes(row.templateId);
    if (!approvedTemplate) {
        throw new Error("Apply target document template is not an approved historical maternity template");
    }

    const customerName = row.customerName?.trim() ?? "";
    const targetCustomerChosungQuery = deriveTargetCustomerChosungQuery(targetCustomerQuery);
    if (
        customerName.length === 0
        || !matchesKoreanSearch(customerName, targetCustomerQuery)
        || !matchesKoreanSearch(customerName, targetCustomerChosungQuery)
    ) {
        throw new Error("Apply target document customer name does not satisfy the required search checks");
    }
}

function assertApplyTargetBeforeUpdate(
    row: TargetDocumentRow,
    branch: BranchRow,
    targetCustomerQuery: string,
): void {
    if (row.branchId !== null && row.branchId !== branch.id) {
        throw new Error("Apply target document is already owned by another branch");
    }
    assertApprovedTargetTemplateAndCustomer(row, targetCustomerQuery);
}

function assertApplyTargetAfterUpdate(
    row: TargetDocumentRow,
    branch: BranchRow,
    targetCustomerQuery: string,
): void {
    if (row.branchId !== branch.id) {
        throw new Error("Apply target document was not assigned to the selected HQ branch");
    }
    assertApprovedTargetTemplateAndCustomer(row, targetCustomerQuery);
}

function sortedRowKeys(rows: RepairRow[]): string[] {
    return rows
        .map((row) => `${row.id}:${row.documentId}:${row.branchId ?? "null"}`)
        .sort();
}

function assertSameRepairRows(expected: RepairRow[], actual: RepairRow[], context: string): void {
    if (expected.length !== actual.length) {
        throw new Error(
            `${context} count fence failed; expected ${expected.length}, observed ${actual.length}`,
        );
    }
    const expectedKeys = sortedRowKeys(expected);
    const actualKeys = sortedRowKeys(actual);
    if (expectedKeys.some((key, index) => key !== actualKeys[index])) {
        throw new Error(`${context} row identity fence failed; the candidate set drifted`);
    }
}

function toBackupRows(rows: RepairRow[]): EformsignBranchRepairBackupRow[] {
    return rows.map((row) => ({
        id: row.id,
        documentId: row.documentId,
        priorBranchId: null,
    }));
}

export function createBackup(
    rows: RepairRow[],
    branch: BranchRow,
    target: EformsignBackfillTarget,
    createdAt = new Date().toISOString(),
): EformsignBranchRepairBackup {
    return {
        version: BACKUP_VERSION,
        operation: BACKUP_OPERATION,
        createdAt,
        target: {
            environment: target.environment,
            databaseTarget: target.databaseTarget,
            branchSlug: TARGET_BRANCH_SLUG,
            branchId: branch.id,
        },
        counts: { unassignedBefore: rows.length },
        rows: toBackupRows(rows),
    };
}

export async function writeBackup(
    path: string,
    backup: EformsignBranchRepairBackup,
): Promise<void> {
    const serialized = `${JSON.stringify(backup, null, 2)}\n`;
    try {
        await writeFile(path, serialized, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
        });
        await chmod(path, 0o600);
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        throw new Error(`Could not create secure backup at ${path}: ${message}`);
    }
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], context: string): void {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${context} contains unsupported fields`);
    }
}

export function validateBackup(value: unknown): EformsignBranchRepairBackup {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Backup must be a JSON object");
    }
    const backup = value as Record<string, unknown>;
    assertExactKeys(backup, ["version", "operation", "createdAt", "target", "counts", "rows"], "Backup");
    if (backup["version"] !== BACKUP_VERSION || backup["operation"] !== BACKUP_OPERATION) {
        throw new Error("Backup version or operation is unsupported");
    }
    const createdAt = backup["createdAt"];
    const parsedCreatedAt = typeof createdAt === "string" ? new Date(createdAt) : null;
    if (
        typeof createdAt !== "string"
        || !createdAt
        || !parsedCreatedAt
        || !Number.isFinite(parsedCreatedAt.getTime())
        || parsedCreatedAt.toISOString() !== createdAt
    ) {
        throw new Error("Backup createdAt is invalid");
    }

    const target = backup["target"];
    if (!target || typeof target !== "object" || Array.isArray(target)) {
        throw new Error("Backup target is invalid");
    }
    const targetRecord = target as Record<string, unknown>;
    assertExactKeys(
        targetRecord,
        ["environment", "databaseTarget", "branchSlug", "branchId"],
        "Backup target",
    );
    if (
        typeof targetRecord["environment"] !== "string"
        || typeof targetRecord["databaseTarget"] !== "string"
        || targetRecord["branchSlug"] !== TARGET_BRANCH_SLUG
        || typeof targetRecord["branchId"] !== "string"
        || !targetRecord["branchId"]
    ) {
        throw new Error("Backup target identity is invalid");
    }

    const counts = backup["counts"];
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
        throw new Error("Backup counts are invalid");
    }
    const countsRecord = counts as Record<string, unknown>;
    assertExactKeys(countsRecord, ["unassignedBefore"], "Backup counts");
    if (
        typeof countsRecord["unassignedBefore"] !== "number"
        || !Number.isInteger(countsRecord["unassignedBefore"])
        || countsRecord["unassignedBefore"] < 0
    ) {
        throw new Error("Backup unassigned count is invalid");
    }

    if (!Array.isArray(backup["rows"])) {
        throw new Error("Backup rows are invalid");
    }
    const rows: EformsignBranchRepairBackupRow[] = [];
    const ids = new Set<number>();
    const documentIds = new Set<string>();
    for (const row of backup["rows"]) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
            throw new Error("Backup row is invalid");
        }
        const rowRecord = row as Record<string, unknown>;
        assertExactKeys(rowRecord, ["id", "documentId", "priorBranchId"], "Backup row");
        if (
            typeof rowRecord["id"] !== "number"
            || !Number.isInteger(rowRecord["id"])
            || rowRecord["id"] <= 0
            || typeof rowRecord["documentId"] !== "string"
            || !rowRecord["documentId"]
            || rowRecord["priorBranchId"] !== null
        ) {
            throw new Error("Backup row identity is invalid");
        }
        if (ids.has(rowRecord["id"] as number) || documentIds.has(rowRecord["documentId"] as string)) {
            throw new Error("Backup contains duplicate row identity");
        }
        ids.add(rowRecord["id"] as number);
        documentIds.add(rowRecord["documentId"] as string);
        rows.push({
            id: rowRecord["id"] as number,
            documentId: rowRecord["documentId"] as string,
            priorBranchId: null,
        });
    }
    if (countsRecord["unassignedBefore"] !== rows.length) {
        throw new Error("Backup row count does not match metadata");
    }

    return {
        version: BACKUP_VERSION,
        operation: BACKUP_OPERATION,
        createdAt,
        target: {
            environment: targetRecord["environment"] as string,
            databaseTarget: targetRecord["databaseTarget"] as string,
            branchSlug: TARGET_BRANCH_SLUG,
            branchId: targetRecord["branchId"] as string,
        },
        counts: { unassignedBefore: rows.length },
        rows,
    };
}

export async function readBackup(path: string): Promise<EformsignBranchRepairBackup> {
    let contents: string;
    try {
        contents = await readFile(path, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        throw new Error(`Could not read backup ${path}: ${message}`);
    }
    try {
        return validateBackup(JSON.parse(contents) as unknown);
    } catch (error) {
        const message = error instanceof Error ? error.message : "invalid JSON";
        throw new Error(`Invalid backup ${path}: ${message}`);
    }
}

export async function readBranchCounts(
    database: EformsignBranchRepairDatabase,
): Promise<EformsignBranchCounts> {
    const [groups, branches] = await Promise.all([
        database.eformsign_doc.groupBy({
            by: ["branchId"],
            _count: { _all: true },
        }),
        database.branch.findMany({
            select: { id: true, slug: true, isActive: true },
        }),
    ]);
    const slugById = new Map(branches.map((branch) => [branch.id, branch.slug] as const));
    const counts: EformsignBranchCounts = {};
    for (const group of groups) {
        const label = group.branchId === null
            ? "unassigned"
            : slugById.get(group.branchId) ?? "other-assigned";
        counts[label] = (counts[label] ?? 0) + group._count._all;
    }
    return counts;
}

export async function verifyTargetDocument(
    database: EformsignBranchRepairDatabase,
    targetBranchId: string,
    targetDocumentId: string,
    targetCustomerQuery: string,
): Promise<EformsignBranchVerification> {
    const rows = await database.eformsign_doc.findMany({
        where: { documentId: targetDocumentId },
        select: {
            id: true,
            documentId: true,
            branchId: true,
            templateId: true,
            customerName: true,
        },
    });
    const row = rows.length === 1 ? rows[0] as TargetDocumentRow : undefined;
    const customerName = row?.customerName?.trim() ?? "";
    const targetCustomerChosungQuery = deriveTargetCustomerChosungQuery(targetCustomerQuery);
    return {
        found: row !== undefined,
        currentBranchMatchesTarget: row?.branchId === targetBranchId,
        templateIsListOnlyHistoricalMaternity: isListOnlyHistoricalMaternityTemplateId(row?.templateId),
        customerNameMatchesExactQuery: customerName.length > 0
            && matchesKoreanSearch(customerName, targetCustomerQuery),
        customerNameMatchesChosungQuery: customerName.length > 0
            && matchesKoreanSearch(customerName, targetCustomerChosungQuery),
    };
}

export function assertPostApplyTargetVerification(
    verification: EformsignBranchVerification,
): void {
    if (
        !verification.found
        || !verification.currentBranchMatchesTarget
        || !verification.templateIsListOnlyHistoricalMaternity
        || !verification.customerNameMatchesExactQuery
        || !verification.customerNameMatchesChosungQuery
    ) {
        throw new Error("Post-apply target verification failed");
    }
}

function printCounts(label: string, counts: EformsignBranchCounts): void {
    console.log(`${label} branch counts: ${JSON.stringify(counts)}`);
}

function printVerification(verification: EformsignBranchVerification): void {
    console.log(`Verification target document found: ${String(verification.found)}`);
    console.log(
        "Verification target branch matches selected HQ: "
        + String(verification.currentBranchMatchesTarget),
    );
    console.log(
        "Verification template is list-only historical maternity: "
        + String(verification.templateIsListOnlyHistoricalMaternity),
    );
    console.log(
        "Verification persisted customer search exact/chosung: "
        + `${String(verification.customerNameMatchesExactQuery)}/${String(verification.customerNameMatchesChosungQuery)}`,
    );
}

function projectApplyCounts(
    counts: EformsignBranchCounts,
    branchSlug: string,
    candidateCount: number,
): EformsignBranchCounts {
    const projected = { ...counts };
    projected["unassigned"] = (projected["unassigned"] ?? 0) - candidateCount;
    projected[branchSlug] = (projected[branchSlug] ?? 0) + candidateCount;
    return projected;
}

export async function applyRepair(
    database: EformsignBranchRepairDatabase,
    options: EformsignBranchRepairOptions,
    branch: BranchRow,
    target: EformsignBackfillTarget,
    hooks: EformsignBranchRepairApplyHooks = {},
): Promise<void> {
    const targetVerification = resolveTargetVerificationInput(options);
    const beforeRows = await loadUnassignedRows(database);
    const backup = createBackup(beforeRows, branch, target);
    await writeBackup(options.backupPath!, backup);
    console.log(`Secure rollback backup written with ${beforeRows.length} row(s).`);

    const updatedCount = await database.$transaction(async (transaction) => {
        const transactionRows = await loadUnassignedRows(transaction);
        assertSameRepairRows(beforeRows, transactionRows, "Apply");
        const targetBefore = await loadTargetDocument(transaction, targetVerification.documentId);
        assertApplyTargetBeforeUpdate(targetBefore, branch, targetVerification.customerQuery);
        const result = await transaction.eformsign_doc.updateMany({
            where: { branchId: null },
            data: { branchId: branch.id },
        });
        if (result.count !== beforeRows.length) {
            throw new Error(
                `Apply count fence failed; expected ${beforeRows.length}, updated ${result.count}`,
            );
        }
        await hooks.afterUpdateMany?.(result.count);
        const targetAfter = await loadTargetDocument(transaction, targetVerification.documentId);
        assertApplyTargetAfterUpdate(targetAfter, branch, targetVerification.customerQuery);
        return result.count;
    }, MUTATION_TRANSACTION_OPTIONS);
    console.log(`Applied branch repair to ${updatedCount} row(s).`);
}

export async function rollbackRepair(
    database: EformsignBranchRepairDatabase,
    backup: EformsignBranchRepairBackup,
    branch: BranchRow,
): Promise<void> {
    if (backup.target.branchId !== branch.id) {
        throw new Error("Rollback target branch identity does not match the backup");
    }
    const expectedRows: RepairRow[] = backup.rows.map((row) => ({
        id: row.id,
        documentId: row.documentId,
        branchId: branch.id,
    }));
    const restoredCount = await database.$transaction(async (transaction) => {
        const currentRows = await transaction.eformsign_doc.findMany({
            where: {
                id: { in: backup.rows.map((row) => row.id) },
            },
            select: { id: true, documentId: true, branchId: true },
            orderBy: { id: "asc" },
        }) as RepairRow[];
        assertSameRepairRows(expectedRows, currentRows, "Rollback");
        const result = await transaction.eformsign_doc.updateMany({
            where: {
                id: { in: backup.rows.map((row) => row.id) },
                branchId: branch.id,
            },
            data: { branchId: null },
        });
        if (result.count !== backup.rows.length) {
            throw new Error(
                `Rollback count fence failed; expected ${backup.rows.length}, restored ${result.count}`,
            );
        }
        return result.count;
    }, MUTATION_TRANSACTION_OPTIONS);
    console.log(`Rolled back ${restoredCount} row(s) to their prior unassigned state.`);
}

async function run(options: EformsignBranchRepairOptions): Promise<void> {
    const target = resolveOperatorDatabaseTarget();
    assertMutationConfirmation(options, target);
    const targetVerification = options.mode === "rollback"
        ? undefined
        : resolveTargetVerificationInput(options);

    const config = createPrismaClientConfig(
        process.env["DATABASE_CONNECTION_MODE"] === "direct"
            ? process.env["DIRECT_URL"]
            : process.env["DATABASE_URL"],
    );
    if (config.missingRequiredEnvVars.length > 0 || !config.options) {
        throw new Error(`Missing required database configuration: ${config.missingRequiredEnvVars.join(", ")}`);
    }

    const prisma = new PrismaClient(config.options);
    const database = prisma as unknown as EformsignBranchRepairDatabase;
    try {
        const branch = await resolveTargetBranch(database);
        const beforeCounts = await readBranchCounts(database);
        printCounts("Pre-repair", beforeCounts);

        if (options.mode === "dry-run") {
            const rows = await loadUnassignedRows(database);
            console.log(`Dry-run candidate rows with no branch: ${rows.length}`);
            printCounts(
                "Projected post-repair",
                projectApplyCounts(beforeCounts, branch.slug, rows.length),
            );
            const verification = await verifyTargetDocument(
                database,
                branch.id,
                targetVerification!.documentId,
                targetVerification!.customerQuery,
            );
            printVerification(verification);
            console.log("No database changes made (dry-run).");
            return;
        }

        if (options.mode === "apply") {
            await applyRepair(database, options, branch, target);
        } else {
            const backup = await readBackup(options.backupPath!);
            if (
                backup.target.environment !== target.environment
                || backup.target.databaseTarget !== target.databaseTarget
            ) {
                throw new Error("Rollback backup belongs to a different database target");
            }
            await rollbackRepair(database, backup, branch);
        }

        const afterCounts = await readBranchCounts(database);
        printCounts("Post-repair", afterCounts);
        if (targetVerification) {
            const verification = await verifyTargetDocument(
                database,
                branch.id,
                targetVerification.documentId,
                targetVerification.customerQuery,
            );
            printVerification(verification);
            if (options.mode === "apply") {
                assertPostApplyTargetVerification(verification);
            }
        } else {
            console.log("Target verification skipped for rollback; secure backup fences remain enforced.");
        }
        console.log(
            "NOTE: This script does not invalidate shared Valkey document snapshots. Deploy/restart "
            + "only refreshes process-local state; shared snapshots require explicit version "
            + "invalidation or the configured snapshot TTL before cached lists refresh.",
        );
    } finally {
        await prisma.$disconnect();
    }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
    loadOperatorEnvironment();
    const options = parseRepairOptions(argv);
    await run(options);
}

if (require.main === module) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        process.stderr.write(`Eformsign branch repair failed: ${message}\n`);
        process.exitCode = 1;
    });
}
