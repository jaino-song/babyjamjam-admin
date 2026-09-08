import { getReceiptLinkExpiresAt, RECEIPT_LINK_GRACE_DAYS } from "domain/constants/receipt-link-expiry";
import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";
import {
    CreateReceiptLinkTokenData,
    RefreshReceiptClientFields,
    ExpiredReceiptLinkToken,
    IReceiptLinkTokenRepository,
    IReceiptLinkTokenIssuanceRepository,
    ReceiptLinkTokenRecord,
    PromoteReceiptLinkRevisionArtifactInput,
    ReceiptLinkRevisionArtifactPromotionResult,
    ReserveVerificationAttemptResult,
    UpdateReceiptLinkTokenData,
} from "domain/repositories/receipt-link-token.repository.interface";

const INCLUDE_NAMES = { branch: { select: { name: true } }, client: { select: { name: true, endDate: true } } } as const;
const JOB_ISSUANCE_LOCK_NAMESPACE = "babyjamjam:receipt-link-job-issuance:v1";
const RECEIPT_REVISION_PROMOTION_LOCK_NAMESPACE = "babyjamjam:receipt-link-revision-promotion:v1";

interface RawRow {
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
    branch?: { name: string } | null;
    client?: { name: string; endDate?: Date | null } | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
    if (!isPlainRecord(value)) return value;
    return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

function validUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validSha(value: string): boolean {
    return /^[0-9a-f]{64}$/i.test(value);
}

function validPromotionInput(input: PromoteReceiptLinkRevisionArtifactInput): boolean {
    if (!isPlainRecord(input)) return false;
    return typeof input.branchId === "string" && validUuid(input.branchId)
        && Number.isSafeInteger(input.clientId) && input.clientId > 0
        && typeof input.serviceRecordCaseId === "string" && validUuid(input.serviceRecordCaseId)
        && typeof input.revisionId === "string" && validUuid(input.revisionId)
        && typeof input.documentStateId === "string" && validUuid(input.documentStateId)
        && typeof input.expectedGeneration === "string" && input.expectedGeneration.trim().length > 0
        && Number.isSafeInteger(input.expectedStateVersion) && input.expectedStateVersion >= 0
        && typeof input.targetDocumentId === "string" && input.targetDocumentId.trim().length > 0
        && (input.documentVersion === null || (Number.isSafeInteger(input.documentVersion) && input.documentVersion >= 0))
        && typeof input.templateId === "string" && input.templateId.trim().length > 0
        && typeof input.templateVersion === "string" && input.templateVersion.trim().length > 0
        && typeof input.mirrorGeneration === "string" && input.mirrorGeneration.trim().length > 0
        && Number.isSafeInteger(input.eformsignDocId) && input.eformsignDocId > 0
        && Array.isArray(input.tokenIds)
        && input.tokenIds.length > 0
        && input.tokenIds.every((tokenId) => validUuid(tokenId))
        && new Set(input.tokenIds).size === input.tokenIds.length
        && typeof input.storagePath === "string" && input.storagePath.trim().length > 0
        && typeof input.contentSha256 === "string" && validSha(input.contentSha256)
        && Number.isSafeInteger(input.byteSize) && input.byteSize > 0
        && isPlainRecord(input.proof)
        && typeof input.proof.officialPdfSha256 === "string" && validSha(input.proof.officialPdfSha256)
        && typeof input.proof.verifiedAt === "string" && input.proof.verifiedAt.trim().length > 0
        && Number.isSafeInteger(input.proof.pageCount) && input.proof.pageCount > 0
        && isPlainRecord(input.proof.scope)
        && isPlainRecord(input.proof.expected)
        && input.proof.scope["branchId"] === input.branchId
        && input.proof.scope["clientId"] === input.clientId
        && input.proof.scope["revisionId"] === input.revisionId
        && input.proof.scope["documentId"] === input.targetDocumentId
        && input.proof.scope["generation"] === input.expectedGeneration
        && input.proof.scope["mirrorGeneration"] === input.mirrorGeneration
        && input.proof.scope["templateId"] === input.templateId
        && input.proof.scope["templateVersion"] === input.templateVersion
        && (!input.proof.artifact || (
            input.proof.artifact.storagePath === input.storagePath
            && input.proof.artifact.contentSha256 === input.contentSha256
            && input.proof.artifact.byteSize === input.byteSize
        ));
}

class ReceiptPromotionRollback extends Error {
    constructor() {
        super("receipt promotion CAS lost");
        this.name = "ReceiptPromotionRollback";
    }
}

function toRecord(row: RawRow): ReceiptLinkTokenRecord {
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
        branchName: row.branch?.name ?? null,
        clientName: row.client?.name ?? null,
    };
}

