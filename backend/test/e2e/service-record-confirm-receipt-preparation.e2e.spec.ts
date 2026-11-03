import { createLegacyAutomationDeliveryGate } from "../fixtures/legacy-automation-delivery-gate";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { ServiceRecordRevisionDispatchContext } from "@babyjamjam/shared/types/service-record";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "application/services/sms-trigger-delivery.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { reached } from "./helpers/service-record-confirm-race.helper";
import { completeServiceRecordFinalizationCase } from "./helpers/service-record-finalization.helper";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget, createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture, serviceRecordConfirmBarrier,
} from "./helpers/service-record-confirm.helper";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("receipt preparation before atomic authorization (actual PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    async function setup(complete = false) {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        if (complete) {
            await completeServiceRecordFinalizationCase(prisma, fixture);
            await prisma.service_record_case.update({ where: { id: fixture.record.id }, data: {
                status: "READY_TO_FINALIZE",
            } });
        }
        const admin = new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as never), createHolidayCalendarStub());
        const started = await admin.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        const draft = started.draft!;
        const saved = await admin.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion, changes: {},
            dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
        });
        const preview = await admin.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: saved.draft!.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        const rule = await prisma.message_trigger_rule.create({ data: {
            branchId: fixture.branch.id, name: "Isolated receipt preparation", isActive: true,
            eventType: "SERVICE_END", offsetType: "AFTER", recipientType: "CLIENT", templateKey: "SERVICE_END_NOTICE",
        } });
        const row = await prisma.message_trigger_job.create({ data: {
            branchId: fixture.branch.id, ruleId: rule.id, status: "pending", scheduledFor: new Date(),
            clientId: fixture.client.id, employeeScheduleId: fixture.schedule.id, recipientType: "CLIENT",
            templateKey: "SERVICE_END_NOTICE", dedupeKey: randomUUID(),
            payload: { memberId: String(fixture.client.id), recipientName: "Synthetic receipt client",
                recipientPhone: "00000000000", templateVariables: {} },
        } });
        const jobs = new SbMessageTriggerJobRepository(prisma as never);
        const job = await jobs.findByIdInBranch(fixture.branch.id, row.id);
        if (!job) throw new Error("Missing receipt preparation fixture");
        return { fixture, admin, draft, jobs, job,
            confirm: () => admin.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
                expectedDraftVersion: saved.draft!.draftVersion, previewId: preview.previewId,
                idempotencyKey: randomUUID(),
            }) };
    }

    function dispatcher(jobs: SbMessageTriggerJobRepository, delivery: unknown,
        beforePreparation?: () => Promise<void>) {
        const forbidden = new Proxy({}, { get: () => { throw new Error("Unexpected external collaborator"); } });
        const branchLock = new MessageAutomationBranchLockService(prisma as never);
        const activation = new MessageAutomationActivationService(prisma as never, branchLock, forbidden as never);
        const rules = new SbMessageTriggerRuleRepository(prisma as never);
        const service = new MessageTriggerService(prisma as never, delivery as never,
            forbidden as never, rules, jobs, forbidden as never, forbidden as never, forbidden as never,
            undefined, undefined, activation, branchLock, undefined,
            createLegacyAutomationDeliveryGate(prisma as never, branchLock));
        if (beforePreparation) {
            const preparationService = service as unknown as {
                authorizeClaimedJobBeforePreparation(job: MessageTriggerJobEntity): Promise<{ kind: string }>;
            };
            const authorize = preparationService.authorizeClaimedJobBeforePreparation.bind(service);
            preparationService.authorizeClaimedJobBeforePreparation = async (job) => {
                await beforePreparation();
                return authorize(job);
            };
        }
        return (job: MessageTriggerJobEntity, branchId: string) => (service as unknown as {
            dispatchClaimedJob(job: MessageTriggerJobEntity, sent: ReadonlySet<string>, approved: ReadonlySet<string>): Promise<void>;
        }).dispatchClaimedJob(job, new Set(), new Set([branchId]));
    }

    it("allows confirm during preparation and refuses old prepared delivery afterward", async () => {
        const { fixture, jobs, job, confirm } = await setup();
        const prepared = serviceRecordConfirmBarrier();
        const resume = serviceRecordConfirmBarrier();
        const observedStatuses: string[] = [];
        const sendPreparedJob = jest.fn(async () => true);
        const prepareJob = async (target: MessageTriggerJobEntity) => {
            observedStatuses.push((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: target.id } })).status);
            prepared.release();
            await resume.entered;
            const serializedSnapshot = "synthetic-adapter-snapshot";
            target.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = serializedSnapshot;
            return { snapshot: Object.freeze({}), serializedSnapshot };
        };
        // Only the preparation/provider adapter is fake. Claim, snapshot
        // persistence, authorization, cancellation and confirmation are real.
        // This is ordering proof, not receipt rendering or external SMS proof.
        const delivery = { prepareJob, sendPreparedJob,
            sendJob: async (target: MessageTriggerJobEntity) => {
                await prepareJob(target);
                return sendPreparedJob();
            } };
        const dispatch = dispatcher(jobs, delivery)(job, fixture.branch.id).then(
            () => undefined, (error: unknown) => error,
        );
        let confirmed: unknown;
        let failure: unknown;
        try {
            await reached(prepared.entered, dispatch);
            confirmed = await confirm();
        } catch (error) { failure = error; } finally { resume.release(); }
        await dispatch;
        if (failure) throw failure;
        expect(confirmed).toMatchObject({ status: "confirmed" });
        expect(observedStatuses).toEqual(["processing"]);
        expect(sendPreparedJob).not.toHaveBeenCalled();
        expect(await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } }))
            .toMatchObject({ status: "canceled", claimToken: null });
    });

    it("a preparation error occurs before dispatching and does not block subsequent confirmation", async () => {
        const { fixture, jobs, job, confirm } = await setup();
        const observedStatuses: string[] = [];
        const sendPreparedJob = jest.fn(async () => true);
        const prepareJob = async (target: MessageTriggerJobEntity) => {
            observedStatuses.push((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: target.id } })).status);
            throw new Error("SYNTHETIC_RECEIPT_PREPARATION_FAILED");
        };
        const delivery = { prepareJob, sendPreparedJob,
            sendJob: async (target: MessageTriggerJobEntity) => { await prepareJob(target); return true; } };
        await dispatcher(jobs, delivery)(job, fixture.branch.id).catch(() => undefined);
        expect(observedStatuses).toEqual(["processing"]);
        expect(sendPreparedJob).not.toHaveBeenCalled();
        expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } })).status)
            .not.toBe("dispatching");
        expect(await confirm()).toMatchObject({ status: "confirmed" });
    });
    it.each(["stale", "capability_unverified"] as const)("rejects an already %s revision before any receipt preparation", async (mode) => {
        // Only these document-context cases need all submitted/signature rows.
        // Other scenarios retain partial readiness and its provider-job guard.
        const { fixture, jobs, job, confirm } = await setup(true);
        expect(await confirm()).toMatchObject({ status: "confirmed" });
        const documentJob = await prisma.eformsign_document_job.findFirstOrThrow({
            where: { clientId: fixture.client.id }, orderBy: { createdAt: "desc" },
        });
        const context = (documentJob.payload as unknown as { context: ServiceRecordRevisionDispatchContext }).context;
        expect(context.revisionId).toBeTruthy();
        // Simulate a retained/recovered queued job with its captured revision
        // context. The real dispatcher must reject before touching the adapter.
        await prisma.message_trigger_job.update({ where: { id: job.id }, data: {
            status: "pending", canceledAt: null, cancelReason: null, claimToken: null,
            payload: JSON.parse(JSON.stringify({ ...job.payload, serviceRecordRevisionContext: { ...context,
                businessFingerprint: mode === "stale" ? "0".repeat(64) : context.businessFingerprint,
            } })) as Prisma.InputJsonValue,
        } });
        const resumed = await jobs.findByIdInBranch(fixture.branch.id, job.id);
        if (!resumed) throw new Error("Missing resumed receipt fixture");
        const prepareJob = jest.fn(async () => ({ snapshot: Object.freeze({}), serializedSnapshot: "synthetic" }));
        const sendPreparedJob = jest.fn(async () => true);
        await dispatcher(jobs, { prepareJob, sendPreparedJob })(resumed, fixture.branch.id);
        expect(prepareJob).not.toHaveBeenCalled();
        expect(sendPreparedJob).not.toHaveBeenCalled();
        expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } })).status)
            .not.toBe("dispatching");
    });

    it("rejects a legacy claim canceled after acquisition but before preparation", async () => {
        const { fixture, jobs, job, confirm } = await setup();
        const claimed = serviceRecordConfirmBarrier();
        const resume = serviceRecordConfirmBarrier();
        const prepareJob = jest.fn(async () => ({ snapshot: Object.freeze({}), serializedSnapshot: "synthetic" }));
        const sendPreparedJob = jest.fn(async () => true);
        // dispatchClaimedJob awaits runExclusive's claim transaction before
        // this fence entry. Pausing inside the repository claim instead would
        // keep its job-row lock held and deadlock the confirming transaction.
        const dispatch = dispatcher(jobs, { prepareJob, sendPreparedJob }, async () => {
            const storedClaim = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } });
            expect(job.claimToken).not.toBeNull();
            expect(storedClaim).toMatchObject({ status: "processing", claimToken: job.claimToken });
            claimed.release();
            await resume.entered;
        })(job, fixture.branch.id)
            .then(() => undefined, (error: unknown) => error);
        try {
            await reached(claimed.entered, dispatch);
            expect(await confirm()).toMatchObject({ status: "confirmed" });
        } finally { resume.release(); }
        expect(await dispatch).toBeUndefined();
        expect(prepareJob).not.toHaveBeenCalled();
        expect(sendPreparedJob).not.toHaveBeenCalled();
        expect(await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } }))
            .toMatchObject({ status: "canceled", claimToken: null });
    });

});
