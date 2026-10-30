import { ConflictException } from "@nestjs/common";

import { CallInboxService } from "application/services/call-inbox.service";
import { CallExtractionRetrySchedulerService } from "application/services/call-extraction-retry-scheduler.service";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { createBranch, createUser } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { makeClientService, prewarmConnections } from "./test-helpers";

jest.setTimeout(180_000);

/**
 * SI-CLIENT-07 — `client_draft` state machine PENDING → CONFIRMING → CONFIRMED
 * | DISCARDED (writer: `CallInboxService`, sweep: `CallExtractionRetrySchedulerService`).
 *
 * Invariants:
 * - the PENDING→CONFIRMING claim (`updateMany WHERE status = 'PENDING'`) admits
 *   exactly one winner even when a second claimant blocks on the row lock and
 *   re-evaluates after the winner commits (deterministic interleaving);
 * - a concurrent double confirm of one NEW_CLIENT draft creates exactly one
 *   client (the loser is refused with REQUEST_NOT_PENDING);
 * - a confirmed draft refuses re-confirmation (no duplicate client);
 * - a stale CONFIRMING (confirmingStartedAt older than the sweep threshold, a
 *   crashed confirm) is swept back to PENDING, while an in-flight CONFIRMING is
 *   left alone.
 */
