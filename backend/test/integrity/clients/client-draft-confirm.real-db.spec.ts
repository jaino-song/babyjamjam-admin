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
        "the production confirm claim admits exactly one winner after both calls block on the same PENDING draft",
        async () => {
            const draftId = await createPendingDraft("production-claim-race");
            let release: () => void = () => undefined;
            let locked: () => void = () => undefined;
            const released = new Promise<void>((resolve) => { release = resolve; });
            const ready = new Promise<void>((resolve) => { locked = resolve; });
            // Hold a real row lock WITHOUT changing PENDING. Both real service
            // calls can read the pending draft, but neither can claim it yet.
            // No copied product statement or mocked Prisma result is involved.
            const holder = handle.raw.$transaction(async (tx) => {
                await tx.$queryRaw`SELECT id FROM client_draft WHERE id = ${draftId}::uuid FOR UPDATE`;
                locked();
                await released;
            }, { maxWait: 5_000, timeout: 60_000 });
            await Promise.race([ready, holder]);
            const calls = Promise.allSettled([
                inbox.confirmNewClient(branchId, userId, draftId, confirmFields("김잠금")),
                inbox.confirmNewClient(branchId, userId, draftId, confirmFields("김잠금")),
            ]);
            let blockedCount = 0;
            try {
                const deadline = Date.now() + 15_000;
                while (Date.now() < deadline) {
                    const blocked = await handle.raw.$queryRaw<Array<{ pid: number }>>`
                        SELECT pid FROM pg_stat_activity
                        WHERE datname = current_database()
                          AND wait_event_type = 'Lock' AND state = 'active'
                          AND pid <> pg_backend_pid()
                          AND query ILIKE 'UPDATE%client_draft%'
                    `;
                    blockedCount = blocked.length;
                    if (blockedCount === 2) break;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            } finally {
                release();
                await holder;
            }
            const results = await calls;
            // Track even a mutation-created duplicate before asserting, so RED
            // runs still clean their fixtures.
            for (const result of results) {
                if (result.status === "fulfilled") tracker.track("client", result.value.clientId);
            }
            expect(blockedCount).toBe(2);
            const winners = results.filter((result) => result.status === "fulfilled");
            const losers = results.filter((result) => result.status === "rejected");
            if (winners.length !== 1 || losers.length !== 1) {
                throw new Error(
                    `SI-CLIENT-07: production claim admitted ${winners.length} winners / ${losers.length} losers after two observed blocked claims`,
                );
            }
            expect(losers[0]).toMatchObject({ reason: { response: { code: "REQUEST_NOT_PENDING" } } });
            const clients = await handle.raw.client.findMany({ where: { branchId, name: "김잠금" }, select: { id: true } });
            expect(clients).toHaveLength(1);
            expect(await handle.raw.client_draft.findUniqueOrThrow({ where: { id: draftId } }))
                .toMatchObject({ status: "CONFIRMED", clientId: clients[0]!.id, confirmingStartedAt: null });
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
