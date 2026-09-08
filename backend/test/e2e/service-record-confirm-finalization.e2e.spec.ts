import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
    ORIGINAL_THIRTEEN_DATES,
} from "./helpers/service-record-confirm.helper";
import { completeServiceRecordFinalizationCase } from "./helpers/service-record-finalization.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

type ClaimResult = {
    claimed: boolean;
    attempts: number;
    blockedGeneration?: boolean;
};

/**
 * The finalizer keeps this owning transaction seam private to the scheduler.
 * Calling it here avoids processDueCases scanning retained fixtures while
 * still exercising the production Prisma transaction and common lock set.
 */
async function claimFinalizationCase(
    service: ServiceRecordFinalizationService,
    caseId: string,
    branchId: string,
    referenceDate: Date,
): Promise<ClaimResult> {
    const target = service as unknown as {
        claimFinalizationCase?: (
            id: string,
            branch: string,
            reference: Date,
        ) => Promise<unknown>;
    };
    if (typeof target.claimFinalizationCase !== "function") {
        throw new Error("Finalization claim seam is unavailable");
    }
    const result = await target.claimFinalizationCase.call(
        service,
        caseId,
        branchId,
        referenceDate,
    );
    if (
        !result
        || typeof result !== "object"
        || typeof (result as { claimed?: unknown }).claimed !== "boolean"
        || typeof (result as { attempts?: unknown }).attempts !== "number"
    ) {
        throw new Error("Finalization claim returned an invalid result");
    }
    return result as ClaimResult;
}

function createFinalizer(prisma: PrismaClient) {
    const lifecycle = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);
    const executeCase = jest.fn().mockRejectedValue(
        new Error("Unverified finalization must not call the document provider"),
    );
    const snapshot = { executeCase } as unknown as CreateAndSendServiceRecordSnapshotUsecase;
    const documentJobs = new EformsignDocumentJobService(
        new SbEformsignDocumentJobRepository(prisma as unknown as PrismaService),
        new SbEformsignDocRepository(prisma as unknown as PrismaService),
        new SbClientRepository(prisma as unknown as PrismaService),
    );
    const finalizer = new ServiceRecordFinalizationService(
        prisma as unknown as PrismaService,
        lifecycle,
        snapshot,
        documentJobs,
    );
    return { finalizer, lifecycle, executeCase };
}

async function confirmAdminDateMove(
    prisma: PrismaClient,
    fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>,
) {
    const editor = new AdminServiceRecordEditService(
        new ServiceRecordEditRepository(prisma as unknown as PrismaService),
    );
    const started = await editor.startDraft(
        fixture.branch.id,
        fixture.client.id,
        fixture.actorUserId,
        {},
    );
    const draft = started.draft;
    if (!draft) throw new Error("Finalization fixture did not create an editor draft");
    const changed = await editor.updateDraft(
        fixture.branch.id,
        draft.id,
        fixture.actorUserId,
        {
            expectedDraftVersion: draft.draftVersion,
            changes: { sessions: [{ sessionIndex: 3, notes: "admin partial revision" }] },
            dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
        },
    );
    if (!changed.draft) throw new Error("Finalization fixture draft update was not persisted");
    const preview = await editor.previewDraft(
        fixture.branch.id,
        draft.id,
        fixture.actorUserId,
        { expectedDraftVersion: changed.draft.draftVersion },
    );
    expect(preview.blockingReasons).toEqual([]);
    return editor.confirmDraft(
        fixture.branch.id,
        draft.id,
        fixture.actorUserId,
        {
            expectedDraftVersion: changed.draft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: randomUUID(),
        },
    );
}