/**
 * `receipt_link_token` is a tenant model (has `branch_id`) as of the drift-spec
 * registration in `tenant-models.generated.ts`, so the tenant-isolation Prisma
 * extension now applies to it. Three methods below are token-KEYED lookups
 * reached from the public, unauthenticated receipt-link endpoints
 * (`ReceiptLinkController`'s status/verify routes): the presented link token
 * IS the credential, and the branch is not yet known — it is resolved BY the
 * lookup, not available before it. That is structurally identical to
 * `TenantGuard`'s own membership-lookup bypass (`tenant.guard.ts`,
 * `run-system-scope.ts`), so those three (plus `reserveVerificationAttempt`,
 * the atomic birthday-attempt reservation backing the same public `verify`
 * endpoint) wrap their bodies in `runSystemScope`, deliberately and
 * auditedly bypassing tenant isolation for a query that is legitimately
 * cross-branch by design. The other methods (`createOrRefreshContractLink`,
 * `findExpired`, `deleteByIds`, `existsByStoragePath`,
 * `findStoragePathsInUse`, `findActiveByJobId`) run under scheduler/delivery
 * context (no HTTP-origin ALS store, or an already-branch-scoped write from
 * `ReceiptLinkIssueService`) and stay unwrapped.
 */
@Injectable()
export class SbReceiptLinkTokenRepository implements IReceiptLinkTokenRepository {
    constructor(private readonly prisma: PrismaService) {}

