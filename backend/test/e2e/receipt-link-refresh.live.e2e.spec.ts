import { ConfigModule, ConfigService } from "@nestjs/config";
import { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { FILE_STORAGE_PORT, type FileStoragePort } from "domain/ports/file-storage.port";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { createExtendedPrismaService } from "infrastructure/database/database.module";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";

import {
    assertNoExternalRateLimitStore,
    assertOwnedStoragePath,
    assertPhase0TargetConfig,
    assertReceiptLinkMetadataUnchanged,
    compareAndSwapReceiptLinkPointer,
    createPhase0CleanupManifest,
    createPhase0StoragePrefix,
    createTransactionReceiptLinkIssuanceRepository,
    deleteAndVerifyOwnedStorageObjects,
    PHASE0_BIRTHDAY,
    RECEIPT_LINK_TOKEN_SNAPSHOT_SELECT,
    readPhase0TargetConfig,
    renderApprovedReceiptPages,
    type OwnedStorageMetadataReader,
    type Phase0CleanupManifest,
    sanitizePhase0Error,
    trackOwnedStoragePath,
    type Phase0ConfigReader,
    type Phase0PdfArtifact,
    type ReceiptLinkRefreshFixtureIds,
    type ReceiptLinkRefreshFixtureOwnership,
    type ReceiptLinkRefreshRowSnapshot,
} from "./helpers/receipt-link-refresh.live.helper";

const LIVE = process.env["LIVE_E2E"] === "1";
const LIVE_TEST_TIMEOUT_MS = 300_000;
const TRANSACTION_TIMEOUT_MS = 180_000;
const HTTP_REQUEST_TIMEOUT_MS = 5_000;
const IMAGE_MIME_TYPE = "image/png";
const STORAGE_BUCKET_NAME = "documents";
const ENV_FILE_PATHS = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "backend/.env"),
];

class Phase0RollbackSentinel extends Error {
    constructor() {
        super("phase0 transaction rollback sentinel");
        this.name = "Phase0RollbackSentinel";
    }
}

interface HttpResult {
    status: number;
    headers: Headers;
    body: unknown;
    bytes: Buffer;
}

interface HttpRequestOptions {
    headers?: Record<string, string>;
    body?: unknown;
}

interface Phase0HttpApp {
    app: INestApplication;
    baseUrl: string;
}

interface Phase0Fixture {
    ids: ReceiptLinkRefreshFixtureIds;
    primaryToken: string;
    secondaryToken: string;
    primaryTokenId: string;
    secondaryTokenId: string;
    primaryDocumentId: number;
    secondaryDocumentId: number;
    beforePath: string;
    afterPath: string;
    clientName: string;
}

interface Phase0ProofResult {
    runId: string;
    manifestPath: string;
    baselinePngSha256: string;
    baselinePngByteSize: number;
    revisedPngSha256: string;
    revisedPngByteSize: number;
    transactionRolledBack: boolean;
    databaseRowsAbsent: boolean;
    storageObjectsAbsent: boolean;
}

type Phase0Checkpoint =
    | "config-module"
    | "target-guard"
    | "pdf-rasterization"
    | "storage-init"
    | "prisma-init"
    | "database-connect"
    | "cleanup-manifest"
    | "transaction-fixture"
    | "storage-upload"
    | "http-proof"
    | "rollback-sentinel"
    | "storage-cleanup"
    | "rollback-verification"
    | "disconnect";

function safePhase0ErrorDescriptor(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError && /^[A-Z0-9_:-]+$/.test(error.code)) {
        return `prisma:${error.code}`;
    }
    if (error instanceof Error && /^[A-Za-z0-9_.:-]+$/.test(error.name)) {
        return error.name;
    }
    return "UnknownError";
}

function phase0ProofStatus(
    transactionRolledBack: boolean,
    databaseRowsAbsent: boolean,
    storageObjectsAbsent: boolean,
): string {
    return [
        `transactionRolledBack=${String(transactionRolledBack)}`,
        `databaseRowsAbsent=${String(databaseRowsAbsent)}`,
        `storageObjectsAbsent=${String(storageObjectsAbsent)}`,
    ].join(", ");
}

