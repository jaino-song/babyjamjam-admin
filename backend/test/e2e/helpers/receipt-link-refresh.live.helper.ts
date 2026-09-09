import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Prisma } from "@prisma/client";

import {
    FileStorageObjectNotFoundError,
    type FileStoragePort,
} from "domain/ports/file-storage.port";
import {
    IReceiptLinkTokenIssuanceRepository,
    ReceiptLinkTokenRecord,
    type CreateReceiptLinkTokenData,
} from "domain/repositories/receipt-link-token.repository.interface";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";

/** The only database project that this isolated Phase 0 probe may touch. */
export const PHASE0_DEV_DATABASE_REF = "ebiughoiebblasxwgxbe";
/** A production project must never be queried by this test. */
export const PHASE0_PRODUCTION_DATABASE_REF = "dsaqfyzyuzbyldmvsihr";
export const PHASE0_STORAGE_PREFIX = "phase0-receipt-refresh";
export const PHASE0_POOLER_DATABASE_HOST = "aws-1-ap-northeast-2.pooler.supabase.com";
export const PHASE0_DIRECT_DATABASE_HOST = `db.${PHASE0_DEV_DATABASE_REF}.supabase.co`;
export const PHASE0_BIRTHDAY = "900101";
export const PHASE0_PAGE_NUMBER = 7;
export const PHASE0_RASTER_WIDTH = 1240;
export const PHASE0_BASELINE_PDF_PATH =
    "/var/folders/gp/f0m_ydss2n15x64qrwdj_rrh0000gn/T/workflow-proof-2gt7Bw/seogu-signed-baseline.pdf";
export const PHASE0_REVISED_PDF_PATH =
    "/var/folders/gp/f0m_ydss2n15x64qrwdj_rrh0000gn/T/workflow-proof-qPjkHo/seogu-second-review.pdf";
export const PHASE0_BASELINE_PDF_SHA256 =
    "da6e21d42271ba3cdd43f95924b68104e57b9a1e81cffc7a87c03102cd8b64ca";
export const PHASE0_REVISED_PDF_SHA256 =
    "1fe24f2392e4975d8dad34a81634daf5e08ea8f6d32841a73489c2423d7027e0";

const POINTER_FIELDS = new Set<keyof ReceiptLinkRefreshRowSnapshot>([
    "storagePath",
    "contentSha256",
    "byteSize",
]);

export interface Phase0ConfigReader {
    get<T = unknown>(propertyPath: string): T | undefined;
}

export interface Phase0TargetConfig {
    databaseUrl?: string;
    directUrl?: string;
    connectionMode?: string;
    storageUrl?: string;
}

export interface Phase0PdfArtifact {
    label: "baseline" | "revised";
    pdfSha256: string;
    pdfByteSize: number;
    png: Buffer;
    pngSha256: string;
}

export interface ReceiptLinkRefreshRowSnapshot {
    id: string;
    branchId: string;
    clientId: number | null;
    eformsignDocId: number;
    jobId: string | null;
    linkTokenHash: string;
    accessTokenHash: string | null;
    expectedBirthdayHash: string;
    verifiedAt: Date | null;
    failedAttempts: number;
    lockedAt: Date | null;
    expiresAt: Date;
    active: boolean;
    revokedAt: Date | null;
    storagePath: string;
    contentSha256: string;
    byteSize: number;
    source: string;
    createdBy: string | null;
    createdAt: Date;
}

export interface ReceiptLinkRefreshFixtureIds {
    branchId: string;
    clientId: number;
    eformsignDocIds: number[];
    receiptLinkTokenIds: string[];
}

/**
 * Incremental ownership record used while a fixture is being created. The
 * callback receives the same object after each successful creation so a
 * failure part-way through setup still leaves enough exact IDs to verify the
 * outer transaction rolled every known row back.
 */
export interface ReceiptLinkRefreshFixtureOwnership {
    branchId?: string;
    clientId?: number;
    eformsignDocIds: number[];
    receiptLinkTokenIds: string[];
}

