import { parseAgentAutomationTaskCommitReference } from "application/agent/agent-automation-storage.schema";
import { createHash, randomUUID } from "node:crypto";
import { ClientWriteAgentCapabilitiesProvider } from "application/usecases/client/client-write-agent-capabilities.provider";
import { fulfillClientMessageAutomationIntent } from "application/services/client-message-automation-intent-fulfiller";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { createAgentAutomationQuestion } from "application/agent/agent-automation-question";
import { parseTaskAutomationArtifact } from "application/agent/agent-task-automation-artifact";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { MESSAGE_CRON_OWNER_USER_ID } from "../helpers/message-automation-cron.helper";
import type { AgentContext } from "application/agent/agent-context";
import { Prisma } from "@prisma/client";
import { ConfigService } from "@nestjs/config";

import { MessageTriggerService } from "application/services/message-trigger.service";
import {
    getClientAutomationIntentDedupeKey,
    MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    getServiceRecordLinkScheduledFor,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
} from "domain/constants/service-record-link-message";
import { normalizePhone } from "domain/utils/normalize-phone";
import { ScriptedAligoStub } from "../helpers/scripted-aligo.stub";
import {
    MESSAGE_CRON_BRANCH_ID,
    type MessageCronHarness,
    bootMessageCronHarness,
} from "../helpers/message-automation-cron.helper";

/**
 * Task 2.4 — job-producing crons on real Postgres:
 * `reconcilePendingIntents`, `syncUpcomingDueDatesToStartDates` and
 * `repairMissingJobs`. Every flow drives the crons through the harness's
 * decorated `tick.*` wrappers and asserts on Postgres rows; flows 1, 6 and 8
 * finish by proving the produced jobs are actually dispatchable with one
 * `tick.dispatch()` that writes `sent` message_log rows and Aligo calls.
 */
const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;
const RUN = `${Date.now()}`.slice(-7);

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

/** Date-only `YYYY-MM-DD` n KST days from now — the same shape `@db.Date` stores. */
function kstDate(offsetDays: number): string {
    const parts = new Map(KST_DATE_FORMATTER.formatToParts(new Date()).map((part) => [part.type, part.value]));
    const date = new Date(Date.UTC(Number(parts.get("year")), Number(parts.get("month")) - 1, Number(parts.get("day"))));
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
}

function digitsOnly(value: string): string {
    return value.replace(/\D/g, "");
}

