import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "@prisma/client";

import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";
import { ReconcileCompletedMirroredEformsignDocUsecase } from "application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

const ORIGINAL_END_DATE = new Date("2026-09-23T00:00:00.000Z");
const REVISED_END_DATE = new Date("2026-09-29T00:00:00.000Z");
const STALE_END_DATE = new Date("2026-09-20T00:00:00.000Z");
const RACE_END_DATE = new Date("2026-09-18T00:00:00.000Z");

type ConfirmFixture = Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>;

type ContractDocumentOverrides = {
    clientId?: number | null;
    customerPhone?: string | null;
    revisionId?: string | null;
    serviceRecordCaseId?: string | null;
    createdDate?: Date;
    updatedDate?: Date;
    sourceUpdatedDate?: Date;
    syncedAt?: Date;
};

type QueryBarrier = {
    entered: Promise<void>;
    arrive: () => void;
    released: Promise<void>;
    release: () => void;
};

function createQueryBarrier(): QueryBarrier {
    let arrive!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { arrive = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    return { entered, arrive, released, release };
}

async function waitForBarrier(
    barrier: Promise<void>,
    label: string,
    timeoutMs = 5_000,
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
        if (timer !== undefined) clearTimeout(timer);
    }
}

function withClientReadBarrier(
    client: PrismaClient,
    clientId: number,
    barrier: QueryBarrier,
): PrismaClient {
    let paused = false;
    return client.$extends({
        query: {
            client: {
                async findUnique({ args, query }) {
                    const result = await query(args);
                    const where = args.where as { id?: number } | undefined;
                    if (!paused && where?.id === clientId) {
                        paused = true;
                        barrier.arrive();
                        await barrier.released;
                    }
                    return result;
                },
            },
        },
    }) as unknown as PrismaClient;
}

function contractDetail(documentId: string): EformsignApiDocumentResponse {
    return {
        id: documentId,
        document_number: `MIRROR-${documentId}`,
        template: { id: "synthetic-contract-template", name: "산모신생아 계약서" },
        document_name: "산모신생아 건강관리 계약서",
        creator: {
            recipient_type: "01",
            id: "mirrored-contract-proof@example.test",
            name: "계약 담당자",
        },
        created_date: Date.parse("2026-09-01T00:00:00.000Z"),
        updated_date: Date.parse("2026-09-01T01:00:00.000Z"),
        current_status: {
            status_type: "050",
            step_type: "06",
            step_index: "3",
            step_name: "완료",
            step_recipients: [],
            step_group: 3,
        },
        fields: [],
    };
}

