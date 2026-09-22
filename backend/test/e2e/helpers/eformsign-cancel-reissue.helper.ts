import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

export const EFORMSIGN_CANCEL_REISSUE_DATABASE =
    "postgresql://jaino@127.0.0.1:55440/bjj_qa_cancel_race_20260918";
export const EFORMSIGN_CANCEL_REISSUE_OPT_IN = "EFORMSIGN_CANCEL_REISSUE_E2E";

/** Require an explicit opt-in and the exact disposable loopback database. */
export function assertApprovedEformsignCancelReissueDatabaseTarget(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
    optIn = process.env[EFORMSIGN_CANCEL_REISSUE_OPT_IN],
): void {
    if (optIn !== "1") {
        throw new Error(
            `Set ${EFORMSIGN_CANCEL_REISSUE_OPT_IN}=1 to run the disposable eformsign cancellation E2E`,
        );
    }
    if (
        databaseUrl !== EFORMSIGN_CANCEL_REISSUE_DATABASE
        || directUrl !== EFORMSIGN_CANCEL_REISSUE_DATABASE
        || /[?#]|:\/\/[^/]+:[^@]+@/.test(EFORMSIGN_CANCEL_REISSUE_DATABASE)
    ) {
        throw new Error(
            "Refusing eformsign cancellation E2E outside the exact passwordless loopback database",
        );
    }
}

export function createApprovedEformsignCancelReissueClient(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
    optIn = process.env[EFORMSIGN_CANCEL_REISSUE_OPT_IN],
): PrismaClient {
    assertApprovedEformsignCancelReissueDatabaseTarget(databaseUrl, directUrl, optIn);
    return new PrismaClient({
        datasources: { db: { url: EFORMSIGN_CANCEL_REISSUE_DATABASE } },
    });
}

export function barrier() {
    let release!: () => void;
    let reject!: (error: unknown) => void;
    let settled = false;
    const entered = new Promise<void>((resolve, rejectPromise) => {
        release = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        reject = (error: unknown) => {
            if (settled) return;
            settled = true;
            rejectPromise(error);
        };
    });
    return { entered, release, reject };
}

export async function holdMirrorRow(
    prisma: PrismaClient,
    branchId: string,
    documentId: string,
    onAcquired: () => void,
    release: Promise<void>,
    onError?: (error: unknown) => void,
): Promise<void> {
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql`
                SELECT id
                FROM eformsign_doc
                WHERE branch_id = ${branchId}::uuid AND document_id = ${documentId}
                FOR UPDATE
            `);
            onAcquired();
            await release;
        });
    } catch (error) {
        onError?.(error);
        throw error;
    }
}

export type MirrorLockHooks = {
    attempted?: () => void;
    acquired?: () => void;
    failed?: (error: unknown) => void;
    holdAfterAcquire?: Promise<void>;
};

/**
 * Observe a real FOR UPDATE lock and optionally hold it. This is used only by
 * the race suite to establish lock order; production repositories remain intact.
 */
export function instrumentMirrorLock(
    prisma: PrismaClient,
    hooks: MirrorLockHooks,
): PrismaClient {
    let observed = false;
    return prisma.$extends({
        query: {
            $allOperations: async ({ model, operation, args, query }) => {
                const raw = (Array.isArray(args) ? args[0] : args) as unknown as {
                    strings?: readonly string[];
                    sql?: string;
                };
                const sql = (raw?.strings?.join(" ") ?? raw?.sql ?? "").toLowerCase();
                const lock = !observed
                    && model === undefined
                    && operation === "$queryRaw"
                    && /from\s+"?eformsign_doc"?\s/.test(sql)
                    && /for\s+update/.test(sql);
                if (lock) {
                    observed = true;
                    hooks.attempted?.();
                }
                let result;
                try {
                    result = await query(args);
                } catch (error) {
                    if (lock) hooks.failed?.(error);
                    throw error;
                }
                if (lock) {
                    hooks.acquired?.();
                    if (hooks.holdAfterAcquire) await hooks.holdAfterAcquire;
                }
                return result;
            },
        },
    }) as unknown as PrismaClient;
}

export type DispatchClaimHooks = {
    attempted?: () => void;
    failed?: (error: unknown) => void;
    holdAfterUpdate?: Promise<void>;
};

/**
 * Observe the durable claim CAS for reissue races that intentionally have no
 * live mirror row. The two independent clients reach the same update under
 * the database's compare-and-set lock instead of relying on a scheduler tick.
 */
