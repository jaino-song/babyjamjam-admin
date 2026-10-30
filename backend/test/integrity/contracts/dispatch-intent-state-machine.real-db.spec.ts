import { createHash } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";
import {
    EFORMSIGN_DISPATCH_INTENT_STATUS,
    type EformsignDispatchIntentEntity,
} from "domain/entities/eformsign-dispatch-intent.entity";

import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, assertThrowawayTarget, type IntegrityPrisma } from "../helpers/real-db";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

/**
 * SI-CONTRACT-06 (dispatch-intent half) — the at-most-once dispatch boundary
 * over the real database. A `started`/`uncertain` intent must never be
 * replayable (the provider may still accept the attempt), exactly one
 * concurrent claim may win the CAS, and the SQL CHECKs must reject every
 * state that would break reconciliation. The boundary service and repository
 * are the real production classes.
 */

interface ClaimIdentity {
    branchId: string;
    clientId: number | null;
    templateId: string;
    action: "create" | "finalize";
    generation: string;
    fingerprint: string;
}

describeReal("eformsign dispatch intent state machine (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let raw: PrismaClient;
    let tracker: RowTracker;
    let repository: SbEformsignDispatchIntentRepository;
    let boundary: EformsignDispatchBoundaryService;
    let branchId: string;
    let sequence = 0;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        raw = handle.raw;
        tracker = new RowTracker();
        const branchRow = await raw.branch.create({
            data: { name: "무결성 디스패치 지점", slug: `throwaway-si-contracts-intent-${Date.now().toString(36)}` },
        });
        tracker.track("branch", branchRow.id);
        branchId = branchRow.id;
        repository = new SbEformsignDispatchIntentRepository(handle.service);
        boundary = new EformsignDispatchBoundaryService(repository);
    });

    afterAll(async () => {
        if (tracker) {
            await tracker.cleanup(raw);
        }
        if (handle) {
            await closeIntegrityPrisma(handle);
        }
    });

    function identity(): ClaimIdentity {
        sequence += 1;
        return {
            branchId,
            clientId: null,
            templateId: "tpl-si-intent",
            action: "create",
            generation: `si-gen-${sequence}`,
            fingerprint: createHash("sha256").update(`si-fingerprint-${sequence}`).digest("hex"),
        };
    }

    const claimInput = (source: ClaimIdentity) => ({ ...source });

    invariant("SI-CONTRACT-06", "claiming the same identity twice while the attempt is running is uncertain, not replayable, and leaves one attempt", async () => {
        const first = await boundary.claim(claimInput(identity()));
        expect(first.disposition).toBe("claimed");
        expect(first.intent.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED);
        expect(first.intent.attemptCount).toBe(1);
        expect(first.intent.startedAt).not.toBeNull();

        // The provider call is still in flight: a second caller with the same
        // identity must observe the running attempt, never start its own.
        const second = await boundary.claim({
            branchId,
            clientId: null,
            templateId: "tpl-si-intent",
            action: "create",
            generation: first.intent.generation,
            fingerprint: first.intent.fingerprint,
        });
        expect(second.disposition).toBe("uncertain");
        expect(second.intent.attemptCount).toBe(1);
        expect(second.intent.id).toBe(first.intent.id);
    });

    invariant("SI-CONTRACT-06", "two concurrent claims on separate connections win the attemptCount CAS exactly once", async () => {
        const source = identity();
        let arrivals = 0;
        const barrierWaiters: Array<() => void> = [];
        const releaseBarrier = () => {
            while (barrierWaiters.length > 0) {
                const resolve = barrierWaiters.shift();
                resolve?.();
            }
        };

        /**
         * Shares one read-before-write barrier across BOTH connections (per
         * connection its first `findFirst` is gated; the waiters and the arrival
         * count are closed over here so the two wrapped clients coordinate):
         * each claim's read must observe the untouched row (attemptCount 0)
         * before either claim proceeds, so only the UPDATE's WHERE clause
         * decides the winner.
         */
        const barrierPrisma = (client: PrismaClient): PrismaService => {
            let firstReadArmed = true;
            const wrapDelegate = (delegate: unknown): unknown => new Proxy(delegate as Record<string, unknown>, {
                get(inner: Record<string, unknown>, method: string | symbol, receiver: unknown) {
                    if (method !== "findFirst") return Reflect.get(inner, method, receiver);
                    const original = Reflect.get(inner, method, receiver) as (...args: unknown[]) => Promise<unknown>;
                    return async (...args: unknown[]) => {
                        const row = await original.apply(inner, args) as { attemptCount: number } | null;
                        if (firstReadArmed) {
                            firstReadArmed = false;
                            arrivals += 1;
                            expect(row).not.toBeNull();
                            // Both raced claims must read the row the claim CAS
                            // is about to write: attemptCount is still 0.
                            expect(row?.attemptCount).toBe(0);
                            if (arrivals < 2) {
                                // Hold this claim's read until the other claim's
                                // read arrived on its own connection.
                                await Promise.race([
                                    new Promise<void>((resolve) => barrierWaiters.push(resolve)),
                                    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("claim barrier timed out")), 10_000)),
                                ]).catch(() => undefined);
                            }
                            releaseBarrier();
                        }
                        return row;
                    };
                },
            });
            return new Proxy(client, {
                get(target: PrismaClient, key: string | symbol, receiver: unknown) {
                    if (key === "eformsign_dispatch_intent") {
                        return wrapDelegate(Reflect.get(target, key, receiver));
                    }
                    return Reflect.get(target, key, receiver);
                },
            }) as unknown as PrismaService;
        };

        const firstConnection = new PrismaClient();
        const secondConnection = new PrismaClient();
        await firstConnection.$connect();
        await secondConnection.$connect();
        try {
            const firstRepository = new SbEformsignDispatchIntentRepository(barrierPrisma(firstConnection));
            const secondRepository = new SbEformsignDispatchIntentRepository(barrierPrisma(secondConnection));
            const prepared = await repository.prepare({ ...source, businessKey: source.fingerprint });

            const [first, second] = await Promise.all([
                firstRepository.claim(prepared.id, branchId),
                secondRepository.claim(prepared.id, branchId),
            ]);

            // The barrier really engaged on both connections.
            expect(arrivals).toBe(2);
            expect(first?.intent.attemptCount).toBe(1);
            const winners = [first, second].filter((result) => result?.claimed === true);
            expect(winners.length).toBe(1);
            const loser = [first, second].find((result) => result?.claimed === false);
            expect(loser?.intent.attemptCount ?? 0).toBe(1);
            // Exactly one attempt was consumed.
            expect((await raw.eformsign_dispatch_intent.findUniqueOrThrow({ where: { id: prepared.id } })).attemptCount).toBe(1);
        } finally {
            await firstConnection.$disconnect();
            await secondConnection.$disconnect();
        }
    });

    invariant("SI-CONTRACT-06", "an uncertain attempt may be reconciled to not-delivered and reclaimed, but a started attempt may not", async () => {
        const source = identity();
        const { intent } = await boundary.claim({ ...source });
        const intentId = intent.id;

        // A provider attempt still in flight cannot be called not-delivered:
        // that would release the durable claim while the provider may accept.
        await expect(boundary.reconcile({
            intentId,
            branchId,
            actorUserId: "22222222-2222-4222-8222-222222222222",
            outcome: "not_delivered",
            reason: "operator confirmed absence",
        })).rejects.toThrow(ConflictException);

        // The attempt ends uncertain; then the operator may record
        // non-delivery, which releases the claim for exactly one more attempt.
        const uncertain = await boundary.markUncertain(intent, "provider timeout");
        expect(uncertain?.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN);
        const reconciled = await boundary.reconcile({
            intentId,
            branchId,
            actorUserId: "22222222-2222-4222-8222-222222222222",
            outcome: "not_delivered",
            reason: "operator confirmed absence",
        });
        expect(reconciled?.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED);
        expect(reconciled?.reconciledOutcome).toBe("not_delivered");

        const reclaimed = await boundary.claim({ ...source });
        expect(reclaimed.disposition).toBe("claimed");
        expect(reclaimed.intent.attemptCount).toBe(2);
    });

    invariant("SI-CONTRACT-06", "an accepted intent is terminal: not-delivered reconciliation is refused and delivered reconciliation is idempotent", async () => {
        const source = identity();
        const { intent } = await boundary.claim({ ...source });
        const accepted = await boundary.markAccepted(intent, "provider-doc-1");
        expect(accepted?.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED);
        if (!accepted) throw new Error("accepted intent missing");
        const intentId = accepted.id;

        await expect(boundary.reconcile({
            intentId,
            branchId,
            actorUserId: "22222222-2222-4222-8222-222222222222",
            outcome: "not_delivered",
            reason: "operator confirmed absence",
        })).rejects.toThrow(ConflictException);

        const delivered = await boundary.reconcile({
            intentId,
            branchId,
            actorUserId: "22222222-2222-4222-8222-222222222222",
            outcome: "delivered",
            reason: "operator confirmed delivery",
        });
        // The operator-confirmed record is terminal in the same sense as the
        // receipt: either status blocks replay.
        expect(delivered?.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED);
        expect(delivered?.reconciledOutcome).toBe("delivered");
        expect(delivered?.providerDocumentId).toBe("provider-doc-1");

        // A late duplicate provider response for a different document id must
        // conflict, not silently rewrite the accepted receipt.
        await expect(repository.markAccepted(intentId, branchId, (accepted as EformsignDispatchIntentEntity).attemptCount, "provider-doc-2")).rejects.toThrow(ConflictException);
    });

    invariant("SI-CONTRACT-06", "a stale attemptCount cannot accept a held claim, and the SQL CHECKs reject impossible states", async () => {
        const source = identity();
        const { intent } = await boundary.claim({ ...source });
        const intentId = intent.id;

        // The boundary service always passes the attemptCount it observed; a
        // caller replaying a stale observation must not move the row.
        await expect(repository.markUncertain(intentId, branchId, 99, "stale observation")).resolves.toMatchObject({
            status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
        });
        const uncertain = await repository.markUncertain(intentId, branchId, intent.attemptCount, "provider timeout");
        expect(uncertain?.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN);

        // DB CHECK 1: an accepted row without a provider document id is
        // impossible.
        const acceptedRow = await boundary.markAccepted(uncertain!, "provider-doc-3");
        expect(acceptedRow?.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED);
        await expect(raw.$executeRaw(Prisma.sql`
            UPDATE eformsign_dispatch_intent
            SET provider_document_id = NULL
            WHERE id = ${intentId}::uuid
        `)).rejects.toThrow(/accepted_receipt_check/);

        // DB CHECK 2: a reconciled status cannot carry the opposite outcome.
        // (SQL CHECK semantics pass a NULL-valued predicate, so a row the
        // application wrote atomically cannot go wrong here, but an explicit
        // contradiction is still refused.)
        await expect(raw.$executeRaw(Prisma.sql`
            UPDATE eformsign_dispatch_intent
            SET status = 'reconciled_delivered', reconciled_outcome = 'not_delivered'
            WHERE id = ${intentId}::uuid
              AND provider_document_id = 'provider-doc-3'
        `)).rejects.toThrow(/reconciliation_state_check/);

        // DB CHECK 3: the status vocabulary is closed.
        await expect(raw.$executeRaw(Prisma.sql`
            UPDATE eformsign_dispatch_intent
            SET status = 'sending'
            WHERE id = ${intentId}::uuid
        `)).rejects.toThrow(/status_check/);

        // DB CHECK 4: attempts never go negative.
        await expect(raw.$executeRaw(Prisma.sql`
            UPDATE eformsign_dispatch_intent
            SET attempt_count = -1
            WHERE id = ${intentId}::uuid
        `)).rejects.toThrow(/attempt_count_check/);
    });

    invariant("SI-CONTRACT-06", "releaseBeforeSend returns a used claim to prepared without consuming an attempt, and the next claim takes attempt 2", async () => {
        const source = identity();
        const { intent } = await boundary.claim({ ...source });
        const released = await boundary.releaseBeforeSend(intent, "missing credentials");
        expect(released?.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED);
        expect(released?.attemptCount).toBe(1);
        expect(released?.startedAt).toBeNull();

        const reclaimed = await boundary.claim({ ...source });
        expect(reclaimed.disposition).toBe("claimed");
        expect(reclaimed.intent.attemptCount).toBe(2);
    });
});
