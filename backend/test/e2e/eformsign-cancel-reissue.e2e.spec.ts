import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { SbEformsignCancellationRepository } from "infrastructure/database/repositories/sb.eformsign-cancellation.repository";
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";
import { EFORMSIGN_DISPATCH_INTENT_STATUS } from "domain/entities/eformsign-dispatch-intent.entity";
import {
    assertApprovedEformsignCancelReissueDatabaseTarget,
    barrier,
    cleanupCancelReissueFixture,
    createApprovedEformsignCancelReissueClient,
    createCancelReissueFixture,
    createDispatchIntentInput,
    failFirstMirrorUpdate,
    holdMirrorRow,
    instrumentMirrorLock,
} from "./helpers/eformsign-cancel-reissue.helper";

const describeE2E = process.env["EFORMSIGN_CANCEL_REISSUE_E2E"] === "1"
    ? describe
    : describe.skip;

function isConflict(error: unknown): boolean {
    return error instanceof ConflictException;
}

describeE2E("eformsign durable cancellation and reissue (disposable PostgreSQL)", () => {
    let prisma: PrismaClient;
    const extraClients: PrismaClient[] = [];
    const fixtureBranches: string[] = [];

    beforeAll(async () => {
        assertApprovedEformsignCancelReissueDatabaseTarget();
        prisma = createApprovedEformsignCancelReissueClient();
        await prisma.$connect();
    });

    afterEach(async () => {
        for (const branchId of fixtureBranches.splice(0)) {
            await cleanupCancelReissueFixture(prisma, branchId);
        }
        await Promise.all(extraClients.splice(0).map((client) => client.$disconnect()));
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    async function fixture() {
        const created = await createCancelReissueFixture(prisma);
        fixtureBranches.push(created.branch.id);
        return created;
    }

    function openClient(): PrismaClient {
        const client = createApprovedEformsignCancelReissueClient();
        extraClients.push(client);
        return client;
    }

    it("allows exactly one concurrent cancel claim and preserves its fence", async () => {
        const created = await fixture();
        const clientA = openClient();
        const clientB = openClient();
        await Promise.all([clientA.$connect(), clientB.$connect()]);
        const repoA = new SbEformsignCancellationRepository(clientA as never);
        const repoB = new SbEformsignCancellationRepository(clientB as never);
        const held = barrier();
        const release = barrier();
        const holding = holdMirrorRow(
            prisma,
            created.branch.id,
            created.document.documentId,
            held.release,
            release.entered,
        );
        await held.entered;

        const first = repoA.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "concurrent cancel A",
        });
        const second = repoB.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "concurrent cancel B",
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        release.release();
        const results = await Promise.allSettled([first, second]);
        await holding;

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) =>
            result.status === "rejected" && isConflict(result.reason),
        )).toHaveLength(1);
        const intents = await prisma.eformsign_dispatch_intent.findMany({
            where: { branchId: created.branch.id, action: "cancel" },
        });
        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({ status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED });
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({ permanentPurgeRequestedAt: expect.any(Date) });
    });

    it("lets a cancellation mirror lock win before dispatch and refuses the pending dispatch", async () => {
        const created = await fixture();
        const cancellationClient = openClient();
        const dispatchClient = openClient();
        await Promise.all([cancellationClient.$connect(), dispatchClient.$connect()]);
        const cancellationAcquired = barrier();
        const cancellationRelease = barrier();
        const lockedCancellationClient = instrumentMirrorLock(cancellationClient, {
            acquired: cancellationAcquired.release,
            holdAfterAcquire: cancellationRelease.entered,
        });
        const cancellationRepository = new SbEformsignCancellationRepository(
            lockedCancellationClient as never,
        );
        const dispatchRepository = new SbEformsignDispatchIntentRepository(dispatchClient as never);
        const cancellation = cancellationRepository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "cancel owns mirror first",
        });
        await cancellationAcquired.entered;

        const prepared = await dispatchRepository.prepare(createDispatchIntentInput({
            branchId: created.branch.id,
            clientId: created.client.id,
            localDocumentId: created.document.id,
        }));
        const dispatch = dispatchRepository.claim(prepared.id, created.branch.id);
        await new Promise<void>((resolve) => setImmediate(resolve));
        cancellationRelease.release();

        await expect(cancellation).resolves.toHaveProperty("targets");
        await expect(dispatch).rejects.toBeInstanceOf(ConflictException);
        const intent = await prisma.eformsign_dispatch_intent.findUniqueOrThrow({
            where: { id: prepared.id },
        });
        expect(intent.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED);
    });

    it("lets dispatch claim the mirror first and refuses cancellation while it is in flight", async () => {
        const created = await fixture();
        const dispatchClient = openClient();
        const cancellationClient = openClient();
        await Promise.all([dispatchClient.$connect(), cancellationClient.$connect()]);
        const dispatchAcquired = barrier();
        const dispatchRelease = barrier();
        const lockedDispatchClient = instrumentMirrorLock(dispatchClient, {
            acquired: dispatchAcquired.release,
            holdAfterAcquire: dispatchRelease.entered,
        });
        const dispatchRepository = new SbEformsignDispatchIntentRepository(
            lockedDispatchClient as never,
        );
        const cancellationRepository = new SbEformsignCancellationRepository(cancellationClient as never);
        const prepared = await dispatchRepository.prepare(createDispatchIntentInput({
            branchId: created.branch.id,
            clientId: created.client.id,
            localDocumentId: created.document.id,
        }));
        const dispatch = dispatchRepository.claim(prepared.id, created.branch.id);
        await dispatchAcquired.entered;
        const cancellation = cancellationRepository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "dispatch owns mirror first",
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        dispatchRelease.release();

        await expect(dispatch).resolves.toMatchObject({ claimed: true });
        await expect(cancellation).rejects.toBeInstanceOf(ConflictException);
        expect(await prisma.eformsign_dispatch_intent.findMany({
            where: { branchId: created.branch.id, action: "cancel" },
        })).toHaveLength(0);
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({ permanentPurgeRequestedAt: null });
    });

    it("rolls back accepted CAS and purge on fault, then retries atomically", async () => {
        const created = await fixture();
        const repository = new SbEformsignCancellationRepository(prisma as never);
        const { targets } = await repository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "fault rollback",
        });
        const target = targets[0]!;
        const failingClient = failFirstMirrorUpdate(prisma, "synthetic purge fault");
        const failingRepository = new SbEformsignCancellationRepository(failingClient as never);
        await expect(failingRepository.completeAccepted({
            target,
            providerReceipt: { source: "e2e", decision: "accepted" },
        })).rejects.toThrow("synthetic purge fault");
        expect(await prisma.eformsign_dispatch_intent.findUniqueOrThrow({
            where: { id: target.cancellationIntent.id },
        })).toMatchObject({ status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED });
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({
            statusType: "010",
            permanentPurgeRequestedAt: expect.any(Date),
        });

        const accepted = await repository.completeAccepted({
            target,
            providerReceipt: { source: "e2e", decision: "accepted" },
        });
        expect(accepted.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED);
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({ statusType: "049", permanentPurgeRequestedAt: null });
    });

    it("rolls back begin insert and fence together when fencing fails", async () => {
        const created = await fixture();
        const failingRepository = new SbEformsignCancellationRepository(
            failFirstMirrorUpdate(prisma, "synthetic fence fault") as never,
        );
        await expect(failingRepository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "fence rollback",
        })).rejects.toThrow("synthetic fence fault");
        expect(await prisma.eformsign_dispatch_intent.count({
            where: { branchId: created.branch.id, action: "cancel" },
        })).toBe(0);
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({ permanentPurgeRequestedAt: null });
        const repository = new SbEformsignCancellationRepository(prisma as never);
        await expect(repository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "fence retry",
        })).resolves.toHaveProperty("targets");
    });

    it("uses only the accepted cancellation id for reissue and elects one concurrent claimant", async () => {
        const created = await fixture();
        const cancellationRepository = new SbEformsignCancellationRepository(prisma as never);
        const { targets } = await cancellationRepository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "accepted cancellation",
        });
        const target = targets[0]!;
        const accepted = await cancellationRepository.completeAccepted({
            target,
            providerReceipt: { source: "e2e", decision: "accepted" },
        });
        const dispatchRepository = new SbEformsignDispatchIntentRepository(prisma as never);
        const boundary = new EformsignDispatchBoundaryService(dispatchRepository);
        await expect(boundary.resolveCreateGeneration({
            branchId: created.branch.id,
            clientId: created.client.id,
            assignmentId: null,
            templateId: "cancel-reissue-template",
            latestLocalDocumentId: null,
        })).resolves.toBe(`reissue:${accepted.id}`);

        const clientA = openClient();
        const clientB = openClient();
        await Promise.all([clientA.$connect(), clientB.$connect()]);
        const repoA = new SbEformsignDispatchIntentRepository(clientA as never);
        const repoB = new SbEformsignDispatchIntentRepository(clientB as never);
        const start = barrier();
        const input = createDispatchIntentInput({
            branchId: created.branch.id,
            clientId: created.client.id,
            generation: `reissue:${accepted.id}`,
            businessKey: "r".repeat(64),
            fingerprint: "s".repeat(64),
        });
        const prepareA = (async () => { await start.entered; return repoA.prepare(input); })();
        const prepareB = (async () => { await start.entered; return repoB.prepare(input); })();
        start.release();
        const [preparedA, preparedB] = await Promise.all([prepareA, prepareB]);
        expect(preparedA.id).toBe(preparedB.id);

        const claimStart = barrier();
        const claimA = (async () => { await claimStart.entered; return repoA.claim(preparedA.id, created.branch.id); })();
        const claimB = (async () => { await claimStart.entered; return repoB.claim(preparedB.id, created.branch.id); })();
        claimStart.release();
        const [claimedA, claimedB] = await Promise.all([claimA, claimB]);
        expect([claimedA?.claimed, claimedB?.claimed].filter(Boolean)).toHaveLength(1);
        expect(await prisma.eformsign_dispatch_intent.findUniqueOrThrow({
            where: { id: preparedA.id },
        })).toMatchObject({ status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED, attemptCount: 1 });
    });

    it("refuses a stale prepared claim after cancellation tombstones the mirror", async () => {
        const created = await fixture();
        const cancellationRepository = new SbEformsignCancellationRepository(prisma as never);
        const { targets } = await cancellationRepository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "stale prepared claim",
        });
        await cancellationRepository.completeAccepted({
            target: targets[0]!,
            providerReceipt: { source: "e2e", decision: "accepted" },
        });
        const dispatchRepository = new SbEformsignDispatchIntentRepository(prisma as never);
        const prepared = await dispatchRepository.prepare(createDispatchIntentInput({
            branchId: created.branch.id,
            clientId: created.client.id,
            localDocumentId: created.document.id,
            generation: "stale-prepared",
        }));
        await expect(dispatchRepository.claim(prepared.id, created.branch.id))
            .rejects.toBeInstanceOf(ConflictException);
        expect(await prisma.eformsign_dispatch_intent.findUniqueOrThrow({
            where: { id: prepared.id },
        })).toMatchObject({ status: EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED });
    });

    it("keeps legacy scope uniqueness and cross-branch provider identity fail-closed", async () => {
        const unique = await fixture();
        const repository = new SbEformsignCancellationRepository(prisma as never);
        const uniqueTarget = (await repository.begin({
            branchId: unique.branch.id,
            documentIds: [unique.document.documentId],
            actorUserId: randomUUID(),
            reason: "unique legacy scope",
        })).targets[0]!;
        await repository.clearAuthoritativeRefusal({
            target: uniqueTarget,
            reason: "legacy scope fixture cleanup",
            actorUserId: randomUUID(),
        });

        const ambiguous = await fixture();
        await prisma.eformsign_doc.create({
            data: {
                documentId: `${ambiguous.document.documentId}-second`,
                documentName: "Cancel reissue fixture second",
                customerName: ambiguous.client.name,
                customerPhone: ambiguous.client.phone,
                createdDate: ambiguous.document.createdDate,
                updatedDate: ambiguous.document.updatedDate,
                statusType: "010",
                statusDetail: "created",
                stepType: "01",
                stepIndex: "1",
                stepName: "start",
                stepRecipientType: "signer",
                stepRecipientName: ambiguous.client.name,
                stepRecipientSms: ambiguous.client.phone ?? "01000000000",
                expiredDate: ambiguous.document.expiredDate,
                clientId: ambiguous.client.id,
                branchId: ambiguous.branch.id,
                documentKind: "contract",
                templateId: "cancel-reissue-template",
            },
        });
        await expect(repository.begin({
            branchId: ambiguous.branch.id,
            documentIds: [ambiguous.document.documentId],
            actorUserId: randomUUID(),
            reason: "ambiguous legacy scope",
        })).rejects.toBeInstanceOf(ConflictException);
        expect(await prisma.eformsign_dispatch_intent.count({
            where: { branchId: ambiguous.branch.id, action: "cancel" },
        })).toBe(0);

        const crossBranch = await fixture();
        const foreignIntent = await prisma.eformsign_dispatch_intent.create({
            data: {
                branchId: crossBranch.branch.id,
                clientId: crossBranch.client.id,
                localDocumentId: null,
                assignmentId: null,
                providerDocumentId: unique.document.documentId,
                templateId: "cancel-reissue-template",
                action: "cancel",
                generation: `foreign-cancel-${randomUUID()}`,
                businessKey: "f".repeat(64),
                fingerprint: "g".repeat(64),
                status: EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                attemptCount: 1,
            },
        });
        await expect(repository.begin({
            branchId: crossBranch.branch.id,
            documentIds: [unique.document.documentId],
            actorUserId: randomUUID(),
            reason: "cross branch provider id",
        })).rejects.toBeInstanceOf(ConflictException);
        await expect(repository.reconcile({
            branchId: crossBranch.branch.id,
            intentId: foreignIntent.id,
            actorUserId: randomUUID(),
            reason: "cross branch reconcile",
            outcome: "not_delivered",
            providerDocumentId: unique.document.documentId,
        })).rejects.toBeInstanceOf(ConflictException);
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: unique.document.documentId },
        })).toMatchObject({ statusType: "010", permanentPurgeRequestedAt: null });
    });

    it("clears only the matching refusal fence while ambiguous outcomes retain theirs", async () => {
        const created = await fixture();
        const repository = new SbEformsignCancellationRepository(prisma as never);
        const first = (await repository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "first attempt",
        })).targets[0]!;
        await repository.markUncertain({
            target: first,
            reason: "timeout 408",
            providerDocumentId: first.providerDocumentId,
        });
        const second = (await repository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "retry attempt",
        })).targets[0]!;
        const stale = await repository.clearAuthoritativeRefusal({
            target: first,
            reason: "authoritative refusal from stale attempt",
            actorUserId: randomUUID(),
        });
        expect(stale.attemptCount).toBe(second.cancellationIntent.attemptCount);
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({ permanentPurgeRequestedAt: second.purgeGeneration });

        const cleared = await repository.clearAuthoritativeRefusal({
            target: second,
            reason: "authoritative refusal",
            actorUserId: randomUUID(),
        });
        expect(cleared.status).toBe(EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED);
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({ permanentPurgeRequestedAt: null });

        const ambiguous = (await repository.begin({
            branchId: created.branch.id,
            documentIds: [created.document.documentId],
            actorUserId: randomUUID(),
            reason: "ambiguous retry",
        })).targets[0]!;
        await repository.markUncertain({
            target: ambiguous,
            reason: "provider 4000031",
            providerDocumentId: ambiguous.providerDocumentId,
        });
        expect(await prisma.eformsign_doc.findUniqueOrThrow({
            where: { documentId: created.document.documentId },
        })).toMatchObject({ permanentPurgeRequestedAt: expect.any(Date) });
    });
});
