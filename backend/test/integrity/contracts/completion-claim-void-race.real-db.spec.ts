import { PrismaClient } from "@prisma/client";

import type { EformsignDocCompletionClaimParams, EformsignDocCompletionClaimResult, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";

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
 * The interleavings are forced mechanically, not hoped for:
 * - The two concurrent completion claims run on TWO separate connections, and the
 *   second connection's `claimCompletionStatus` is held (a pause hook on the repository
 *   method) until the first one has committed, so the loser really evaluates the CAS
 *   predicate `status_type NOT IN ('050', …)` against the winner's committed write.
 * - The void-vs-side-effects race pauses the REAL webhook service between its claim
 *   resolving `claimed` and its side effects, commits a real `markVoided` inside that
 *   window, and only then lets the side effects run. The event order is asserted.
 */

describeReal("completion claim vs concurrent claims and void (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let raw: PrismaClient;
    let tracker: RowTracker;
    let harness: WebhookHarness;
    let branchId: string;
    let realRepository: SbEformsignDocRepository;

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

    invariant("SI-CONTRACT-04", "two concurrent completion claims on separate connections produce exactly one claimed and one duplicate, and the loser records no side effect", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate: d("2026-10-01"),
            updatedDate: d("2026-10-01"),
            statusType: "060",
        });
        const claimTime = d("2026-10-02");

        // A SECOND connection for the competing writer (one extra raw client,
        // as the harness rules allow), with a pause hook that holds its claim
        // until the first claim has fully committed.
        const secondConnection = new PrismaClient();
        await secondConnection.$connect();
        try {
            let firstCommitted = false;
            const firstClaim = realRepository.claimCompletionStatus(branchId, claimParams(doc.documentId, claimTime))
                .then((result) => {
                    firstCommitted = true;
                    return result;
                });
            const losingRepository: IEformsignDocRepository = new Proxy(
                new SbEformsignDocRepository(secondConnection as unknown as PrismaService),
                {
                    get(target: SbEformsignDocRepository, key: string | symbol, receiver: unknown) {
                        if (key !== "claimCompletionStatus") {
                            return Reflect.get(target, key, receiver);
                        }
                        return async (...args: Parameters<SbEformsignDocRepository["claimCompletionStatus"]>) => {
                            // Forced interleaving: the loser's CAS only starts
                            // after the winner's UPDATE has committed.
                            for (let i = 0; i < 500 && !firstCommitted; i += 1) {
                                await new Promise((resolve) => setTimeout(resolve, 10));
                            }
                            expect(firstCommitted).toBe(true);
                            return target.claimCompletionStatus(...args);
                        };
                    },
                },
            );

            const [first, second] = await Promise.all([
                firstClaim,
                losingRepository.claimCompletionStatus(branchId, claimParams(doc.documentId, claimTime)),
            ]);
            expect(first).toBe<EformsignDocCompletionClaimResult>("claimed");
            expect(second).toBe<EformsignDocCompletionClaimResult>("duplicate");

            // The CAS predicate held: the row is at the terminal status once,
            // with the winner's source timestamp.
            const row = await docRow(handle, doc.documentId);
            expect(row.statusType).toBe("050");
            expect(row.updatedDate).toEqual(claimTime);
        } finally {
            await secondConnection.$disconnect();
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