describeE2E("service-record finalization eligibility and frozen input (real disposable PostgreSQL)", () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        // Guard before Prisma construction is mandatory: this suite is allowed
        // to use only the disposable task-4 loopback database.
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    it.each([
        { label: "only three of thirteen stored rows", completeHeader: true },
        { label: "missing service-record header", completeHeader: false },
    ])("does not claim a stale READY case after an administrator date move ($label)", async ({ completeHeader }) => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        if (completeHeader) {
            await prisma.service_record_case.update({
                where: { id: fixture.record.id },
                data: {
                    momName: fixture.client.name,
                    momBirth: "900101",
                    babyName: "Task 4 Baby",
                    babyBirth: "260101",
                    deliveryType: "single",
                    babyWeight: "3.2kg",
                },
            });
        } else {
            // Isolate missing header from missing sessions: all thirteen
            // submitted rows are present in this case.
            await completeServiceRecordFinalizationCase(prisma, fixture);
            await prisma.service_record_case.update({
                where: { id: fixture.record.id },
                data: { babyWeight: null },
            });
        }

        // Deliberately seed the stale lifecycle marker to model a READY row
        // left behind by an earlier date confirmation. The real claim must
        // re-read current header/session evidence before changing it.
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: {
                requiredSessionCount: ORIGINAL_THIRTEEN_DATES.length,
                status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE,
                // The existing policy makes an incomplete case due at the
                // service end date (20:00 KST), never at an invented end+7
                // hold. The date move below leaves this marker stale on
                // purpose so the finalizer must recompute current eligibility.
                finalizationDueAt: new Date("2026-09-23T11:00:00.000Z"),
            },
        });
        await confirmAdminDateMove(prisma, fixture);

        const { finalizer, executeCase } = createFinalizer(prisma);
        const beforeJobs = await prisma.eformsign_document_job.count({
            where: { clientId: fixture.client.id },
        });
        const claim = await claimFinalizationCase(
            finalizer,
            fixture.record.id,
            fixture.branch.id,
            new Date("2026-09-30T00:00:00.000Z"),
        );

        expect(claim.claimed).toBe(false);
        expect(claim.blockedGeneration).toBe(true);
        expect(executeCase).not.toHaveBeenCalled();
        expect(await prisma.eformsign_document_job.count({ where: { clientId: fixture.client.id } }))
            .toBe(beforeJobs);
        const current = await prisma.service_record_case.findUniqueOrThrow({
            where: { id: fixture.record.id },
        });
        expect(current.status).not.toBe(SERVICE_RECORD_CASE_STATUS.FINALIZING);
    });

    it("freezes a new complete generation input after a partial revision becomes eligible", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const confirmed = await confirmAdminDateMove(prisma, fixture);
        expect(confirmed.revisionId).toBeTruthy();

        const partialRevisionBefore = await prisma.service_record_revision.findUniqueOrThrow({
            where: { id: confirmed.revisionId! },
        });
        const delayedCompleteDays = await completeServiceRecordFinalizationCase(prisma, fixture);
        expect(delayedCompleteDays).toHaveLength(ORIGINAL_THIRTEEN_DATES.length);

        const { finalizer, lifecycle, executeCase } = createFinalizer(prisma);
        const ready = await lifecycle.recompute(fixture.record.id);
        expect(ready.status).toBe(SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE);

        const currentBeforeClaim = await prisma.service_record_case.findUniqueOrThrow({
            where: { id: fixture.record.id },
            select: { currentRevisionId: true },
        });
        expect(currentBeforeClaim.currentRevisionId).toBe(confirmed.revisionId);
        const requestKey = `service-record-initial-finalization:${currentBeforeClaim.currentRevisionId}`;

        const [firstClaim, concurrentClaim] = await Promise.all([
            claimFinalizationCase(
                finalizer,
                fixture.record.id,
                fixture.branch.id,
                new Date("2026-09-30T00:00:00.000Z"),
            ),
            claimFinalizationCase(
                finalizer,
                fixture.record.id,
                fixture.branch.id,
                new Date("2026-09-30T00:00:00.000Z"),
            ),
        ]);
        // Phase0 capability is deliberately unverified: the real finalizer
        // records a frozen manual-review job but does not claim/external-send.
        expect(firstClaim.claimed).toBe(false);
        expect(firstClaim.blockedGeneration).toBe(true);
        expect(concurrentClaim.claimed).toBe(false);
        expect(concurrentClaim.blockedGeneration).toBe(true);
        expect(executeCase).not.toHaveBeenCalled();

        const firstJob = await prisma.eformsign_document_job.findUniqueOrThrow({
            where: { requestKey },
        });
        expect(firstJob).toMatchObject({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            jobType: "create_document",
            source: "auto_finalize",
            requestKey,
        });
        const firstPayload = firstJob.payload;
        expect(firstPayload).toEqual(expect.objectContaining({
            kind: "service_record_revision",
            generationKind: "INITIAL_FINALIZATION",
            completeness: "complete",
            manualReviewRequired: true,
            generation: expect.any(String),
            immutablePayload: expect.any(Object),
            payloadFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/i),
            context: expect.objectContaining({
                revisionId: confirmed.revisionId,
                revisionNumber: confirmed.revisionNumber,
                plannedSessionCount: ORIGINAL_THIRTEEN_DATES.length,
            }),
        }));
        expect(JSON.stringify((firstPayload as { immutablePayload?: unknown }).immutablePayload))
            .toContain("complete-13");

        // The original administrator revision is append-only. Completion of
        // later provider rows creates a generation job bound to that revision;
        // it must not rewrite the partial history row.
        const partialRevisionAfter = await prisma.service_record_revision.findUniqueOrThrow({
            where: { id: partialRevisionBefore.id },
        });
        expect(partialRevisionAfter).toEqual(partialRevisionBefore);

        const frozenPayload = JSON.stringify(firstPayload);
        await prisma.service_record_day.update({
            where: { id: delayedCompleteDays.at(-1)!.id },
            data: { notes: "source mutated after finalization freeze" },
        });

        const retryClaim = await claimFinalizationCase(
            finalizer,
            fixture.record.id,
            fixture.branch.id,
            new Date("2026-09-30T00:00:00.000Z"),
        );
        expect(retryClaim.claimed).toBe(false);
        expect(executeCase).not.toHaveBeenCalled();

        const jobs = await prisma.eformsign_document_job.findMany({
            where: { requestKey },
            orderBy: { createdAt: "asc" },
        });
        expect(jobs).toHaveLength(1);
        expect(JSON.stringify(jobs[0]?.payload)).toBe(frozenPayload);
    });
});
