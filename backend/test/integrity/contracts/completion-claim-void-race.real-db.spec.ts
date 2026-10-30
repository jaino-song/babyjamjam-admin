import { PrismaClient, Prisma } from "@prisma/client";

import type { EformsignDocCompletionClaimParams, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";

import {
    buildWebhookHarness,
    clientRow,
    createContractClient,
    createContractDoc,
    deleteWebhookLedgerRows,
    documentEventPayload,
    docRow,
    d,
    mirrorDetail,
    type WebhookHarness,
} from "./contracts-fixture";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, assertThrowawayTarget, type IntegrityPrisma } from "../helpers/real-db";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

/**
 * SI-CONTRACT-04 — completion-claim CAS vs concurrent mirror `saveDetail` and void.
 *
 * The interleavings are forced by the DATABASE's own locking, not by timers or
 * promise discipline:
 * - A row lock is held in an open transaction on a separate connection; the
 *   concurrent writers are started behind it and each is only proven running
 *   when `pg_stat_activity` shows `wait_event_type = 'Lock'` for its own
 *   statement. Releasing the lock then lets Postgres' lock queue decide the
 *   order, so the loser re-evaluates its CAS predicate against the winner's
 *   COMMITTED write (the same evidence style as the void-fences spec).
 * - The void-vs-side-effects race pauses the REAL webhook service between its claim
 *   resolving `claimed` and its side effects, commits a real `markVoided` inside that
 *   window, and only then lets the side effects run. The event order is asserted.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function countLockWaiters(raw: PrismaClient): Promise<Array<{ pid: number; query: string }>> {
    return raw.$queryRaw<Array<{ pid: number; query: string }>>(Prisma.sql`
        SELECT pid, query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
    `);
}

/** Bounded poll until `wanted` backends are blocked on a statement matching `statement`. */
async function waitUntilLocked(raw: PrismaClient, statement: RegExp, wanted = 1, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const waiting = await countLockWaiters(raw);
        if (waiting.filter((row) => statement.test(row.query)).length >= wanted) return;
        if (Date.now() > deadline) {
            throw new Error(`no backend was blocked on ${statement}; waiting: ${JSON.stringify(waiting.map((row) => row.query))}`);
        }
        await sleep(20);
    }
}

const EFORMSIGN_DOC_UPDATE = /UPDATE\s+("?[\w.]+"?\.)?"?eformsign_doc"?\s+SET/i;