describeReal("SI-CLIENT-07 client_draft confirm state machine", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    let userId: string;
    let inbox: CallInboxService;

    const confirmFields = (name: string) => ({ fields: { name }, suppressGreetingSms: true });

    async function createPendingDraft(label: string): Promise<string> {
        const callRecord = await handle.raw.call_record.create({
            data: {
                branchId,
                driveFileId: `si-clients-${label}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
                fileName: `${label}.wav`,
                transcript: {},
            },
        });
        const draft = await handle.raw.client_draft.create({
            data: {
                callRecordId: callRecord.id,
                branchId,
                type: "NEW_CLIENT",
                status: "PENDING",
                proposals: [],
                requestSummary: `${label} 신규 등록 요청`,
            },
        });
        return draft.id;
    }

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        const branch = await createBranch(handle.raw, tracker);
        branchId = branch.id;
        const user = await createUser(handle.raw, tracker, {});
        userId = user.id;
        // Warm several pool connections: the claim race needs a concurrent
        // second connection to already exist when the loser's claim issues.
        await prewarmConnections(handle.raw);
        await prewarmConnections(handle.service);
        const clientService = makeClientService({
            prisma: handle.service,
            raw: handle.raw,
            messageAutomationIntentService: {
                persistClientIntent: async () => undefined,
                persistScheduleIntent: async () => undefined,
                fulfillClientIntent: async () => undefined,
                fulfillScheduleIntent: async () => undefined,
            },
        });
        inbox = new CallInboxService(handle.service, clientService);
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    invariant(
        "SI-CLIENT-07",
        "the PENDING→CONFIRMING claim admits exactly one winner when a second claimant blocks and re-evaluates (PostgreSQL predicate semantics only)",
        async () => {
            // SCOPE: the production claim (`CallInboxService.confirmNewClientWithDraft`
            // → `client_draft.updateMany WHERE status = 'PENDING'`,
            // call-inbox.service.ts ~406-410) is a single autocommit statement
            // with no lock to hold between the predicate check and the write,
            // so the forced interleaving below took the same predicate/data in
            // an explicitly held transaction instead. This test therefore proves
            // the PostgreSQL conditional-update re-evaluation semantics only —
            // production-path exclusivity under the real service is proven by
            // the two concurrent confirmNewClient invariants below (exactly one
            // client created / re-confirmation refused with REQUEST_NOT_PENDING).
            // TAP REQUIREMENT: a bare `PrismaPromise` is LAZY — its query only
            // issues when some `.then`/`await` attaches, so a promise created
            // (but not immediately tapped) WOULD issue after T1 committed and
            // never actually race. The claim below is tapped at creation so the
            // second claimant's UPDATE is in flight while T1 holds the lock.
            //
            // The interleaving is retried on a fresh draft when the second
            // claimant's statement is not observed blocked within the window
            // (an infra-level miss, not the tracked behaviour). A run only
            // passes on evidence: first=1 while the second claimant had
            // demonstrably blocked on the winner's row lock.
            let observablyBlocked = false;
            for (let attempt = 1; attempt <= 3 && !observablyBlocked; attempt += 1) {
                const draftId = await createPendingDraft(`claim-race-${attempt}`);
                const claim = {
                    where: { id: draftId, status: "PENDING" },
                    data: { status: "CONFIRMING", confirmingStartedAt: new Date() },
                } as const;

                // T1 claims inside an explicitly held transaction (same
                // predicate and data the service writes at call-inbox.service
                // confirm time).
                let firstClaimDone: () => void = () => undefined;
                const firstClaimPromise = new Promise<void>((resolve) => { firstClaimDone = resolve; });
                const firstClaim = handle.service.$transaction(async (tx): Promise<number> => {
                    const claimed = await tx.client_draft.updateMany(claim);
                    firstClaimDone(); // the winner holds the draft row lock
                    const deadline = Date.now() + 10_000;
                    for (;;) {
                        const blocked = await handle.raw.$queryRaw<Array<{ pid: number }>>`
                            SELECT pid
                            FROM pg_stat_activity
                            WHERE datname = current_database()
                              AND wait_event_type = 'Lock'
                              AND state = 'active'
                              AND pid <> pg_backend_pid()
                              AND query ILIKE '%client_draft%'
                        `;
                        if (blocked.length > 0) {
                            observablyBlocked = true;
                            break;
                        }
                        if (Date.now() > deadline) break;
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    return claimed.count;
                    // Returning commits T1; the blocked claimant re-evaluates.
                }, { maxWait: 5_000, timeout: 60_000 });

                await firstClaimPromise;
                // T2 issues while T1 still holds the lock: it blocks, then
                // re-evaluates the predicate after T1 commits. The tap below is
                // REQUIRED — see the TAP REQUIREMENT note above.
                const secondOutcome: { count?: number; error?: string } = {};
                const secondClaim = handle.raw.client_draft.updateMany(claim).then(
                    (result) => { secondOutcome.count = result.count; },
                    (error: unknown) => { secondOutcome.error = String(error); },
                );

                const firstCount = await firstClaim;
                await secondClaim;
                if (firstCount !== 1 || secondOutcome.count !== 0) {
                    throw new Error(
                        `SI-CLIENT-07: claim race produced first=${firstCount} second=${secondOutcome.error ?? String(secondOutcome.count)} — claim is not exclusive`,
                    );
                }
                if (!observablyBlocked) continue;
                const draft = await handle.raw.client_draft.findUniqueOrThrow({
                    where: { id: draftId },
                    select: { status: true },
                });
                if (draft.status !== "CONFIRMING") {
                    throw new Error(`SI-CLIENT-07: draft status after the race is "${draft.status}"`);
                }
            }
            if (!observablyBlocked) {
                throw new Error(
                    "SI-CLIENT-07: the interleaving was never observed in 3 attempts (test infrastructure, not the tracked behaviour)",
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-07",
        "two concurrent confirmNewClient calls on one draft create exactly one client",
        async () => {
            const draftId = await createPendingDraft("concurrent-confirm");

            const results = await Promise.allSettled([
                inbox.confirmNewClient(branchId, userId, draftId, confirmFields("김동시")),
                inbox.confirmNewClient(branchId, userId, draftId, confirmFields("김동시")),
            ]);
            const fulfilled = results.filter((entry) => entry.status === "fulfilled");
            const rejected = results.filter((entry) => entry.status === "rejected");
            if (fulfilled.length !== 1 || rejected.length !== 1) {
                throw new Error(
                    `SI-CLIENT-07: concurrent confirm produced ${fulfilled.length} fulfilled / ${rejected.length} rejected — expected exactly one winner`,
                );
            }
            const createdClientIds = new Set(
                fulfilled.map((entry) => (entry as PromiseFulfilledResult<{ clientId: number }>).value.clientId),
            );
            for (const createdId of createdClientIds) tracker.track("client", createdId);
            if (createdClientIds.size !== 1) {
                throw new Error(`SI-CLIENT-07: concurrent confirm created ${createdClientIds.size} distinct clients`);
            }
            const clientsNamed = await handle.raw.client.findMany({
                where: { branchId, name: "김동시" },
                select: { id: true },
            });
            if (clientsNamed.length !== 1) {
                throw new Error(
                    `SI-CLIENT-07: ${clientsNamed.length} client rows named 김동시 exist — the draft created duplicates`,
                );
            }
            const draft = await handle.raw.client_draft.findUniqueOrThrow({
                where: { id: draftId },
                select: { status: true, clientId: true },
            });
            if (draft.status !== "CONFIRMED" || draft.clientId !== clientsNamed[0]!.id) {
                throw new Error(
                    `SI-CLIENT-07: draft ended as ${draft.status} with clientId ${String(draft.clientId)}`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-07",
        "a CONFIRMED draft refuses re-confirmation and creates no second client",
        async () => {
            const draftId = await createPendingDraft("reconfirm");
            const first = await inbox.confirmNewClient(branchId, userId, draftId, confirmFields("김재확인"));
            tracker.track("client", first.clientId);

            await expect(
                inbox.confirmNewClient(branchId, userId, draftId, confirmFields("김재확인")),
            ).rejects.toMatchObject({ response: { code: "REQUEST_NOT_PENDING" } });

            const clientsNamed = await handle.raw.client.findMany({
                where: { branchId, name: "김재확인" },
                select: { id: true },
            });
            if (clientsNamed.length !== 1 || clientsNamed[0]!.id !== first.clientId) {
                throw new Error(
                    `SI-CLIENT-07: re-confirmation left ${clientsNamed.length} client row(s) — duplicate client created`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-07",
        "the stuck-CONFIRMING sweep recovers a crashed confirm but never an in-flight one",
        async () => {
            const staleId = await createPendingDraft("stale-confirming");
            const inFlightId = await createPendingDraft("inflight-confirming");
            const staleStarted = new Date(Date.now() - 11 * 60 * 1000);
            await handle.raw.client_draft.update({
                where: { id: staleId },
                data: { status: "CONFIRMING", confirmingStartedAt: staleStarted },
            });
            await handle.raw.client_draft.update({
                where: { id: inFlightId },
                data: { status: "CONFIRMING", confirmingStartedAt: new Date() },
            });

            const lease = { holdsLease: () => true };
            const scheduler = new CallExtractionRetrySchedulerService(
                handle.service,
                {} as never,
                lease as never,
            );
            await scheduler.retryFailedExtractions();

            const stale = await handle.raw.client_draft.findUniqueOrThrow({
                where: { id: staleId },
                select: { status: true, confirmingStartedAt: true },
            });
            if (stale.status !== "PENDING" || stale.confirmingStartedAt !== null) {
                throw new Error(
                    `SI-CLIENT-07: stale CONFIRMING draft not recovered (status=${stale.status}, confirmingStartedAt=${String(stale.confirmingStartedAt)})`,
                );
            }
            const inFlight = await handle.raw.client_draft.findUniqueOrThrow({
                where: { id: inFlightId },
                select: { status: true },
            });
            if (inFlight.status !== "CONFIRMING") {
                throw new Error(
                    `SI-CLIENT-07: in-flight CONFIRMING draft was swept (status=${inFlight.status})`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-07",
        "control: the refused concurrent loser carries the REQUEST_NOT_PENDING conflict",
        async () => {
            const draftId = await createPendingDraft("loser-code");
            const created = await inbox.confirmNewClient(branchId, userId, draftId, confirmFields("김승자"));
            tracker.track("client", created.clientId);
            const error = await inbox
                .confirmNewClient(branchId, userId, draftId, confirmFields("김패자"))
                .catch((caught: unknown) => caught);
            if (!(error instanceof ConflictException)) {
                throw new Error(`SI-CLIENT-07 control failed: expected ConflictException, got ${String(error)}`);
            }
        },
    );
});
