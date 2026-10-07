import { createHash } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
} from "domain/constants/service-record-link-message";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";

/**
 * Real-PostgreSQL concurrency spec for the manual service-record link send
 * (`replacePendingJobsUnlessInFlight`) racing the dispatcher claim
 * (`claimPendingWithRuleFence`). The hermetic specs model row locks in memory;
 * only a real server can prove there is no lock-order deadlock.
 *
 * Skipped unless G9_CONCURRENCY_DATABASE_URL is set. It then REFUSES (throws)
 * unless the host is loopback and the database name starts with
 * `g9_concurrency_`, because it drops and recreates the three tables it uses.
 *
 *   createdb -h 127.0.0.1 -p 62311 g9_concurrency_run
 *   G9_CONCURRENCY_DATABASE_URL=postgresql://$USER@127.0.0.1:62311/g9_concurrency_run \
 *     NODE_OPTIONS=--experimental-vm-modules pnpm exec jest \
 *     test/repositories/sb.message-trigger-job.manual-send-concurrency.spec.ts --runInBand
 */
const DATABASE_URL = process.env["G9_CONCURRENCY_DATABASE_URL"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function disposableDatabaseUrl(raw: string): string {
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
        throw new Error(`G9_CONCURRENCY_DATABASE_URL must point at a loopback host, got "${url.hostname}"`);
    }
    if (!database.startsWith("g9_concurrency_")) {
        throw new Error('G9_CONCURRENCY_DATABASE_URL database name must start with "g9_concurrency_"');
    }
    url.searchParams.set("application_name", APPLICATION_NAME);
    url.searchParams.set("connection_limit", "8");
    return url.toString();
}