    async withJobIssuanceLock<T>(
        jobId: string,
        operation: (contended: boolean, repository: IReceiptLinkTokenIssuanceRepository) => Promise<T>,
    ): Promise<T> {
        return this.prisma.$transaction(async (tx) => {
            const lockKey = `${JOB_ISSUANCE_LOCK_NAMESPACE}:${jobId}`;
            const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
                SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
            `);
            const acquired = rows[0]?.acquired === true;
            if (!acquired) {
                await tx.$executeRaw(Prisma.sql`
                    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
                `);
            }
            const transactionRepository: IReceiptLinkTokenIssuanceRepository = {
                createOrRefreshContractLink: async (data, _now, refreshClient) =>
                    toRecord(await this.createOrRefreshContractLinkWithClient(tx, data, refreshClient)),
                findActiveByJobId: (lockedJobId) => this.findActiveByJobIdWithClient(tx, lockedJobId),
            };
            return operation(!acquired, transactionRepository);
        });
    }

    // Cross-branch by design: see the class comment above.
    async findByLinkTokenHash(linkTokenHash: string): Promise<ReceiptLinkTokenRecord | null> {
        return runSystemScope(async () => {
            const row = await this.prisma.receipt_link_token.findUnique({
                where: { linkTokenHash },
                include: INCLUDE_NAMES,
            });
            if (!row) return null;
            // Missing legacy end dates keep their original expiry, but do not prevent
            // restoration of URLs revoked by the former reissuance policy.
            const expiresAt = row.client?.endDate ? getReceiptLinkExpiresAt(row.client.endDate) : row.expiresAt;
            const restoreLegacyLink = !row.active && row.revokedAt !== null;
            if (expiresAt.getTime() !== row.expiresAt.getTime() || restoreLegacyLink) {
                const data = {
                    expiresAt,
                    ...(restoreLegacyLink ? { active: true, revokedAt: null, accessTokenHash: null, verifiedAt: null } : {}),
                };
                await this.prisma.receipt_link_token.update({ where: { id: row.id }, data });
                Object.assign(row, data);
            }
            return toRecord(row);
        });
    }

    async createOrRefreshContractLink(data: CreateReceiptLinkTokenData, now: Date, refreshClient?: RefreshReceiptClientFields): Promise<ReceiptLinkTokenRecord> {
        void now;
        const row = await this.prisma.$transaction((tx) => this.createOrRefreshContractLinkWithClient(tx, data, refreshClient));
        return toRecord(row);
    }

    private async createOrRefreshContractLinkWithClient(
        client: Prisma.TransactionClient,
        data: CreateReceiptLinkTokenData,
        refreshClient?: RefreshReceiptClientFields,
    ) {
        // Serialize different jobs for the same contract, including simultaneous first issuance.
        await client.$executeRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(hashtextextended(${`receipt-contract:${data.branchId}:${data.eformsignDocId}`}, 0))
        `);
        if (refreshClient) {
            // Rendering happens before this transaction. Read the latest profile while
            // holding its row lock so a concurrent correction cannot be overwritten.
            const rows = await client.$queryRaw<Array<{ birthday: string | null; endDate: Date | null }>>(Prisma.sql`
                SELECT birthday, end_date AS "endDate" FROM client
                WHERE id = ${data.clientId} AND branch_id = ${data.branchId}::uuid
                FOR UPDATE
            `);
            if (!rows[0]) throw new Error("Receipt client no longer exists");
            data = { ...data, ...refreshClient(rows[0]) };
        }
        // Older URLs remain usable. Refresh their lifetime without clearing challenge state.
        await client.receipt_link_token.updateMany({
            where: { clientId: data.clientId, branchId: data.branchId },
            data: { expiresAt: data.expiresAt, expectedBirthdayHash: data.expectedBirthdayHash },
        });
        const previous = await client.receipt_link_token.findUnique({
            where: { linkTokenHash: data.linkTokenHash, branchId: data.branchId },
        });
        if (previous && previous.storagePath !== data.storagePath) {
            // Retain an unreachable, inactive snapshot reference for the existing expiry
            // cleanup. Overwriting the only path reference would leak the former image.
            await client.receipt_link_token.create({
                data: {
                    ...data,
                    linkTokenHash: randomBytes(32).toString("hex"),
                    jobId: null,
                    storagePath: previous.storagePath,
                    contentSha256: previous.contentSha256,
                    byteSize: previous.byteSize,
                    active: false,
                    revokedAt: null,
                },
            });
        }
        return client.receipt_link_token.upsert({
            where: { linkTokenHash: data.linkTokenHash, branchId: data.branchId },
            create: data,
            update: {
                expiresAt: data.expiresAt,
                expectedBirthdayHash: data.expectedBirthdayHash,
                // Reissuing retains the URL and the authenticated session.
                storagePath: data.storagePath,
                contentSha256: data.contentSha256,
                byteSize: data.byteSize,
            },
            include: INCLUDE_NAMES,
        });
    }

    // Cross-branch by design: see the class comment above. This is the verify()
    // access-token mint's only caller — the post-lock-window reset now happens inside
    // reserveVerificationAttempt's own SQL, not here.
    async update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
        return runSystemScope(async () => {
            const row = await this.prisma.receipt_link_token.update({
                where: { id },
                data,
                include: INCLUDE_NAMES,
            });
            return toRecord(row);
        });
    }