function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("phase0 HTTP response was not an object");
    }
    return value as Record<string, unknown>;
}

function requiredResponseString(body: unknown, key: string): string {
    const value = asRecord(body)[key];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error("phase0 HTTP response omitted a required credential field");
    }
    return value;
}

async function requestHttp(
    baseUrl: string,
    method: "GET" | "POST",
    pathname: string,
    options: HttpRequestOptions = {},
): Promise<HttpResult> {
    let response: Response;
    try {
        response = await fetch(`${baseUrl}${pathname}`, {
            method,
            headers: options.body === undefined
                ? options.headers
                : { "Content-Type": "application/json", ...options.headers },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            redirect: "error",
            signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
        });
    } catch {
        throw new Error("phase0 localhost HTTP request failed");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;
    if (contentType.toLowerCase().includes("application/json")) {
        try {
            body = JSON.parse(bytes.toString("utf8")) as unknown;
        } catch {
            throw new Error("phase0 HTTP JSON response could not be parsed");
        }
    }
    return { status: response.status, headers: response.headers, body, bytes };
}

async function readReceiptLinkSnapshot(
    client: Prisma.TransactionClient,
    id: string,
): Promise<ReceiptLinkRefreshRowSnapshot> {
    const row = await client.receipt_link_token.findUnique({
        where: { id },
        select: RECEIPT_LINK_TOKEN_SNAPSHOT_SELECT,
    });
    if (!row) throw new Error("phase0 fixture receipt-link row disappeared inside transaction");
    return row as ReceiptLinkRefreshRowSnapshot;
}

async function createSyntheticFixture(
    client: Prisma.TransactionClient,
    tokenService: ReceiptLinkTokenService,
    prefix: string,
    baseline: Phase0PdfArtifact,
    now: Date,
    runId: string,
    registerFixtureOwnership: (ownership: ReceiptLinkRefreshFixtureOwnership) => void,
): Promise<Phase0Fixture> {
    const branchId = randomUUID();
    const ownership: ReceiptLinkRefreshFixtureOwnership = {
        branchId,
        eformsignDocIds: [],
        receiptLinkTokenIds: [],
    };
    registerFixtureOwnership(ownership);
    const branch = await client.branch.create({
        data: {
            id: branchId,
            name: `Phase0 receipt refresh ${runId}`,
            slug: `phase0-receipt-refresh-${runId}`,
        },
    });
    const serviceEndDate = new Date(now.getTime() + 86_400_000);
    const clientRow = await client.client.create({
        data: {
            name: `Phase0 receipt client ${runId}`,
            birthday: PHASE0_BIRTHDAY,
            voucherClient: false,
            branchId: branch.id,
            endDate: serviceEndDate,
        },
    });
    ownership.clientId = clientRow.id;
    registerFixtureOwnership(ownership);
    const documentData = (suffix: "primary" | "secondary") => ({
        documentId: `phase0-receipt-refresh-${runId}-${suffix}`,
        documentName: "Phase0 receipt refresh fixture",
        documentNumber: `phase0-${runId}-${suffix}`,
        templateName: "Phase0 receipt refresh fixture",
        customerName: clientRow.name,
        creatorName: "phase0-test",
        lastEditorName: "phase0-test",
        stepRecipientTypes: "01",
        createdDate: now,
        updatedDate: now,
        statusType: "060",
        statusDetail: "phase0-test",
        stepType: "05",
        stepIndex: "3",
        stepName: "phase0-test",
        stepRecipientType: "01",
        stepRecipientName: clientRow.name,
        stepRecipientSms: "",
        expiredDate: new Date(now.getTime() + 86_400_000),
        expired: false,
        clientId: clientRow.id,
        branchId: branch.id,
    });
    const primaryDocument = await client.eformsign_doc.create({ data: documentData("primary") });
    ownership.eformsignDocIds.push(primaryDocument.id);
    registerFixtureOwnership(ownership);
    const secondaryDocument = await client.eformsign_doc.create({ data: documentData("secondary") });
    ownership.eformsignDocIds.push(secondaryDocument.id);
    registerFixtureOwnership(ownership);

    const beforePath = `${prefix}/before.png`;
    const afterPath = `${prefix}/after.png`;
    assertOwnedStoragePath(beforePath, prefix);
    assertOwnedStoragePath(afterPath, prefix);

    const issuanceRepository = createTransactionReceiptLinkIssuanceRepository(client);
    const primary = await tokenService.issue({
        branchId: branch.id,
        clientId: clientRow.id,
        eformsignDocId: primaryDocument.id,
        birthday: PHASE0_BIRTHDAY,
        serviceEndDate,
        storagePath: beforePath,
        contentSha256: baseline.pngSha256,
        byteSize: baseline.png.length,
        source: "manual",
        now,
    }, issuanceRepository);
    ownership.receiptLinkTokenIds.push(primary.id);
    registerFixtureOwnership(ownership);
    const secondary = await tokenService.issue({
        branchId: branch.id,
        clientId: clientRow.id,
        eformsignDocId: secondaryDocument.id,
        birthday: PHASE0_BIRTHDAY,
        serviceEndDate,
        storagePath: beforePath,
        contentSha256: baseline.pngSha256,
        byteSize: baseline.png.length,
        source: "manual",
        now,
    }, issuanceRepository);
    ownership.receiptLinkTokenIds.push(secondary.id);
    registerFixtureOwnership(ownership);

    const fixtureIds: ReceiptLinkRefreshFixtureIds = {
        branchId: branch.id,
        clientId: clientRow.id,
        eformsignDocIds: ownership.eformsignDocIds,
        receiptLinkTokenIds: ownership.receiptLinkTokenIds,
    };

    return {
        ids: fixtureIds,
        primaryToken: primary.linkToken,
        secondaryToken: secondary.linkToken,
        primaryTokenId: primary.id,
        secondaryTokenId: secondary.id,
        primaryDocumentId: primaryDocument.id,
        secondaryDocumentId: secondaryDocument.id,
        beforePath,
        afterPath,
        clientName: clientRow.name,
    };
}

async function createReceiptLinkHttpApp(
    tokenService: ReceiptLinkTokenService,
    storage: FileStoragePort,
    client: Prisma.TransactionClient,
): Promise<Phase0HttpApp> {
    // Let Nest construct the production guard from its route metadata, while
    // binding its PostgreSQL fallback to the outer transaction. External Valkey
    // is refused before this point.
    //
    // The interactive transaction proxy inherits PrismaService lifecycle
    // methods on some Prisma versions. Supplying that proxy directly would
    // make Nest call `onModuleInit` and attempt a second `$connect` on the
    // already-open transaction. Expose only the two query methods the guard
    // actually uses, bound to this transaction client, so no lifecycle hook or
    // independent database connection can run.
    const rateLimitPrisma = {
        $queryRaw: client.$queryRaw.bind(client),
        $executeRaw: client.$executeRaw.bind(client),
    } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
        controllers: [ReceiptLinkController],
        providers: [
            { provide: ReceiptLinkTokenService, useValue: tokenService },
            { provide: FILE_STORAGE_PORT, useValue: storage },
            { provide: PrismaService, useValue: rateLimitPrisma },
            RateLimitGuard,
        ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new GlobalValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    try {
        await app.init();
        await app.listen(0, "127.0.0.1");
        const baseUrl = await app.getUrl();
        if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
            throw new Error("phase0 HTTP app did not bind to localhost");
        }
        return { app, baseUrl };
    } catch {
        await app.close().catch(() => undefined);
        throw new Error("phase0 HTTP app could not start");
    }
}

/**
 * Read the storage provider's object metadata after cleanup. A metadata list
 * is the authoritative absence check for this probe; a download can still
 * return a cached response after an object has been removed.
 */
function createOwnedStorageMetadataReader(
    configService: ConfigService,
): OwnedStorageMetadataReader {
    const supabaseUrl = configService.get<string>("SUPABASE_URL")?.trim();
    const supabaseServiceKey = configService.get<string>("SUPABASE_SERVICE_KEY")?.trim();
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("phase0 storage metadata credentials are not configured");
    }

    const metadataClient: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    return async (prefix: string): Promise<readonly string[]> => {
        const { data, error } = await metadataClient.storage
            .from(STORAGE_BUCKET_NAME)
            .list(prefix, { limit: 100, offset: 0 });
        if (error) {
            throw new Error("phase0 storage metadata listing failed");
        }
        if (!Array.isArray(data)) {
            throw new Error("phase0 storage metadata listing returned invalid data");
        }
        const paths = data.map((entry) => `${prefix}/${entry.name}`);
        paths.forEach((path) => assertOwnedStoragePath(path, prefix));
        return paths;
    };
}