export function instrumentDispatchClaim(
    prisma: PrismaClient,
    hooks: DispatchClaimHooks,
): PrismaClient {
    return prisma.$extends({
        query: {
            eformsign_dispatch_intent: {
                updateMany: async ({ args, query }) => {
                    const data = args.data as { status?: unknown };
                    const status = typeof data.status === "string" ? data.status : undefined;
                    if (status === "started") {
                        hooks.attempted?.();
                        let result;
                        try {
                            result = await query(args);
                        } catch (error) {
                            hooks.failed?.(error);
                            throw error;
                        }
                        if (hooks.holdAfterUpdate) await hooks.holdAfterUpdate;
                        return result;
                    }
                    return query(args);
                },
            },
        },
    }) as unknown as PrismaClient;
}

/** Fail exactly one mirror update inside a real transaction for rollback tests. */
export function failFirstMirrorUpdate(prisma: PrismaClient, message: string): PrismaClient {
    let failed = false;
    return prisma.$extends({
        query: {
            eformsign_doc: {
                updateMany: async ({ args, query }) => {
                    if (!failed) {
                        failed = true;
                        throw new Error(message);
                    }
                    return query(args);
                },
            },
        },
    }) as unknown as PrismaClient;
}

export async function createCancelReissueFixture(prisma: PrismaClient, suffix = randomUUID()) {
    const phone = `010${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`;
    const branch = await prisma.branch.create({
        data: {
            name: `Cancel reissue fixture ${suffix}`,
            slug: `cancel-reissue-${suffix}`,
        },
    });
    const client = await prisma.client.create({
        data: {
            branchId: branch.id,
            name: `Cancel reissue client ${suffix}`,
            phone,
            voucherClient: false,
        },
    });
    const now = new Date("2026-09-18T00:00:00.000Z");
    const document = await prisma.eformsign_doc.create({
        data: {
            documentId: `cancel-reissue-doc-${suffix}`,
            documentName: "Cancel reissue fixture",
            documentNumber: null,
            templateName: "Cancel reissue fixture",
            customerName: client.name,
            customerPhone: phone,
            creatorName: "QA",
            lastEditorName: "QA",
            stepRecipientTypes: "signer",
            createdDate: now,
            updatedDate: now,
            statusType: "010",
            statusDetail: "created",
            stepType: "01",
            stepIndex: "1",
            stepName: "start",
            stepRecipientType: "signer",
            stepRecipientName: client.name,
            stepRecipientSms: phone,
            expiredDate: new Date("2026-12-31T00:00:00.000Z"),
            expired: false,
            clientId: client.id,
            branchId: branch.id,
            documentKind: "contract",
            templateId: "cancel-reissue-template",
            detailPayload: {
                id: `cancel-reissue-doc-${suffix}`,
                current_status: { status_type: "010" },
            },
            detailSourceUpdatedDate: now,
            detailSyncedAt: now,
            syncStatus: "ready",
        },
    });
    const fileContent = Buffer.from(`cancel-reissue-fixture:${suffix}`);
    await prisma.eformsign_doc_file.create({
        data: {
            eformsignDocId: document.id,
            fileType: "document",
            content: fileContent,
            contentType: "application/pdf",
            contentDisposition: "inline",
            byteSize: fileContent.byteLength,
            sha256: createHash("sha256").update(fileContent).digest("hex"),
            sourceUpdatedDate: now,
        },
    });
    await prisma.client.update({
        where: { id: client.id },
        data: { eDocId: document.documentId },
    });
    return { branch, client, document };
}

export async function cleanupCancelReissueFixture(
    prisma: PrismaClient,
    branchId: string,
): Promise<void> {
    await prisma.eformsign_dispatch_intent.deleteMany({ where: { branchId } });
    await prisma.client.updateMany({ where: { branchId }, data: { eDocId: null } });
    await prisma.eformsign_doc.deleteMany({ where: { branchId } });
    await prisma.client.deleteMany({ where: { branchId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
}

export function createDispatchIntentInput(input: {
    branchId: string;
    clientId: number;
    localDocumentId?: number | null;
    assignmentId?: number | null;
    providerDocumentId?: string | null;
    templateId?: string | null;
    action?: "create" | "finalize";
    generation?: string;
    businessKey?: string;
    fingerprint?: string;
}) {
    const generation = input.generation ?? `fixture:${randomUUID()}`;
    const randomFingerprint = () => randomUUID().replace(/-/g, "").repeat(2).slice(0, 64);
    return {
        branchId: input.branchId,
        clientId: input.clientId,
        localDocumentId: input.localDocumentId ?? null,
        assignmentId: input.assignmentId ?? null,
        providerDocumentId: input.providerDocumentId ?? null,
        templateId: input.templateId ?? "cancel-reissue-template",
        action: input.action ?? "create",
        generation,
        businessKey: input.businessKey ?? randomFingerprint(),
        fingerprint: input.fingerprint ?? randomFingerprint(),
    } as const;
}