    // Cross-branch by design: see the class comment above.
    //
    // ONE atomic statement (a locking CTE feeding a single UPDATE...FROM...RETURNING), not a
    // read-then-decide-then-write sequence: two concurrent reservations against the same row
    // always serialize on the row lock the CTE's `FOR UPDATE` takes, so neither can ever act on
    // a stale pre-write snapshot of `locked_at`/`failed_attempts`. `before` captures that
    // snapshot explicitly (aliased `b`) because, inside a single UPDATE's SET/RETURNING
    // expressions, referencing the target table's own columns would otherwise resolve to
    // whichever value THIS statement is writing, not the value the decision must be based on.
    async reserveVerificationAttempt(
        id: string,
        now: Date,
        lockWindowMs: number,
        maxAttempts: number,
    ): Promise<ReserveVerificationAttemptResult> {
        return runSystemScope(async () => {
            const rows = await this.prisma.$queryRaw<
                Array<{ failedAttempts: number; lockedAt: Date | null; expectedBirthdayHash: string; wasLocked: boolean }>
            >(Prisma.sql`
                WITH before AS (
                    SELECT id, locked_at, failed_attempts, expected_birthday_hash
                    FROM receipt_link_token
                    WHERE id = ${id}::uuid AND active AND expires_at > ${now}::timestamptz
                    FOR UPDATE
                )
                UPDATE receipt_link_token t
                SET
                    failed_attempts = CASE
                        WHEN b.locked_at IS NOT NULL
                             AND b.locked_at + make_interval(secs => (${lockWindowMs}::double precision / 1000)) > ${now}::timestamptz
                        THEN b.failed_attempts
                        WHEN b.locked_at IS NOT NULL THEN 1
                        ELSE b.failed_attempts + 1
                    END,
                    locked_at = CASE
                        WHEN b.locked_at IS NOT NULL
                             AND b.locked_at + make_interval(secs => (${lockWindowMs}::double precision / 1000)) > ${now}::timestamptz
                        THEN b.locked_at
                        WHEN b.locked_at IS NOT NULL THEN NULL
                        WHEN b.failed_attempts + 1 >= ${maxAttempts}::int THEN ${now}::timestamptz
                        ELSE NULL
                    END
                FROM before b
                WHERE t.id = b.id
                RETURNING
                    t.failed_attempts AS "failedAttempts",
                    t.locked_at AS "lockedAt",
                    t.expected_birthday_hash AS "expectedBirthdayHash",
                    (b.locked_at IS NOT NULL
                        AND b.locked_at + make_interval(secs => (${lockWindowMs}::double precision / 1000)) > ${now}::timestamptz
                    ) AS "wasLocked"
            `);
            const row = rows[0];
            if (!row) {
                // The CTE's WHERE (id AND active AND expires_at > now) matched zero rows: the
                // token is missing, already inactive, or expired as of this same `now`. The
                // caller re-reads the row to report the correct terminal reason.
                return { outcome: "unusable" };
            }
            if (row.wasLocked) {
                // Values unchanged: the statement still writes t.locked_at/failed_attempts
                // above, it just writes back the pre-write value in this branch (see the row
                // lock the CTE's FOR UPDATE holds for the duration of the write).
                return { outcome: "locked", lockedUntil: new Date(row.lockedAt!.getTime() + lockWindowMs) };
            }
            return {
                outcome: "recorded",
                failedAttempts: row.failedAttempts,
                lockedAt: row.lockedAt,
                expectedBirthdayHash: row.expectedBirthdayHash,
            };
        });
    }

    private expiredWhere(cutoff: Date): Prisma.receipt_link_tokenWhereInput {
        // DATE endDate maps to midnight KST after the grace period. Invert that
        // boundary so corrected earlier dates are candidates even with a stale expiry.
        const endDateBoundary = cutoff.getTime() - (RECEIPT_LINK_GRACE_DAYS + 1) * 86_400_000 + 9 * 3_600_000;
        // Prisma binds this as a DATE: round up so a partial day does not lose
        // already-expired end dates when PostgreSQL drops the time component.
        const endDateCutoff = new Date(Math.ceil(endDateBoundary / 86_400_000) * 86_400_000);
        return {
            OR: [
                { client: { endDate: { lt: endDateCutoff } } },
                { client: { endDate: null }, expiresAt: { lt: cutoff } },
            ],
        };
    }

    async findExpired(cutoff: Date): Promise<ExpiredReceiptLinkToken[]> {
        const rows = await this.prisma.receipt_link_token.findMany({
            where: this.expiredWhere(cutoff),
            include: INCLUDE_NAMES,
            take: 1000,
        });
        const expired: ExpiredReceiptLinkToken[] = [];
        for (const row of rows) {
            const expiresAt = row.client?.endDate ? getReceiptLinkExpiresAt(row.client.endDate) : row.expiresAt;
            if (expiresAt.getTime() !== row.expiresAt.getTime()) {
                await this.prisma.receipt_link_token.update({ where: { id: row.id }, data: { expiresAt } });
            }
            if (expiresAt < cutoff) expired.push({ id: row.id, storagePath: row.storagePath, eformsignDocId: row.eformsignDocId });
        }
        return expired;
    }

    async deleteByIds(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;
        const now = new Date();
        const result = await this.prisma.receipt_link_token.deleteMany({
            where: { id: { in: ids }, expiresAt: { lt: now }, ...this.expiredWhere(now) },
        });
        return result.count;
    }

    async existsByStoragePath(storagePath: string): Promise<boolean> {
        const row = await this.prisma.receipt_link_token.findFirst({
            where: { storagePath },
            select: { id: true },
        });
        return row !== null;
    }

    async findStoragePathsInUse(storagePaths: string[], cutoff: Date): Promise<string[]> {
        if (storagePaths.length === 0) return [];
        const rows = await this.prisma.receipt_link_token.findMany({
            where: { storagePath: { in: storagePaths }, expiresAt: { gte: cutoff } },
            select: { storagePath: true },
            distinct: ["storagePath"],
        });
        return rows.map((row) => row.storagePath);
    }

