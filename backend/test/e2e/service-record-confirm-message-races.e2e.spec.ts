import { createLegacyAutomationDeliveryGate } from "../fixtures/legacy-automation-delivery-gate";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { clientLock, reached } from "./helpers/service-record-confirm-race.helper";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE, type SmsTriggerDeliveryPreparation } from "application/services/sms-trigger-delivery.service";
import { MessageTriggerTemplateKey, MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { getClientAutomationIntentDedupeKey, getScheduleAutomationIntentDedupeKey,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON } from "domain/constants/message-automation-intent";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget, createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture, serviceRecordConfirmBarrier,
} from "./helpers/service-record-confirm.helper";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

function edit(prisma: unknown) {
    return new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as never), createHolidayCalendarStub());
}

// Only the provider preparation adapter and focused race admission are doubles.
// Preparation, snapshot persistence and both authorization fences use production
// code; this authorization-only suite never sends a provider request.
function authorizationService(prisma: unknown) {
    const forbidden = new Proxy({}, { get: () => { throw new Error("Unexpected non-DB collaborator"); } });
    const branchLock = new MessageAutomationBranchLockService(prisma as never);
    const activation = new MessageAutomationActivationService(prisma as never, branchLock, forbidden as never);
    const delivery = {
        prepareJob: async (job: MessageTriggerJobEntity) => {
            const serializedSnapshot = "synthetic-adapter-snapshot";
            job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = serializedSnapshot;
            return { snapshot: Object.freeze({}), serializedSnapshot };
        },
    };
    const jobs = new SbMessageTriggerJobRepository(prisma as never);
    const service = new MessageTriggerService(prisma as never, delivery as never, forbidden as never,
        forbidden as never, jobs, forbidden as never, forbidden as never, forbidden as never,
        undefined, undefined, activation, branchLock, undefined,
        createLegacyAutomationDeliveryGate(prisma as never, branchLock));
    return service as unknown as {
        authorizeClaimedJobBeforePreparation(job: MessageTriggerJobEntity): Promise<{ kind: string }>;
        prepareClaimedJob(job: MessageTriggerJobEntity): Promise<SmsTriggerDeliveryPreparation | null>;
        persistPreparedDelivery(job: MessageTriggerJobEntity): Promise<boolean>;
        authorizeClaimedJobForDispatch(job: MessageTriggerJobEntity, preparation: SmsTriggerDeliveryPreparation): Promise<{ kind: string }>;
    };
}

