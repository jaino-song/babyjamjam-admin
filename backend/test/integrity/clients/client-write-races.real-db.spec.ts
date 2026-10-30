import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { createBranch, createClient } from "../helpers/factories";
import { invariant, knownDefect } from "../helpers/known-defect";
import { addDays, dbDate, isoDateInKorea, makeClientService, makeDueDateScheduler, prewarmConnections } from "./test-helpers";

jest.setTimeout(180_000);

/**
 * Bounded wait for a specific SQL statement to appear BLOCKED on a row lock in
 * `pg_stat_activity` (the void-fences wait-detection approach). Resolves with
 * the blocked PID; throws an `InterleavingNotObservedError` on timeout so the
 * caller can retry the whole interleaving on a fresh fixture (an infra-level
 * dispatch miss), rather than failing the case on scheduler noise.
 */
class InterleavingNotObservedError extends Error {
    constructor(fragment: string, timeoutMs: number) {
        super(`no blocked statement matching "${fragment}" appeared within ${timeoutMs}ms — interleaving not reached`);
        this.name = "InterleavingNotObservedError";
    }
}

async function waitForBlockedStatement(
    raw: IntegrityPrisma["raw"],
    queryFragment: string,
    timeoutMs = 10_000,
): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const rows = await raw.$queryRaw<Array<{ pid: number }>>`
            SELECT pid
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND state = 'active'
              AND pid <> pg_backend_pid()
              AND query ILIKE ${`%${queryFragment}%`}
        `;
        if (rows.length > 0) return rows[0]!.pid;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new InterleavingNotObservedError(queryFragment, timeoutMs);
}

/**
 * SI-CLIENT-03 / SI-CLIENT-09 — writes issued OUTSIDE the service-record
 * write-set lock.
 *
 * SI-CLIENT-09: the due-date scheduler's startDate copy is a CONDITIONAL write
 * (`WHERE id = … AND due_date = … AND start_date IS NULL`). When a concurrent
 * locked client.update commits a real start date between the scheduler's
 * candidate read and its write, PostgreSQL re-evaluates the predicate after the
 * lock wait and the scheduler must skip — no lost update.
 *
 * SI-CLIENT-03: the reuse-existing-client `smsAutomationEnabled` write
 * (`client.service.ts`, create()'s reuse branch) is an UNCONDITIONAL
 * `updateMany` by (id, branchId) issued without the write-set lock. A locked
 * concurrent client.update that commits first is overwritten by the reuse
 * writer, which decided its value from an older snapshot — a lost update.
 */
