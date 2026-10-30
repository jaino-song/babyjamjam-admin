import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import {
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SystemSettingService } from "application/services/system-setting.service";
import { MESSAGE_AUTOMATION_PARENT_DISABLED_REASON } from "application/services/message-automation-activation.service";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    MESSAGE_CRON_BRANCH_ID,
    MESSAGE_CRON_OWNER_USER_ID,
    type MessageCronHarness,
    bootMessageCronHarness,
} from "../helpers/message-automation-cron.helper";
import { ScriptedAligoStub } from "../helpers/scripted-aligo.stub";

/**
 * Dispatch happy path + gates (real DB, scripted Aligo stub).
 *
 * Asserts read Postgres rows via prisma; the stub only supplies call counts.
 *
 * 1. End-to-end tick — a client created over HTTP with greeting automation
 *    enabled materializes a CLIENT_GREETING trigger job through the production
 *    provisioning path (client intent claim → ensureDefaultRulesForBranch →
 *    syncClientRulesForClient); backdating it past the due window and
 *    dispatching sends exactly one SMS and writes a terminal message_log row
 *    (status sent / provider accepted / aligoMid / carrierCheckDueAt).
 * 2. An idempotent second dispatch tick sends nothing more.
 * 3. The due query takes the 100 OLDEST pending rows (scheduledFor asc): a
 *    >100 pending backlog leaves the 5 newest pending; a second tick drains
 *    them. Sends are real (scripted-accept stub); elapsed time is logged.
 * 4. The standby:true lease knob holds no scheduler lease and dispatch is a
 *    no-op even with a due job present.
 * 5. Two concurrent dispatch tick calls hit ONE MessageTriggerSchedulerService
 *    instance, whose SchedulerExecutionGuard admits only the first runner:
 *    one send, one log, job sent.
 * 6. The branch `trigger-dispatch` gate inside dispatchDueJobs keeps a due
 *    automatic job pending with zero provider calls while the setting row is
 *    off, and the SAME job sends once the row is back on. (The gate is
 *    exercised at row level because the public setter additionally runs the
 *    disable/enable fence — see 7 — which makes "stays pending" unobservable
 *    through the API.)
 * 7. The SystemSettingService setter fences automation off: its guarded
 *    transaction cancels every pending automatic branch job on disable AND on
 *    re-enable (MessageAutomationActivationService.cancelMutableJobs), so a
 *    due automatic job is canceled, never sent, and re-enable sends nothing.
 *    The brief's "re-enable and it sends" holds for the gate (test 6), not
 *    through the setter's fence; this divergence is asserted as production
 *    semantics, not patched.
 *
 * The setter-fence test also stamps branch rules inactive/jobsStale; afterAll
 * restores the disturbed system_setting row and rule/override state so
 * another spec file in this directory never inherits a closed automation
 * parent.
 *
 * SAFETY: boots the real module graph and mutates the DB — must not run
 * without the gated vendor stub. ScheduleModule.forRoot() is not in the
 * harness graph, so no cron timer fires on its own: every tick is a manual
 * call of the decorated scheduler wrappers (never
 * MessageTriggerService.dispatchDueJobs directly).
 */

const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;

const BRANCH_ID = MESSAGE_CRON_BRANCH_ID;
const RUN = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
const GREETING_TEMPLATE = MessageTriggerTemplateKey.CLIENT_GREETING;
const TRIGGER_DISPATCH_POLICY_KEY = `branch:${BRANCH_ID}:message_policy:trigger-dispatch:enabled`;