const APPLICATION_NAME = "g9_concurrency_spec";
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("manual send vs dispatcher claim on real PostgreSQL", () => {
    const BRANCH = "11111111-1111-4111-8111-111111111111";
    const RULE = SERVICE_RECORD_LINK_RULE_ID;
    const OTHER_RULE = "g9_concurrency_other_rule";
    const SCHEDULE = 10;
    const OTHER_SCHEDULE = 11;
    const REASON = "Service record link rescheduled";

    type Deferred = { promise: Promise<void>; resolve: () => void };
    type Settled<T> = { ok: true; value: T } | { ok: false; code: string | undefined; message: string };

    let db: PrismaClient;
    let repository: SbMessageTriggerJobRepository;

    const defer = (): Deferred => {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => { resolve = done; });
        return { promise, resolve };
    };
    const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    const settle = <T>(work: Promise<T>): Promise<Settled<T>> => work.then(
        (value): Settled<T> => ({ ok: true, value }),
        (error: { code?: string; meta?: { code?: string }; message?: string }): Settled<T> => ({
            ok: false,
            code: error.meta?.code ?? error.code,
            message: String(error.message),
        }),
    );

    const waitForLockWait = async (label: string): Promise<void> => {
        for (let attempt = 0; attempt < 400; attempt++) {
            const rows = await db.$queryRaw<Array<{ pid: number }>>`
                SELECT pid FROM pg_stat_activity
                WHERE application_name = ${APPLICATION_NAME} AND wait_event_type = 'Lock'
            `;
            if (rows.length > 0) return;
            await delay(10);
        }
        throw new Error(`Expected a SQL lock wait: ${label}`);
    };

    /**
     * A repository whose transactions run `hold` after a statement matching
     * `after`, so a test can freeze a transaction while it holds its locks.
     */
    const repositoryHolding = (
        after: (sql: string) => boolean,
        hold: () => Promise<void>,
        deadlockTimeout?: string,
    ): SbMessageTriggerJobRepository => new SbMessageTriggerJobRepository({
        $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: object) => db.$transaction(async (tx) => {
            if (deadlockTimeout) await tx.$executeRawUnsafe(`SET LOCAL deadlock_timeout = '${deadlockTimeout}'`);
            const wrapped = new Proxy(tx, {
                get(target, key) {
                    if (key === "$queryRaw") {
                        return async (query: Prisma.Sql) => {
                            const result = await target.$queryRaw(query);
                            if (after(query.sql)) await hold();
                            return result;
                        };
                    }
                    const value = (target as unknown as Record<PropertyKey, unknown>)[key];
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
            return work(wrapped);
        }, options),
    } as unknown as PrismaService);

    /** Resolves once `held` fires; fails fast if the transaction finished without ever reaching its hook. */
    const reachedHold = (held: Promise<void>, finished: Promise<unknown>): Promise<void> => Promise.race([
        held,
        finished.then(() => { throw new Error("transaction finished without reaching the expected lock statement"); }),
    ]);

    const afterJobLock = (sql: string) => sql.includes('FROM "message_trigger_job"') && sql.includes("FOR UPDATE");
    const afterRuleLock = (sql: string) => sql.includes('FROM "message_trigger_rule"') && sql.includes("FOR UPDATE");

    const manualJob = (suffix: string, ruleId = RULE, scheduleId = SCHEDULE) => MessageTriggerJobEntity.create({
        branchId: BRANCH,
        ruleId,
        scheduledFor: new Date(),
        clientId: 20,
        employeeScheduleId: scheduleId,
        recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        recipientPhone: "01011112222",
        templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        dedupeKey: `${ruleId}:schedule:${scheduleId}:primary:manual:${suffix}`,
        payload: { memberId: "employee:30", recipientName: "provider", recipientPhone: "01011112222", templateVariables: {} },
    });

    const seed = async (
        status: string,
        options: { ruleId?: string; scheduleId?: number; key?: string } = {},
    ): Promise<string> => {
        const ruleId = options.ruleId ?? RULE;
        const scheduleId = options.scheduleId ?? SCHEDULE;
        const claimToken = status === "processing" || status === "dispatching" ? `claim-${status}` : null;
        const dedupeKey = `${ruleId}:schedule:${scheduleId}:primary${options.key ? `:${options.key}` : ""}`;
        const [row] = await db.$queryRaw<Array<{ id: string }>>`
            INSERT INTO message_trigger_job (branch_id, rule_id, status, scheduled_for, employee_schedule_id, client_id,
                recipient_type, recipient_phone, template_key, dedupe_key, claim_token, updated_at)
            VALUES (${BRANCH}::uuid, ${ruleId}, ${status}, now(), ${scheduleId}, 20, ${MessageTriggerRecipientType.PRIMARY_EMPLOYEE},
                '01011112222', ${MessageTriggerTemplateKey.SERVICE_RECORD_LINK}, ${dedupeKey}, ${claimToken},
                now() - interval '1 hour')
            RETURNING id
        `;
        return row!.id;
    };

    const jobs = () => db.$queryRaw<Array<{ id: string; status: string; rule_id: string; employee_schedule_id: number }>>`
        SELECT id, status, rule_id, employee_schedule_id FROM message_trigger_job ORDER BY id
    `;
    const liveJobs = async (ruleId = RULE, scheduleId = SCHEDULE) => (await jobs()).filter((row) => (
        row.rule_id === ruleId
        && row.employee_schedule_id === scheduleId
        && ["pending", "processing", "dispatching"].includes(row.status)
    ));
    const statusOf = async (id: string) => (await jobs()).find((row) => row.id === id)?.status;
    const rowOf = async (id: string) => (await db.$queryRaw<Array<{
        id: string; status: string; claim_token: string | null; cancel_reason: string | null; canceled_at: Date | null;
    }>>`
        SELECT id, status, claim_token, cancel_reason, canceled_at FROM message_trigger_job WHERE id = ${id}
    `)[0]!;

    /** Opens a transaction that runs `work` and then stays open (holding its locks) until released. */
    const openHolds: Array<{ release: () => void; done: Promise<unknown> }> = [];
    const holdOpen = async (work: (tx: Prisma.TransactionClient) => Promise<void>) => {
        const locked = defer();
        const release = defer();
        const done = settle(db.$transaction(async (tx) => {
            await work(tx);
            locked.resolve();
            await release.promise;
        }, { timeout: 120_000, maxWait: 10_000 }));
        const hold = { release: () => release.resolve(), done };
        // A test that fails before releasing must not leave its locks to block the next test.
        openHolds.push(hold);
        await Promise.race([
            locked.promise,
            done.then((result) => { throw new Error(`holding transaction failed: ${JSON.stringify(result)}`); }),
        ]);
        return hold;
    };

    /** The dispatcher's pre-provider authorization CAS (message-trigger.service.ts), verbatim. */
    const authorizeDispatch = (client: Prisma.TransactionClient | PrismaClient, id: string, token: string | null) => client.$queryRaw<Array<{ id: string }>>`
        UPDATE message_trigger_job
        SET status = 'dispatching', updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE id = ${id} AND status = 'processing' AND claim_token = ${token}
        RETURNING id
    `;

    /** The link tokens a send can carry here; both start active, as after a normal link preparation. */
    const LINK_TOKENS = ["same-link", "reset-link"];
    const seedTokens = async (): Promise<void> => {
        await db.$executeRaw`DELETE FROM service_record_token`;
        for (const token of LINK_TOKENS) {
            await db.$executeRaw`
                INSERT INTO service_record_token (branch_id, schedule_id, link_token_hash)
                VALUES (${BRANCH}::uuid, ${SCHEDULE}, ${token})
            `;
        }
    };
    /** `ServiceRecordTokenService.revokeForSchedule(scheduleId, tx)`'s write, on the caller's transaction when given. */
    const revokeTokens = async (scheduleId: number, tx?: Prisma.TransactionClient): Promise<void> => {
        await (tx ?? db).$executeRaw`
            UPDATE service_record_token SET active = false, revoked_at = now()
            WHERE schedule_id = ${scheduleId} AND active = true
        `;
    };
    const tokenStates = async () => (await db.$queryRaw<Array<{ link_token_hash: string; active: boolean; revoked_at: Date | null }>>`
        SELECT link_token_hash, active, revoked_at FROM service_record_token ORDER BY link_token_hash
    `);

    const allTokensInactive = async () => (await tokenStates()).every((row) => row.active === false);

    const linkService = (
        jobRepository: SbMessageTriggerJobRepository,
        duringLinkPreparation: () => Promise<void> = async () => undefined,
    ): ServiceRecordLinkService => {
        const prisma = {
            employee_schedule: {
                findUnique: async () => ({
                    id: SCHEDULE, branchId: BRANCH, clientId: 20, replaced: false,
                    startDate: new Date(), endDate: new Date(),
                    primaryEmployee: { id: 30, name: "provider", phone: "01011112222" },
                    client: { id: 20, name: "client" },
                }),
            },
        };
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            {
                reuseActiveLink: async () => {
                    await duringLinkPreparation();
                    return { linkToken: "same-link" };
                },
                revokeForSchedule: revokeTokens,
                issueLink: async () => ({ linkToken: "reset-link" }),
            } as never,
            { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService,
            jobRepository,
            { findRetryableServiceRecordSmsByScheduleId: async () => [] } as never,
            {} as never,
        );
        (service as unknown as { ensureSystemRule: () => Promise<void> }).ensureSystemRule = async () => undefined;
        return service;
    };

    /**
     * The real service with the real branch lock and repository, as
     * `scheduleForServiceStart` runs in production; only the token service is
     * faked, and `duringLinkPreparation` runs inside its `reuseActiveLink`, i.e.
     * between the automatic claim and its promotion.
     */
    const automaticService = (duringLinkPreparation: () => Promise<void> = async () => undefined): ServiceRecordLinkService => {
        const schedule = {
            id: SCHEDULE, branchId: BRANCH, clientId: 20, replaced: false,
            startDate: new Date(), endDate: new Date(Date.now() + 30 * 86_400_000),
            primaryEmployee: { id: 30, name: "provider", phone: "01011112222" },
            client: { id: 20, name: "client" },
        };
        const prisma = new Proxy(db, {
            get(target, key) {
                if (key === "employee_schedule") return { findUnique: async () => schedule };
                const value = Reflect.get(target, key) as unknown;
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            {
                reuseActiveLink: async () => {
                    await duringLinkPreparation();
                    return { linkToken: "same-link" };
                },
                revokeForSchedule: revokeTokens,
                issueLink: async () => ({ linkToken: "reset-link" }),
            } as never,
            { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService,
            repository,
            { findRetryableServiceRecordSmsByScheduleId: async () => [] } as never,
            {} as never,
            undefined,
            undefined,
            new MessageAutomationBranchLockService(db as never),
            { getTriggerDispatchEnabled: async () => true } as never,
        );
        (service as unknown as { ensureSystemRule: () => Promise<void> }).ensureSystemRule = async () => undefined;
        return service;
    };

    beforeAll(async () => {
        db = new PrismaClient({ datasources: { db: { url: disposableDatabaseUrl(DATABASE_URL!) } } });
        repository = new SbMessageTriggerJobRepository(db as unknown as PrismaService);
        for (const sql of [
            "DROP TABLE IF EXISTS message_trigger_job, message_trigger_rule_branch_override, message_trigger_rule, service_record_token CASCADE",
            // The columns of the real `service_record_token` the fence reads and the revoke writes.
            `CREATE TABLE service_record_token (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid NOT NULL, schedule_id integer NOT NULL,
                link_token_hash text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true, revoked_at timestamptz,
                created_at timestamptz NOT NULL DEFAULT now())`,
            `CREATE TABLE message_trigger_rule (id text PRIMARY KEY, branch_id uuid, is_active boolean NOT NULL DEFAULT true, jobs_stale boolean NOT NULL DEFAULT false)`,
            `CREATE TABLE message_trigger_rule_branch_override (branch_id uuid, rule_id text, is_active boolean,
                created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (branch_id, rule_id))`,
            `CREATE TABLE message_trigger_job (
                id text PRIMARY KEY DEFAULT gen_random_uuid()::text, branch_id uuid,
                rule_id text NOT NULL REFERENCES message_trigger_rule(id) ON DELETE CASCADE ON UPDATE NO ACTION,
                status text NOT NULL DEFAULT 'pending', scheduled_for timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0,
                next_attempt_at timestamptz, claim_token text, sent_at timestamptz, canceled_at timestamptz, cancel_reason text,
                canceled_by_user boolean NOT NULL DEFAULT false, client_id integer, employee_schedule_id integer,
                recipient_type text NOT NULL, recipient_phone text, template_key text NOT NULL, dedupe_key text NOT NULL UNIQUE,
                payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (status <> 'processing' OR claim_token IS NOT NULL))`,
        ]) await db.$executeRawUnsafe(sql);
        await db.$executeRaw`INSERT INTO message_trigger_rule (id) VALUES (${RULE}), (${OTHER_RULE})`;
    });

    afterAll(async () => {
        await db?.$disconnect();
    });

    afterEach(async () => {
        for (const hold of openHolds.splice(0)) {
            hold.release();
            await hold.done;
        }
    });

    beforeEach(async () => {
        await db.$executeRaw`DELETE FROM message_trigger_job`;
        await seedTokens();
    });

    jest.setTimeout(60000);

    describe("refusal and replacement", () => {
        it.each(["dispatching", "processing"])("refuses and writes nothing while a %s job exists", async (status) => {
            const original = await seed(status);

            const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON);

            expect(result).toEqual({ kind: "in_flight", inFlightJobIds: [original] });
            expect(await jobs()).toHaveLength(1);
            expect(await statusOf(original)).toBe(status);
        });

        it("sendNow answers a 409 and creates no job behind an in-flight one", async () => {
            await seed("dispatching");

            await expect(linkService(repository).sendNow(SCHEDULE)).rejects.toMatchObject({ status: 409 });

            expect(await jobs()).toHaveLength(1);
        });

        it("cancels the pending job and leaves exactly one live replacement", async () => {
            const original = await seed("pending");

            const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON);

            expect(result.kind).toBe("replaced");
            expect(await statusOf(original)).toBe("canceled");
            expect(await liveJobs()).toHaveLength(1);
        });

        it("ignores a different schedule's in-flight job and a different rule's pending job", async () => {
            const otherScheduleInFlight = await seed("dispatching", { scheduleId: OTHER_SCHEDULE });
            const otherRulePending = await seed("pending", { ruleId: OTHER_RULE });
            const own = await seed("pending");

            const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON);

            expect(result.kind).toBe("replaced");
            expect(await statusOf(own)).toBe("canceled");
            expect(await statusOf(otherScheduleInFlight)).toBe("dispatching");
            expect(await statusOf(otherRulePending)).toBe("pending");
            expect(await liveJobs()).toHaveLength(1);
        });

        it("still refuses for this schedule when only its own job is in flight beside unrelated pending ones", async () => {
            const own = await seed("dispatching");
            const otherSchedulePending = await seed("pending", { scheduleId: OTHER_SCHEDULE });

            const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON);

            expect(result).toEqual({ kind: "in_flight", inFlightJobIds: [own] });
            expect(await statusOf(otherSchedulePending)).toBe("pending");
        });
    });

    describe("double manual send", () => {
        it("two concurrent sends over one pending job leave exactly one live job", async () => {
            await seed("pending");

            const results = await Promise.all([
                repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON),
                repository.replacePendingJobsUnlessInFlight(manualJob("b"), REASON),
            ]);

            expect(results.map((result) => result.kind)).toEqual(["replaced", "replaced"]);
            expect(await liveJobs()).toHaveLength(1);
        });

        it("two concurrent sends with nothing live yet still leave exactly one live job", async () => {
            const results = await Promise.all([
                repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON),
                repository.replacePendingJobsUnlessInFlight(manualJob("b"), REASON),
            ]);

            expect(results.map((result) => result.kind)).toEqual(["replaced", "replaced"]);
            expect(await liveJobs()).toHaveLength(1);
        });
    });

    describe("dispatcher claim racing the manual send", () => {
        it("claim first: the replacement waits for the claim, then refuses; never two live jobs", async () => {
            const original = await seed("pending");
            const claimed = defer();
            const releaseClaim = defer();
            const claim = settle(db.$transaction(async (tx) => {
                const token = await repository.claimPendingWithRuleFence(original, BRANCH, tx);
                claimed.resolve();
                await releaseClaim.promise;
                return token;
            }));
            await claimed.promise;

            const replacement = settle(repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON));
            await waitForLockWait("replacement behind claim");
            releaseClaim.resolve();
            const [claimResult, replacementResult] = await Promise.all([claim, replacement]);

            expect(claimResult).toMatchObject({ ok: true });
            expect(replacementResult).toEqual({ ok: true, value: { kind: "in_flight", inFlightJobIds: [original] } });
            expect(await jobs()).toHaveLength(1);
            expect(await statusOf(original)).toBe("processing");
        });

        it.each([
            ["the job rows are locked", afterJobLock],
            ["only the rule row is locked", afterRuleLock],
        ])("replacement first (%s): the claim waits, loses against the canceled row, no deadlock", async (_label, after) => {
            const original = await seed("pending");
            const holding = defer();
            const release = defer();
            const slow = repositoryHolding(after, async () => { holding.resolve(); await release.promise; });
            const replacement = settle(slow.replacePendingJobsUnlessInFlight(manualJob("a"), REASON));
            await reachedHold(holding.promise, replacement);

            const claim = settle(repository.claimPendingWithRuleFence(original, BRANCH));
            await waitForLockWait("claim behind replacement");
            release.resolve();
            const [replacementResult, claimResult] = await Promise.all([replacement, claim]);

            expect(replacementResult).toMatchObject({ ok: true, value: { kind: "replaced" } });
            expect(claimResult).toEqual({ ok: true, value: null });
            expect(await statusOf(original)).toBe("canceled");
            expect(await liveJobs()).toHaveLength(1);
            expect((await liveJobs())[0]!.status).toBe("pending");
        });

        it("sendNow is never the deadlock victim while a claim waits behind it", async () => {
            const original = await seed("pending");
            const holding = defer();
            const release = defer();
            // A short deadlock_timeout makes a lock cycle surface within 50ms on
            // the sendNow side, which is how it used to turn into an HTTP 500.
            const slow = repositoryHolding(afterJobLock, async () => { holding.resolve(); await release.promise; }, "50ms");
            const send = settle(linkService(slow).sendNow(SCHEDULE));
            await reachedHold(holding.promise, send);

            const claim = settle(db.$transaction(async (tx) => {
                await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '4s'");
                return repository.claimPendingWithRuleFence(original, BRANCH, tx);
            }));
            await waitForLockWait("claim behind sendNow");
            await delay(300);
            release.resolve();
            const [sendResult, claimResult] = await Promise.all([send, claim]);

            expect(sendResult).toMatchObject({ ok: true });
            expect(claimResult).toEqual({ ok: true, value: null });
            expect(await statusOf(original)).toBe("canceled");
            expect(await liveJobs()).toHaveLength(1);
        });
    });

    describe("cancel by revoke / reset / automatic reschedule vs the dispatcher", () => {
        const CANCEL_REASON = "Service record access revoked";

        it("cancels pending and processing jobs atomically and reports dispatching ones untouched", async () => {
            const pending = await seed("pending", { key: "p" });
            const processing = await seed("processing", { key: "q" });
            const dispatching = await seed("dispatching", { key: "r" });
            const otherSchedule = await seed("pending", { scheduleId: OTHER_SCHEDULE });
            const otherRule = await seed("pending", { ruleId: OTHER_RULE });

            const result = await repository.cancelPendingByRuleAndEmployeeSchedule(RULE, SCHEDULE, CANCEL_REASON);

            expect([...result.canceledJobIds].sort()).toEqual([pending, processing].sort());
            expect(result.inFlightJobIds).toEqual([dispatching]);
            for (const id of [pending, processing]) {
                expect(await rowOf(id)).toMatchObject({ status: "canceled", claim_token: null, cancel_reason: CANCEL_REASON });
                expect((await rowOf(id)).canceled_at).toBeInstanceOf(Date);
            }
            expect(await rowOf(dispatching)).toMatchObject({ status: "dispatching", claim_token: "claim-dispatching", cancel_reason: null });
            expect(await statusOf(otherSchedule)).toBe("pending");
            expect(await statusOf(otherRule)).toBe("pending");
        });

        it("claim first: the cancel waits for the claim, cancels the processing job and the dispatcher authorization loses", async () => {
            const original = await seed("pending");
            const claimed = defer();
            const releaseClaim = defer();
            let token: string | null = null;
            const claim = settle(db.$transaction(async (tx) => {
                token = await repository.claimPendingWithRuleFence(original, BRANCH, tx);
                claimed.resolve();
                await releaseClaim.promise;
            }));
            await claimed.promise;

            const cancel = settle(repository.cancelPendingByRuleAndEmployeeSchedule(RULE, SCHEDULE, CANCEL_REASON));
            await waitForLockWait("cancel behind claim");
            releaseClaim.resolve();
            const [claimResult, cancelResult] = await Promise.all([claim, cancel]);

            expect(claimResult).toMatchObject({ ok: true });
            expect(token).not.toBeNull();
            expect(cancelResult).toEqual({ ok: true, value: { canceledJobIds: [original], inFlightJobIds: [] } });
            expect(await rowOf(original)).toMatchObject({ status: "canceled", claim_token: null });
            expect(await authorizeDispatch(db, original, token)).toEqual([]);
            expect(await statusOf(original)).toBe("canceled");
        });

        it("cancel first: the dispatcher claim finds a canceled job and claims nothing", async () => {
            const original = await seed("pending");

            await repository.cancelPendingByRuleAndEmployeeSchedule(RULE, SCHEDULE, CANCEL_REASON);

            expect(await repository.claimPendingWithRuleFence(original, BRANCH)).toBeNull();
            expect(await statusOf(original)).toBe("canceled");
        });

        it("authorization first: a cancel arriving behind the processing->dispatching CAS leaves the dispatching job and reports it", async () => {
            const original = await seed("processing");
            const hold = await holdOpen(async (tx) => {
                expect(await authorizeDispatch(tx, original, "claim-processing")).toEqual([{ id: original }]);
            });

            const cancel = settle(repository.cancelPendingByRuleAndEmployeeSchedule(RULE, SCHEDULE, CANCEL_REASON));
            await waitForLockWait("cancel behind authorization");
            hold.release();
            const [holdResult, cancelResult] = await Promise.all([hold.done, cancel]);

            expect(holdResult).toMatchObject({ ok: true });
            expect(cancelResult).toEqual({ ok: true, value: { canceledJobIds: [], inFlightJobIds: [original] } });
            expect(await rowOf(original)).toMatchObject({ status: "dispatching", claim_token: "claim-processing", cancel_reason: null });
        });

        it("a pending job claimed AND authorized while the cancel waits ends dispatching, never canceled", async () => {
            const original = await seed("pending");
            const hold = await holdOpen(async (tx) => {
                const token = await repository.claimPendingWithRuleFence(original, BRANCH, tx);
                expect(await authorizeDispatch(tx, original, token)).toEqual([{ id: original }]);
            });

            const cancel = settle(repository.cancelPendingByRuleAndEmployeeSchedule(RULE, SCHEDULE, CANCEL_REASON));
            await waitForLockWait("cancel behind claim + authorization");
            hold.release();
            const [, cancelResult] = await Promise.all([hold.done, cancel]);

            expect(cancelResult).toEqual({ ok: true, value: { canceledJobIds: [], inFlightJobIds: [original] } });
            expect((await rowOf(original)).status).toBe("dispatching");
        });

        it.each([
            ["revoke", (service: ServiceRecordLinkService) => service.revoke(SCHEDULE)],
            ["reset", (service: ServiceRecordLinkService) => service.resetLink(SCHEDULE)],
        ])("%s never overwrites a job the dispatcher authorized meanwhile, and does not throw", async (label, run) => {
            const original = await seed("processing");
            const hold = await holdOpen(async (tx) => {
                expect(await authorizeDispatch(tx, original, "claim-processing")).toEqual([{ id: original }]);
            });

            const outcome = settle(run(linkService(repository)).then(() => undefined));
            await waitForLockWait(`${label} behind authorization`);
            hold.release();
            const [, result] = await Promise.all([hold.done, outcome]);

            expect(result).toEqual({ ok: true, value: undefined });
            expect(await rowOf(original)).toMatchObject({ status: "dispatching", cancel_reason: null });
        });

        it("revoke still cancels what has not been dispatched", async () => {
            const pending = await seed("pending", { key: "p" });
            const processing = await seed("processing", { key: "q" });

            await linkService(repository).revoke(SCHEDULE);

            expect(await statusOf(pending)).toBe("canceled");
            expect(await rowOf(processing)).toMatchObject({ status: "canceled", claim_token: null });
        });
    });

    describe("manual send behind a long lock answers 409, not 500", () => {
        const lockRule = async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT id FROM message_trigger_rule WHERE id = ${RULE} FOR UPDATE`;
        };

        it("a lock timeout reaches the caller as P2010 with SQLSTATE 55P03 in meta.code", async () => {
            const hold = await holdOpen(lockRule);
            let thrown: unknown;
            try {
                await db.$transaction(async (tx) => {
                    await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '300ms'`);
                    await lockRule(tx);
                });
            } catch (error) {
                thrown = error;
            }
            hold.release();
            await hold.done;

            expect(thrown).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
            expect(thrown).toMatchObject({ code: "P2010", meta: { code: "55P03" } });
        });

        it.each([
            ["the rule row", lockRule],
            ["a live job row of the schedule", async (tx: Prisma.TransactionClient) => {
                await tx.$queryRaw`SELECT id FROM message_trigger_job WHERE rule_id = ${RULE} AND employee_schedule_id = ${SCHEDULE} FOR UPDATE`;
            }],
            ["the schedule's advisory replace lock", async (tx: Prisma.TransactionClient) => {
                await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`message-trigger-job-replace:${RULE}:${SCHEDULE}`}, 0))`);
            }],
        ])("sendNow behind %s held past lock_timeout answers 409 REQUEST_CONFLICT and writes nothing", async (_label, lock) => {
            const original = await seed("pending");
            const hold = await holdOpen(lock);

            const started = Date.now();
            const failure = await linkService(repository).sendNow(SCHEDULE).then(() => null, (error: unknown) => error);
            const elapsed = Date.now() - started;
            hold.release();
            await hold.done;

            expect(failure).toMatchObject({ status: 409 });
            expect((failure as { getResponse(): unknown }).getResponse()).toEqual(codeOnlyProblemBody("REQUEST_CONFLICT"));
            // Answered by lock_timeout, long before the 5 s interactive-transaction default.
            expect(elapsed).toBeLessThan(4000);
            expect(await jobs()).toHaveLength(1);
            expect(await statusOf(original)).toBe("pending");

            // Once the lock is gone the same send goes through.
            expect((await repository.replacePendingJobsUnlessInFlight(manualJob("retry"), REASON)).kind).toBe("replaced");
        });

        it("the repository returns lock_timeout instead of throwing when the rule lock outlasts lock_timeout", async () => {
            const hold = await holdOpen(lockRule);
            const result = await settle(repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON));
            hold.release();
            await hold.done;

            expect(result).toEqual({ ok: true, value: { kind: "lock_timeout" } });
            expect(await jobs()).toHaveLength(0);
        });

        describe("provider-rejected retry behind the rule lock (b4)", () => {
            /** A failed provider-rejected source, the approved target version for it, and the action-bound retry candidate. */
            const rejectedRetry = async () => {
                const rejectedSource = MessageTriggerJobEntity.create({
                    branchId: BRANCH,
                    ruleId: RULE,
                    scheduledFor: new Date(),
                    clientId: 20,
                    employeeScheduleId: SCHEDULE,
                    recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                    recipientPhone: "01011112222",
                    templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                    dedupeKey: `${RULE}:schedule:${SCHEDULE}:primary:manual:rejected`,
                    payload: {
                        memberId: "employee:30",
                        recipientName: "provider",
                        recipientPhone: "01011112222",
                        templateVariables: { retrySafety: "provider-rejected" },
                    },
                });
                rejectedSource.markFailed("provider rejected");
                const source = await repository.create(rejectedSource);
                const snapshotHash = "b4-snapshot";
                const version = createHash("sha256").update(JSON.stringify({
                    id: source.id, branchId: source.branchId, ruleId: source.ruleId, status: source.status,
                    scheduledFor: source.scheduledFor.toISOString(), sentAt: source.sentAt?.toISOString() ?? null,
                    canceledAt: source.canceledAt?.toISOString() ?? null, cancelReason: source.cancelReason,
                    clientId: source.clientId, employeeScheduleId: source.employeeScheduleId,
                    recipientType: source.recipientType, recipientPhone: source.recipientPhone, templateKey: source.templateKey,
                    payload: source.payload, attempts: source.attempts, nextAttemptAt: source.nextAttemptAt?.toISOString() ?? null,
                    createdAt: source.createdAt.toISOString(), updatedAt: source.updatedAt.toISOString(),
                    deliverySnapshotHash: snapshotHash,
                })).digest("hex");
                const retryJob = MessageTriggerJobEntity.create({
                    branchId: BRANCH,
                    ruleId: RULE,
                    scheduledFor: new Date(),
                    clientId: 20,
                    employeeScheduleId: OTHER_SCHEDULE,
                    recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                    recipientPhone: "01011112222",
                    templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                    dedupeKey: "agent-sms-retry:b4",
                    payload: source.payload,
                });
                return {
                    source,
                    retryJob,
                    claim: (target: SbMessageTriggerJobRepository = repository) => target.claimProviderRejectedForRetry(
                        BRANCH, source.id, version, snapshotHash, source, retryJob,
                    ),
                };
            };

            it("answers lock_timeout within ~1-2 s when the rule lock is held for 6 s, writing nothing", async () => {
                const { source, claim } = await rejectedRetry();
                const hold = await holdOpen(lockRule);
                // A rule normalisation holds the row for ~6 s: past Prisma's 5 s
                // interactive-transaction default, which is what used to end in P2028.
                const releaseLater = setTimeout(() => hold.release(), 6000);

                const started = Date.now();
                const result = await settle(claim());
                const elapsed = Date.now() - started;
                clearTimeout(releaseLater);
                hold.release();
                await hold.done;

                // Not P2028 after the 5 s interactive default: the lock wait is bounded at 1 s.
                expect(result).toEqual({ ok: true, value: { kind: "lock_timeout" } });
                expect(elapsed).toBeGreaterThanOrEqual(900);
                expect(elapsed).toBeLessThan(2500);
                expect(await jobs()).toHaveLength(1);
                expect(await statusOf(source.id)).toBe("failed");
            });

            it("a retry started behind a long hold returns lock_timeout; the same retry after release creates the job", async () => {
                const { source, retryJob, claim } = await rejectedRetry();
                const hold = await holdOpen(lockRule);
                const first = await settle(claim());
                hold.release();
                await hold.done;
                expect(first).toEqual({ ok: true, value: { kind: "lock_timeout" } });
                expect(await jobs()).toHaveLength(1);

                const second = await settle(claim());
                expect(second).toMatchObject({
                    ok: true,
                    value: { kind: "claimed", job: expect.objectContaining({ dedupeKey: retryJob.dedupeKey, status: "pending" }) },
                });
                expect(await jobs()).toHaveLength(2);
                expect(await statusOf(source.id)).toBe("failed");
            });

            it("a lock released well inside lock_timeout still creates the retry", async () => {
                const { retryJob, claim } = await rejectedRetry();
                const hold = await holdOpen(lockRule);

                const retry = settle(claim());
                await waitForLockWait("retry behind the rule lock");
                await delay(150);
                hold.release();
                await hold.done;

                expect(await retry).toMatchObject({
                    ok: true,
                    value: { kind: "claimed", job: expect.objectContaining({ dedupeKey: retryJob.dedupeKey }) },
                });
                expect(await jobs()).toHaveLength(2);
            });
        });
    });

    describe("automatic promotion vs manual send", () => {
        const leaseRow = async () => (await db.$queryRaw<Array<{
            id: string; status: string; cancel_reason: string | null; next_attempt_at: Date | null; updated_at: Date;
        }>>`
            SELECT id, status, cancel_reason, next_attempt_at, updated_at FROM message_trigger_job
            WHERE dedupe_key = ${`${RULE}:schedule:${SCHEDULE}:primary`}
        `)[0];

        /** The lease an automatic claim would hold (a failed marker on the automatic dedupe key) and the job it would promote. */
        const seedLease = async () => {
            const dedupeKey = `${RULE}:schedule:${SCHEDULE}:primary`;
            const [marker] = await db.$queryRaw<Array<{ id: string; claim_version: string }>>`
                INSERT INTO message_trigger_job (branch_id, rule_id, status, scheduled_for, employee_schedule_id, client_id,
                    recipient_type, recipient_phone, template_key, dedupe_key, cancel_reason, next_attempt_at, updated_at)
                VALUES (${BRANCH}::uuid, ${RULE}, 'failed', now(), ${SCHEDULE}, 20, ${MessageTriggerRecipientType.PRIMARY_EMPLOYEE},
                    '01011112222', ${MessageTriggerTemplateKey.SERVICE_RECORD_LINK}, ${dedupeKey},
                    ${SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON}, now() + interval '10 minutes', clock_timestamp())
                RETURNING id, updated_at::text AS claim_version
            `;
            const automaticJob = MessageTriggerJobEntity.create({
                branchId: BRANCH,
                ruleId: RULE,
                scheduledFor: new Date(),
                clientId: 20,
                employeeScheduleId: SCHEDULE,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipientPhone: "01011112222",
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey,
                payload: { memberId: "employee:30", recipientName: "provider", recipientPhone: "01011112222", templateVariables: {} },
            });
            return { marker: marker!, automaticJob };
        };

        /** Starts the automatic path and parks it holding its lease, between its claim and its promotion. */
        const automaticRun = async () => {
            const reached = defer();
            const release = defer();
            const service = automaticService(async () => {
                reached.resolve();
                await release.promise;
            });
            const run = settle(service.scheduleForServiceStart(SCHEDULE));
            await Promise.race([reached.promise, run.then(() => { throw new Error("automatic run ended before link preparation"); })]);
            return { run, release: () => release.resolve() };
        };

        it("control: automatic only, then a manual send, leaves exactly one live job", async () => {
            expect(await automaticService().scheduleForServiceStart(SCHEDULE)).toBe(true);
            expect(await liveJobs()).toHaveLength(1);

            await linkService(repository).sendNow(SCHEDULE);

            const live = await liveJobs();
            expect(live).toHaveLength(1);
            expect(live[0]!.status).toBe("pending");
        });

        it("a manual send the dispatcher claimed during link preparation is never joined by a second job", async () => {
            const { run, release } = await automaticRun();
            const leaseBefore = (await leaseRow())!.next_attempt_at!;
            expect(await leaseRow()).toMatchObject({ status: "failed", cancel_reason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON });

            const manual = await linkService(repository).sendNow(SCHEDULE);
            const token = await repository.claimPendingWithRuleFence(manual.jobId, BRANCH);
            expect(token).not.toBeNull();
            expect(await authorizeDispatch(db, manual.jobId, token)).toEqual([{ id: manual.jobId }]);
            release();
            const outcome = await run;

            expect(outcome).toEqual({ ok: true, value: false });
            const live = await liveJobs();
            expect(live).toEqual([expect.objectContaining({ id: manual.jobId, status: "dispatching" })]);
            // The lease is released, not promoted: still the failed marker, retry pushed out.
            const lease2 = (await leaseRow())!;
            expect(lease2).toMatchObject({ status: "failed", cancel_reason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON });
            expect(lease2.next_attempt_at!.getTime()).toBeGreaterThan(leaseBefore.getTime());
            expect(lease2.next_attempt_at!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
        });

        it("a manual job that already went out (sent) before the promotion blocks it", async () => {
            const { run, release } = await automaticRun();

            const manual = await linkService(repository).sendNow(SCHEDULE);
            await db.$executeRaw`UPDATE message_trigger_job SET status = 'sent', sent_at = now() WHERE id = ${manual.jobId}`;
            release();
            const outcome = await run;

            expect(outcome).toEqual({ ok: true, value: false });
            expect(await liveJobs()).toHaveLength(0);
            expect(await statusOf(manual.jobId)).toBe("sent");
            expect(await leaseRow()).toMatchObject({ status: "failed", cancel_reason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON });
        });

        it("a manual job still pending at promotion blocks it (the manual send wins, one live row)", async () => {
            const { run, release } = await automaticRun();

            const manual = await linkService(repository).sendNow(SCHEDULE);
            release();
            const outcome = await run;

            expect(outcome).toEqual({ ok: true, value: false });
            expect(await liveJobs()).toEqual([expect.objectContaining({ id: manual.jobId, status: "pending" })]);
        });

        it("a manual send arriving while the promotion holds the fence replaces the promoted job without deadlock", async () => {
            const { marker, automaticJob } = await seedLease();

            const promoted = defer();
            const commit = defer();
            const promotion = settle(db.$transaction(async (tx) => {
                const job = await repository.promoteAutomaticSchedulingClaim(marker!.id, marker!.claim_version, automaticJob, tx);
                promoted.resolve();
                await commit.promise;
                return job;
            }));
            await promoted.promise;

            // Started while the promotion's locks are held; commits well inside the manual send's 1 s lock_timeout.
            const manual = settle(repository.replacePendingJobsUnlessInFlight(manualJob("manual"), REASON));
            await waitForLockWait("manual send behind the promotion");
            await delay(300);
            commit.resolve();
            const [promotionResult, manualResult] = await Promise.all([promotion, manual]);

            expect(promotionResult).toMatchObject({ ok: true, value: expect.objectContaining({ id: marker!.id, status: "pending" }) });
            expect(manualResult).toMatchObject({ ok: true, value: { kind: "replaced", canceledJobIds: [marker!.id] } });
            expect(await statusOf(marker!.id)).toBe("canceled");
            const live = await liveJobs();
            expect(live).toHaveLength(1);
            expect(live[0]).toMatchObject({ status: "pending" });
            expect(live[0]!.id).not.toBe(marker!.id);
        });

        it("a provider-rejected retry holding its source row never deadlocks with the promotion; the promotion refuses", async () => {
            const { marker, automaticJob } = await seedLease();
            // A manual send that later failed with a provider rejection: a failed blocker for the schedule.
            const rejectedSource = MessageTriggerJobEntity.create({
                branchId: BRANCH,
                ruleId: RULE,
                scheduledFor: new Date(),
                clientId: 20,
                employeeScheduleId: SCHEDULE,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipientPhone: "01011112222",
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey: `${RULE}:schedule:${SCHEDULE}:primary:manual:rejected`,
                payload: {
                    memberId: "employee:30",
                    recipientName: "provider",
                    recipientPhone: "01011112222",
                    templateVariables: { retrySafety: "provider-rejected" },
                },
            });
            rejectedSource.markFailed("provider rejected");
            const source = await repository.create(rejectedSource);
            const snapshotHash = "h1-snapshot";
            const version = createHash("sha256").update(JSON.stringify({
                id: source.id, branchId: source.branchId, ruleId: source.ruleId, status: source.status,
                scheduledFor: source.scheduledFor.toISOString(), sentAt: source.sentAt?.toISOString() ?? null,
                canceledAt: source.canceledAt?.toISOString() ?? null, cancelReason: source.cancelReason,
                clientId: source.clientId, employeeScheduleId: source.employeeScheduleId,
                recipientType: source.recipientType, recipientPhone: source.recipientPhone, templateKey: source.templateKey,
                payload: source.payload, attempts: source.attempts, nextAttemptAt: source.nextAttemptAt?.toISOString() ?? null,
                createdAt: source.createdAt.toISOString(), updatedAt: source.updatedAt.toISOString(),
                deliverySnapshotHash: snapshotHash,
            })).digest("hex");
            // The retry job is for another schedule, so the failed source is the only blocker the promotion can see.
            const retryJob = MessageTriggerJobEntity.create({
                branchId: BRANCH,
                ruleId: RULE,
                scheduledFor: new Date(),
                clientId: 20,
                employeeScheduleId: OTHER_SCHEDULE,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipientPhone: "01011112222",
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey: "agent-sms-retry:h1-regression",
                payload: source.payload,
            });

            // Park the retry once it has taken its locks (the source row lock is its last statement before the INSERT).
            const holding = defer();
            const release = defer();
            const retryRepository = repositoryHolding(
                (sql) => sql.includes('FROM "message_trigger_job"') && sql.includes("SELECT *") && sql.includes("FOR UPDATE"),
                async () => { holding.resolve(); await release.promise; },
            );
            const retry = settle(retryRepository.claimProviderRejectedForRetry(BRANCH, source.id, version, snapshotHash, source, retryJob));
            await reachedHold(holding.promise, retry);

            const promotion = settle(new MessageAutomationBranchLockService(db as never).runExclusive(
                BRANCH,
                (tx) => repository.promoteAutomaticSchedulingClaim(marker.id, marker.claim_version, automaticJob, tx),
            ));
            await waitForLockWait("promotion behind the retry");
            release.resolve();
            const [retryResult, promotionResult] = await Promise.all([retry, promotion]);

            expect(retryResult).toMatchObject({ ok: true, value: { kind: "claimed", job: expect.objectContaining({ dedupeKey: retryJob.dedupeKey, status: "pending" }) } });
            expect(promotionResult).toEqual({ ok: true, value: null });
            expect(await statusOf(marker.id)).toBe("failed");
            expect(await liveJobs(RULE, OTHER_SCHEDULE)).toHaveLength(1);
            expect(await liveJobs()).toHaveLength(0);
        });

        describe("revoke vs link preparation, promotion and manual send (b5 defect 2)", () => {
            const REVOKE_REASON = "Service record access revoked";
            const GUARD = { requireActiveLinkToken: "same-link" };
            const allTokensRevoked = async () => (await tokenStates()).every((row) => row.active === false && row.revoked_at !== null);
            const noLiveJobAgainstARevokedToken = async () => {
                expect(await allTokensRevoked()).toBe(true);
                expect(await liveJobs()).toEqual([]);
            };

            /** Runs the automatic promotion as the service does: under the branch lock, in the lock's transaction. */
            const promoteUnderBranchLock = (marker: { id: string; claim_version: string }, automaticJob: MessageTriggerJobEntity) => settle(
                new MessageAutomationBranchLockService(db as never).runExclusive(
                    BRANCH,
                    (tx) => repository.promoteAutomaticSchedulingClaim(marker.id, marker.claim_version, automaticJob, tx, GUARD),
                ),
            );

            it("revoke landing during the automatic run's link preparation: the promotion refuses, no pending job is left against the revoked token", async () => {
                const { run, release } = await automaticRun();

                await linkService(repository).revoke(SCHEDULE);
                release();
                const outcome = await run;

                expect(outcome).toEqual({ ok: true, value: false });
                await noLiveJobAgainstARevokedToken();
                const lease = await leaseRow();
                expect(lease).toMatchObject({ status: "failed", cancel_reason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON });
            });

            it("revoke after the automatic promotion committed cancels the promoted job", async () => {
                expect(await automaticService().scheduleForServiceStart(SCHEDULE)).toBe(true);
                expect(await liveJobs()).toHaveLength(1);

                await linkService(repository).revoke(SCHEDULE);

                await noLiveJobAgainstARevokedToken();
                expect((await leaseRow())).toMatchObject({ status: "canceled", cancel_reason: REVOKE_REASON });
            });

            it("revoke arriving while the promotion holds the fence waits for it, then cancels the promoted job and revokes the token; no deadlock", async () => {
                const { marker, automaticJob } = await seedLease();
                const promoted = defer();
                const commit = defer();
                const promotion = settle(db.$transaction(async (tx) => {
                    const job = await repository.promoteAutomaticSchedulingClaim(marker.id, marker.claim_version, automaticJob, tx, GUARD);
                    promoted.resolve();
                    await commit.promise;
                    return job;
                }, { timeout: 30_000 }));
                await promoted.promise;

                const revoke = settle(linkService(repository).revoke(SCHEDULE));
                await waitForLockWait("revoke behind the promotion");
                commit.resolve();
                const [promotionResult, revokeResult] = await Promise.all([promotion, revoke]);

                expect(promotionResult).toMatchObject({ ok: true, value: expect.objectContaining({ status: "pending" }) });
                expect(revokeResult).toEqual({ ok: true, value: undefined });
                await noLiveJobAgainstARevokedToken();
            });

            it("a promotion arriving while the revoke holds the fence waits for it, then sees the revoked token and refuses", async () => {
                const parked = defer();
                const gate = defer();
                const revoke = settle(repository.cancelPendingUnderScheduleFence(RULE, SCHEDULE, REVOKE_REASON, async (tx) => {
                    await revokeTokens(SCHEDULE, tx);
                    parked.resolve();
                    await gate.promise;
                }));
                await Promise.race([parked.promise, revoke.then(() => { throw new Error("revoke ended before parking"); })]);
                const { marker, automaticJob } = await seedLease();

                const promotion = promoteUnderBranchLock(marker, automaticJob);
                await waitForLockWait("promotion behind the revoke");
                gate.resolve();
                const [revokeResult, promotionResult] = await Promise.all([revoke, promotion]);

                expect(revokeResult).toMatchObject({ ok: true });
                expect(promotionResult).toEqual({ ok: true, value: null });
                await noLiveJobAgainstARevokedToken();
                expect(await statusOf(marker.id)).toBe("failed");
            });

            it("the promotion still promotes while the link token is active (control)", async () => {
                const { marker, automaticJob } = await seedLease();

                const promotion = await promoteUnderBranchLock(marker, automaticJob);

                expect(promotion).toMatchObject({ ok: true, value: expect.objectContaining({ id: marker.id, status: "pending" }) });
                expect(await liveJobs()).toHaveLength(1);
            });

            it("revoke landing during a manual send's link preparation: the send answers 409 and writes nothing", async () => {
                const reached = defer();
                const release = defer();
                const send = linkService(repository, async () => { reached.resolve(); await release.promise; }).sendNow(SCHEDULE);
                const refused = expect(send).rejects.toMatchObject({ status: 409 });
                await Promise.race([reached.promise, send.then(() => { throw new Error("send ended before link preparation"); }, () => undefined)]);

                await linkService(repository).revoke(SCHEDULE);
                release.resolve();
                await refused;

                await noLiveJobAgainstARevokedToken();
                expect(await jobs()).toEqual([]);
            });

            it("revoke after a manual send committed cancels the manual job", async () => {
                await linkService(repository).sendNow(SCHEDULE);
                expect(await liveJobs()).toHaveLength(1);

                await linkService(repository).revoke(SCHEDULE);

                await noLiveJobAgainstARevokedToken();
            });

            it("revoke arriving while the manual send holds the fence waits for it, then cancels the new job; no deadlock", async () => {
                const holding = defer();
                const release = defer();
                const slow = repositoryHolding(afterJobLock, async () => { holding.resolve(); await release.promise; });
                const send = settle(linkService(slow).sendNow(SCHEDULE));
                await reachedHold(holding.promise, send);

                const revoke = settle(linkService(repository).revoke(SCHEDULE));
                await waitForLockWait("revoke behind the manual send");
                release.resolve();
                const [sendResult, revokeResult] = await Promise.all([send, revoke]);

                expect(sendResult).toMatchObject({ ok: true });
                expect(revokeResult).toEqual({ ok: true, value: undefined });
                await noLiveJobAgainstARevokedToken();
            });

            it("a manual send arriving while the revoke holds the fence waits for it, then sees the revoked token and refuses", async () => {
                const parked = defer();
                const gate = defer();
                const revoke = settle(repository.cancelPendingUnderScheduleFence(RULE, SCHEDULE, REVOKE_REASON, async (tx) => {
                    await revokeTokens(SCHEDULE, tx);
                    parked.resolve();
                    await gate.promise;
                }));
                await Promise.race([parked.promise, revoke.then(() => { throw new Error("revoke ended before parking"); })]);

                const manual = settle(repository.replacePendingJobsUnlessInFlight(manualJob("manual"), REASON, GUARD));
                await waitForLockWait("manual send behind the revoke");
                await delay(300);
                gate.resolve();
                const [revokeResult, manualResult] = await Promise.all([revoke, manual]);

                expect(revokeResult).toMatchObject({ ok: true });
                expect(manualResult).toEqual({ ok: true, value: { kind: "link_revoked" } });
                await noLiveJobAgainstARevokedToken();
                expect(await jobs()).toEqual([]);
            });

            it("a manual send with an active token replaces as before (control)", async () => {
                const result = await repository.replacePendingJobsUnlessInFlight(manualJob("manual"), REASON, GUARD);

                expect(result).toMatchObject({ kind: "replaced" });
                expect(await liveJobs()).toHaveLength(1);
            });

            it("a token of another schedule or one that is inactive/revoked does not satisfy the guard", async () => {
                await db.$executeRaw`UPDATE service_record_token SET active = false WHERE link_token_hash = 'same-link'`;
                expect(await repository.replacePendingJobsUnlessInFlight(manualJob("a"), REASON, GUARD)).toEqual({ kind: "link_revoked" });

                await db.$executeRaw`UPDATE service_record_token SET active = true, schedule_id = ${OTHER_SCHEDULE} WHERE link_token_hash = 'same-link'`;
                expect(await repository.replacePendingJobsUnlessInFlight(manualJob("b"), REASON, GUARD)).toEqual({ kind: "link_revoked" });
                expect(await repository.replacePendingJobsUnlessInFlight(manualJob("c"), REASON, { requireActiveLinkToken: "missing" }))
                    .toEqual({ kind: "link_revoked" });
                expect(await jobs()).toEqual([]);
            });

            it("a revoke waiting out a rule lock held past Prisma's 5 s default transaction limit still succeeds (no P2028)", async () => {
                // Seeded first: the marker's INSERT needs a KEY SHARE lock on the rule row.
                const { marker, automaticJob } = await seedLease();
                const normalization = await holdOpen(async (tx) => {
                    await tx.$queryRaw`SELECT id FROM message_trigger_rule WHERE id = ${RULE} FOR UPDATE`;
                });
                // The promotion takes the schedule fence, then waits on the rule lock the normalization holds.
                const promoted = settle(db.$transaction((tx) => repository.promoteAutomaticSchedulingClaim(
                    marker.id, marker.claim_version, automaticJob, tx, GUARD,
                ), { timeout: 30_000 }));
                await waitForLockWait("promotion behind the normalization");
                const revoke = settle(linkService(repository).revoke(SCHEDULE));
                await delay(5_500);
                normalization.release();
                const [promotionResult, revokeResult] = await Promise.all([promoted, revoke]);

                expect(promotionResult).toMatchObject({ ok: true });
                expect(revokeResult).toEqual({ ok: true, value: undefined });
                await noLiveJobAgainstARevokedToken();
            });
        });
    });

    describe("client-rule claim cancel vs the dispatcher (b5 defect 1)", () => {
        const CLIENT_REASON = "Client data changed";

        /** The entity `findPendingByRuleIdsAndClientId` handed the service: a processing job read BEFORE the dispatcher's next step. */
        const staleProcessingEntity = async (id: string, token: string) => {
            const [row] = await db.$queryRaw<Array<{
                id: string; branch_id: string; rule_id: string; scheduled_for: Date; client_id: number;
                employee_schedule_id: number; recipient_type: string; recipient_phone: string; template_key: string;
                dedupe_key: string; payload: object; created_at: Date; updated_at: Date;
            }>>`SELECT * FROM message_trigger_job WHERE id = ${id}`;
            return MessageTriggerJobEntity.reconstitute(
                row!.id, row!.branch_id, row!.rule_id, "processing", row!.scheduled_for, null, null, null,
                row!.client_id, row!.employee_schedule_id, row!.recipient_type as MessageTriggerRecipientType,
                row!.recipient_phone, row!.template_key as MessageTriggerTemplateKey, row!.dedupe_key,
                row!.payload as never, row!.created_at, row!.updated_at, 0, null, token,
            );
        };

        /** The real `refreshPendingImmediateClientJobs` against the real repository, with `betweenReadAndCancel` running after its read. */
        const refreshClientJobs = async (id: string, betweenReadAndCancel: () => Promise<void>) => {
            const stale = await staleProcessingEntity(id, "claim-processing");
            const racing = Object.assign(Object.create(repository) as SbMessageTriggerJobRepository, {
                findPendingByRuleIdsAndClientId: async () => {
                    await betweenReadAndCancel();
                    return [stale];
                },
            });
            const service = Object.create(MessageTriggerService.prototype) as {
                jobRepository: SbMessageTriggerJobRepository;
                refreshPendingImmediateClientJobs: (rules: unknown[], clientId: number, client: unknown) => Promise<void>;
            };
            service.jobRepository = racing;
            await service.refreshPendingImmediateClientJobs([{ id: RULE }], 20, {});
        };

        it("the claim token does not change from processing to dispatching, so the stale entity's token still matches a dispatching row", async () => {
            const id = await seed("pending");
            const token = await repository.claimPendingWithRuleFence(id, BRANCH);
            expect(token).not.toBeNull();
            expect(await rowOf(id)).toMatchObject({ status: "processing", claim_token: token });

            expect(await authorizeDispatch(db, id, token)).toEqual([{ id }]);

            expect(await rowOf(id)).toMatchObject({ status: "dispatching", claim_token: token });
        });

        it("cancels a processing claim under its token, clearing it, and the dispatcher authorization then loses", async () => {
            const id = await seed("processing");

            expect(await repository.cancelProcessingClaim(id, "claim-processing", CLIENT_REASON)).toBe(true);

            expect(await rowOf(id)).toMatchObject({ status: "canceled", claim_token: null, cancel_reason: CLIENT_REASON });
            expect((await rowOf(id)).canceled_at).toBeInstanceOf(Date);
            expect(await authorizeDispatch(db, id, "claim-processing")).toEqual([]);
            expect(await statusOf(id)).toBe("canceled");
        });

        it("leaves a dispatching job alone even though its claim token matches", async () => {
            const id = await seed("dispatching");

            expect(await repository.cancelProcessingClaim(id, "claim-dispatching", CLIENT_REASON)).toBe(false);

            expect(await rowOf(id)).toMatchObject({ status: "dispatching", claim_token: "claim-dispatching", cancel_reason: null });
        });

        it("does not cancel a pending job or a claim held under another token", async () => {
            const pending = await seed("pending", { key: "p" });
            const processing = await seed("processing", { key: "q" });

            expect(await repository.cancelProcessingClaim(pending, "claim-processing", CLIENT_REASON)).toBe(false);
            expect(await repository.cancelProcessingClaim(processing, "someone-else", CLIENT_REASON)).toBe(false);

            expect(await statusOf(pending)).toBe("pending");
            expect(await statusOf(processing)).toBe("processing");
        });

        it("authorization first: a cancel waiting behind the processing->dispatching CAS skips the now-dispatching job", async () => {
            const id = await seed("processing");
            const hold = await holdOpen(async (tx) => {
                expect(await authorizeDispatch(tx, id, "claim-processing")).toEqual([{ id }]);
            });

            const cancel = settle(repository.cancelProcessingClaim(id, "claim-processing", CLIENT_REASON));
            await waitForLockWait("cancel behind authorization");
            hold.release();
            const [, result] = await Promise.all([hold.done, cancel]);

            expect(result).toEqual({ ok: true, value: false });
            expect(await rowOf(id)).toMatchObject({ status: "dispatching", claim_token: "claim-processing", cancel_reason: null });
        });

        it("cancel first: the dispatcher's authorization finds a canceled job and sends nothing", async () => {
            const id = await seed("processing");

            expect(await repository.cancelProcessingClaim(id, "claim-processing", CLIENT_REASON)).toBe(true);

            expect(await authorizeDispatch(db, id, "claim-processing")).toEqual([]);
            expect(await statusOf(id)).toBe("canceled");
        });

        it("service flow, dispatcher wins between the read and the cancel: the dispatching job is never overwritten as canceled", async () => {
            const id = await seed("processing");

            await refreshClientJobs(id, async () => {
                expect(await authorizeDispatch(db, id, "claim-processing")).toEqual([{ id }]);
            });

            expect(await rowOf(id)).toMatchObject({ status: "dispatching", claim_token: "claim-processing", cancel_reason: null });
        });

        it("service flow, nothing happens between the read and the cancel: the claim is cancelled", async () => {
            const id = await seed("processing");

            await refreshClientJobs(id, async () => undefined);

            expect(await rowOf(id)).toMatchObject({ status: "canceled", claim_token: null, cancel_reason: CLIENT_REASON });
        });

        it("the pending refresh's upsert cannot overwrite a job that became processing or dispatching", async () => {
            const processing = await seed("processing", { key: "q" });
            const dispatching = await seed("dispatching", { key: "r" });
            for (const key of ["q", "r"]) {
                const refreshed = MessageTriggerJobEntity.create({
                    branchId: BRANCH,
                    ruleId: RULE,
                    scheduledFor: new Date(),
                    clientId: 20,
                    employeeScheduleId: SCHEDULE,
                    recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                    recipientPhone: "01099998888",
                    templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                    dedupeKey: `${RULE}:schedule:${SCHEDULE}:primary:${key}`,
                    payload: { memberId: "x", recipientName: "refreshed", recipientPhone: "01099998888", templateVariables: {} },
                });
                await repository.upsertPending(refreshed);
            }

            expect(await rowOf(processing)).toMatchObject({ status: "processing", claim_token: "claim-processing" });
            expect(await rowOf(dispatching)).toMatchObject({ status: "dispatching", claim_token: "claim-dispatching" });
            const phones = await db.$queryRaw<Array<{ recipient_phone: string }>>`
                SELECT recipient_phone FROM message_trigger_job WHERE id IN (${processing}, ${dispatching})
            `;
            expect(phones.map((row) => row.recipient_phone)).toEqual(["01011112222", "01011112222"]);
        });
    });

    describe("dispatch authorization refuses a revoked service-record link (b5 review F1)", () => {
        const REVOKED_REASON = "제공기록지 링크가 철회되어 발송하지 않았습니다";
        const LINK_URL = "https://mobile.test/service-record/same-link";

        /** The real `authorizeClaimedJobForDispatch` on the real database (manual jobs bypass the automatic authority gate). */
        const dispatchService = () => {
            const prisma = {
                $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: object) => db.$transaction(
                    // A narrow transaction without the service-record case delegate, as the unit doubles do.
                    (tx) => work(new Proxy(tx, {
                        get(target, key) {
                            if (key === "service_record_case") return undefined;
                            const value = (target as unknown as Record<PropertyKey, unknown>)[key];
                            return typeof value === "function" ? value.bind(target) : value;
                        },
                    })),
                    options,
                ),
            };
            const service = Object.create(MessageTriggerService.prototype) as {
                prisma: unknown;
                authorizeClaimedJobForDispatch: (job: MessageTriggerJobEntity) => Promise<{ kind: string; reason?: string }>;
            };
            service.prisma = prisma;
            return service;
        };

        const seedLinkJob = async (dedupeKey: string, status = "processing", url: string | null = LINK_URL) => {
            const payload = JSON.stringify({
                memberId: "employee:30", recipientName: "provider", recipientPhone: "01011112222",
                buttonUrl: url, templateVariables: { serviceRecordUrl: url ?? "" },
            });
            const [row] = await db.$queryRaw<Array<{ id: string }>>`
                INSERT INTO message_trigger_job (branch_id, rule_id, status, scheduled_for, employee_schedule_id, client_id,
                    recipient_type, recipient_phone, template_key, dedupe_key, claim_token, payload, updated_at)
                VALUES (${BRANCH}::uuid, ${RULE}, ${status}, now(), ${SCHEDULE}, 20, ${MessageTriggerRecipientType.PRIMARY_EMPLOYEE},
                    '01011112222', ${MessageTriggerTemplateKey.SERVICE_RECORD_LINK}, ${dedupeKey},
                    ${status === "processing" ? "claim-processing" : null}, ${payload}::jsonb, now() - interval '1 hour')
                RETURNING id
            `;
            return MessageTriggerJobEntity.reconstitute(
                row!.id, BRANCH, RULE, status as never, new Date(), null, null, null, 20, SCHEDULE,
                MessageTriggerRecipientType.PRIMARY_EMPLOYEE, "01011112222", MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey, JSON.parse(payload), new Date(), new Date(), 0, null, status === "processing" ? "claim-processing" : null,
            );
        };

        const MANUAL_KEY = `${RULE}:schedule:${SCHEDULE}:primary:manual:00000000-0000-4000-8000-0000000000f1`;
        const RETRY_KEY = "agent-sms-retry:f1-action";

        it.each([["a manual job", MANUAL_KEY], ["an agent-sms-retry job", RETRY_KEY]])(
            "%s with a revoked token is canceled, never dispatching",
            async (_label, dedupeKey) => {
                const job = await seedLinkJob(dedupeKey);
                await revokeTokens(SCHEDULE);

                const result = await dispatchService().authorizeClaimedJobForDispatch(job);

                expect(result).toEqual({ kind: "stale", reason: REVOKED_REASON });
                expect(await rowOf(job.id)).toMatchObject({ status: "canceled", claim_token: null, cancel_reason: REVOKED_REASON });
            },
        );

        it.each([["a manual job", MANUAL_KEY], ["an agent-sms-retry job", RETRY_KEY]])(
            "%s with an active token dispatches as before",
            async (_label, dedupeKey) => {
                const job = await seedLinkJob(dedupeKey);

                const result = await dispatchService().authorizeClaimedJobForDispatch(job);

                expect(result).toEqual({ kind: "allow" });
                expect(await rowOf(job.id)).toMatchObject({ status: "dispatching", claim_token: "claim-processing" });
            },
        );

        it("a retry created from a failed source AFTER the revoke is canceled (revoke does not touch failed sources)", async () => {
            const source = await seedLinkJob(`${RULE}:schedule:${SCHEDULE}:primary:manual:00000000-0000-4000-8000-0000000000a1`, "failed");
            await linkService(repository).revoke(SCHEDULE);
            expect(await statusOf(source.id)).toBe("failed");
            const retry = await seedLinkJob(RETRY_KEY);

            const result = await dispatchService().authorizeClaimedJobForDispatch(retry);

            expect(result).toMatchObject({ kind: "stale" });
            expect(await statusOf(retry.id)).toBe("canceled");
        });

        it("a token of another schedule, or one that is missing, does not satisfy the fence", async () => {
            await db.$executeRaw`UPDATE service_record_token SET schedule_id = ${OTHER_SCHEDULE} WHERE link_token_hash = 'same-link'`;
            const otherSchedule = await seedLinkJob(RETRY_KEY);
            const missing = await seedLinkJob(`${RULE}:schedule:${SCHEDULE}:primary:manual:00000000-0000-4000-8000-0000000000a2`, "processing", "https://mobile.test/service-record/nope");
            const unreadable = await seedLinkJob(`${RULE}:schedule:${SCHEDULE}:primary:manual:00000000-0000-4000-8000-0000000000a3`, "processing", null);

            for (const job of [otherSchedule, missing, unreadable]) {
                expect(await dispatchService().authorizeClaimedJobForDispatch(job)).toMatchObject({ kind: "stale" });
                expect(await statusOf(job.id)).toBe("canceled");
            }
        });

        it("authorization and revoke racing for one processing job settle without a deadlock", async () => {
            const job = await seedLinkJob(MANUAL_KEY);

            const [authorization, revoke] = await Promise.all([
                settle(dispatchService().authorizeClaimedJobForDispatch(job)),
                settle(linkService(repository).revoke(SCHEDULE)),
            ]);

            expect(revoke).toEqual({ ok: true, value: undefined });
            expect(authorization.ok).toBe(true);
            // Either the revoke cancelled the claim first (authorization lost), or the
            // authorization committed first and the revoke reported it in flight.
            expect(["canceled", "dispatching"]).toContain(await statusOf(job.id));
            expect(await allTokensInactive()).toBe(true);
        });
    });
});