async function proveReceiptLinkRefreshInsideTransaction(
    client: Prisma.TransactionClient,
    tokenService: ReceiptLinkTokenService,
    storage: FileStoragePort,
    baseline: Phase0PdfArtifact,
    revised: Phase0PdfArtifact,
    prefix: string,
    runId: string,
    createdStoragePaths: string[],
    registerFixtureOwnership: (ownership: ReceiptLinkRefreshFixtureOwnership) => void,
    setCheckpoint: (checkpoint: Phase0Checkpoint) => void,
): Promise<ReceiptLinkRefreshFixtureIds> {
    const now = new Date();
    setCheckpoint("transaction-fixture");
    const fixture = await createSyntheticFixture(
        client,
        tokenService,
        prefix,
        baseline,
        now,
        runId,
        registerFixtureOwnership,
    );

    // Upload only fresh, owned objects. The path list is the complete cleanup
    // allowlist; no broad-prefix deletion is ever attempted.
    setCheckpoint("storage-upload");
    trackOwnedStoragePath(createdStoragePaths, fixture.beforePath, prefix);
    await storage.upload(baseline.png, fixture.beforePath, IMAGE_MIME_TYPE);
    trackOwnedStoragePath(createdStoragePaths, fixture.afterPath, prefix);
    await storage.upload(revised.png, fixture.afterPath, IMAGE_MIME_TYPE);

    setCheckpoint("http-proof");
    const http = await createReceiptLinkHttpApp(tokenService, storage, client);
    try {
        const statusBefore = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/status`,
        );
        if (statusBefore.status !== 200) throw new Error("phase0 status preflight did not return 200");
        const statusBeforeBody = asRecord(statusBefore.body);
        if (statusBeforeBody["state"] !== "pending") {
            throw new Error("phase0 status preflight was not pending");
        }

        const noAccess = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/image`,
        );
        if (noAccess.status !== 401) throw new Error("phase0 image route accepted missing access credential");

        const verified = await requestHttp(
            http.baseUrl,
            "POST",
            `/receipt-links/${fixture.primaryToken}/verify`,
            { body: { birthday: "19900101" } },
        );
        if (verified.status !== 200) throw new Error("phase0 valid birthday verification did not return 200");
        const verifiedBody = asRecord(verified.body);
        if (verifiedBody["ok"] !== true || verifiedBody["clientName"] !== fixture.clientName) {
            throw new Error("phase0 birthday verification response was invalid");
        }
        const accessToken = requiredResponseString(verified.body, "accessToken");
        if (Object.keys(verifiedBody).sort().join(",") !== "accessToken,clientName,ok") {
            throw new Error("phase0 verification response leaked unexpected fields");
        }

        const accessMetadata = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/access`,
            { headers: { "X-Receipt-Access-Token": accessToken } },
        );
        if (accessMetadata.status !== 200) throw new Error("phase0 access credential was not accepted");

        const baselineImage = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/image`,
            { headers: { "X-Receipt-Access-Token": accessToken } },
        );
        if (baselineImage.status !== 200 || !baselineImage.bytes.equals(baseline.png)) {
            throw new Error("phase0 receipt image did not serve the baseline PNG");
        }
        if (
            baselineImage.headers.get("content-type")?.split(";")[0]?.toLowerCase() !== IMAGE_MIME_TYPE
            || baselineImage.headers.get("cache-control") !== "private, no-store"
            || baselineImage.headers.get("x-content-type-options") !== "nosniff"
        ) {
            throw new Error("phase0 baseline image response headers were unsafe or cacheable");
        }

        const statusAfterVerify = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/status`,
        );
        if (statusAfterVerify.status !== 200 || asRecord(statusAfterVerify.body)["state"] !== "verified") {
            throw new Error("phase0 status did not reflect verified access");
        }
        if ("storagePath" in asRecord(statusAfterVerify.body)) {
            throw new Error("phase0 status route leaked the storage path");
        }

        const baselineRow = await readReceiptLinkSnapshot(client, fixture.primaryTokenId);
        if (
            baselineRow.storagePath !== fixture.beforePath
            || baselineRow.contentSha256 !== baseline.pngSha256
            || baselineRow.byteSize !== baseline.png.length
            || !baselineRow.active
            || !baselineRow.verifiedAt
            || !baselineRow.accessTokenHash
            || baselineRow.failedAttempts !== 0
        ) {
            throw new Error("phase0 verified fixture snapshot was not as expected");
        }

        let duplicateUploadRejected = false;
        try {
            // upsert=false in the real Supabase adapter makes this a deliberate
            // upload failure against an already-owned object.
            await storage.upload(revised.png, fixture.beforePath, IMAGE_MIME_TYPE);
        } catch {
            duplicateUploadRejected = true;
        }
        if (!duplicateUploadRejected) throw new Error("phase0 failed upload unexpectedly succeeded");
        const afterUploadFailure = await readReceiptLinkSnapshot(client, fixture.primaryTokenId);
        assertReceiptLinkMetadataUnchanged(baselineRow, afterUploadFailure);
        if (
            afterUploadFailure.storagePath !== fixture.beforePath
            || afterUploadFailure.contentSha256 !== baseline.pngSha256
            || afterUploadFailure.byteSize !== baseline.png.length
        ) {
            throw new Error("phase0 failed upload switched the receipt pointer");
        }

        const baselineAfterFailure = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/image`,
            { headers: { "X-Receipt-Access-Token": accessToken } },
        );
        if (baselineAfterFailure.status !== 200 || !baselineAfterFailure.bytes.equals(baseline.png)) {
            throw new Error("phase0 failed upload changed the served baseline image");
        }

        await expect(compareAndSwapReceiptLinkPointer(client, {
            id: fixture.primaryTokenId,
            branchId: fixture.ids.branchId,
            eformsignDocId: fixture.primaryDocumentId,
            expectedStoragePath: fixture.beforePath,
            expectedContentSha256: "0".repeat(64),
            expectedByteSize: baseline.png.length,
            nextStoragePath: fixture.afterPath,
            nextContentSha256: revised.pngSha256,
            nextByteSize: revised.png.length,
        })).rejects.toThrow("compare-and-swap precondition failed");
        const afterStaleCas = await readReceiptLinkSnapshot(client, fixture.primaryTokenId);
        assertReceiptLinkMetadataUnchanged(baselineRow, afterStaleCas);
        if (afterStaleCas.storagePath !== fixture.beforePath) {
            throw new Error("phase0 stale CAS changed the receipt pointer");
        }

        await compareAndSwapReceiptLinkPointer(client, {
            id: fixture.primaryTokenId,
            branchId: fixture.ids.branchId,
            eformsignDocId: fixture.primaryDocumentId,
            expectedStoragePath: fixture.beforePath,
            expectedContentSha256: baseline.pngSha256,
            expectedByteSize: baseline.png.length,
            nextStoragePath: fixture.afterPath,
            nextContentSha256: revised.pngSha256,
            nextByteSize: revised.png.length,
        });
        const afterCas = await readReceiptLinkSnapshot(client, fixture.primaryTokenId);
        assertReceiptLinkMetadataUnchanged(baselineRow, afterCas);
        if (
            afterCas.storagePath !== fixture.afterPath
            || afterCas.contentSha256 !== revised.pngSha256
            || afterCas.byteSize !== revised.png.length
        ) {
            throw new Error("phase0 successful CAS did not point at the revised PNG");
        }

        const revisedImage = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/image`,
            { headers: { "X-Receipt-Access-Token": accessToken } },
        );
        if (revisedImage.status !== 200 || !revisedImage.bytes.equals(revised.png)) {
            throw new Error("phase0 same URL did not serve the revised PNG");
        }
        if (revisedImage.headers.get("cache-control") !== "private, no-store") {
            throw new Error("phase0 revised image response was cacheable");
        }

        const accessAfterCas = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/access`,
            { headers: { "X-Receipt-Access-Token": accessToken } },
        );
        if (accessAfterCas.status !== 200) throw new Error("phase0 old access credential was not retained");

        const secondaryVerified = await requestHttp(
            http.baseUrl,
            "POST",
            `/receipt-links/${fixture.secondaryToken}/verify`,
            { body: { birthday: PHASE0_BIRTHDAY } },
        );
        if (secondaryVerified.status !== 200) throw new Error("phase0 revoked fixture verification failed");
        const secondaryAccessToken = requiredResponseString(secondaryVerified.body, "accessToken");
        await client.receipt_link_token.update({
            where: { id: fixture.secondaryTokenId },
            data: { active: false, revokedAt: new Date() },
        });
        const revokedImage = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.secondaryToken}/image`,
            { headers: { "X-Receipt-Access-Token": secondaryAccessToken } },
        );
        if (revokedImage.status !== 401) throw new Error("phase0 revoked access was accepted");

        await client.receipt_link_token.update({
            where: { id: fixture.primaryTokenId },
            data: { expiresAt: new Date(Date.now() - 1_000) },
        });
        const expiredImage = await requestHttp(
            http.baseUrl,
            "GET",
            `/receipt-links/${fixture.primaryToken}/image`,
            { headers: { "X-Receipt-Access-Token": accessToken } },
        );
        if (expiredImage.status !== 401) throw new Error("phase0 expired access was accepted");
    } finally {
        await http.app.close();
    }

    return fixture.ids;
}

async function assertFixtureRowsAbsent(
    prisma: PrismaService,
    ownership: ReceiptLinkRefreshFixtureOwnership,
): Promise<void> {
    const [branch, client, documents, tokens] = await Promise.all([
        ownership.branchId
            ? prisma.branch.findUnique({ where: { id: ownership.branchId }, select: { id: true } })
            : Promise.resolve(null),
        ownership.clientId !== undefined
            ? prisma.client.findUnique({ where: { id: ownership.clientId }, select: { id: true } })
            : Promise.resolve(null),
        Promise.all(ownership.eformsignDocIds.map((id) => prisma.eformsign_doc.findUnique({ where: { id }, select: { id: true } }))),
        Promise.all(ownership.receiptLinkTokenIds.map((id) => prisma.receipt_link_token.findUnique({ where: { id }, select: { id: true } }))),
    ]);
    if (branch || client || documents.some(Boolean) || tokens.some(Boolean)) {
        throw new Error("phase0 transaction rollback left fixture rows behind");
    }
}

async function runPhase0Proof(): Promise<Phase0ProofResult> {
    const runId = randomUUID();
    const prefix = createPhase0StoragePrefix(runId);
    const beforePath = `${prefix}/before.png`;
    const afterPath = `${prefix}/after.png`;
    const createdStoragePaths: string[] = [];
    let storage: FileStoragePort | undefined;
    let prisma: PrismaService | undefined;
    let configModule: TestingModule | undefined;
    let fixtureOwnership: ReceiptLinkRefreshFixtureOwnership | undefined;
    let cleanupManifest: Phase0CleanupManifest | undefined;
    let readOwnedStorageObjectPaths: OwnedStorageMetadataReader | undefined;
    let artifacts: { baseline: Phase0PdfArtifact; revised: Phase0PdfArtifact } | undefined;
    let transactionRolledBack = false;
    let databaseRowsAbsent = false;
    let storageObjectsAbsent = false;
    let primaryFailure: unknown;
    let cleanupFailure = false;
    let rollbackVerificationFailure = false;
    let checkpoint: Phase0Checkpoint = "config-module";
    let failureCheckpoint: Phase0Checkpoint | undefined;

    try {
        checkpoint = "config-module";
        configModule = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATHS })],
        }).compile();
        const configService = configModule.get(ConfigService);
        checkpoint = "target-guard";
        const targetConfig = readPhase0TargetConfig(configService as Phase0ConfigReader);
        assertPhase0TargetConfig(targetConfig);
        assertNoExternalRateLimitStore(configService.get<string>("VALKEY_URL"));

        checkpoint = "pdf-rasterization";
        const proofArtifacts = await renderApprovedReceiptPages(new PdfPageRasterizerService());
        artifacts = proofArtifacts;
        checkpoint = "storage-init";
        readOwnedStorageObjectPaths = createOwnedStorageMetadataReader(configService);
        storage = new SupabaseStorageAdapter(configService);
        checkpoint = "prisma-init";
        prisma = createExtendedPrismaService();
        checkpoint = "database-connect";
        await prisma.$connect();

        // Register both exact paths before any upload starts. A timeout or
        // provider error after a remote write must still leave a recoverable
        // cleanup allowlist, and the manifest is intentionally retained after
        // a successful proof for independent operator verification.
        trackOwnedStoragePath(createdStoragePaths, beforePath, prefix);
        trackOwnedStoragePath(createdStoragePaths, afterPath, prefix);
        checkpoint = "cleanup-manifest";
        cleanupManifest = await createPhase0CleanupManifest(
            runId,
            prefix,
            createdStoragePaths,
        );

        try {
            checkpoint = "transaction-fixture";
            await prisma.$transaction(async (rawClient) => {
                const client = rawClient as unknown as Prisma.TransactionClient;
                const repository = new SbReceiptLinkTokenRepository(client as unknown as PrismaService);
                const tokenService = new ReceiptLinkTokenService(repository, configService);
                const fixtureIds = await proveReceiptLinkRefreshInsideTransaction(
                    client,
                    tokenService,
                    storage as FileStoragePort,
                    proofArtifacts.baseline,
                    proofArtifacts.revised,
                    prefix,
                    runId,
                    createdStoragePaths,
                    (ownership) => {
                        fixtureOwnership = ownership;
                    },
                    (nextCheckpoint) => {
                        checkpoint = nextCheckpoint;
                    },
                );
                // Keep the complete record for the successful path while the
                // incremental ownership object remains available on failures.
                fixtureOwnership = {
                    branchId: fixtureIds.branchId,
                    clientId: fixtureIds.clientId,
                    eformsignDocIds: fixtureIds.eformsignDocIds,
                    receiptLinkTokenIds: fixtureIds.receiptLinkTokenIds,
                };
                checkpoint = "rollback-sentinel";
                throw new Phase0RollbackSentinel();
            }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 5_000 });
        } catch (error) {
            if (error instanceof Phase0RollbackSentinel) {
                transactionRolledBack = true;
            } else {
                throw error;
            }
        }
        if (!transactionRolledBack || !fixtureOwnership) {
            throw new Error("phase0 transaction did not reach its rollback sentinel");
        }
    } catch (error) {
        primaryFailure = error;
        failureCheckpoint = checkpoint;
    }

    checkpoint = "storage-cleanup";
    if (storage && createdStoragePaths.length > 0) {
        try {
            if (!readOwnedStorageObjectPaths) {
                throw new Error("phase0 storage metadata reader was not initialized");
            }
            await deleteAndVerifyOwnedStorageObjects(
                storage,
                prefix,
                createdStoragePaths,
                readOwnedStorageObjectPaths,
            );
            storageObjectsAbsent = true;
        } catch (error) {
            cleanupFailure = true;
            if (!primaryFailure) {
                primaryFailure = error;
                failureCheckpoint = checkpoint;
            }
        }
    } else {
        storageObjectsAbsent = true;
    }

    if (prisma && fixtureOwnership) {
        checkpoint = "rollback-verification";
        try {
            await assertFixtureRowsAbsent(prisma, fixtureOwnership);
            databaseRowsAbsent = true;
        } catch (error) {
            rollbackVerificationFailure = true;
            if (!primaryFailure) {
                primaryFailure = error;
                failureCheckpoint = checkpoint;
            }
        }
    }

    checkpoint = "disconnect";
    await prisma?.$disconnect().catch((error: unknown) => {
        if (!primaryFailure) {
            primaryFailure = error;
            failureCheckpoint = checkpoint;
        }
    });
    await configModule?.close().catch((error: unknown) => {
        if (!primaryFailure) {
            primaryFailure = error;
            failureCheckpoint = checkpoint;
        }
    });

    const outcome = phase0ProofStatus(
        transactionRolledBack,
        databaseRowsAbsent,
        storageObjectsAbsent,
    );
    if (primaryFailure) {
        const failureDetails = [
            `checkpoint=${failureCheckpoint ?? checkpoint}`,
            `error=${safePhase0ErrorDescriptor(primaryFailure)}`,
            `manifestPath=${cleanupManifest?.filePath ?? "unavailable"}`,
            `cleanupFailure=${String(cleanupFailure)}`,
            `rollbackVerificationFailure=${String(rollbackVerificationFailure)}`,
            outcome,
        ].join("; ");
        if (cleanupFailure || rollbackVerificationFailure) {
            throw new Error(`phase0 receipt-link refresh proof or cleanup verification failed (${failureDetails})`);
        }
        throw new Error(`${sanitizePhase0Error(primaryFailure)} (${failureDetails})`);
    }
    if (!transactionRolledBack || !databaseRowsAbsent || !storageObjectsAbsent || !cleanupManifest || !artifacts) {
        throw new Error(`phase0 receipt-link refresh proof did not establish all invariants (${outcome})`);
    }
    return {
        runId,
        manifestPath: cleanupManifest.filePath,
        baselinePngSha256: artifacts.baseline.pngSha256,
        baselinePngByteSize: artifacts.baseline.png.length,
        revisedPngSha256: artifacts.revised.pngSha256,
        revisedPngByteSize: artifacts.revised.png.length,
        transactionRolledBack,
        databaseRowsAbsent,
        storageObjectsAbsent,
    };
}

(LIVE ? describe : describe.skip)("receipt-link refresh — isolated Phase 0 proof", () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    it("serves a revised PNG through the existing controller while preserving credentials and rolling back fixtures", async () => {
        const result = await runPhase0Proof();
        console.info("[receipt-link-refresh] " + JSON.stringify({
            runId: result.runId,
            manifestPath: result.manifestPath,
            baselinePngSha256: result.baselinePngSha256,
            baselinePngByteSize: result.baselinePngByteSize,
            revisedPngSha256: result.revisedPngSha256,
            revisedPngByteSize: result.revisedPngByteSize,
            transactionRolledBack: result.transactionRolledBack,
            databaseRowsAbsent: result.databaseRowsAbsent,
            storageObjectsAbsent: result.storageObjectsAbsent,
        }));
        expect(result.transactionRolledBack).toBe(true);
        expect(result.databaseRowsAbsent).toBe(true);
        expect(result.storageObjectsAbsent).toBe(true);
    });
});