describeReal("completion claim vs concurrent claims and void (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let raw: PrismaClient;
    let tracker: RowTracker;
    let harness: WebhookHarness;
    let branchId: string;
    let realRepository: SbEformsignDocRepository;
    let mirrorRepository: SbEformsignDocumentMirrorRepository;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        raw = handle.raw;
        tracker = new RowTracker();
        const branchRow = await raw.branch.create({
            data: { name: "무결성 클레임 지점", slug: `throwaway-si-contracts-claim-${Date.now().toString(36)}` },
        });
        tracker.track("branch", branchRow.id);
        branchId = branchRow.id;
        harness = buildWebhookHarness(handle);
        realRepository = harness.docRepository as SbEformsignDocRepository;
        mirrorRepository = new SbEformsignDocumentMirrorRepository(handle.service);
    });

    afterAll(async () => {
        if (tracker) {
            await tracker.cleanup(raw);
        }
        if (handle) {
            await closeIntegrityPrisma(handle);
        }
    });

    const claimParams = (documentId: string, sourceUpdatedDate: Date): EformsignDocCompletionClaimParams => ({
        documentId,
        statusType: "050",
        statusDetail: "완료",
        expired: false,
        sourceUpdatedDate,
        documentName: "산모신생아건강관리서비스 계약서",
    });

    /**
     * Opens a transaction on a separate connection that holds an exclusive row
     * lock on the document until the returned releaser is called. The returned
     * promise-signal ordering guarantees the lock is already held before the
     * writers are started behind it.
     */
    async function holdRowLock(client: PrismaClient, documentId: string): Promise<{ release: () => Promise<void> }> {
        let release!: () => void;
        let locked!: () => void;
        const lockedPromise = new Promise<void>((resolve) => {
            locked = resolve;
        });
        const held = client.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                SELECT id FROM "eformsign_doc" WHERE document_id = ${documentId} FOR UPDATE
            `);
            locked();
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        }, { timeout: 30_000 });
        await lockedPromise;
        return {
            release: async () => {
                release();
                await held;
            },
        };
    }

    /** Reads the distinguishing marker written into a detail payload. */
    function readMarker(payload: unknown): unknown {
        return (payload as { marker?: unknown } | null)?.marker;
    }

    invariant("SI-CONTRACT-04", "two concurrent completion claims serialize on the row lock: the loser's CAS re-evaluates against the winner's committed write", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate: d("2026-10-01"),
            updatedDate: d("2026-10-01"),
            statusType: "060",
        });
        const claimTime = d("2026-10-02");

        // HOLD the row in an open transaction on connection H. Both claims are
        // started behind that lock; only releasing H decides the order, and
        // Postgres' lock queue serializes them at the statement level.
        const holderConnection = new PrismaClient();
        const loserConnection = new PrismaClient();
        await holderConnection.$connect();
        await loserConnection.$connect();
        try {
            const holder = await holdRowLock(holderConnection, doc.documentId);
            const winnerClaim = realRepository.claimCompletionStatus(branchId, claimParams(doc.documentId, claimTime));
            const loserRepository = new SbEformsignDocRepository(loserConnection as unknown as PrismaService);
            const loserClaim = loserRepository.claimCompletionStatus(branchId, claimParams(doc.documentId, claimTime));

            // Both UPDATE statements are really queued on the row lock in
            // pg_stat_activity — no promise manipulation decided this.
            await waitUntilLocked(raw, EFORMSIGN_DOC_UPDATE, 2);
            await holder.release();

            const [first, second] = await Promise.all([winnerClaim, loserClaim]);
            // Exactly one claim and one duplicate: the lock queue's grant order
            // is not guaranteed across two connections, so which connection
            // wins is not asserted — that the winner's committed write makes
            // the CAS reject the other one is.
            const results = [first, second];
            expect(results.filter((result) => result === "claimed").length).toBe(1);
            expect(results.filter((result) => result === "duplicate").length).toBe(1);

            // The CAS predicate held: the row is at the terminal status once,
            // with the winner's source timestamp.
            const row = await docRow(handle, doc.documentId);
            expect(row.statusType).toBe("050");
            expect(row.updatedDate).toEqual(claimTime);
        } finally {
            await holderConnection.$disconnect();
            await loserConnection.$disconnect();
        }
    });

    invariant("SI-CONTRACT-04", "a mirror saveDetail racing the completion claim under the row lock applies both writes without a lost update", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate: d("2026-10-01"),
            updatedDate: d("2026-10-01"),
            statusType: "060",
        });
        const claimTime = d("2026-10-02");

        // HOLD the row; the claim and the mirror detail write are both started
        // behind it and are serialized by the database's lock queue.
        const holderConnection = new PrismaClient();
        await holderConnection.$connect();
        try {
            const holder = await holdRowLock(holderConnection, doc.documentId);
            const claim = realRepository.claimCompletionStatus(branchId, claimParams(doc.documentId, claimTime));
            const detail = mirrorRepository.saveDetail({
                documentId: doc.documentId,
                detailPayload: { marker: "si-detail-race" } as never,
                customerPhone: "01099998888",
                sourceUpdatedDate: claimTime,
                expectedDetailSyncedAt: null,
                allowReadySameVersionRepair: false,
                syncedAt: claimTime,
            });

            // Both UPDATE statements are really waiting on the row lock.
            await waitUntilLocked(raw, EFORMSIGN_DOC_UPDATE, 2);
            await holder.release();

            // Exactly one completion claim, and the detail write still applies:
            // the two CAS predicates guard different column sets, so the race
            // must lose NO update on either side.
            expect(await claim).toBe("claimed");
            expect(await detail).toBe(true);

            const row = await docRow(handle, doc.documentId);
            expect(row.statusType).toBe("050");
            expect(row.detailSourceUpdatedDate).toEqual(claimTime);
            expect(readMarker(row.detailPayload)).toBe("si-detail-race");
        } finally {
            await holderConnection.$disconnect();
        }
    });

    invariant("SI-CONTRACT-04", "a stale saveDetail queued behind a newer one under the row lock is refused by its own version CAS", async () => {
        const doc = await createContractDoc(handle, tracker, branchId, { clientId: null, statusType: "060" });
        const older = d("2026-10-03");
        const newer = d("2026-10-04");

        const holderConnection = new PrismaClient();
        await holderConnection.$connect();
        try {
            const holder = await holdRowLock(holderConnection, doc.documentId);
            // The NEWER detail is queued first; the stale one lands behind it.
            const newerWrite = mirrorRepository.saveDetail({
                documentId: doc.documentId,
                detailPayload: { marker: "si-detail-newer" } as never,
                customerPhone: null,
                sourceUpdatedDate: newer,
                expectedDetailSyncedAt: null,
                allowReadySameVersionRepair: false,
                syncedAt: newer,
            });
            const staleWrite = mirrorRepository.saveDetail({
                documentId: doc.documentId,
                detailPayload: { marker: "si-detail-stale" } as never,
                customerPhone: null,
                sourceUpdatedDate: older,
                expectedDetailSyncedAt: null,
                allowReadySameVersionRepair: false,
                syncedAt: older,
            });

            await waitUntilLocked(raw, EFORMSIGN_DOC_UPDATE, 2);
            await holder.release();

            expect(await newerWrite).toBe(true);
            // The stale writer re-evaluated its predicate AFTER the newer write
            // committed and lost: its payload must not overwrite the row.
            expect(await staleWrite).toBe(false);

            const row = await docRow(handle, doc.documentId);
            expect(row.detailSourceUpdatedDate).toEqual(newer);
            expect(readMarker(row.detailPayload)).toBe("si-detail-newer");
        } finally {
            await holderConnection.$disconnect();
        }
    });


    invariant("SI-CONTRACT-04", "a void that lands between the completion claim and its side effects leaves no client link and moves no end date", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate: d("2026-10-01"),
            updatedDate: d("2026-10-01"),
            statusType: "060",
        });
        const claimTime = d("2026-10-02");
        const events: string[] = [];

        // Pause hook ON THE REAL REPOSITORY: when the webhook service's claim
        // resolves "claimed", the void is committed before the claim returns,
        // so every side effect below runs after a durable void.
        const voidingRepository: IEformsignDocRepository = new Proxy(realRepository, {
            get(target: SbEformsignDocRepository, key: string | symbol, receiver: unknown) {
                if (key !== "claimCompletionStatus") {
                    return Reflect.get(target, key, receiver);
                }
                return async (...args: Parameters<SbEformsignDocRepository["claimCompletionStatus"]>) => {
                    const result = await target.claimCompletionStatus(...args);
                    if (result === "claimed") {
                        events.push("CLAIMED");
                        const voided = await target.markVoided(
                            branchId,
                            doc.documentId,
                            new Date(),
                            "22222222-2222-4222-8222-222222222222",
                        );
                        expect(voided).toBe(true);
                        events.push("VOID_COMMITTED");
                    }
                    return result;
                };
            },
        });
        const racedHarness = buildWebhookHarness(handle, { docRepositoryOverride: voidingRepository });

        const result = await racedHarness.service.processWebhook(
            documentEventPayload({
                webhookId: "si-claim-void-1",
                documentId: doc.documentId,
                status: "doc_complete",
                updatedDate: claimTime,
            }),
            {
                mirroredDocument: mirrorDetail({ documentId: doc.documentId, statusType: "050", updatedDate: claimTime }),
                deferCompletionEvent: true,
                deferCompletionEffects: false,
            },
        );

        // The forced order really happened: claim first, void inside the window.
        expect(events).toEqual(["CLAIMED", "VOID_COMMITTED"]);
        expect(result).toMatchObject({ completionClaim: "claimed" });

        // The side effects must all have refused the now-voided document.
        const afterClient = await clientRow(handle, client.id);
        expect(afterClient.eDocId).toBeNull();
        expect(afterClient.endDate).toEqual(d("2026-10-16"));
        const row = await docRow(handle, doc.documentId);
        expect(row.statusType).toBe("050"); // the claim itself is a plain status write
        expect(row.voidedAt).not.toBeNull();
        await deleteWebhookLedgerRows(handle, [doc.documentId]);
    });
});