describeReal("SI-CLIENT-03/09 writes outside the write-set lock under forced interleaving", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    let kstToday: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        kstToday = isoDateInKorea(new Date());
        const branch = await createBranch(handle.raw, tracker);
        branchId = branch.id;
        // Warm several pool connections: the races below need a concurrent
        // second connection to already exist when the unlockable write issues.
        await prewarmConnections(handle.raw);
        await prewarmConnections(handle.service);
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    invariant(
        "SI-CLIENT-09",
        "the scheduler's conditional startDate write skips after a concurrent locked update commits a start date",
        async () => {
            // The interleaving is retried on a fresh client when the scheduler's
            // blocked write is not observed within the window (an infra-level
            // dispatch miss); a pass requires actually observed blocking.
            let observed = false;
            for (let attempt = 1; attempt <= 3 && !observed; attempt += 1) {
                const client = await createClient(handle.raw, tracker, {
                    branchId,
                    dueDate: dbDate(kstToday),
                    endDate: dbDate(addDays(kstToday, 3)),
                    bookingConfirmedAt: new Date(),
                    serviceStatus: "waiting",
                    // startDate left NULL so the scheduler selects the row.
                });

                let candidatesRead: () => void = () => undefined;
                const candidatesPromise = new Promise<void>((resolve) => { candidatesRead = resolve; });
                let releaseScheduler: () => void = () => undefined;
                const schedulerMayWrite = new Promise<void>((resolve) => { releaseScheduler = resolve; });

                let issuedUpdate: Promise<{ count: number }> | undefined;
                const realUpdateMany = handle.service.client.updateMany.bind(handle.service.client);
                // The scheduler only touches `client.findMany` /
                // `client.updateMany` on this path (no lifecycle/intent
                // services are wired).
                const schedulerPrisma = {
                    client: {
                        findMany: handle.service.client.findMany.bind(handle.service.client),
                        updateMany: async (...args: Parameters<typeof handle.service.client.updateMany>) => {
                            candidatesRead(); // the candidate read (startDate IS NULL) completed
                            await schedulerMayWrite;
                            issuedUpdate = realUpdateMany(...args);
                            return issuedUpdate;
                        },
                    },
                } as unknown as typeof handle.service;

                const scheduler = makeDueDateScheduler(schedulerPrisma);
                const schedulerCopy = scheduler.copyUpcomingDueDatesToStartDates();
                await candidatesPromise;

                // T1: the write-set lock holder. It takes the client row lock
                // the ordinary update path takes and commits a real start date.
                try {
                    await handle.service.$transaction(async (tx) => {
                        await tx.$executeRaw`SELECT id FROM "client" WHERE "id" = ${client.id} FOR UPDATE`;
                        await tx.client.update({
                            where: { id: client.id },
                            data: { startDate: dbDate(addDays(kstToday, 1)) },
                        });
                        // Let the scheduler issue its write and block on our lock.
                        releaseScheduler();
                        await waitForBlockedStatement(handle.raw, "start_date");
                        // Returning commits T1; the blocked write re-evaluates the predicate.
                    }, { maxWait: 5_000, timeout: 60_000 });
                    observed = true;
                } catch (error) {
                    if (!(error instanceof InterleavingNotObservedError)) throw error;
                    // Dilgent: release the scheduler gate so the pending copy loop settles before the retry.
                    releaseScheduler();
                    await schedulerCopy.catch(() => undefined);
                    if (issuedUpdate) await issuedUpdate.catch(() => undefined);
                    continue;
                }
                const copied = await schedulerCopy;
                if (!issuedUpdate) {
                    throw new Error("SI-CLIENT-09: scheduler never issued its conditional write — interleaving not reached");
                }
                const updateResult = await issuedUpdate;

                if (updateResult.count !== 0) {
                    throw new Error(
                        `SI-CLIENT-09: scheduler wrote ${updateResult.count} row(s) although a committed start date existed — lost update`,
                    );
                }
                if (copied !== 0) {
                    throw new Error(`SI-CLIENT-09: scheduler reported ${copied} copied rows — expected the guard to skip`);
                }
                const row = await handle.raw.client.findUniqueOrThrow({
                    where: { id: client.id },
                    select: { startDate: true },
                });
                if (row.startDate?.getTime() !== dbDate(addDays(kstToday, 1)).getTime()) {
                    throw new Error("SI-CLIENT-09: the committed locked start date was overwritten");
                }
            }
            if (!observed) {
                throw new Error(
                    "SI-CLIENT-09: the interleaving was never observed in 3 attempts (test infrastructure, not the tracked behaviour)",
                );
            }
        },
    );

    knownDefect(
        "SI-CLIENT-03",
        "the reuse-existing-client smsAutomationEnabled write overwrites a committed locked client.update",
        async () => {
            // Same evidence-based retry as SI-CLIENT-09: each attempt builds a
            // fresh same-phone client; a pass requires an observed blocked
            // reuse write. Retry-exhaustion throws a non-matching error, which
            // it.failing reports RED (an infra miss must not look like a pass).
            let observed = false;
            for (let attempt = 1; attempt <= 3 && !observed; attempt += 1) {
                const phone = `010${String(30_000_000 + Math.floor(Math.random() * 69_999_999)).padStart(8, "0")}`;
                const client = await createClient(handle.raw, tracker, {
                    branchId,
                    phone: `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`,
                    phoneNormalized: phone,
                    smsAutomationEnabled: true,
                });

                // T1: the locked writer — the same row lock and write the ordinary
                // clientService.update issues under the write-set lock. It is
                // started first, so its FOR UPDATE takes the row lock before
                // the reuse write below reaches the row.
                const lockedUpdate = handle.service.$transaction(async (tx) => {
                    await tx.$executeRaw`SELECT id FROM "client" WHERE "id" = ${client.id} FOR UPDATE`;
                    await tx.client.update({
                        where: { id: client.id },
                        data: { smsAutomationEnabled: true },
                    });
                    // Hold the lock until the reuse write is observed blocked on us.
                    await waitForBlockedStatement(handle.raw, "sms_automation_enabled");
                }, { maxWait: 5_000, timeout: 60_000 });

                const service = makeClientService({ prisma: handle.service, raw: handle.raw });
                // The reuse-existing-client branch of create(): decided from the
                // pre-T1 snapshot, written OUTSIDE the write-set lock.
                const reuseCreate = service.create(branchId, {
                    name: `재사용 고객 ${client.id}`,
                    phone,
                    careCenter: false,
                    voucherClient: false,
                    breastPump: false,
                    reuseExistingClient: true,
                    smsAutomationEnabled: false,
                });

                try {
                    await lockedUpdate;
                    observed = true;
                } catch (error) {
                    if (!(error instanceof InterleavingNotObservedError)) throw error;
                    // T1 rolled back; the blocked write resolved onto the rolled-back state.
                    await reuseCreate.catch(() => undefined);
                    continue;
                }

                const reused = await reuseCreate;

                const row = await handle.raw.client.findUniqueOrThrow({
                    where: { id: client.id },
                    select: { smsAutomationEnabled: true },
                });
                if (row.smsAutomationEnabled !== true || reused.id !== client.id) {
                    throw new Error(
                        `SI-CLIENT-03: reuse write returned client ${reused.id} with smsAutomationEnabled=${String(row.smsAutomationEnabled)} — the committed locked update (true) was overwritten (false)`,
                    );
                }
            }
            if (!observed) {
                throw new Error(
                    "SI-CLIENT-03: the interleaving was never observed in 3 attempts (test infrastructure, not the tracked behaviour)",
                );
            }
        },
        /SI-CLIENT-03: reuse write returned client \d+ with smsAutomationEnabled=false — the committed locked update \(true\) was overwritten \(false\)/,
    );
});
