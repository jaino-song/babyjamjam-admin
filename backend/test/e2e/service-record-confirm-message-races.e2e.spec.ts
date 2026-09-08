import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { MessageTriggerTemplateKey, MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget, createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture, serviceRecordConfirmBarrier,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

function clientLock(prisma: PrismaClient, hooks: { attempted?: () => void; acquired?: () => void; hold?: Promise<void> }) {
    let observed = false;
    return prisma.$extends({ query: { $allOperations: async ({ model, operation, args, query }) => {
        const raw = (Array.isArray(args) ? args[0] : args) as unknown as { strings?: readonly string[]; sql?: string };
        const sql = (raw?.strings?.join(" ") ?? raw?.sql ?? "").toLowerCase();
        const target = !observed && model === undefined && operation === "$queryRaw"
            && /from\s+"?client"?\s/.test(sql) && /for\s+update/.test(sql);
        if (target) { observed = true; hooks.attempted?.(); }
        const result = await query(args);
        if (target) { hooks.acquired?.(); await hooks.hold; }
        return result;
    } } });
}

function edit(prisma: unknown) {
    return new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as never));
}

// Actual production authorization transaction only. This suite never invokes
// delivery; focused unit tests verify the caller sends only after allow.
function authorize(prisma: unknown, job: MessageTriggerJobEntity) {
    const forbidden = new Proxy({}, { get: () => { throw new Error("Unexpected non-DB collaborator"); } });
    const service = new MessageTriggerService(prisma as never, forbidden as never, forbidden as never,
        forbidden as never, forbidden as never, forbidden as never, forbidden as never, forbidden as never);
    return (service as unknown as {
        authorizeClaimedJobForDispatch(job: MessageTriggerJobEntity): Promise<{ kind: string }>;
    }).authorizeClaimedJobForDispatch(job);
}

async function reached(barrier: Promise<void>, operation: Promise<unknown>) {
    await Promise.race([barrier, operation.then(() => {
        throw new Error("Operation finished without the common client lock");
    })]);
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
        const held = serviceRecordConfirmBarrier();
        const release = serviceRecordConfirmBarrier();
        const attempted = serviceRecordConfirmBarrier();
        const winningClient = clientLock(prisma, { acquired: held.release, hold: release.entered });
        const losingClient = clientLock(prisma, { attempted: attempted.release });
        const confirm = (client: unknown) => edit(client)
            .confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request);
        const winner = (first === "confirm" ? confirm(winningClient) : authorize(winningClient, job))
            .then((value) => value, (error: unknown) => error);
        let loser: Promise<unknown> | undefined;
        let boundaryError: unknown;
        try {
            await reached(held.entered, winner);
            loser = (first === "confirm" ? authorize(losingClient, job) : confirm(losingClient))
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