export const RECEIPT_LINK_TOKEN_SNAPSHOT_SELECT = {
    id: true,
    branchId: true,
    clientId: true,
    eformsignDocId: true,
    jobId: true,
    linkTokenHash: true,
    accessTokenHash: true,
    expectedBirthdayHash: true,
    verifiedAt: true,
    failedAttempts: true,
    lockedAt: true,
    expiresAt: true,
    active: true,
    revokedAt: true,
    storagePath: true,
    contentSha256: true,
    byteSize: true,
    source: true,
    createdBy: true,
    createdAt: true,
} as const;

export interface ReceiptLinkRefreshCasParams {
    id: string;
    branchId: string;
    eformsignDocId: number;
    expectedStoragePath: string;
    expectedContentSha256: string;
    expectedByteSize: number;
    nextStoragePath: string;
    nextContentSha256: string;
    nextByteSize: number;
}

export interface Phase0CleanupManifest {
    directory: string;
    filePath: string;
}

export type OwnedStorageMetadataReader = (prefix: string) => Promise<readonly string[]>;

export class ReceiptLinkRefreshCasConflictError extends Error {
    constructor() {
        super("receipt link refresh compare-and-swap precondition failed");
        this.name = "ReceiptLinkRefreshCasConflictError";
    }
}

function stripWrappingQuotes(value: string): string {
    if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

interface ParsedEndpoint {
    protocol: string;
    hostname: string;
    username: string;
}

function endpointUrl(raw: string | undefined, label: string): ParsedEndpoint {
    if (!raw?.trim()) throw new Error(`phase0 ${label} is not configured`);
    try {
        const parsed = new URL(stripWrappingQuotes(raw.trim()));
        return {
            protocol: parsed.protocol.toLowerCase(),
            hostname: parsed.hostname.toLowerCase(),
            username: decodeURIComponent(parsed.username),
        };
    } catch {
        throw new Error(`phase0 ${label} is not a valid URL`);
    }
}

function assertAllowedProjectEndpoint(
    endpoint: ParsedEndpoint,
    label: string,
    kind: "database" | "storage",
): void {
    if (
        endpoint.hostname === `${PHASE0_PRODUCTION_DATABASE_REF}.supabase.co`
        || endpoint.username === `postgres.${PHASE0_PRODUCTION_DATABASE_REF}`
    ) {
        throw new Error(`phase0 ${label} points at the production project`);
    }
    if (kind === "database" && !["postgres:", "postgresql:"].includes(endpoint.protocol)) {
        throw new Error(`phase0 ${label} is not a PostgreSQL URL`);
    }
    if (kind === "database") {
        if (![PHASE0_POOLER_DATABASE_HOST, PHASE0_DIRECT_DATABASE_HOST].includes(endpoint.hostname)) {
            throw new Error(`phase0 ${label} is outside the approved dev project`);
        }
        if (endpoint.username !== `postgres.${PHASE0_DEV_DATABASE_REF}`) {
            throw new Error(`phase0 ${label} does not identify the approved dev project`);
        }
        return;
    }
    if (endpoint.protocol !== "https:") {
        throw new Error(`phase0 ${label} is not an HTTPS URL`);
    }
    if (endpoint.hostname !== `${PHASE0_DEV_DATABASE_REF}.supabase.co`) {
        throw new Error(`phase0 ${label} is outside the approved storage endpoint`);
    }
}

/**
 * Refuse to start unless every configured database route and storage endpoint
 * point at the isolated dev Supabase project. This guard intentionally runs
 * before Prisma is connected, so a copied production .env cannot be queried.
 */
export function assertPhase0TargetConfig(config: Phase0TargetConfig): void {
    const connectionMode = config.connectionMode?.trim() || "shared";
    if (connectionMode !== "shared" && connectionMode !== "direct") {
        throw new Error("phase0 database connection mode is invalid");
    }
    const selectedDatabaseUrl = connectionMode === "direct" ? config.directUrl : config.databaseUrl;
    if (!selectedDatabaseUrl?.trim()) {
        throw new Error("phase0 selected database URL is not configured");
    }
    const databaseUrls = [config.databaseUrl, config.directUrl].filter(
        (value): value is string => Boolean(value?.trim()),
    );
    if (databaseUrls.length === 0) {
        throw new Error("phase0 database URL is not configured");
    }
    databaseUrls.forEach((value, index) => {
        assertAllowedProjectEndpoint(endpointUrl(value, `database URL ${index + 1}`), "database URL", "database");
    });
    assertAllowedProjectEndpoint(endpointUrl(config.storageUrl, "storage URL"), "storage URL", "storage");
}

export function assertNoExternalRateLimitStore(valkeyUrl: string | undefined): void {
    if (valkeyUrl?.trim()) {
        throw new Error("phase0 refuses an external rate-limit store");
    }
}

export function readPhase0TargetConfig(config: Phase0ConfigReader): Phase0TargetConfig {
    return {
        databaseUrl: config.get<string>("DATABASE_URL"),
        directUrl: config.get<string>("DIRECT_URL"),
        connectionMode: config.get<string>("DATABASE_CONNECTION_MODE"),
        storageUrl: config.get<string>("SUPABASE_URL"),
    };
}

export function sha256Bytes(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

export function assertApprovedPdfSha256(
    body: Buffer,
    expectedSha256: string,
    label: "baseline" | "revised",
): string {
    const actual = sha256Bytes(body);
    if (actual !== expectedSha256) {
        throw new Error(`phase0 ${label} PDF is outside the approved fixture`);
    }
    return actual;
}

/**
 * Reads and rasterizes only the two approved, user-supplied PDFs. No PDF is
 * edited and no external document is opened or changed by this helper.
 */
export async function renderApprovedReceiptPages(
    rasterizer: PdfPageRasterizerService = new PdfPageRasterizerService(),
): Promise<{ baseline: Phase0PdfArtifact; revised: Phase0PdfArtifact }> {
    const inputs = [
        {
            label: "baseline" as const,
            path: PHASE0_BASELINE_PDF_PATH,
            sha256: PHASE0_BASELINE_PDF_SHA256,
        },
        {
            label: "revised" as const,
            path: PHASE0_REVISED_PDF_PATH,
            sha256: PHASE0_REVISED_PDF_SHA256,
        },
    ];
    const artifacts: Phase0PdfArtifact[] = [];
    for (const input of inputs) {
        let pdf: Buffer;
        try {
            pdf = await readFile(input.path);
        } catch {
            throw new Error(`phase0 ${input.label} PDF fixture could not be read`);
        }
        const pdfSha256 = assertApprovedPdfSha256(pdf, input.sha256, input.label);
        let png: Buffer;
        try {
            png = await rasterizer.renderPageToPng(pdf, PHASE0_PAGE_NUMBER, {
                width: PHASE0_RASTER_WIDTH,
            });
        } catch {
            throw new Error(`phase0 ${input.label} PDF page rasterization failed`);
        }
        artifacts.push({
            label: input.label,
            pdfSha256,
            pdfByteSize: pdf.length,
            png,
            pngSha256: sha256Bytes(png),
        });
    }
    const [baseline, revised] = artifacts;
    if (!baseline || !revised || baseline.pngSha256 === revised.pngSha256) {
        throw new Error("phase0 baseline and revised receipt images are identical");
    }
    return { baseline, revised };
}

export function createPhase0StoragePrefix(runId: string = randomUUID()): string {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) {
        throw new Error("phase0 run id is invalid");
    }
    return `${PHASE0_STORAGE_PREFIX}/${runId}`;
}

export function assertOwnedStoragePath(path: string, prefix: string): void {
    const expectedPrefix = `${prefix}/`;
    const parts = path.split("/");
    const ownedPrefixPattern = new RegExp(
        `^${PHASE0_STORAGE_PREFIX}/[0-9a-f-]{36}$`,
        "i",
    );
    if (
        !ownedPrefixPattern.test(prefix)
        || !path.startsWith(expectedPrefix)
        || path.includes("..")
        || parts.length !== prefix.split("/").length + 1
        || !/^(before|after)\.png$/.test(parts.at(-1) ?? "")
    ) {
        throw new Error("phase0 storage path is outside the owned run prefix");
    }
}

/** Register before an upload starts so a timeout after remote write is still cleanable. */
export function trackOwnedStoragePath(paths: string[], path: string, prefix: string): void {
    assertOwnedStoragePath(path, prefix);
    if (!paths.includes(path)) paths.push(path);
}

/**
 * Persist only non-secret cleanup ownership metadata before the first upload.
 * The directory/file modes are explicit because this manifest is retained when
 * a live cleanup fails, allowing a later operator to recover the exact run
 * prefix without ever recording link tokens, credentials, or image bytes.
 */
export async function createPhase0CleanupManifest(
    runId: string,
    prefix: string,
    ownedStoragePaths: readonly string[],
): Promise<Phase0CleanupManifest> {
    if (createPhase0StoragePrefix(runId) !== prefix) {
        throw new Error("phase0 cleanup manifest does not match the owned run");
    }
    const paths = Array.from(new Set(ownedStoragePaths));
    paths.forEach((path) => assertOwnedStoragePath(path, prefix));

    const directory = join(tmpdir(), `babyjamjam-phase0-receipt-refresh-${runId}`);
    const filePath = join(directory, "manifest.json");
    try {
        await mkdir(directory, { mode: 0o700 });
        await writeFile(
            filePath,
            `${JSON.stringify({ runId, prefix, ownedStoragePaths: paths }, null, 2)}\n`,
            { encoding: "utf8", mode: 0o600 },
        );
        await chmod(filePath, 0o600);
        await chmod(directory, 0o700);
    } catch {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw new Error("phase0 cleanup manifest could not be persisted");
    }
    return { directory, filePath };
}

export async function removePhase0CleanupManifest(
    manifest: Phase0CleanupManifest,
): Promise<void> {
    if (manifest.filePath !== join(manifest.directory, "manifest.json")) {
        throw new Error("phase0 cleanup manifest path is invalid");
    }
    await rm(manifest.filePath, { force: true });
    await rm(manifest.directory, { recursive: true, force: true });
}

export async function deleteAndVerifyOwnedStorageObjects(
    storage: FileStoragePort,
    prefix: string,
    paths: readonly string[],
    readOwnedStorageObjectPaths?: OwnedStorageMetadataReader,
): Promise<void> {
    const uniquePaths = Array.from(new Set(paths));
    uniquePaths.forEach((path) => assertOwnedStoragePath(path, prefix));
    let cleanupFailed = false;
    for (const path of uniquePaths) {
        try {
            await storage.delete(path);
        } catch {
            cleanupFailed = true;
        }
    }
    if (readOwnedStorageObjectPaths) {
        try {
            const remaining = await readOwnedStorageObjectPaths(prefix);
            remaining.forEach((path) => assertOwnedStoragePath(path, prefix));
            if (remaining.some((path) => uniquePaths.includes(path))) {
                cleanupFailed = true;
            }
        } catch {
            cleanupFailed = true;
        }
    } else {
        // Legacy callers without a metadata reader retain the conservative
        // download check. The live harness always supplies the metadata reader
        // because a post-delete CDN response is not proof that an object remains.
        for (const path of uniquePaths) {
            try {
                await storage.download(path);
            } catch (error) {
                if (error instanceof FileStorageObjectNotFoundError) continue;
                cleanupFailed = true;
                continue;
            }
            cleanupFailed = true;
        }
    }
    if (cleanupFailed) {
        throw new Error("phase0 owned storage cleanup or absence verification failed");
    }
}

/**
 * Test-only pointer CAS. This deliberately lives under test/e2e and updates
 * exactly the three image-pointer columns. The ownership and old-hash guards
 * prevent a stale or foreign fixture from being changed accidentally.
 */
export async function compareAndSwapReceiptLinkPointer(
    client: Pick<Prisma.TransactionClient, "receipt_link_token">,
    params: ReceiptLinkRefreshCasParams,
): Promise<void> {
    const result = await client.receipt_link_token.updateMany({
        where: {
            id: params.id,
            branchId: params.branchId,
            eformsignDocId: params.eformsignDocId,
            storagePath: params.expectedStoragePath,
            contentSha256: params.expectedContentSha256,
            byteSize: params.expectedByteSize,
        },
        data: {
            storagePath: params.nextStoragePath,
            contentSha256: params.nextContentSha256,
            byteSize: params.nextByteSize,
        },
    });
    if (result.count !== 1) throw new ReceiptLinkRefreshCasConflictError();
}

function toReceiptLinkTokenRecord(row: {
    id: string;
    eformsignDocId: number;
    accessTokenHash: string | null;
    expectedBirthdayHash: string;
    verifiedAt: Date | null;
    failedAttempts: number;
    lockedAt: Date | null;
    expiresAt: Date;
    active: boolean;
    storagePath: string;
}): ReceiptLinkTokenRecord {
    return {
        id: row.id,
        eformsignDocId: row.eformsignDocId,
        accessTokenHash: row.accessTokenHash,
        expectedBirthdayHash: row.expectedBirthdayHash,
        verifiedAt: row.verifiedAt,
        failedAttempts: row.failedAttempts,
        lockedAt: row.lockedAt,
        expiresAt: row.expiresAt,
        active: row.active,
        storagePath: row.storagePath,
        branchName: null,
        clientName: null,
    };
}

/**
 * Minimal test adapter for ReceiptLinkTokenService.issue(). It forwards the
 * issuance operation into the already-open outer transaction instead of
 * starting the production repository's nested `$transaction`.
 */
export function createTransactionReceiptLinkIssuanceRepository(
    client: Prisma.TransactionClient,
): IReceiptLinkTokenIssuanceRepository {
    return {
        createOrRefreshContractLink: async (data: CreateReceiptLinkTokenData, now: Date) => {
            await client.receipt_link_token.updateMany({
                where: {
                    eformsignDocId: data.eformsignDocId,
                    active: true,
                    branchId: data.branchId,
                },
                data: { active: false, revokedAt: now },
            });
            const row = await client.receipt_link_token.create({ data });
            return toReceiptLinkTokenRecord(row);
        },
        findActiveByJobId: async (jobId) => {
            const row = await client.receipt_link_token.findFirst({
                where: { jobId, active: true },
                orderBy: { createdAt: "desc" },
            });
            return row ? toReceiptLinkTokenRecord(row) : null;
        },
    };
}

export function assertReceiptLinkMetadataUnchanged(
    before: ReceiptLinkRefreshRowSnapshot,
    after: ReceiptLinkRefreshRowSnapshot,
): void {
    const keys = Object.keys(before) as Array<keyof ReceiptLinkRefreshRowSnapshot>;
    for (const key of keys) {
        if (POINTER_FIELDS.has(key)) continue;
        const beforeValue = before[key];
        const afterValue = after[key];
        if (beforeValue instanceof Date && afterValue instanceof Date) {
            if (beforeValue.getTime() !== afterValue.getTime()) {
                throw new Error("phase0 receipt-link metadata changed during pointer refresh");
            }
            continue;
        }
        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
            throw new Error("phase0 receipt-link metadata changed during pointer refresh");
        }
    }
}

export function sanitizePhase0Error(error: unknown): string {
    if (error instanceof ReceiptLinkRefreshCasConflictError) return error.message;
    return "phase0 receipt-link refresh proof failed";
}