describeE2E("confirm versus legacy SMS authorization (actual PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    it.each(["confirm", "dispatch"] as const)("%s wins the common client lock", async (first) => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const service = edit(prisma);
        const started = await service.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        const draft = started.draft!;
        const changed = await service.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion, changes: {},
            dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
        });
        const preview = await service.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: changed.draft!.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        const request = { expectedDraftVersion: changed.draft!.draftVersion,
            previewId: preview.previewId, idempotencyKey: randomUUID() };
        const rule = await prisma.message_trigger_rule.create({ data: {
            branchId: fixture.branch.id, name: "Isolated confirm race", eventType: "SERVICE_END",
            offsetType: "BEFORE", recipientType: "CLIENT", templateKey: "SERVICE_END_REMINDER",
        } });
        const payload = { memberId: String(fixture.client.id), recipientName: "Synthetic client",
            recipientPhone: "00000000000", templateVariables: { endDate: "2026-09-23" } };
        const row = await prisma.message_trigger_job.create({ data: {
            branchId: fixture.branch.id, ruleId: rule.id, status: "processing", scheduledFor: new Date(),
            clientId: fixture.client.id, employeeScheduleId: fixture.schedule.id, recipientType: "CLIENT",
            templateKey: "SERVICE_END_REMINDER", dedupeKey: randomUUID(), claimToken: randomUUID(), payload,
        } });
        const job = new MessageTriggerJobEntity(
            row.id, row.branchId, row.ruleId, "processing", row.scheduledFor, row.sentAt,
            row.canceledAt, row.cancelReason, row.clientId, row.employeeScheduleId,
            MessageTriggerRecipientType.CLIENT, row.recipientPhone, MessageTriggerTemplateKey.SERVICE_END_REMINDER,
            row.dedupeKey, payload, row.attempts, row.nextAttemptAt, row.createdAt, row.updatedAt, row.claimToken,
        );
        // Complete preparation before installing the one-shot client-lock hooks.
        // A repository CAS can return without writing, so verify the stored
        // snapshot as well as persistPreparedDelivery's boolean result.
        const preparationService = authorizationService(prisma);
        expect(await preparationService.authorizeClaimedJobBeforePreparation(job)).toMatchObject({ kind: "allow" });
        const preparation = await preparationService.prepareClaimedJob(job);
        expect(preparation).not.toBeNull();
        if (!preparation) throw new Error("Missing prepared race delivery");
        expect(await preparationService.persistPreparedDelivery(job)).toBe(true);
        const preparedJob = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } });
        expect((preparedJob.payload as { templateVariables: Record<string, unknown> })
            .templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE]).toBe(preparation.serializedSnapshot);
        const held = serviceRecordConfirmBarrier();
        const release = serviceRecordConfirmBarrier();
        const attempted = serviceRecordConfirmBarrier();
        const winningClient = clientLock(prisma, { acquired: held.release, hold: release.entered });
        const losingClient = clientLock(prisma, { attempted: attempted.release });
        const confirm = (client: unknown) => edit(client)
            .confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request);
        const winner = (first === "confirm" ? confirm(winningClient) : authorizationService(winningClient).authorizeClaimedJobForDispatch(job, preparation))
            .then((value) => value, (error: unknown) => error);
        let loser: Promise<unknown> | undefined;
        let boundaryError: unknown;
        try {
            await reached(held.entered, winner);
            loser = (first === "confirm" ? authorizationService(losingClient).authorizeClaimedJobForDispatch(job, preparation) : confirm(losingClient))
                .then((value) => value, (error: unknown) => error);
            await reached(attempted.entered, loser);
        } catch (error) { boundaryError = error; } finally { release.release(); }
        const result = await winner;
        const other = await loser;
        if (boundaryError) throw boundaryError;
        const finalJob = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } });
        if (first === "confirm") {
            expect(result).toMatchObject({ status: "confirmed" });
            expect(other).toMatchObject({ kind: "lost" });
            expect(finalJob).toMatchObject({ status: "canceled", claimToken: null });
            const intents = await prisma.message_trigger_job.findMany({ where: {
                branchId: fixture.branch.id, clientId: fixture.client.id,
                dedupeKey: { in: [getClientAutomationIntentDedupeKey(fixture.branch.id, fixture.client.id),
                    getScheduleAutomationIntentDedupeKey(fixture.branch.id, fixture.schedule.id)] },
            } });
            expect(intents).toHaveLength(2);
            expect(intents).toEqual(expect.arrayContaining([
                expect.objectContaining({ status: "failed", cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                    dedupeKey: getClientAutomationIntentDedupeKey(fixture.branch.id, fixture.client.id),
                    payload: expect.objectContaining({ templateVariables: expect.objectContaining({
                        intentKind: "client", includePast: "false", suppressGreeting: "true",
                    }) }) }),
                expect.objectContaining({ status: "failed", cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                    dedupeKey: getScheduleAutomationIntentDedupeKey(fixture.branch.id, fixture.schedule.id) }),
            ]));
        } else {
            expect(result).toMatchObject({ kind: "allow" });
            expect(other).toBeInstanceOf(ConflictException);
            expect(finalJob).toMatchObject({ status: "dispatching", claimToken: job.claimToken });
            expect(await prisma.service_record_edit_draft.findUniqueOrThrow({ where: { id: draft.id } }))
                .toMatchObject({ status: "ACTIVE" });
            expect(await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
                .toMatchObject({ endDate: fixture.client.endDate, duration: 15, actualPrice: "600000" });
            expect(await prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } })).toBe(0);
        }
    });
});