function createMirrorLinker(prisma: PrismaClient): LinkMirroredEformsignDocByPhoneUsecase {
    const config = {
        get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const settings = {
        getClientAutoRegistrationEnabled: jest.fn().mockResolvedValue(false),
        getGreetingOnAutoRegistrationEnabled: jest.fn().mockResolvedValue(false),
        getEformsignTemplateBranch: jest.fn().mockResolvedValue(null),
    };
    return new LinkMirroredEformsignDocByPhoneUsecase(
        prisma as unknown as PrismaService,
        config,
        settings as never,
        undefined,
        new ServiceRecordLifecycleService(prisma as unknown as PrismaService),
    );
}

async function createContractDocument(
    prisma: PrismaClient,
    fixture: ConfirmFixture,
    overrides: ContractDocumentOverrides = {},
) {
    const documentId = `synthetic-mirrored-contract:${randomUUID()}`;
    const createdDate = overrides.createdDate ?? new Date("2026-09-01T00:00:00.000Z");
    const updatedDate = overrides.updatedDate ?? createdDate;
    const sourceUpdatedDate = overrides.sourceUpdatedDate ?? new Date("2026-09-01T01:00:00.000Z");
    const syncedAt = overrides.syncedAt ?? new Date("2026-09-01T01:01:00.000Z");
    const detail = contractDetail(documentId);
    const serviceRecordCaseId = overrides.serviceRecordCaseId === undefined
        ? (overrides.revisionId ? fixture.record.id : null)
        : overrides.serviceRecordCaseId;

    const document = await prisma.eformsign_doc.create({
        data: {
            documentId,
            documentName: "산모신생아 건강관리 계약서",
            documentNumber: `MIRROR-${randomUUID()}`,
            templateName: "산모신생아 계약서",
            createdDate,
            updatedDate,
            expiredDate: new Date("2027-12-31T00:00:00.000Z"),
            statusType: "050",
            statusDetail: "완료",
            stepType: "06",
            stepIndex: "3",
            stepName: "완료",
            stepRecipientType: "02",
            stepRecipientName: "이용자",
            stepRecipientSms: "01012345678",
            customerPhone: overrides.customerPhone ?? null,
            branchId: fixture.branch.id,
            clientId: overrides.clientId === undefined ? fixture.client.id : overrides.clientId,
            documentKind: "contract",
            serviceRecordCaseId,
            revisionId: overrides.revisionId ?? null,
            detailPayload: detail as unknown as Prisma.InputJsonValue,
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: syncedAt,
            syncStatus: "ready",
        },
    });

    await prisma.eformsign_doc_file.createMany({
        data: ["document", "audit_trail"].map((fileType) => ({
            eformsignDocId: document.id,
            fileType,
            content: Buffer.from(`${documentId}:${fileType}`),
            contentType: "application/pdf",
            contentDisposition: null,
            byteSize: `${documentId}:${fileType}`.length,
            sha256: "a".repeat(64),
            sourceUpdatedDate,
            syncedAt,
        })),
    });

    return { ...document, detail, sourceUpdatedDate, syncedAt };
}

async function appendRevision(
    prisma: PrismaClient,
    fixture: ConfirmFixture,
    marker: string,
) {
    const repository = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
    return repository.appendRevision({
        branchId: fixture.branch.id,
        serviceRecordCaseId: fixture.record.id,
        actorUserId: fixture.actorUserId,
        payload: { mirroredContractEventFence: marker },
        plannedSessions: [],
        provenance: { source: "service-record-mirrored-contract-event-fence" },
        formVersionAtConfirm: 2,
    });
}

function createReconciler(
    prisma: PrismaClient,
    fixture: ConfirmFixture,
    endDate: Date,
    lifecyclePrisma: PrismaClient = prisma,
) {
    const mirrorRepository = new SbEformsignDocumentMirrorRepository(
        prisma as unknown as PrismaService,
    );
    const linkMirroredDocumentByPhoneUsecase = createMirrorLinker(prisma);
    const syncClientEndDateUsecase = {
        executeFromDocument: jest.fn(async (
            _branchId: string,
            _documentId: string,
            _detail: EformsignApiDocumentResponse,
            options: {
                persist?: (target: { clientId: number; endDate: Date }) => Promise<void>;
            },
        ) => {
            if (!options.persist) throw new Error("Missing mirrored persistence callback");
            await options.persist({ clientId: fixture.client.id, endDate });
            return { clientId: fixture.client.id, endDate };
        }),
    };
    const lifecycle = new ServiceRecordLifecycleService(
        lifecyclePrisma as unknown as PrismaService,
    );
    const reconciler = new ReconcileCompletedMirroredEformsignDocUsecase(
        linkMirroredDocumentByPhoneUsecase,
        syncClientEndDateUsecase as never,
        mirrorRepository,
        lifecycle,
    );
    return { reconciler, syncClientEndDateUsecase };
}

describeE2E("mirrored contract completion event ownership fence (real disposable PostgreSQL)", () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        // The guard must run before any Prisma client is constructed. This suite is
        // opt-in and is never allowed to use a developer, staging, or remote database.
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    it("keeps a newer revision and contract pointer authoritative over an old ready mirror", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const oldRevision = await appendRevision(prisma, fixture, "old");
        const currentRevision = await appendRevision(prisma, fixture, "current");
        const oldDocument = await createContractDocument(prisma, fixture, {
            revisionId: oldRevision.id,
            createdDate: new Date("2026-09-01T00:00:00.000Z"),
            updatedDate: new Date("2026-09-01T00:00:00.000Z"),
        });
        const currentDocument = await createContractDocument(prisma, fixture, {
            revisionId: currentRevision.id,
            createdDate: new Date("2026-09-10T00:00:00.000Z"),
            updatedDate: new Date("2026-09-10T00:00:00.000Z"),
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: {
                currentRevisionId: currentRevision.id,
                currentUsableRevisionId: currentRevision.id,
                currentUsableDocumentVersion: 1,
                endDate: REVISED_END_DATE,
            },
        });
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: currentDocument.documentId, endDate: REVISED_END_DATE },
        });

        const { reconciler, syncClientEndDateUsecase } = createReconciler(
            prisma,
            fixture,
            STALE_END_DATE,
        );
        // Match normal mirror completion: lifecycle initialization is enabled.
        await expect(reconciler.execute({
            documentId: oldDocument.documentId,
            detail: oldDocument.detail,
            options: { suppressOutboundAutomation: true },
        })).resolves.toBe("ambiguous");

        expect(syncClientEndDateUsecase.executeFromDocument).toHaveBeenCalledTimes(1);
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
        await expect(prisma.eformsign_doc.findUniqueOrThrow({ where: { id: oldDocument.id } }))
            .resolves.toMatchObject({ clientId: fixture.client.id, revisionId: oldRevision.id });
    });

    it("allows the current legacy mirror to reconcile its period", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const phone = `010${String((process.pid * 9_000 + Date.now()) % 100_000_000).padStart(8, "0")}`;
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { phone, phoneNormalized: phone },
        });
        const legacyDocument = await createContractDocument(prisma, fixture, {
            clientId: null,
            customerPhone: phone,
        });
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: null, endDate: ORIGINAL_END_DATE },
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: {
                currentRevisionId: null,
                currentUsableRevisionId: null,
                currentUsableDocumentVersion: null,
                endDate: ORIGINAL_END_DATE,
            },
        });

        const { reconciler } = createReconciler(prisma, fixture, REVISED_END_DATE);
        await expect(reconciler.execute({
            documentId: legacyDocument.documentId,
            detail: legacyDocument.detail,
            options: { suppressOutboundAutomation: true },
        })).resolves.toBe("linked");

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
    });

    it("rejects the original legacy mirror while a revision is pending", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const originalDocument = await createContractDocument(prisma, fixture);
        const pendingRevision = await appendRevision(prisma, fixture, "pending");
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: originalDocument.documentId, endDate: REVISED_END_DATE },
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: { currentRevisionId: pendingRevision.id, endDate: REVISED_END_DATE },
        });

        const beforeCase = await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } });
        const { reconciler } = createReconciler(prisma, fixture, ORIGINAL_END_DATE);
        await expect(reconciler.execute({
            documentId: originalDocument.documentId,
            detail: originalDocument.detail,
            options: { suppressOutboundAutomation: true },
        })).resolves.toBe("ambiguous");

        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({
                eDocId: originalDocument.documentId,
                endDate: REVISED_END_DATE,
            });
        await expect(prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .resolves.toMatchObject({
                currentRevisionId: pendingRevision.id,
                endDate: REVISED_END_DATE,
            });
        expect(await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .toEqual(beforeCase);
    });

    it("does not let an old revision replace a newer pointer even with a newer created date", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const oldRevision = await appendRevision(prisma, fixture, "old-pointer-candidate");
        const currentRevision = await appendRevision(prisma, fixture, "new-pointer-owner");
        const currentDocument = await createContractDocument(prisma, fixture, {
            revisionId: currentRevision.id,
            createdDate: new Date("2026-09-01T00:00:00.000Z"),
            updatedDate: new Date("2026-09-01T00:00:00.000Z"),
        });
        const oldDocument = await createContractDocument(prisma, fixture, {
            revisionId: oldRevision.id,
            createdDate: new Date("2028-01-01T00:00:00.000Z"),
            updatedDate: new Date("2028-01-01T00:00:00.000Z"),
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: { currentRevisionId: currentRevision.id },
        });
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: currentDocument.documentId },
        });

        const linker = createMirrorLinker(prisma);
        await expect(linker.execute(
            oldDocument.documentId,
            { linkExistingOnly: true, suppressOutboundAutomation: true },
            {
                detailSourceUpdatedDate: oldDocument.sourceUpdatedDate,
                detailSyncedAt: oldDocument.syncedAt,
            },
        )).resolves.toBe("ambiguous");

        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({ eDocId: currentDocument.documentId });
        await expect(prisma.eformsign_doc.findUniqueOrThrow({ where: { id: oldDocument.id } }))
            .resolves.toMatchObject({
                clientId: fixture.client.id,
                revisionId: oldRevision.id,
                createdDate: new Date("2028-01-01T00:00:00.000Z"),
            });
    });

    it("rejects a stale mirrored completion when the pointer changes after the linker read", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const currentRevision = await appendRevision(prisma, fixture, "race-current");
        const oldDocument = await createContractDocument(prisma, fixture, {
            revisionId: null,
            createdDate: new Date("2026-09-01T00:00:00.000Z"),
            updatedDate: new Date("2026-09-01T00:00:00.000Z"),
        });
        const currentDocument = await createContractDocument(prisma, fixture, {
            revisionId: currentRevision.id,
            createdDate: new Date("2026-09-02T00:00:00.000Z"),
            updatedDate: new Date("2026-09-02T00:00:00.000Z"),
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: {
                currentRevisionId: null,
                currentUsableRevisionId: null,
                currentUsableDocumentVersion: null,
                endDate: ORIGINAL_END_DATE,
            },
        });
        await prisma.client.update({
            where: { id: fixture.client.id },
            data: { eDocId: oldDocument.documentId, endDate: ORIGINAL_END_DATE },
        });

        const barrier = createQueryBarrier();
        const lifecyclePrisma = withClientReadBarrier(prisma, fixture.client.id, barrier);
        const { reconciler } = createReconciler(
            prisma,
            fixture,
            RACE_END_DATE,
            lifecyclePrisma,
        );
        const reconciliation = reconciler.execute({
            documentId: oldDocument.documentId,
            detail: oldDocument.detail,
            options: { suppressOutboundAutomation: true },
        });

        try {
            await waitForBarrier(barrier.entered, "mirrored lifecycle client read");
            await prisma.service_record_case.update({
                where: { id: fixture.record.id },
                data: {
                    currentRevisionId: currentRevision.id,
                    currentUsableRevisionId: currentRevision.id,
                    currentUsableDocumentVersion: 2,
                    endDate: REVISED_END_DATE,
                },
            });
            await prisma.client.update({
                where: { id: fixture.client.id },
                data: { eDocId: currentDocument.documentId, endDate: REVISED_END_DATE },
            });
            barrier.release();
            await expect(reconciliation).resolves.toBe("already_linked");
        } finally {
            barrier.release();
            await Promise.allSettled([reconciliation]);
        }

        await expect(prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .resolves.toMatchObject({
                eDocId: currentDocument.documentId,
                endDate: REVISED_END_DATE,
            });
        await expect(prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }))
            .resolves.toMatchObject({
                currentRevisionId: currentRevision.id,
                currentUsableRevisionId: currentRevision.id,
                currentUsableDocumentVersion: 2,
                endDate: REVISED_END_DATE,
            });
        await expect(prisma.eformsign_doc.findUniqueOrThrow({ where: { id: oldDocument.id } }))
            .resolves.toMatchObject({ clientId: fixture.client.id, revisionId: null });
    });

});