    async findActiveByJobId(jobId: string): Promise<ReceiptLinkTokenRecord | null> {
        return this.findActiveByJobIdWithClient(this.prisma, jobId);
    }

    /**
     * Promote a freshly verified receipt image and complete its durable
     * operation in the same transaction. All identity/proof checks happen
     * while the owning rows are locked; a stale generation returns without
     * touching any token or replacing its old artifact.
     */
    async promoteReceiptRevisionArtifact(
        input: PromoteReceiptLinkRevisionArtifactInput,
    ): Promise<ReceiptLinkRevisionArtifactPromotionResult> {
        if (!validPromotionInput(input)) {
            return { disposition: "stale", tokenIds: [], stateVersion: null };
        }
        const now = input.now ?? new Date();
        if (!Number.isFinite(now.getTime())) {
            return { disposition: "stale", tokenIds: [], stateVersion: null };
        }
        const proofJson = canonicalJson(input.proof);
        try {
            return await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                SELECT pg_advisory_xact_lock(hashtextextended(${`${RECEIPT_REVISION_PROMOTION_LOCK_NAMESPACE}:${input.branchId}:${input.serviceRecordCaseId}:${input.revisionId}`}, 0))
            `);
            // Keep the common owner lock order: client -> case -> revision ->
            // document state -> contract document -> receipt tokens.
            const clients = await tx.$queryRaw<Array<{ eDocId: string | null }>>(Prisma.sql`
                SELECT e_doc_id AS "eDocId"
                FROM client
                WHERE id = ${input.clientId}
                  AND branch_id = ${input.branchId}::uuid
                FOR UPDATE
            `);
            const client = clients[0];
            if (!client) return { disposition: "not_found", tokenIds: [], stateVersion: null };
            if (client.eDocId !== input.targetDocumentId) {
                return { disposition: "stale", tokenIds: [], stateVersion: null };
            }

            const cases = await tx.$queryRaw<Array<{ currentRevisionId: string | null }>>(Prisma.sql`
                SELECT current_revision_id AS "currentRevisionId"
                FROM service_record_case
                WHERE id = ${input.serviceRecordCaseId}::uuid
                  AND branch_id = ${input.branchId}::uuid
                  AND client_id = ${input.clientId}
                FOR UPDATE
            `);
            const ownerCase = cases[0];
            if (!ownerCase) return { disposition: "not_found", tokenIds: [], stateVersion: null };
            if (ownerCase.currentRevisionId !== input.revisionId) {
                return { disposition: "stale", tokenIds: [], stateVersion: null };
            }

            const revisions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT id
                FROM service_record_revision
                WHERE id = ${input.revisionId}::uuid
                  AND branch_id = ${input.branchId}::uuid
                  AND service_record_case_id = ${input.serviceRecordCaseId}::uuid
                FOR UPDATE
            `);
            if (!revisions[0]) return { disposition: "not_found", tokenIds: [], stateVersion: null };

            const stateRows = await tx.$queryRaw<Array<{
                version: number;
                operation: string;
                generation: string;
                sourceDocumentId: string | null;
                targetDocumentId: string | null;
                documentVersion: number | null;
                templateId: string | null;
                templateVersion: string | null;
                mirrorGeneration: string | null;
                outputProof: unknown;
                status: string;
            }>>(Prisma.sql`
                SELECT
                    version,
                    operation,
                    generation,
                    source_document_id AS "sourceDocumentId",
                    target_document_id AS "targetDocumentId",
                    document_version AS "documentVersion",
                    template_id AS "templateId",
                    template_version AS "templateVersion",
                    mirror_generation AS "mirrorGeneration",
                    output_proof AS "outputProof",
                    status
                FROM service_record_revision_document_state
                WHERE id = ${input.documentStateId}::uuid
                  AND branch_id = ${input.branchId}::uuid
                  AND client_id = ${input.clientId}
                  AND service_record_case_id = ${input.serviceRecordCaseId}::uuid
                  AND revision_id = ${input.revisionId}::uuid
                  AND generation = ${input.expectedGeneration}
                FOR UPDATE
            `);
            const state = stateRows[0];
            if (!state) return { disposition: "stale", tokenIds: [], stateVersion: null };
            if (state.version !== input.expectedStateVersion
                || state.operation !== "receipt_refresh"
                || state.status === "completed"
                || state.targetDocumentId !== input.targetDocumentId
                || state.documentVersion !== input.documentVersion
                || state.templateId !== input.templateId
                || state.templateVersion !== input.templateVersion
                || state.mirrorGeneration !== input.mirrorGeneration
                || canonicalJson(state.outputProof) !== proofJson) {
                return { disposition: "stale", tokenIds: [], stateVersion: state.version };
            }

            const targetDocuments = await tx.$queryRaw<Array<{ id: number; documentId: string }>>(Prisma.sql`
                SELECT id, document_id AS "documentId"
                FROM eformsign_doc
                WHERE document_id = ${input.targetDocumentId}
                  AND branch_id = ${input.branchId}::uuid
                  AND client_id = ${input.clientId}
                FOR UPDATE
            `);
            const targetDocument = targetDocuments[0];
            if (!targetDocument || targetDocument.documentId !== input.targetDocumentId) {
                return { disposition: "stale", tokenIds: [], stateVersion: state.version };
            }

            const tokenRows = await tx.$queryRaw<Array<{
                id: string;
                eformsignDocId: number;
                branchId: string;
                clientId: number | null;
                active: boolean;
                expiresAt: Date;
            }>>(Prisma.sql`
                SELECT
                    id,
                    eformsign_doc_id AS "eformsignDocId",
                    branch_id AS "branchId",
                    client_id AS "clientId",
                    active,
                    expires_at AS "expiresAt"
                FROM receipt_link_token
                WHERE id IN (${Prisma.join(input.tokenIds.map((id) => Prisma.sql`${id}::uuid`))})
                ORDER BY id
                FOR UPDATE
            `);
            if (tokenRows.length !== input.tokenIds.length
                || tokenRows.some((row) => row.eformsignDocId !== input.eformsignDocId
                    || row.branchId !== input.branchId
                    || row.clientId !== input.clientId
                    || !row.active
                    || !(row.expiresAt instanceof Date)
                    || row.expiresAt.getTime() <= now.getTime())) {
                return { disposition: "stale", tokenIds: [], stateVersion: state.version };
            }

            const updatedTokens = await tx.receipt_link_token.updateMany({
                where: {
                    id: { in: input.tokenIds },
                    branchId: input.branchId,
                    clientId: input.clientId,
                    eformsignDocId: input.eformsignDocId,
                    active: true,
                    expiresAt: { gt: now },
                },
                data: {
                    storagePath: input.storagePath,
                    contentSha256: input.contentSha256,
                    byteSize: input.byteSize,
                },
            });
            if (updatedTokens.count !== input.tokenIds.length) {
                throw new ReceiptPromotionRollback();
            }

            const completed = await tx.$queryRaw<Array<{ version: number }>>(Prisma.sql`
                UPDATE service_record_revision_document_state
                SET step = 'artifact_promoted',
                    status = 'completed',
                    last_error_code = NULL,
                    version = version + 1,
                    updated_at = now()
                WHERE id = ${input.documentStateId}::uuid
                  AND branch_id = ${input.branchId}::uuid
                  AND client_id = ${input.clientId}
                  AND service_record_case_id = ${input.serviceRecordCaseId}::uuid
                  AND revision_id = ${input.revisionId}::uuid
                  AND generation = ${input.expectedGeneration}
                  AND version = ${input.expectedStateVersion}
                  AND output_proof = ${proofJson}::jsonb
                RETURNING version
            `);
            const completedState = completed[0];
            if (!completedState) {
                // The transaction is rolled back, preserving every old token
                // artifact when a final CAS unexpectedly loses.
                throw new ReceiptPromotionRollback();
            }
            return {
                disposition: "promoted",
                tokenIds: [...input.tokenIds],
                stateVersion: completedState.version,
            };
            });
        } catch {
            // A failed transaction (including a post-update CAS mismatch)
            // leaves every old artifact intact; callers may reconcile safely.
            return { disposition: "stale", tokenIds: [], stateVersion: null };
        }
    }

    private async findActiveByJobIdWithClient(
        client: Pick<PrismaService, "receipt_link_token"> | Prisma.TransactionClient,
        jobId: string,
    ): Promise<ReceiptLinkTokenRecord | null> {
        const row = await client.receipt_link_token.findFirst({
            where: { jobId, active: true },
            orderBy: { createdAt: "desc" },
            include: INCLUDE_NAMES,
        });
        return row ? toRecord(row) : null;
    }
}
