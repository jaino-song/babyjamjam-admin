import { Prisma } from "@prisma/client";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { createBranch, createClient } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { addDays, dbDate, isoDateInKorea, makeClientService, makeDueDateScheduler, prewarmConnections } from "./test-helpers";

jest.setTimeout(180_000);

/**
 * Equal under one canonical JSON serialization. Decimal/Date/undefined shapes
 * serialize identically for identical values, so two full row images that only
 * differ in one excluded column pass, and a clobbered column fails. Used to
 * compare the committed T1 row image with the post-reuse row.
 */
function sameSerialized(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

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
 * SI-CLIENT-03 (review round 1 re-verdict): the reuse-existing-client
 * `smsAutomationEnabled` write (`client.service.ts`, create()'s reuse branch)
 * is a blind, explicit, SINGLE-COLUMN `updateMany` by (id, branchId) issued
 * without the write-set lock. Last-writer-wins on a caller-supplied explicit
 * value is correct: a serial order "T1 commits, then reuse(false)" yields
 * `false` too, so nothing is lost. The invariant pinned here is therefore not
 * exclusivity but scope: under the forced interleaving the reuse write changes
 * only `smsAutomationEnabled` and clobbers no other column of the committed
 * locked update.
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

    for (const mode of ["transactional", "fallback"] as const) invariant(
        "SI-CLIENT-09",
        `the ${mode} scheduler's conditional startDate write skips after a concurrent locked update commits a start date`,
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
                let transactionWrites = 0;
                let fallbackWrites = 0;
                // Pause the actual production statement, not a copied predicate.
                // Proxy only dispatch timing; every read/write uses real Prisma.
                const gatedClient = (delegate: Prisma.TransactionClient["client"], transactional: boolean) =>
                    new Proxy(delegate, { get(target, key) {
                        if (key === "updateMany") return async (...args: Parameters<typeof delegate.updateMany>) => {
                            // Lifecycle may issue its own client metadata write
                            // after a mutant bypasses the scheduler guard.
                            if (!args[0]?.where || !("dueDate" in args[0].where)) return target.updateMany(...args);
                            if (transactional) transactionWrites += 1;
                            else fallbackWrites += 1;
                            candidatesRead(); // the candidate read (startDate IS NULL) completed
                            await schedulerMayWrite;
                            // Await inside the promise so Prisma's lazy statement
                            // is dispatched immediately and can be observed blocked.
                            issuedUpdate = (async () => target.updateMany(...args))();
                            return issuedUpdate;
                        };
                        return Reflect.get(target, key);
                    } });
                const schedulerPrisma = new Proxy(handle.service, { get(target, key) {
                    if (key === "client") return gatedClient(target.client, false);
                    if (key === "$transaction") return (body: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
                        target.$transaction((tx) => body(new Proxy(tx, { get(transaction, property) {
                            return property === "client" ? gatedClient(transaction.client, true) : Reflect.get(transaction, property);
                        } })), { maxWait: 5_000, timeout: 60_000 });
                    const value: unknown = Reflect.get(target, key);
                    return typeof value === "function" ? value.bind(target) : value;
                } });

                const scheduler = makeDueDateScheduler(schedulerPrisma, mode);
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
                expect(transactionWrites).toBe(mode === "transactional" ? 1 : 0);
                expect(fallbackWrites).toBe(mode === "fallback" ? 1 : 0);
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

    invariant(
        "SI-CLIENT-03",
        "the reuse-existing-client write is single-column: under the forced interleaving it clobbers only smsAutomationEnabled",
        async () => {
            // Same evidence-based interleaving the removed knownDefect used:
            // each attempt builds a fresh same-phone client; a pass requires an
            // observed blocked reuse write. Retry-exhaustion throws a
            // non-matching error (an infra miss must not look like a pass).
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
                // the reuse write below reaches the row. It commits a column the
                // reuse write must not touch; its committed row image is reread
                // inside the transaction (the lock holder sees its own write).
                let committedRow: Record<string, unknown> | undefined;
                const lockedUpdate = handle.service.$transaction(async (tx) => {
                    await tx.$executeRaw`SELECT id FROM "client" WHERE "id" = ${client.id} FOR UPDATE`;
                    await tx.client.update({
                        where: { id: client.id },
                        data: { name: "잠금작성" },
                    });
                    committedRow = (await tx.client.findUniqueOrThrow({ where: { id: client.id } })) as unknown as Record<string, unknown>;
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

                await reuseCreate;
                if (!committedRow) {
                    throw new Error("SI-CLIENT-03: the locked row image was never captured — interleaving not reached");
                }
                const committed = committedRow;
                const after = (await handle.raw.client.findUniqueOrThrow({ where: { id: client.id } })) as unknown as Record<string, unknown>;

                // The reuse write must change ONLY `smsAutomationEnabled`
                // (last-writer-wins on the caller-supplied explicit false).
                // `client` has no updatedAt column, so any other difference
                // between the committed T1 image and the post-reuse row is a
                // clobber.
                const driftKeys = Object.keys(committed)
                    .filter((key) => key !== "smsAutomationEnabled" && sameSerialized(committed[key], after[key]) === false);
                if (driftKeys.length > 0) {
                    throw new Error(
                        `SI-CLIENT-03: the reuse write clobbered ${driftKeys.join(", ")} — expected only smsAutomationEnabled to change`,
                    );
                }
                if (after["smsAutomationEnabled"] !== false) {
                    throw new Error(
                        `SI-CLIENT-03: the reuse write left smsAutomationEnabled=${String(after["smsAutomationEnabled"])} — the caller-supplied explicit false was not applied`,
                    );
                }
            }
            if (!observed) {
                throw new Error(
                    "SI-CLIENT-03: the interleaving was never observed in 3 attempts (test infrastructure, not the tracked behaviour)",
                );
            }
        },
    );
});