describeE2E("job-producing message-automation crons (real DB)", () => {
    let harness: MessageCronHarness;
    let prisma: MessageCronHarness["prisma"];
    let triggers: MessageTriggerService;
    let aligoStub: ScriptedAligoStub;

    // Unique-per-run phones, canonical hyphenated form (safeguard spec shape):
    // a 1-digit tag keeps every number 11 digits.
    // Keep flow 6b distinct from flow 6 after phone normalization strips letters.
    const clientPhone = (tag: string) => tag === "6b" ? `010-76${RUN.slice(1, 8)}` : `010-5${tag}${RUN.slice(1, 8)}`;
    const employeePhone = (tag: string) => `010-6${tag}${RUN.slice(1, 8)}`;

    // Cleanup bookkeeping (FK-safe order handled in afterAll).
    const branchIds = new Set<string>();
    const employeeIds = new Set<number>();
    const clientIds = new Set<number>();
    const scheduleIds = new Set<number>();
    const producerRuleIds: string[] = [];
    const producerGroupIds: string[] = [];
    const caregiverSessionIds: string[] = [];
    const intentRuleId = MESSAGE_AUTOMATION_INTENT_RULE_ID;

    beforeAll(async () => {
        aligoStub = new ScriptedAligoStub();
        harness = await bootMessageCronHarness({ aligo: aligoStub });
        prisma = harness.prisma;
        triggers = harness.app.get(MessageTriggerService, { strict: false });

        // The e2e seed stores no system templates. The SERVICE_RECORD_LINK row is
        // required for the link SMS render gate (same upsert as the safeguard
        // spec); CLIENT_GREETING is stored for the same reason: without a stored
        // row the send render can never match a stamped template version.
        const greetingKey = MessageTriggerTemplateKey.CLIENT_GREETING;
        await prisma.system_template.upsert({
            where: { templateKey: greetingKey },
            update: {},
            create: { id: "tpl-client-greeting", templateKey: greetingKey, content: "고객 인사 (E2E)" },
        });
        const linkKey = MessageTriggerTemplateKey.SERVICE_RECORD_LINK;
        await prisma.system_template.upsert({
            where: { templateKey: linkKey },
            update: {},
            create: { id: "tpl-service-record-link", templateKey: linkKey, content: "제공기록지 링크 (E2E)" },
        });

        await prisma.branch.updateMany({
            where: { id: MESSAGE_CRON_BRANCH_ID, smsSenderApprovalStatus: { not: "approved" } },
            data: { smsSenderApprovalStatus: "approved" },
        });
    });

    afterEach(() => jest.useRealTimers());

    afterAll(async () => {
        for (const clientId of clientIds) {
            await prisma.message_log.deleteMany({ where: { clientId } }).catch(() => undefined);
            await prisma.message_trigger_job.deleteMany({ where: { clientId } }).catch(() => undefined);
            await prisma.message_trigger_job.deleteMany({ where: { employeeScheduleId: { in: [...scheduleIds] } } }).catch(() => undefined);
            await prisma.service_record_token.deleteMany({ where: { scheduleId: { in: [...scheduleIds] } } }).catch(() => undefined);
            await prisma.eformsign_doc.deleteMany({ where: { employeeScheduleId: { in: [...scheduleIds] } } }).catch(() => undefined);
            await prisma.service_record.deleteMany({ where: { scheduleId: { in: [...scheduleIds] } } }).catch(() => undefined);
            await prisma.employee_schedule.deleteMany({ where: { clientId } }).catch(() => undefined);
            await prisma.client.deleteMany({ where: { id: clientId } }).catch(() => undefined);
        }
        for (const ruleId of producerRuleIds) {
            await prisma.message_trigger_job.deleteMany({ where: { ruleId } }).catch(() => undefined);
            await prisma.message_trigger_rule.deleteMany({ where: { id: ruleId } }).catch(() => undefined);
        }
        for (const sessionId of caregiverSessionIds) {
            await prisma.agent_action.deleteMany({ where: { sessionId } });
            await prisma.agent_task.deleteMany({ where: { sessionId } });
            await prisma.agent_session.deleteMany({ where: { id: sessionId } });
        }
        await prisma.message_trigger_rule_group.deleteMany({ where: { id: { in: producerGroupIds } } });
        await prisma.employee.deleteMany({ where: { id: { in: [...employeeIds] } } }).catch(() => undefined);
        await prisma.branch.deleteMany({ where: { id: { in: [...branchIds] } } });
        await harness?.close();
    });

    /**
     * Section A step 1: HTTP-create a client while the post-commit automation
     * sync fails once (the exact post-commit-failure path the durable intent
     * exists for), so the intent marker row survives the create.
     */
    async function createClientWithStrandedIntent(tag: string): Promise<number> {
        const syncSpy = jest
            .spyOn(triggers, "syncClientRulesForClient")
            .mockRejectedValueOnce(new Error("e2e producer-40 client automation sync fault"));
        try {
            const created = await harness
                .http()
                .post("/clients")
                .send({
                    name: `생산자-A-고객${tag}-${RUN}`,
                    phone: clientPhone(tag),
                    voucherClient: false,
                    breastPump: false,
                    applyMessageAutomation: true,
                    suppressGreetingSms: false,
                });
            if (created.status !== 201) {
                throw new Error(`client create failed ${created.status}: ${JSON.stringify(created.body)}`);
            }
            expect(created.status).toBe(201);
            clientIds.add(created.body.id as number);
            return created.body.id as number;
        } finally {
            syncSpy.mockRestore();
        }
    }

    /** Plain HTTP create without the automation side effects (no intent written). */
    async function createSilentClient(
        tag: string,
        options: {
            dueDate?: string;
            startDate?: string;
            endDate?: string;
            applyMessageAutomation?: boolean;
            smsAutomationEnabled?: boolean;
        } = {},
    ): Promise<number> {
        const created = await harness
            .http()
            .post("/clients")
            .send({
                name: `생산자-고객${tag}-${RUN}`,
                phone: clientPhone(tag),
                voucherClient: false,
                careCenter: false,
                breastPump: false,
                applyMessageAutomation: options.applyMessageAutomation ?? false,
                // An explicit true wins over `applyMessageAutomation` for the
                // persisted per-client SMS switch (client.service.ts:1343-1345),
                // which is what later CLIENT-recipient dispatches gate on.
                ...(options.smsAutomationEnabled === undefined ? {} : { smsAutomationEnabled: options.smsAutomationEnabled }),
                ...(options.dueDate === undefined ? {} : { dueDate: options.dueDate }),
                ...(options.startDate === undefined ? {} : { startDate: options.startDate }),
                ...(options.endDate === undefined ? {} : { endDate: options.endDate }),
            });
        if (created.status !== 201) {
            throw new Error(`client create failed ${created.status}: ${JSON.stringify(created.body)}`);
        }
        expect(created.status).toBe(201);
        clientIds.add(created.body.id as number);
        return created.body.id as number;
    }

    /** Copy of the safeguard spec's registerConfirmedClient (primary employee flag). */
    async function registerConfirmedClient(clientTag: string, employeeTag: string, smsAutomationEnabled: boolean): Promise<{
        clientId: number;
        employeeId: number;
        scheduleId: number;
    }> {
        const employee = await prisma.employee.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                name: `생산자-A-관리사${employeeTag}-${RUN}`,
                phone: employeePhone(employeeTag),
                grade: "스탠다드",
                smsAutomationEnabled,
            },
        });
        employeeIds.add(employee.id);
        const created = await harness
            .http()
            .post("/clients")
            .send({
                name: `생산자-C-고객${clientTag}-${RUN}`,
                phone: clientPhone(clientTag),
                primaryEmployeeId: employee.id,
                voucherClient: false,
                duration: 10,
                fullPrice: "1,000,000원",
                startDate: kstDate(0),
                endDate: kstDate(16),
                breastPump: false,
                careCenter: false,
                serviceStatus: "active",
                applyMessageAutomation: false,
                suppressGreetingSms: true,
            });
        if (created.status !== 201) {
            throw new Error(`client create failed ${created.status}: ${JSON.stringify(created.body)}`);
        }
        expect(created.status).toBe(201);
        clientIds.add(created.body.id as number);
        const schedule = await prisma.employee_schedule.findFirstOrThrow({
            where: { clientId: created.body.id as number, primaryEmployeeId: employee.id, branchId: MESSAGE_CRON_BRANCH_ID, replaced: false },
            orderBy: { id: "desc" },
            select: { id: true },
        });
        scheduleIds.add(schedule.id);
        return { clientId: created.body.id as number, employeeId: employee.id, scheduleId: schedule.id };
    }

    /** Mirror of message-automation-intent-writer's own rule bootstrap (the FK). */
    async function ensureIntentRuleRow(): Promise<void> {
        await prisma.message_trigger_rule.upsert({
            where: { id: intentRuleId },
            create: {
                id: intentRuleId,
                branchId: null,
                name: "메시지 자동화 생성 복구 표식",
                isActive: false,
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                isDefault: false,
                jobsStale: false,
            },
            update: {},
        });
    }

    interface HandwrittenIntent {
        id: string;
        branchId: string | null;
        clientId: number | null;
        scheduleId?: number | null;
        payload: Prisma.InputJsonObject;
        attempts?: number;
        nextAttemptAt?: Date | null;
        scheduledFor?: Date;
    }

    function clientIntentPayload(clientId: number, extraVariables: Record<string, string> = {}): Prisma.InputJsonObject {
        return {
            clientId,
            memberId: `client:${clientId}`,
            recipientName: "메시지 자동화 복구",
            recipientPhone: "",
            templateVariables: {
                intentKind: "client",
                includePast: "true",
                suppressGreeting: "false",
                replaceExisting: "false",
                ...extraVariables,
            },
        };
    }

    async function insertIntentRow(params: HandwrittenIntent): Promise<void> {
        await ensureIntentRuleRow();
        await prisma.message_trigger_job.create({
            data: {
                branchId: params.branchId,
                ruleId: intentRuleId,
                status: "failed",
                scheduledFor: params.scheduledFor ?? new Date(),
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
                clientId: params.clientId,
                employeeScheduleId: params.scheduleId ?? null,
                recipientType: MessageTriggerRecipientType.CLIENT,
                recipientPhone: null,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                dedupeKey: params.id,
                payload: params.payload,
                attempts: params.attempts ?? 0,
                nextAttemptAt: params.nextAttemptAt ?? null,
            },
        });
    }

    /** full-flow.e2e.spec.ts:457-466 precedent: the failure paths only ever release
     * with a future retry delay, so a tick must see the marker in the due window. */
    async function markIntentDue(dedupeKey: string): Promise<void> {
        await prisma.message_trigger_job.update({
            where: { dedupeKey },
            data: { nextAttemptAt: new Date(Date.now() - 60_000) },
        });
    }

    const clientGenericJobs = async (clientId: number) => prisma.message_trigger_job.findMany({
        where: { clientId, employeeScheduleId: null, ruleId: { not: intentRuleId } },
        orderBy: { id: "asc" },
        select: { id: true, ruleId: true, templateKey: true, status: true, scheduledFor: true },
    });

    const linkJobsForSchedule = async (scheduleId: number) => prisma.message_trigger_job.findMany({
        where: { employeeScheduleId: scheduleId, ruleId: SERVICE_RECORD_LINK_RULE_ID },
        orderBy: { id: "asc" },
        select: { id: true, status: true, cancelReason: true, dedupeKey: true },
    });

    const sentLogsForClient = async (clientId: number) => prisma.message_log.findMany({
        where: { clientId, status: "sent" },
        select: { id: true, triggerJobId: true, receiver: true },
    });

    /** Backdate every pending job of one client, dispatch once, and prove the
     * send landed: one `sent` message_log per pending job and exact sendCalls
     * for this client's receivers (scoped, because one dispatch pass covers the
     * whole system scope and other specs' due rows may ride along). */
    async function dispatchAndAssertClientSends(clientId: number, expectedReceivers: string[]): Promise<void> {
        const pending = await prisma.message_trigger_job.findMany({
            where: { clientId, status: "pending" },
            select: { id: true },
        });
        expect(pending.length).toBeGreaterThan(0);
        for (const job of pending) {
            await harness.backdate(job.id, new Date(Date.now() - 60_000));
        }
        await harness.prepareFreshDispatchWindow();
        await harness.tick.dispatch();

        const logs = await sentLogsForClient(clientId);
        const sentJobIds = new Set(logs
            .map((log) => log.triggerJobId ?? "")
            .filter((id) => id.length > 0));
        expect(new Set(pending.map((job) => job.id))).toEqual(sentJobIds);

        const expectedDigits = new Set(expectedReceivers.map(digitsOnly));
        const actualCalls = [...aligoStub.sendCalls].filter((call) => expectedDigits.has(digitsOnly(String(call.receiver))));
        expect(actualCalls.map((call) => digitsOnly(String(call.receiver))).sort()).toEqual(
            [...expectedDigits].sort(),
        );
        expect(actualCalls.length).toBe(pending.length);
    }

    it("A1 (flow 1) fulfills a client intent into real dispatchable jobs and deletes the marker", async () => {
        const clientId = await createClientWithStrandedIntent("1");
        const intentKey = getClientAutomationIntentDedupeKey(MESSAGE_CRON_BRANCH_ID, clientId);

        // The create persisted the durable intent marker. Its post-commit
        // fulfillment claimed it (attempts 0 → 1), failed in
        // syncClientRulesForClient, and released it with the 5-minute retry
        // backoff — the released claim stays a `failed` marker row.
        const intentBefore = await prisma.message_trigger_job.findUniqueOrThrow({
            where: { dedupeKey: intentKey },
        });
        expect(intentBefore).toEqual(expect.objectContaining({
            branchId: MESSAGE_CRON_BRANCH_ID,
            ruleId: intentRuleId,
            status: "failed",
            cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
            canceledByUser: false,
            clientId,
            attempts: 1,
        }));
        expect(intentBefore.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
        expect((await clientGenericJobs(clientId)).length).toBe(0);

        // The reconcile's claim lease requires next_attempt_at <= clock time
        // (client-message-automation-intent-fulfiller.ts:48), so pull the
        // released marker into the due window (full-flow.e2e.spec.ts:454-466
        // precedent) and tick the cron (`tick.intents(now)`).
        await markIntentDue(intentKey);
        await harness.tick.intents(new Date());

        await expect(prisma.message_trigger_job.findUnique({ where: { dedupeKey: intentKey } }))
            .resolves.toBeNull();

        const jobs = await clientGenericJobs(clientId);
        expect(jobs.length).toBeGreaterThan(0);
        expect(jobs.map((job) => job.ruleId)).not.toContain(intentRuleId);
        // The intent row carries the client-greeting tuple; the produced jobs
        // must materialize that expectation.
        expect(new Set(jobs.map((job) => job.templateKey))).toContain(MessageTriggerTemplateKey.CLIENT_GREETING);
        expect(jobs.every((job) => job.status === "pending")).toBe(true);

        // One dispatch tick sends the produced jobs to the real Postgres log.
        await dispatchAndAssertClientSends(clientId, [clientPhone("1")]);
        expect((await prisma.message_trigger_job.findMany({
            where: { clientId, ruleId: { not: intentRuleId } },
            select: { status: true },
        })).every((job) => job.status === "sent")).toBe(true);
    }, 30_000);

    it("A2 (flow 2) re-claims an expired fulfiller claim and fulfills the intent", async () => {
        // The fulfiller leases a claim with `next_attempt_at = claimed_at + 10
        // minutes` and re-claims when that column is in the past
        // (client-message-automation-intent-fulfiller.ts:27-77). An owner
        // killed right after its lease write leaves attempts=1 (claim
        // promoted) with the 10-minute lease — the "claim fields" of the row.
        const clientId = await createSilentClient("2");
        const intentKey = getClientAutomationIntentDedupeKey(MESSAGE_CRON_BRANCH_ID, clientId);
        await insertIntentRow({
            id: intentKey,
            branchId: MESSAGE_CRON_BRANCH_ID,
            clientId,
            payload: clientIntentPayload(clientId),
            attempts: 1,
            // The 10-minute claim lease written by claimIntent, already expired.
            nextAttemptAt: new Date(Date.now() - 11 * 60_000),
            scheduledFor: new Date(Date.now() - 20 * 60_000),
        });

        await harness.tick.intents(new Date());

        const intentAfter = await prisma.message_trigger_job.findUnique({ where: { dedupeKey: intentKey } });
        expect(intentAfter).toBeNull(); // reclaimed and fulfilled; the marker is consumed
        const jobs = await clientGenericJobs(clientId);
        expect(jobs.length).toBeGreaterThan(0);
        expect(new Set(jobs.map((job) => job.templateKey))).toContain(MessageTriggerTemplateKey.CLIENT_GREETING);
    }, 30_000);

    it("A3 (flow 3) releases (keeps) the intent marker for an unapproved branch and creates no jobs", async () => {
        await ensureIntentRuleRow();
        const unapprovedBranch = await prisma.branch.create({
            data: {
                name: `생산자-미승인브랜치-${RUN}`,
                slug: `producer-40-${RUN}`,
                smsSenderApprovalStatus: "not_requested",
            },
        });
        branchIds.add(unapprovedBranch.id);
        const client = await prisma.client.create({
            data: {
                branchId: unapprovedBranch.id,
                name: `생산자-미승인고객-${RUN}`,
                phone: clientPhone("3"),
                phoneNormalized: normalizePhone(clientPhone("3")),
                voucherClient: false,
            },
        });
        clientIds.add(client.id);

        const intentKey = getClientAutomationIntentDedupeKey(unapprovedBranch.id, client.id);
        await insertIntentRow({
            id: intentKey,
            branchId: unapprovedBranch.id,
            clientId: client.id,
            payload: clientIntentPayload(client.id),
        });

        await harness.tick.intents(new Date());

        // The fulfiller claim updates the row even when the branch is not
        // approved (attempts back to 0, retry backoff), returns no claim and
        // never fulfills: the released marker survives the tick.
        const intentAfter = await prisma.message_trigger_job.findUniqueOrThrow({
            where: { dedupeKey: intentKey },
        });
        expect(intentAfter).toEqual(expect.objectContaining({
            ruleId: intentRuleId,
            status: "failed",
            cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
            canceledByUser: false,
            clientId: client.id,
            attempts: 0,
        }));
        expect(intentAfter.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());

        // Nothing was produced for the unapproved branch's client.
        expect(await prisma.message_trigger_job.count({
            where: { clientId: client.id, ruleId: { not: intentRuleId } },
        })).toBe(0);
    }, 30_000);

    it("A4 (flow 4) discards orphaned intents (deleted client / detached branch)", async () => {
        // (a) An intent whose client was deleted: the FK Client.onDelete=SetNull
        // flips client_id to null while the row keeps its version, and
        // fulfillCandidate discards `kind:"client"` markers with a null client.
        const clientId = await createSilentClient("4");
        const intentKey = getClientAutomationIntentDedupeKey(MESSAGE_CRON_BRANCH_ID, clientId);
        await insertIntentRow({
            id: intentKey,
            branchId: MESSAGE_CRON_BRANCH_ID,
            clientId,
            payload: clientIntentPayload(clientId),
        });
        await prisma.client.delete({ where: { id: clientId } });
        clientIds.delete(clientId);

        // (b) An intent with no branch at all (`!candidate.branchId` → discard).
        const detachedKey = `${intentRuleId}:branch:none:client:40-orphan-${RUN}`;
        await insertIntentRow({
            id: detachedKey,
            branchId: null,
            clientId: null,
            payload: clientIntentPayload(1),
        });

        await harness.tick.intents(new Date());

        await expect(prisma.message_trigger_job.findUnique({ where: { dedupeKey: intentKey } }))
            .resolves.toBeNull();
        await expect(prisma.message_trigger_job.findUnique({ where: { dedupeKey: detachedKey } }))
            .resolves.toBeNull();
    }, 30_000);

    it("A5 (flow 5) quarantines a corrupt intent and never reprocesses it", async () => {
        const clientId = await createSilentClient("5");
        const intentKey = getClientAutomationIntentDedupeKey(MESSAGE_CRON_BRANCH_ID, clientId);
        // Malformed templateVariables: an intentKind the fulfiller does not know
        // falls through to quarantineInvalidIntent (intent.service.ts:427).
        const payload = clientIntentPayload(clientId, { intentKind: "banana" });
        await insertIntentRow({
            id: intentKey,
            branchId: MESSAGE_CRON_BRANCH_ID,
            clientId,
            payload,
        });

        await harness.tick.intents(new Date());

        const quarantined = await prisma.message_trigger_job.findUniqueOrThrow({
            where: { dedupeKey: intentKey },
        });
        expect(quarantined).toEqual(expect.objectContaining({
            ruleId: intentRuleId,
            status: "failed",
            cancelReason: MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
            canceledByUser: false,
            clientId,
            nextAttemptAt: null,
        }));
        expect(await prisma.message_trigger_job.count({
            where: { clientId, ruleId: { not: intentRuleId } },
        })).toBe(0);

        // The candidates query selects only retry-reason markers
        // (message-automation-intent.service.ts:231-241), so the next tick must
        // leave the quarantined row exactly as it was.
        await harness.tick.intents(new Date());
        await expect(prisma.message_trigger_job.findUniqueOrThrow({
            where: { dedupeKey: intentKey },
        })).resolves.toEqual(expect.objectContaining({
            cancelReason: MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
            nextAttemptAt: null,
        }));
        expect(await prisma.message_trigger_job.count({
            where: { clientId, ruleId: { not: intentRuleId } },
        })).toBe(0);
    }, 30_000);

    it("B1 (flow 6) copies an in-window dueDate to startDate, finishes the intent in-run, and is idempotent", async () => {
        // The due-date fulfillment syncs with includePast=false, and the
        // materialization window refuses IMMEDIATE (greeting) recipes whose
        // scheduledFor <= now (message-trigger-recipes.ts:12-22). A future-
        // scheduled SERVICE_START rule is what the same-run fulfillment can
        // actually materialize into dispatchable jobs.
        const producerRule = await prisma.message_trigger_rule.create({
            data: {
                id: `e2e:producer-40:start-plus2:${RUN}`,
                branchId: MESSAGE_CRON_BRANCH_ID,
                name: `생산자40 서비스 시작 2일 후 안내 ${RUN}`,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.AFTER_DAYS,
                offsetDays: 2,
                sendTime: "09:00",
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                isDefault: false,
                jobsStale: false,
            },
        });
        producerRuleIds.push(producerRule.id);

        const dueDate = kstDate(0); // inside [kstToday, kstToday+7d]
        const clientId = await createSilentClient("6", { dueDate, smsAutomationEnabled: true });
        const before = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        expect(before.startDate).toBeNull();
        expect(before.dueDate?.toISOString().slice(0, 10)).toBe(dueDate);
        expect(await prisma.message_trigger_job.count({ where: { clientId } })).toBe(0);

        await harness.tick.dueDate();

        const afterFirst = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        // The scheduler sets startDate to the value it computed — the copied
        // dueDate (client-due-date-scheduler.service.ts:107-113), not dueDate-7d.
        expect(afterFirst.startDate?.toISOString().slice(0, 10)).toBe(dueDate);

        const intentKey = getClientAutomationIntentDedupeKey(MESSAGE_CRON_BRANCH_ID, clientId);
        const intentWritten = await prisma.message_trigger_job.findUnique({
            where: { dedupeKey: intentKey },
        });
        // The cron writes nextAttemptAt = dueDate (@db.Date UTC midnight,
        // 09:00 KST). The fulfiller requires next_attempt_at <= clock_timestamp(),
        // so only runs before that boundary may leave a marker for reconciliation.
        // B1b proves in-run fulfillment deterministically, independent of this boundary.
        const inRunPossible = Date.now() >= Date.parse(`${dueDate}T00:00:00Z`);
        expect(intentWritten === null).toBe(inRunPossible);
        if (!inRunPossible) {
            // Pull the clock-blocked marker into the due window and reconcile it,
            // exactly what a later scheduler cycle would do.
            expect(intentWritten).toEqual(expect.objectContaining({
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                clientId,
            }));
            await markIntentDue(intentKey);
            await harness.tick.intents(new Date());
        }
        await expect(prisma.message_trigger_job.findUnique({ where: { dedupeKey: intentKey } }))
            .resolves.toBeNull();
        const jobs = await clientGenericJobs(clientId);
        expect(jobs.length).toBeGreaterThan(0);
        expect(new Set(jobs.map((job) => job.templateKey))).toContain(MessageTriggerTemplateKey.SERVICE_INFO);
        const countsAfterFirstRun = {
            jobs: (await clientGenericJobs(clientId)).length,
            sentLogs: (await sentLogsForClient(clientId)).length,
        };

        // Second tick: startDate is set, so the window query
        // (`startDate: null`, scheduler :80-90) finds nothing — a no-op.
        await harness.tick.dueDate();

        const afterSecond = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        expect(afterSecond.startDate?.toISOString().slice(0, 10)).toBe(dueDate);
        expect(await prisma.message_trigger_job.findUnique({ where: { dedupeKey: intentKey } }))
            .toBeNull();
        expect({
            jobs: (await clientGenericJobs(clientId)).length,
            sentLogs: (await sentLogsForClient(clientId)).length,
        }).toEqual(countsAfterFirstRun);

        await dispatchAndAssertClientSends(clientId, [clientPhone("6")]);
    }, 30_000);

    it("B1b (flow 6, in-run) fulfills the due-date intent inside the same cron run", async () => {
        const realNow = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const kstOffsetMs = 9 * 60 * 60 * 1000;
        const yesterdayKst = new Date(realNow + kstOffsetMs - dayMs).toISOString().slice(0, 10);
        const fakeNow = new Date(`${yesterdayKst}T03:00:00Z`); // yesterday 12:00 KST
        let clientId: number;

        // Fake only Date: the scheduler sees yesterday, but Postgres's real
        // clock can already claim the intent stamped at yesterday's UTC midnight.
        // Prisma, supertest and Nest must keep all their actual timers running.
        jest.useFakeTimers({
            doNotFake: [
                "nextTick", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout",
                "setInterval", "clearInterval", "queueMicrotask", "performance", "hrtime",
                "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
            ],
        });
        try {
            jest.setSystemTime(fakeNow);
            expect(kstDate(0)).toBe(yesterdayKst);
            // Reuse B1's recipe when it ran first, or create it for a focused
            // B1b run: two identical active rules would produce two SMS jobs.
            const producerRule = await prisma.message_trigger_rule.upsert({
                where: { id: `e2e:producer-40:start-plus2:${RUN}` },
                update: {},
                create: {
                    id: `e2e:producer-40:start-plus2:${RUN}`,
                    branchId: MESSAGE_CRON_BRANCH_ID,
                    name: `생산자40 실행 내 서비스 시작 2일 후 안내 ${RUN}`,
                    isActive: true,
                    eventType: MessageTriggerEventType.SERVICE_START,
                    offsetType: MessageTriggerOffsetType.AFTER_DAYS,
                    offsetDays: 2,
                    sendTime: "09:00",
                    recipientType: MessageTriggerRecipientType.CLIENT,
                    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                    isDefault: false,
                    jobsStale: false,
                },
            });
            producerRuleIds.push(producerRule.id);
            clientId = await createSilentClient("6b", { dueDate: yesterdayKst, smsAutomationEnabled: true });
            const before = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
            expect(before.startDate).toBeNull();
            expect(before.dueDate?.toISOString().slice(0, 10)).toBe(yesterdayKst);
            expect(await prisma.message_trigger_job.count({ where: { clientId } })).toBe(0);

            await harness.tick.dueDate();
        } finally {
            // Restore before assertions/dispatch: backdating against the fake
            // clock could violate the DB-side scheduled_for > clock_timestamp() - 24h fence.
            jest.useRealTimers();
        }

        const afterFirst = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        expect(afterFirst.startDate?.toISOString().slice(0, 10)).toBe(yesterdayKst);
        const intentKey = getClientAutomationIntentDedupeKey(MESSAGE_CRON_BRANCH_ID, clientId);
        // No reconcile tick or marker backdate: the due-date cron itself must consume it.
        expect(await prisma.message_trigger_job.findUnique({ where: { dedupeKey: intentKey } })).toBeNull();
        const jobs = await clientGenericJobs(clientId);
        expect(jobs.length).toBeGreaterThan(0);
        expect(new Set(jobs.map((job) => job.templateKey))).toContain(MessageTriggerTemplateKey.SERVICE_INFO);
        // Yesterday + 2 days at 09:00 KST is tomorrow, even on the real clock.
        expect(jobs.every((job) => job.scheduledFor.getTime() > Date.now())).toBe(true);
        const countsAfterFirstRun = {
            jobs: jobs.length,
            sentLogs: (await sentLogsForClient(clientId)).length,
        };

        await harness.tick.dueDate();

        const afterSecond = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        expect(afterSecond.startDate?.toISOString().slice(0, 10)).toBe(yesterdayKst);
        expect(await prisma.message_trigger_job.findUnique({ where: { dedupeKey: intentKey } })).toBeNull();
        expect({
            jobs: (await clientGenericJobs(clientId)).length,
            sentLogs: (await sentLogsForClient(clientId)).length,
        }).toEqual(countsAfterFirstRun);

        await dispatchAndAssertClientSends(clientId, [clientPhone("6b")]);
    }, 30_000);

    it("B2 (flow 7) leaves clients outside the window or with a startDate untouched", async () => {
        // Outside the window: the scheduler scans dueDate in
        // [kstToday, kstToday+7d] (`lte upcomingDueDate`), so +8 is excluded.
        const outsideClientId = await createSilentClient("7", { dueDate: kstDate(8) });
        // Inside the window but startDate already set: excluded by `startDate: null`.
        const startedClientId = await createSilentClient("8", { dueDate: kstDate(2), startDate: kstDate(0) });

        await harness.tick.dueDate();

        const outside = await prisma.client.findUniqueOrThrow({ where: { id: outsideClientId } });
        expect(outside.startDate).toBeNull();
        const started = await prisma.client.findUniqueOrThrow({ where: { id: startedClientId } });
        expect(started.startDate?.toISOString().slice(0, 10)).toBe(kstDate(0));
        expect(await prisma.message_trigger_job.count({
            where: {
                clientId: { in: [outsideClientId, startedClientId] },
                ruleId: intentRuleId,
            },
        })).toBe(0);
        expect(await prisma.message_trigger_job.count({
            where: { clientId: { in: [outsideClientId, startedClientId] } },
        })).toBe(0);
    }, 30_000);

    // ---------- Section C: repairMissingJobs ----------

    /**
     * The automatic service-record scheduling pipeline keeps ONE durable row
     * per schedule (the claim marker itself is promoted into the pending job).
     * Reproducing the state the repair cron exists for therefore means
     * removing the live rows and re-writing only the durable failed lease row
     * exactly as claimAutomaticScheduling leaves it behind when a promote
     * never completed (service-record-link.service.ts:706-785):
     * status failed + SCHEDULING_RETRY_REASON + an expired nextAttemptAt.
     */
    async function rewritePendingLinkJobAsExpiredLease(scheduleId: number) {
        const jobs = await linkJobsForSchedule(scheduleId);
        expect(jobs.length).toBe(1);
        expect(jobs[0]?.status).toBe("pending");
        await prisma.message_trigger_job.delete({ where: { id: jobs[0]!.id } });
        await prisma.service_record_token.deleteMany({ where: { scheduleId } });

        // The lease rows are rebuilt from the live schedule so the payload is
        // the exact shape claimAutomaticScheduling would have written.
        const schedule = await prisma.employee_schedule.findUniqueOrThrow({
            where: { id: scheduleId },
            include: { client: true, primaryEmployee: true },
        });
        const startIsoDate = schedule.startDate.toISOString().slice(0, 10);
        const endIsoDate = schedule.endDate.toISOString().slice(0, 10);
        await prisma.message_trigger_job.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                status: "failed",
                scheduledFor: getServiceRecordLinkScheduledFor(new Date(`${startIsoDate}T00:00:00Z`)),
                cancelReason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                canceledByUser: false,
                clientId: schedule.clientId,
                employeeScheduleId: scheduleId,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipientPhone: schedule.primaryEmployee.phone,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary`,
                payload: {
                    clientId: schedule.clientId,
                    clientName: schedule.client.name,
                    employeeId: schedule.primaryEmployeeId,
                    employeeName: schedule.primaryEmployee.name,
                    memberId: `employee:${schedule.primaryEmployeeId}`,
                    recipientName: schedule.primaryEmployee.name,
                    recipientPhone: schedule.primaryEmployee.phone,
                    buttonUrl: null,
                    messageBody: null,
                    templateVariables: {
                        clientName: schedule.client.name,
                        employeeName: schedule.primaryEmployee.name,
                        serviceRecordUrl: "",
                        serviceStartDate: startIsoDate,
                        serviceEndDate: endIsoDate,
                    },
                },
                attempts: 0,
                // exact lease shape of claimAutomaticScheduling, expired
                nextAttemptAt: new Date(Date.now() - 60_000),
            },
        });
    }

    it("C1 (flow 8) recreates exactly one link job from the durable lease and stays idempotent", async () => {
        const fixture = await registerConfirmedClient("9", "1", true);
        const initialJobs = await linkJobsForSchedule(fixture.scheduleId);
        expect(initialJobs).toHaveLength(1);
        expect(initialJobs[0]?.status).toBe("pending");

        await rewritePendingLinkJobAsExpiredLease(fixture.scheduleId);
        expect(await linkJobsForSchedule(fixture.scheduleId)).toEqual([
            expect.objectContaining({
                status: "failed",
                cancelReason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
            }),
        ]);

        await harness.tick.linkRepair();

        const repaired = await linkJobsForSchedule(fixture.scheduleId);
        expect(repaired).toHaveLength(1);
        expect(repaired[0]).toEqual(expect.objectContaining({
            status: "pending",
            cancelReason: null,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${fixture.scheduleId}:primary`,
        }));
        expect(await prisma.service_record_token.count({
            where: { scheduleId: fixture.scheduleId, active: true, revokedAt: null },
        })).toBe(1);

        // Second repair tick: the pending job is no longer a failed lease and
        // itself blocks new scheduling (none-check in the reconcile query), so
        // the schedule still has exactly one link job.
        await harness.tick.linkRepair();
        expect(await linkJobsForSchedule(fixture.scheduleId)).toEqual(repaired);

        // The recreated job is dispatchable: one dispatch sends the link SMS.
        await harness.backdate(repaired[0]!.id, new Date(Date.now() - 60_000));
        await harness.prepareFreshDispatchWindow();
        await harness.tick.dispatch();
        const logs = await prisma.message_log.findMany({ where: { clientId: fixture.clientId, status: "sent" } });
        expect(logs.map((log) => log.triggerJobId)).toEqual([repaired[0]!.id]);
        const expectedReceiver = digitsOnly(employeePhone("1"));
        expect(
            [...aligoStub.sendCalls].filter((call) => digitsOnly(String(call.receiver)) === expectedReceiver),
        ).toHaveLength(1);
    }, 30_000);

    it("C2 (flow 9) never recreates the link job for terminated or replaced schedules", async () => {
        const terminatedFixture = await registerConfirmedClient("0", "3", true);
        const replacedFixture = await registerConfirmedClient("4", "5", true);
        await rewritePendingLinkJobAsExpiredLease(terminatedFixture.scheduleId);
        await rewritePendingLinkJobAsExpiredLease(replacedFixture.scheduleId);

        // Termination records terminatedAt while keeping the contracted dates;
        // replacement flips `replaced` (employee-schedule.service update path).
        await prisma.employee_schedule.update({
            where: { id: terminatedFixture.scheduleId },
            data: { terminatedAt: new Date() },
        });
        await prisma.employee_schedule.update({
            where: { id: replacedFixture.scheduleId },
            data: { replaced: true },
        });

        const terminatedLeaseBefore = await prisma.message_trigger_job.findUniqueOrThrow({
            where: { dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${terminatedFixture.scheduleId}:primary` },
        });
        const replacedLeaseBefore = await prisma.message_trigger_job.findUniqueOrThrow({
            where: { dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${replacedFixture.scheduleId}:primary` },
        });

        await harness.tick.linkRepair();

        // Nothing was recreated and both expired leases are untouched.
        for (const leaseBefore of [terminatedLeaseBefore, replacedLeaseBefore]) {
            const leaseAfter = await prisma.message_trigger_job.findUniqueOrThrow({
                where: { id: leaseBefore.id },
            });
            expect(leaseAfter).toEqual(expect.objectContaining({
                status: "failed",
                cancelReason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                nextAttemptAt: leaseBefore.nextAttemptAt,
            }));
        }
        expect(await prisma.service_record_token.count({
            where: { scheduleId: { in: [terminatedFixture.scheduleId, replacedFixture.scheduleId] } },
        })).toBe(0);
    }, 30_000);
    it.each(["SERVICE_START", "SERVICE_END"] as const)("RULE-2 r4.19 actual reviewed caregiver-only %s provider→RecordStore→client intent→core→seal→fake provider", async (event) => {
        const activation = harness.app.get(MessageAutomationActivationService);
        const config = harness.app.get(ConfigService);
        const readConfig = config.get.bind(config);
        const previousBranchName = (await prisma.branch.findUniqueOrThrow({ where: { id: MESSAGE_CRON_BRANCH_ID } })).name;
        const previousParent = await prisma.system_setting.findUnique({ where: { key: activation.getParentKey(MESSAGE_CRON_BRANCH_ID) } });
        const previousRules = await prisma.message_trigger_rule.findMany({ where: { branchId: MESSAGE_CRON_BRANCH_ID, recipientType: "CLIENT", deletedAt: null }, select: { id: true, isActive: true, updatedAt: true } });
        let defaults = previousRules;
        const linkBase = jest.spyOn(config, "get").mockImplementation((...args: Parameters<ConfigService["get"]>) =>
            args[0] === "MOBILE_SERVICE_RECORD_BASE_URL" ? "https://phase7.example.invalid" : readConfig(...args));
        try {
        await prisma.branch.update({ where: { id: MESSAGE_CRON_BRANCH_ID }, data: { name: "Phase7 합성 지점" } });
        await activation.setTriggerDispatchEnabled(MESSAGE_CRON_BRANCH_ID, true, { userId: MESSAGE_CRON_OWNER_USER_ID, globalRole: "owner", branchRole: "owner" });
        await triggers.ensureDefaultRulesForBranch(MESSAGE_CRON_BRANCH_ID);
        defaults = await prisma.message_trigger_rule.findMany({ where: { branchId: MESSAGE_CRON_BRANCH_ID, recipientType: "CLIENT", deletedAt: null } });
        await prisma.message_trigger_rule.updateMany({ where: { id: { in: defaults.map((rule) => rule.id) } }, data: { isActive: false } });
        const group = await triggers.createRuleGroup(MESSAGE_CRON_BRANCH_ID, { name: "검토된 배정 안내", recipientMode: "BOTH_EMPLOYEES",
            eventType: event as MessageTriggerEventType, offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 0, sendTime: "10:30", isActive: true,
            recipientTemplates: { PRIMARY_EMPLOYEE: MessageTriggerTemplateKey.CAREGIVER_SERVICE_START_NOTICE, SECONDARY_EMPLOYEE: MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE } });
        producerGroupIds.push(group.id); producerRuleIds.push(...group.rules.map((rule) => rule.id));
        const primary = await prisma.employee.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, name: "합성 주", phone: event === "SERVICE_START" ? "01000000111" : "01000000211", grade: "스탠다드" } });
        const secondary = await prisma.employee.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, name: "합성 보조", phone: event === "SERVICE_START" ? "01000000112" : "01000000212", grade: "스탠다드" } });
        employeeIds.add(primary.id); employeeIds.add(secondary.id);
        const client = await prisma.client.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, name: "변경 전 합성 고객", phone: event === "SERVICE_START" ? "01000000113" : "01000000213", voucherClient: false,
            startDate: new Date("2026-11-10T00:00:00.000Z"), endDate: new Date("2026-11-20T00:00:00.000Z"), bookingConfirmedAt: new Date("2026-10-01T00:00:00.000Z"), serviceStatus: "waiting" } });
        clientIds.add(client.id);
        const schedule = await prisma.employee_schedule.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, clientId: client.id, primaryEmployeeId: primary.id, secondaryEmployeeId: secondary.id,
            workAddress: "합성 주소", startDate: new Date("2026-11-10T00:00:00.000Z"), endDate: new Date("2026-11-20T00:00:00.000Z") } });
        scheduleIds.add(schedule.id);
        const serviceRecordCase = await prisma.service_record_case.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, clientId: client.id,
            startDate: new Date("2026-11-10T00:00:00.000Z"), endDate: new Date("2026-11-20T00:00:00.000Z"), requiredSessionCount: 9 } });
        const preservedToken = await prisma.service_record_token.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, scheduleId: schedule.id, employeeId: primary.id, serviceRecordCaseId: serviceRecordCase.id,
            linkTokenHash: `phase7_${randomUUID().replace(/-/g, "")}`, expectedPhoneHash: createHash("sha256").update(primary.phone).digest("hex"), expiresAt: new Date("2026-12-01T00:00:00.000Z") } });
        await prisma.message_trigger_rule.upsert({ where: { id: SERVICE_RECORD_LINK_RULE_ID }, update: {}, create: { id: SERVICE_RECORD_LINK_RULE_ID,
            branchId: null, name: "제공기록지 링크", isActive: true, eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0,
            sendTime: "15:00", recipientType: "PRIMARY_EMPLOYEE", templateKey: "SERVICE_RECORD_LINK", isDefault: true } });
        const oldClientRule = await prisma.message_trigger_rule.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, name: "기존 고객", isActive: false,
            eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, recipientType: "CLIENT", templateKey: "INFO" } });
        const oldAssignmentRule = await prisma.message_trigger_rule.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, name: "기존 배정", isActive: false,
            eventType: "EMPLOYEE_ASSIGNED", offsetType: "IMMEDIATE", offsetDays: 0, recipientType: "PRIMARY_EMPLOYEE", templateKey: "EMPLOYEE_ASSIGNED" } });
        producerRuleIds.push(oldClientRule.id, oldAssignmentRule.id);
        const oldFamilies = [];
        for (const [ruleId, templateKey, recipientType, employeeScheduleId, dedupeKey] of [
            [oldClientRule.id, "INFO", "CLIENT", null, `phase7-old-client-${client.id}`],
            [oldAssignmentRule.id, "EMPLOYEE_ASSIGNED", "PRIMARY_EMPLOYEE", schedule.id, `phase7-old-assignment-${client.id}`],
            [SERVICE_RECORD_LINK_RULE_ID, "SERVICE_RECORD_LINK", "PRIMARY_EMPLOYEE", schedule.id, `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${schedule.id}:primary`],
        ] as const) oldFamilies.push(await prisma.message_trigger_job.create({ data: { branchId: MESSAGE_CRON_BRANCH_ID, clientId: client.id, ruleId, templateKey, recipientType, employeeScheduleId,
            status: "sent", sentAt: new Date("2026-11-01T00:00:00.000Z"), scheduledFor: new Date("2026-11-01T00:00:00.000Z"), dedupeKey,
            recipientPhone: "01000000999", payload: { memberId: String(client.id), recipientName: "보존할 이력", recipientPhone: "01000000999", templateVariables: {}, legacyAuthorityMarker: "preserve" } } }));
        const sessionId = randomUUID(); const taskId = randomUUID(); const actionId = randomUUID(); caregiverSessionIds.push(sessionId);
        await prisma.agent_session.create({ data: { id: sessionId, userId: MESSAGE_CRON_OWNER_USER_ID, branchId: MESSAGE_CRON_BRANCH_ID, model: "fixture", agentVersion: "fixture", expiresAt: new Date("2027-01-01T00:00:00Z") } });
        await prisma.agent_task.create({ data: { id: taskId, sessionId, userId: MESSAGE_CRON_OWNER_USER_ID, branchId: MESSAGE_CRON_BRANCH_ID, capabilityId: "clients.update", status: "executing", revision: 2, expiresAt: new Date("2027-01-01T00:00:00Z") } });
        const capability = harness.app.get(ClientWriteAgentCapabilitiesProvider).getCapabilities().find((entry) => entry.meta.name === "clients.update")!;
        const context: AgentContext = { principal: { userId: MESSAGE_CRON_OWNER_USER_ID, branchId: MESSAGE_CRON_BRANCH_ID, globalRole: "owner", branchRole: "owner" } as never,
            sessionId, actionId, traceId: randomUUID(), locale: "ko" };
            const inspection = await capability.inspect!(context, { id: client.id, name: "변경 후 합성 고객" });
            const input = { id: client.id, name: "변경 후 합성 고객", targetVersion: inspection.targetVersion };
            const impact = await capability.planAutomationImpact!(context, input, taskId);
            expect(impact.availability).toBe("available"); expect(impact.complete).toBe(true);
            expect(impact.effects.map((effect) => [effect.kind, effect.scheduleId, effect.recipientType]).sort()).toEqual([
                ["caregiver-service", schedule.id, "primary-employee"], ["caregiver-service", schedule.id, "secondary-employee"],
            ]);
            const question = createAgentAutomationQuestion(impact);
            const artifact = parseTaskAutomationArtifact({ version: 1, actionId, taskId, taskRevision: 2, sessionId, userId: MESSAGE_CRON_OWNER_USER_ID, branchId: MESSAGE_CRON_BRANCH_ID,
                capability: "clients.update", inputHash: agentBindingHash(input), targetClientId: client.id, targetVersion: inspection.targetVersion, question,
                consent: { choice: "yes", binding: { recipientRef: question.recipientSetRef, templateRef: question.templateSetRef, effectDigest: question.effectDigest, policyDigest: question.policyDigest, consentEventId: randomUUID() } }, noSend: false, impact });
            expect(artifact).not.toBeNull();
            await prisma.agent_action.create({ data: { id: actionId, sessionId, userId: MESSAGE_CRON_OWNER_USER_ID, branchId: MESSAGE_CRON_BRANCH_ID, taskId, taskRevision: 2,
                capability: "clients.update", capabilityVersion: "1.0.0", risk: "external-side-effect", status: "executing", proposal: { _taskAutomation: artifact } as Prisma.InputJsonValue,
                proposalRevision: "fixture", inputHash: artifact!.inputHash, targetVersion: inspection.targetVersion, authorizationContext: { approvalPolicy: "strong" }, expiresAt: new Date("2027-01-01T00:00:00Z"),
                idempotencyKey: randomUUID(), requestDedupeKey: randomUUID(), dedupeExpiresAt: new Date("2027-01-01T00:00:00Z") } });
            context.taskAutomation = artifact!; context.approvedTargetVersion = inspection.targetVersion;
            const callsBefore = aligoStub.sendCalls.length;
            expect(await capability.executeApprovedTarget!(context, input, inspection.targetVersion!)).toEqual({ id: client.id, name: "변경 후 합성 고객", status: "updated" });
            const intents = await prisma.message_trigger_job.findMany({ where: { branchId: MESSAGE_CRON_BRANCH_ID, clientId: client.id, ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID, cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON } });
            expect(intents).toHaveLength(1);
            const reference = parseAgentAutomationTaskCommitReference((intents[0]!.payload as { taskAutomationReference: unknown }).taskAutomationReference);
            expect(reference).not.toBeNull();
            if (!reference) throw new Error("missing persisted task reference");
            expect(await fulfillClientMessageAutomationIntent({ prisma, triggerService: triggers, branchId: MESSAGE_CRON_BRANCH_ID, clientId: client.id, includePast: true, suppressGreeting: false,
                taskOrigin: true, taskAutomationReference: reference })).toBe(true);
            const generated = await prisma.message_trigger_job.findMany({ where: { clientId: client.id, ruleId: { in: group.rules.map((rule) => rule.id) } }, orderBy: { recipientType: "asc" } });
            expect(generated).toHaveLength(2);
            for (const row of generated) {
                expect(row.status).toBe("pending");
                expect(row.scheduledFor.toISOString()).toBe(event === "SERVICE_START" ? "2026-11-10T01:30:00.000Z" : "2026-11-20T01:30:00.000Z");
                expect(row.payload).toMatchObject({ caregiverSourceSnapshot: { version: 1, groupId: group.id, groupVersion: 1 }, agentAutomationSeal: { version: 1 } });
            }
            const gate = harness.app.get(AgentAutomationDeliveryGateService); const delivery = harness.app.get(SmsTriggerDeliveryService); const jobs = new SbMessageTriggerJobRepository(prisma);
            for (const row of generated) {
                const token = await jobs.claimPendingWithRuleFence(row.id, MESSAGE_CRON_BRANCH_ID); expect(token).not.toBeNull();
                const job = await jobs.findByIdInBranch(MESSAGE_CRON_BRANCH_ID, row.id); expect(job).not.toBeNull();
                const render = (candidate: MessageTriggerJobEntity, tx: Prisma.TransactionClient) => delivery.resolveCanonicalDeliverySnapshot(candidate, tx);
                expect(await gate.authorizePreparation(job!, render, async () => ({ kind: "allow" }))).toEqual({ kind: "allow" });
                const prepared = await delivery.prepareJob(job!); expect(prepared).not.toBeNull(); await jobs.update(job!);
                expect(await gate.authorizeDispatch(job!, prepared!, render, async (tx) => {
                    const changed = await tx.message_trigger_job.updateMany({ where: { id: row.id, branchId: MESSAGE_CRON_BRANCH_ID, status: "processing", claimToken: token }, data: { status: "dispatching" } });
                    return changed.count === 1 ? { kind: "allow" } : { kind: "lost" };
                })).toEqual({ kind: "allow" });
                job!.status = "dispatching"; expect(await delivery.sendPreparedJob(job!, prepared!)).toBe(true);
                job!.markSent(); await jobs.update(job!);
            }
            expect(aligoStub.sendCalls.slice(callsBefore).map((call) => [call.receiver, call.message]).sort()).toEqual([
                [event === "SERVICE_START" ? "01000000111" : "01000000211", "합성 주 관리사님, 변경 후 합성 고객 고객님의 서비스가 2026-11-10에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - Phase7 합성 지점"],
                [event === "SERVICE_START" ? "01000000112" : "01000000212", "합성 보조 관리사님, 변경 후 합성 고객 고객님의 서비스가 2026-11-20에 종료됩니다. 마무리 안내를 확인해 주세요. - Phase7 합성 지점"],
            ].sort());
            await triggers.syncClientRulesForClient(MESSAGE_CRON_BRANCH_ID, client.id, true, false, { preserveExisting: true, stableBatchAt: new Date(), taskOrigin: true, taskAutomationReference: reference });
            expect(await prisma.message_trigger_job.count({ where: { clientId: client.id, ruleId: { in: group.rules.map((rule) => rule.id) } } })).toBe(2);
            expect(aligoStub.sendCalls.length - callsBefore).toBe(2);
            for (const old of oldFamilies) expect(await prisma.message_trigger_job.findUnique({ where: { id: old.id } })).toEqual(old);
            expect(await prisma.service_record_token.findUnique({ where: { id: preservedToken.id } })).toEqual(preservedToken);
            expect(aligoStub.sendCalls.slice(callsBefore).some((call) => call.receiver === "01000000999")).toBe(false);
        } finally {
            linkBase.mockRestore();
            await prisma.branch.update({ where: { id: MESSAGE_CRON_BRANCH_ID }, data: { name: previousBranchName } });
            for (const id of producerGroupIds) {
                const group = await prisma.message_trigger_rule_group.findUnique({ where: { id } });
                if (group && !group.deletedAt) await triggers.deleteRuleGroup(MESSAGE_CRON_BRANCH_ID, id);
            }
            for (const rule of previousRules) await prisma.message_trigger_rule.update({ where: { id: rule.id }, data: { isActive: rule.isActive, updatedAt: rule.updatedAt } });
            for (const rule of defaults.filter((rule) => !previousRules.some((previous) => previous.id === rule.id))) await prisma.message_trigger_rule.update({ where: { id: rule.id }, data: { isActive: rule.isActive, updatedAt: rule.updatedAt } });
            if (previousParent) await prisma.system_setting.update({ where: { key: previousParent.key }, data: { value: previousParent.value, updatedAt: previousParent.updatedAt } });
            else await prisma.system_setting.deleteMany({ where: { key: activation.getParentKey(MESSAGE_CRON_BRANCH_ID) } });
        }
    });

});
