import { randomUUID } from "node:crypto";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

const ORIGINAL_END_DATE = new Date("2026-09-23T00:00:00.000Z");
const REVISED_END_DATE = new Date("2026-09-29T00:00:00.000Z");
const STALE_END_DATE = new Date("2026-09-20T00:00:00.000Z");

type ConfirmFixture = Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>;

type ContractEventFenceRepository = SbEformsignDocRepository & {
    isCurrentContractDocument(branchId: string, documentId: string): Promise<boolean>;
};

type ContractEventFenceLifecycle = ServiceRecordLifecycleService & {
    syncEndDateFromCurrentContract(params: {
        branchId: string;
        clientId: number;
        endDate: Date;
        documentId: string;
    }): Promise<boolean>;
};

type ContractDocumentOverrides = Partial<{
    clientId: number | null;
    serviceRecordCaseId: string | null;
    revisionId: string | null;
    createdDate: Date;
    updatedDate: Date;
}>;

function createBarrier() {
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { release = resolve; });
    return { entered, release };
}

async function waitForBarrier(
    barrier: Promise<void>,
    label: string,
    timeoutMs = 5000,
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            barrier,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

describeE2E("contract completion event ownership fence (real disposable PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    let eformsignDocs: ContractEventFenceRepository;
    let lifecycle: ContractEventFenceLifecycle;
    let revisions: ServiceRecordEditRepository;

    beforeAll(async () => {
        // Keep the database guard before any Prisma construction. This suite is
        // intentionally opt-in and must never point at a developer or remote DB.
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        eformsignDocs = new SbEformsignDocRepository(prisma as unknown as PrismaService) as ContractEventFenceRepository;
        lifecycle = new ServiceRecordLifecycleService(prisma as unknown as PrismaService) as ContractEventFenceLifecycle;
        revisions = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    async function contractDocument(
        fixture: ConfirmFixture,
        overrides: ContractDocumentOverrides = {},
    ) {
        const createdDate = overrides.createdDate ?? new Date("2026-09-01T00:00:00.000Z");
        const updatedDate = overrides.updatedDate ?? createdDate;
        return prisma.eformsign_doc.create({
            data: {
                branchId: fixture.branch.id,
                clientId: overrides.clientId === undefined ? fixture.client.id : overrides.clientId,
                serviceRecordCaseId: overrides.serviceRecordCaseId ?? null,
                revisionId: overrides.revisionId ?? null,
                documentKind: "contract",
                documentId: `synthetic-contract-event:${randomUUID()}`,
                createdDate,
                updatedDate,
                expiredDate: new Date("2027-12-31T00:00:00.000Z"),
                statusType: "003",
                statusDetail: "Synthetic completed contract",
                stepType: "06",
                stepIndex: "3",
                stepName: "Synthetic provider review",
                stepRecipientType: "group",
                stepRecipientName: "Synthetic provider",
                stepRecipientSms: "",
                syncStatus: "synced",
            },
        });
    }

    async function appendRevision(fixture: ConfirmFixture, marker: string) {
        return revisions.appendRevision({
            branchId: fixture.branch.id,
            serviceRecordCaseId: fixture.record.id,
            actorUserId: fixture.actorUserId,
            payload: { eventFence: marker },
            plannedSessions: [],
            provenance: { source: "service-record-contract-event-fence" },
            formVersionAtConfirm: 2,
        });
    }

    it("rejects an older revision contract without replacing the current pointer or end date", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const olderRevision = await appendRevision(fixture, "older");
        const currentRevision = await appendRevision(fixture, "current");
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: {
                currentRevisionId: currentRevision.id,
                currentUsableRevisionId: currentRevision.id,
                currentUsableDocumentVersion: 1,
            },
        });

        const olderDocument = await contractDocument(fixture, {
            revisionId: olderRevision.id,
            serviceRecordCaseId: fixture.record.id,
            createdDate: new Date("2026-09-01T00:00:00.000Z"),
            updatedDate: new Date("2026-09-01T00:00:00.000Z"),
        });
        const currentDocument = await contractDocument(fixture, {
            revisionId: currentRevision.id,
            serviceRecordCaseId: fixture.record.id,
            createdDate: new Date("2026-09-10T00:00:00.000Z"),
            updatedDate: new Date("2026-09-10T00:00:00.000Z"),
        });
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: currentDocument.documentId, endDate: REVISED_END_DATE },
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: { endDate: REVISED_END_DATE },
        });

        await expect(
            eformsignDocs.isCurrentContractDocument(fixture.branch.id, olderDocument.documentId),
        ).resolves.toBe(false);
        await expect(
            eformsignDocs.linkClientIfActive(fixture.branch.id, olderDocument.documentId, fixture.client.id),
        ).resolves.toBe(false);
        await expect(lifecycle.syncEndDateFromCurrentContract({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            documentId: olderDocument.documentId,
            endDate: STALE_END_DATE,
        })).resolves.toBe(false);

        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({
                eDocId: currentDocument.documentId,
                endDate: REVISED_END_DATE,
                duration: 15,
                fullPrice: "1500000",
                grant: "900000",
                actualPrice: "600000",
            });
        await expect(prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .resolves.toMatchObject({
                currentRevisionId: currentRevision.id,
                currentUsableRevisionId: currentRevision.id,
                currentUsableDocumentVersion: 1,
                endDate: REVISED_END_DATE,
            });
        await expect(prisma.eformsign_doc.findUniqueOrThrow({ where: { id: olderDocument.id } }))
            .resolves.toMatchObject({ clientId: fixture.client.id, revisionId: olderRevision.id });
    });

    it("rejects the original legacy pointer while a current revision is pending", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const originalDocument = await contractDocument(fixture, {
            createdDate: new Date("2026-09-01T00:00:00.000Z"),
            updatedDate: new Date("2026-09-01T00:00:00.000Z"),
        });
        const currentRevision = await appendRevision(fixture, "pending-current");
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: originalDocument.documentId, endDate: REVISED_END_DATE },
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: { currentRevisionId: currentRevision.id, endDate: REVISED_END_DATE },
        });

        await expect(
            eformsignDocs.isCurrentContractDocument(fixture.branch.id, originalDocument.documentId),
        ).resolves.toBe(false);
        await expect(
            eformsignDocs.linkClientIfActive(fixture.branch.id, originalDocument.documentId, fixture.client.id),
        ).resolves.toBe(false);
        await expect(lifecycle.syncEndDateFromCurrentContract({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            documentId: originalDocument.documentId,
            endDate: ORIGINAL_END_DATE,
        })).resolves.toBe(false);

        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({ eDocId: originalDocument.documentId, endDate: REVISED_END_DATE });
        await expect(prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .resolves.toMatchObject({ currentRevisionId: currentRevision.id, endDate: REVISED_END_DATE });
    });

    it("allows a current legacy contract to link and synchronize its period", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        // A completion can arrive before the client resolver has persisted the
        // document owner. The locked target client is valid legacy evidence, so
        // the linker must establish both sides of the relationship atomically.
        const legacyDocument = await contractDocument(fixture, { clientId: null });
        expect((await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } })).eDocId).toBeNull();

        await expect(
            eformsignDocs.linkClientIfActive(fixture.branch.id, legacyDocument.documentId, fixture.client.id),
        ).resolves.toBe(true);
        await expect(
            eformsignDocs.isCurrentContractDocument(fixture.branch.id, legacyDocument.documentId),
        ).resolves.toBe(true);
        await expect(lifecycle.syncEndDateFromCurrentContract({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            documentId: legacyDocument.documentId,
            endDate: REVISED_END_DATE,
        })).resolves.toBe(true);

        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({
                eDocId: legacyDocument.documentId,
                endDate: REVISED_END_DATE,
                duration: 15,
                fullPrice: "1500000",
                grant: "900000",
                actualPrice: "600000",
            });
        await expect(prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .resolves.toMatchObject({
                currentRevisionId: null,
                currentUsableRevisionId: null,
                currentUsableDocumentVersion: null,
                endDate: REVISED_END_DATE,
            });
        await expect(prisma.eformsign_doc.findUniqueOrThrow({ where: { id: legacyDocument.id } }))
            .resolves.toMatchObject({ clientId: fixture.client.id });
    });

    it("allows a revision contract only when the persisted current revision and pointer agree", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const currentRevision = await appendRevision(fixture, "verified-current");
        const currentDocument = await contractDocument(fixture, {
            revisionId: currentRevision.id,
            serviceRecordCaseId: fixture.record.id,
            createdDate: new Date("2026-09-10T00:00:00.000Z"),
            updatedDate: new Date("2026-09-10T00:00:00.000Z"),
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: {
                currentRevisionId: currentRevision.id,
                currentUsableRevisionId: currentRevision.id,
                currentUsableDocumentVersion: 1,
                endDate: ORIGINAL_END_DATE,
            },
        });
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: currentDocument.documentId, endDate: ORIGINAL_END_DATE },
        });

        await expect(
            eformsignDocs.isCurrentContractDocument(fixture.branch.id, currentDocument.documentId),
        ).resolves.toBe(true);
        await expect(lifecycle.syncEndDateFromCurrentContract({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            documentId: currentDocument.documentId,
            endDate: REVISED_END_DATE,
        })).resolves.toBe(true);

        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({ eDocId: currentDocument.documentId, endDate: REVISED_END_DATE });
        await expect(prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .resolves.toMatchObject({
                currentRevisionId: currentRevision.id,
                currentUsableRevisionId: currentRevision.id,
                currentUsableDocumentVersion: 1,
                endDate: REVISED_END_DATE,
            });
    });

    it("rejects a legacy completion when a revision becomes current during its locked read", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const legacyDocument = await contractDocument(fixture);
        const currentRevision = await appendRevision(fixture, "raced-current");
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: legacyDocument.documentId, endDate: ORIGINAL_END_DATE },
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: { endDate: ORIGINAL_END_DATE },
        });

        const entered = createBarrier();
        const release = createBarrier();
        let paused = false;
        const instrumented = prisma.$extends({
            query: {
                client: {
                    async findUnique({ args, query }) {
                        const result = await query(args);
                        const where = args.where as { id?: number } | undefined;
                        if (!paused && where?.id === fixture.client.id) {
                            paused = true;
                            entered.release();
                            await release.entered;
                        }
                        return result;
                    },
                },
            },
        });
        const racedLifecycle = new ServiceRecordLifecycleService(
            instrumented as unknown as PrismaService,
        ) as ContractEventFenceLifecycle;
        const syncPromise = racedLifecycle.syncEndDateFromCurrentContract({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            documentId: legacyDocument.documentId,
            endDate: STALE_END_DATE,
        });

        await waitForBarrier(entered.entered, "client ownership read");
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: { currentRevisionId: currentRevision.id },
        });
        release.release();

        await expect(syncPromise).resolves.toBe(false);
        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({ eDocId: legacyDocument.documentId, endDate: ORIGINAL_END_DATE });
        await expect(prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .resolves.toMatchObject({ currentRevisionId: currentRevision.id, endDate: ORIGINAL_END_DATE });
    });
});