describeE2E("message-automation cron dispatch happy path and gates (real DB)", () => {
    let harness: MessageCronHarness;
    let standbyHarness: MessageCronHarness | undefined;
    let prisma: PrismaService;
    let stub: ScriptedAligoStub;
    let standbyStub: ScriptedAligoStub;

    let clientId: number | undefined;
    let clientPhoneDigits = "";
    let greetingJobId: string | undefined;
    let greetingRuleId: string | undefined;

    let batchJobIds: string[] = [];
    const batchElapsedMs = { firstTick: 0, secondTick: 0 };

    const trackedRuleIds: string[] = [];
    const trackedClientIds: number[] = [];

    /** Disturbed state captured before the policy test, restored in afterAll. */
    let policySettingSnapshot: { value: string } | undefined;
    let ruleStateSnapshot: Array<{ id: string; isActive: boolean; jobsStale: boolean }> = [];
    let overrideStateSnapshot: Array<{ branchId: string; ruleId: string; isActive: boolean }> = [];

    const toDigits = (value: string): string => value.replace(/\D/g, "");

    beforeAll(async () => {
        stub = new ScriptedAligoStub();
        harness = await bootMessageCronHarness({ aligo: stub });
        prisma = harness.prisma;

        // A client created over HTTP with greeting automation enabled: the
        // create transaction persists a durable intent row; the post-commit
        // fulfiller provisions the branch default CLIENT_GREETING rule and
        // materializes the greeting job synchronously. Re-createdper-run
        // unique phone keeps the shared DB collision-free.
        clientPhoneDigits = `0109${`${Date.now()}`.slice(-7)}`;
        const createRes = await harness.http().post("/clients").send({
            name: `cron-dispatch-greeting-${RUN}`,
            phone: `${clientPhoneDigits.slice(0, 3)}-${clientPhoneDigits.slice(3, 7)}-${clientPhoneDigits.slice(7)}`,
            voucherClient: false,
            breastPump: false,
            applyMessageAutomation: true,
            suppressGreetingSms: false,
        });
        expect(createRes.status).toBe(201);
        expect(typeof createRes.body.id).toBe("number");
        clientId = createRes.body.id as number;
        trackedClientIds.push(clientId);

        // tick.intents must be able to materialize the job even if the
        // synchronous fulfillment failed: releaseClientIntent re-arms a
        // failed intent +5min, so pull its claim window into the past first.
        await prisma.message_trigger_job.updateMany({
            where: {
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                clientId,
            },
            data: { nextAttemptAt: new Date(Date.now() - 60_000) },
        });
        await harness.tick.intents(new Date());

        // The materialized job (provisioned by the production path) and its rule.
        const greetingJob = await prisma.message_trigger_job.findFirstOrThrow({
            where: {
                clientId,
                employeeScheduleId: null,
                templateKey: GREETING_TEMPLATE,
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
            },
        });
        greetingJobId = greetingJob.id;
        greetingRuleId = greetingJob.ruleId;
        if (!trackedRuleIds.includes(greetingRuleId)) trackedRuleIds.push(greetingRuleId);
    });

    afterAll(async () => {
        // Restore the automation parent + rule/override state the fence test
        // disturbed, BEFORE deleting rows so the cleanup itself runs on a
        // normally-configured branch.
        if (prisma) {
            try {
                if (policySettingSnapshot !== undefined) {
                    await prisma.system_setting.upsert({
                        where: { key: TRIGGER_DISPATCH_POLICY_KEY },
                        create: { key: TRIGGER_DISPATCH_POLICY_KEY, value: policySettingSnapshot.value },
                        update: { value: policySettingSnapshot.value },
                    });
                } else {
                    await prisma.system_setting.deleteMany({ where: { key: TRIGGER_DISPATCH_POLICY_KEY } });
                }
                for (const rule of ruleStateSnapshot) {
                    await prisma.message_trigger_rule.update({
                        where: { id: rule.id },
                        data: { isActive: rule.isActive, jobsStale: rule.jobsStale },
                    });
                }
                for (const override of overrideStateSnapshot) {
                    await prisma.message_trigger_rule_branch_override.upsert({
                        where: { branchId_ruleId: { branchId: override.branchId, ruleId: override.ruleId } },
                        create: override,
                        update: { isActive: override.isActive },
                    });
                }
            } catch (error) {
                // Restore is best-effort: the disposable DB is dropped per run.
                console.warn("[10-dispatch.e2e] policy/rule restore failed:", error);
            }

            // Throwaway rows first (logs → jobs → rules → clients; FK-safe).
            const allJobIds = [greetingJobId, ...batchJobIds].filter(
                (value): value is string => value !== undefined,
            );
            if (allJobIds.length > 0) {
                await prisma.message_log
                    .deleteMany({ where: { triggerJobId: { in: allJobIds } } })
                    .catch(() => undefined);
            }
            if (trackedClientIds.length > 0 || trackedRuleIds.length > 0) {
                await prisma.message_trigger_job
                    .deleteMany({
                        where: {
                            OR: [
                                ...(trackedClientIds.length > 0
                                    ? [{ clientId: { in: trackedClientIds } }]
                                    : []),
                                ...(trackedRuleIds.length > 0
                                    ? [{ ruleId: { in: trackedRuleIds } }]
                                    : []),
                            ],
                        },
                    })
                    .catch(() => undefined);
            }
            if (trackedRuleIds.length > 0) {
                await prisma.message_trigger_rule
                    .deleteMany({ where: { id: { in: trackedRuleIds } } })
                    .catch(() => undefined);
            }
            if (trackedClientIds.length > 0) {
                await prisma.client
                    .deleteMany({ where: { id: { in: trackedClientIds } } })
                    .catch(() => undefined);
            }
        }
        // Standby harness first (own module graph), then the main app.
        await standbyHarness?.close().catch(() => undefined);
        await harness?.close().catch(() => undefined);
    });

    const insertDuePendingJob = async (
        label: string,
        minutesAgo: number,
    ): Promise<{ id: string; status: string }> => {
        // Minimal required columns of an automatic CLIENT recipient job on the
        // provisioned greeting rule; nextAttemptAt null keeps it claimable.
        return prisma.message_trigger_job.create({
            select: { id: true, status: true },
            data: {
                branchId: BRANCH_ID,
                ruleId: greetingRuleId!,
                status: "pending",
                scheduledFor: new Date(Date.now() - minutesAgo * 60_000),
                clientId: clientId!,
                recipientType: MessageTriggerRecipientType.CLIENT,
                recipientPhone: clientPhoneDigits,
                templateKey: GREETING_TEMPLATE,
                dedupeKey: `cron-dispatch-${label}-${RUN}-${Date.now()}`,
                // templateVariables must exist for the agent-automation delivery
                // gate's source-payload binding (agentAutomationSourcePayload);
                // without a seal and without a task reference the job resolves
                // as "legacy" authority and dispatches.
                payload: { templateVariables: {} },
                nextAttemptAt: null,
                canceledByUser: false,
                attempts: 0,
            },
        });
    };

    const readJob = async (
        jobId: string,
    ): Promise<{ id: string; status: string; cancelReason: string | null; sentAt: Date | null }> => {
        const row = await prisma.message_trigger_job.findUnique({
            where: { id: jobId },
            select: { id: true, status: true, cancelReason: true, sentAt: true },
        });
        expect(row).not.toBeNull();
        return row!;
    };

    it("1. dispatches a due, backdated greeting job once, end-to-end", async () => {
        expect(harness.lease.holdsLease()).toBe(true);

        // Backdate to now-1h so the next manual dispatch tick is due (the job
        // materialized at the create timestamp, still inside its minute).
        await harness.backdate(greetingJobId!, new Date(Date.now() - 60 * 60_000));

        const callsBefore = stub.sendCalls.length;
        await harness.tick.dispatch();

        const job = await readJob(greetingJobId!);
        expect(job.status).toBe("sent");
        expect(job.sentAt).not.toBeNull();

        const logs = await prisma.message_log.findMany({
            where: { triggerJobId: greetingJobId! },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0]?.status).toBe("sent");
        expect(logs[0]?.provider).toBe("aligo_sms");
        expect(logs[0]?.providerAcceptanceState).toBe("accepted");
        expect(logs[0]?.aligoMid).not.toBeNull();
        expect(logs[0]?.carrierCheckDueAt).not.toBeNull();

        // Stub only totals calls; digits-only receiver proves the row.
        expect(stub.sendCalls.length - callsBefore).toBe(1);
        expect(toDigits(stub.sendCalls[stub.sendCalls.length - 1]!.receiver)).toBe(clientPhoneDigits);
    });

    it("2. a second dispatch tick is idempotent", async () => {
        await harness.tick.dispatch();

        const logCount = await prisma.message_log.count({ where: { triggerJobId: greetingJobId! } });
        expect(logCount).toBe(1);
        expect(stub.sendCalls.length).toBe(1);
        expect((await readJob(greetingJobId!)).status).toBe("sent");
    });

    it("3. orders a >100 due backlog: the 100 oldest leave pending, the 5 newest remain", async () => {
        // 105 pending rows: distinct scheduledFor spaced by minutes, every
        // one in the past, same rule/client, distinct dedupe keys. scheduledFor
        // is strictly distinct so the (scheduledFor, createdAt) due-query
        // ordering can never interleave. Index 0 = oldest (deepest past).
        const base = Date.now() - 3 * 60 * 60_000;
        const rows: Prisma.message_trigger_jobCreateManyInput[] = [];
        for (let index = 0; index < 105; index += 1) {
            rows.push({
                branchId: BRANCH_ID,
                ruleId: greetingRuleId!,
                status: "pending",
                scheduledFor: new Date(base + index * 60_000), // all < now
                nextAttemptAt: null,
                clientId: clientId!,
                recipientType: MessageTriggerRecipientType.CLIENT,
                recipientPhone: clientPhoneDigits,
                templateKey: GREETING_TEMPLATE,
                dedupeKey: `cron-dispatch-batch-${RUN}-${index}`,
                payload: { recipientName: `batch-${RUN}-${index}`, templateVariables: {} },
                canceledByUser: false,
                attempts: 0,
            });
        }
        const created = await prisma.message_trigger_job.createManyAndReturn({
            data: rows,
            select: { id: true, dedupeKey: true },
        });
        batchJobIds = created
            .map((row) => ({ id: row.id, index: Number(row.dedupeKey.split("-").pop()) }))
            .sort((left, right) => left.index - right.index)
            .map((row) => row.id);
        expect(batchJobIds).toHaveLength(105);
        expect(new Set(batchJobIds).size).toBe(105);

        const before = await prisma.message_trigger_job.findMany({
            where: { id: { in: batchJobIds } },
            select: { status: true },
        });
        expect(before).toHaveLength(105);
        expect(before.every((row) => row.status === "pending")).toBe(true);

        const callsBefore = stub.sendCalls.length;
        const firstTickStart = Date.now();
        await harness.tick.dispatch();
        batchElapsedMs.firstTick = Date.now() - firstTickStart;

        // Exactly the 100 OLDEST (indexes 0..99) are no longer pending;
        // the 5 newest (indexes 100..104) remain pending.
        const statusById = new Map(
            (await prisma.message_trigger_job.findMany({
                where: { id: { in: batchJobIds } },
                select: { id: true, status: true },
            })).map((row) => [row.id, row.status] as const),
        );
        for (let index = 0; index < 105; index += 1) {
            expect(statusById.get(batchJobIds[index]!)).toBe(index < 100 ? "sent" : "pending");
        }
        expect(stub.sendCalls.length - callsBefore).toBe(100);

        const secondTickStart = Date.now();
        await harness.tick.dispatch();
        batchElapsedMs.secondTick = Date.now() - secondTickStart;
        console.log(
            `[10-dispatch.e2e] batch ticks (real sends): first (100) ${batchElapsedMs.firstTick}ms, `
            + `second (5) ${batchElapsedMs.secondTick}ms, total ${batchElapsedMs.firstTick + batchElapsedMs.secondTick}ms`,
        );

        const after = await prisma.message_trigger_job.findMany({
            where: { id: { in: batchJobIds } },
            select: { status: true },
        });
        expect(after.every((row) => row.status === "sent")).toBe(true);
        expect(stub.sendCalls.length - callsBefore).toBe(105);
    }, 120_000);

    it("4. a standby app holds no lease and dispatches nothing, even with a due job", async () => {
        standbyStub = new ScriptedAligoStub();
        standbyHarness = await bootMessageCronHarness({ aligo: standbyStub, standby: true });

        // Identity of the overridden vendor port (as the smoke spec asserts):
        // "sends nothing" must not pass vacuously on a real provider port.
        expect(standbyHarness.app.get(ALIGO_SMS_API_PORT, { strict: false })).toBe(standbyStub);
        expect(standbyHarness.lease.holdsLease()).toBe(false);

        const dueJob = await insertDuePendingJob("standby", 91);
        await standbyHarness.tick.dispatch();

        expect((await readJob(dueJob.id)).status).toBe("pending");
        expect(standbyStub.sendCalls).toHaveLength(0);
        expect(standbyStub.deliveryDetailCalls).toHaveLength(0);

        // Remove the row so it never becomes due for the main harness's
        // dispatch ticks of later tests (tests 3+ assert exact send deltas).
        await prisma.message_trigger_job.delete({ where: { id: dueJob.id } });
    });

    it("5. concurrent dispatch ticks share one execution guard: one send, one log", async () => {
        const dueJob = await insertDuePendingJob("guard", 121);
        const callsBefore = stub.sendCalls.length;

        // Both tick calls resolve the SAME MessageTriggerSchedulerService
        // instance, hence the same SchedulerExecutionGuard: the second
        // tryStart returns null and its tick becomes a no-op.
        await Promise.all([harness.tick.dispatch(), harness.tick.dispatch()]);

        expect((await readJob(dueJob.id)).status).toBe("sent");
        expect(await prisma.message_log.count({ where: { triggerJobId: dueJob.id } })).toBe(1);
        expect(stub.sendCalls.length - callsBefore).toBe(1);
    });

    it("6. the branch trigger-dispatch gate keeps a due automatic job pending while off, and the same job sends once it re-opens", async () => {
        // Snapshot the setting row (restored in afterAll) before row surgery.
        policySettingSnapshot = (await prisma.system_setting.findUnique({
            where: { key: TRIGGER_DISPATCH_POLICY_KEY },
            select: { value: true },
        })) ?? undefined;

        const dueJob = await insertDuePendingJob("policy-off", 151);
        const callsBefore = stub.sendCalls.length;

        // The gate (findDuePendingSystemScope → isAutomaticMessageJob →
        // getMessagePolicyEnabled in dispatchDueJobs) reads exactly this row,
        // so set it off the way the service would without the setter's
        // disable-fence transaction: the public setter cancels every pending
        // automatic branch job on both transitions (see test 7), which makes
        // "stays pending" unobservable through that API.
        await prisma.system_setting.upsert({
            where: { key: TRIGGER_DISPATCH_POLICY_KEY },
            create: { key: TRIGGER_DISPATCH_POLICY_KEY, value: "false" },
            update: { value: "false" },
        });
        await harness.tick.dispatch();

        // Gate: the due automatic job survives the tick still pending, and no
        // provider call happened.
        expect((await readJob(dueJob.id)).status).toBe("pending");
        expect(stub.sendCalls.length - callsBefore).toBe(0);

        // Re-open dispatch: restore the setting row and the SAME job sends.
        await prisma.system_setting.upsert({
            where: { key: TRIGGER_DISPATCH_POLICY_KEY },
            create: { key: TRIGGER_DISPATCH_POLICY_KEY, value: "true" },
            update: { value: "true" },
        });
        await harness.tick.dispatch();

        expect((await readJob(dueJob.id)).status).toBe("sent");
        expect(await prisma.message_log.count({ where: { triggerJobId: dueJob.id } })).toBe(1);
        expect(stub.sendCalls.length - callsBefore).toBe(1);
    });

    it("7. the SystemSettingService setter fences automation off: pending automatic jobs are canceled on disable, zero sends", async () => {
        // Snapshot the state this fence test disturbs so afterAll restores an
        // enabled parent, active rules and clean stamps for other spec files
        // sharing this DB in the runner's file order.
        policySettingSnapshot = (await prisma.system_setting.findUnique({
            where: { key: TRIGGER_DISPATCH_POLICY_KEY },
            select: { value: true },
        })) ?? undefined;
        ruleStateSnapshot = await prisma.message_trigger_rule.findMany({
            where: { OR: [{ branchId: BRANCH_ID }, { branchId: null }] },
            select: { id: true, isActive: true, jobsStale: true },
        });
        overrideStateSnapshot = await prisma.message_trigger_rule_branch_override.findMany({
            where: { rule: { branchId: null } },
            select: { branchId: true, ruleId: true, isActive: true },
        });

        const setting = harness.app.get(SystemSettingService, { strict: false });
        const actor = { userId: MESSAGE_CRON_OWNER_USER_ID, branchRole: "owner" };
        const callsBefore = stub.sendCalls.length;

        const dueJob = await insertDuePendingJob("policy-fence", 151);
        await setting.setMessageSettingsPolicyEnabled(BRANCH_ID, "trigger-dispatch", false, actor);

        // The guarded disable transaction (normalizeBranchOff →
        // cancelMutableJobs) cancels every pending automatic job of the
        // branch — including the just-inserted due job — so nothing can send:
        // zero provider calls either way.
        expect((await readJob(dueJob.id)).status).toBe("canceled");
        expect((await readJob(dueJob.id)).cancelReason).toBe(MESSAGE_AUTOMATION_PARENT_DISABLED_REASON);
        expect(stub.sendCalls.length - callsBefore).toBe(0);

        // Re-enable: production normalizes branch-off once more inside the
        // reopen transaction (jobs are already canceled), then flips the
        // parent on. Nothing pending exists to send, so the provider count
        // stays flat — the fenced did not resurrect.
        await setting.setMessageSettingsPolicyEnabled(BRANCH_ID, "trigger-dispatch", true, actor);
        expect((await readJob(dueJob.id)).status).toBe("canceled");
        expect(stub.sendCalls.length - callsBefore).toBe(0);
    });
});
