import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";

/**
 * `claimCompletionFromStoredDetail` over the REAL webhook service and repository with an
 * in-memory `eformsign_doc` table. The row mirrors the production incident: summary columns
 * still at 060 / original send time while the stored detail says 003 at completion time.
 */
describe("EformsignWebhookService.claimCompletionFromStoredDetail (real repository, in-memory table)", () => {
    const branchId = "test-branch";
    const documentId = "doc-stored-claim-1";

    type Row = {
        id: number;
        documentId: string;
        branchId: string;
        statusType: string;
        statusDetail: string;
        stepType: string;
        stepIndex: string;
        updatedDate: Date;
        permanentPurgeRequestedAt: Date | null;
    } & Record<string, unknown>;
    type Where = {
        branchId?: string;
        documentId?: string;
        permanentPurgeRequestedAt?: null;
        statusType?: { notIn?: string[] };
        updatedDate?: { lt?: Date };
    };

    const baseRow = (overrides: Partial<Row> = {}): Row => ({
        id: 1,
        documentId,
        branchId,
        documentName: "산모신생아건강관리서비스 계약서",
        documentNumber: null,
        templateName: "template",
        customerName: "고객",
        creatorName: "생성자",
        lastEditorName: "편집자",
        stepRecipientTypes: null,
        createdDate: new Date("2026-09-30T00:00:00.000Z"),
        updatedDate: new Date("2026-10-01T09:00:00.000Z"),
        statusType: "060",
        statusDetail: "서명 요청됨",
        stepType: "05",
        stepIndex: "2",
        stepName: "이용자",
        stepRecipientType: "01",
        stepRecipientName: "직원",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-12-01T00:00:00.000Z"),
        expired: false,
        clientId: 9,
        documentKind: null,
        employeeScheduleId: null,
        templateId: null,
        permanentPurgeRequestedAt: null,
        ...overrides,
    });

    let table: Row;
    // Runs right before the claim's compare-and-set, i.e. a webhook write that lands
    // after the service has read whatever it was going to read.
    let beforeClaimUpdate: (() => void) | undefined;

    const matches = (row: Row, where: Where): boolean => {
        if (where.branchId !== undefined && where.branchId !== row.branchId) return false;
        if (where.documentId !== undefined && where.documentId !== row.documentId) return false;
        if (
            where.permanentPurgeRequestedAt === null
            && row.permanentPurgeRequestedAt !== null
        ) return false;
        if (where.statusType?.notIn?.includes(row.statusType)) return false;
        if (where.updatedDate?.lt && !(row.updatedDate < where.updatedDate.lt)) return false;
        return true;
    };

    const prisma = {
        eformsign_doc: {
            findUnique: jest.fn(async () => ({ ...table })),
            findFirst: jest.fn(async ({ where }: { where: Where }) =>
                matches(table, where) ? { ...table } : null),
            updateMany: jest.fn(async ({ where, data }: {
                where: Where;
                data: Record<string, unknown>;
            }) => {
                beforeClaimUpdate?.();
                beforeClaimUpdate = undefined;
                if (!matches(table, where)) return { count: 0 };
                for (const [key, value] of Object.entries(data)) {
                    if (value !== undefined) (table as Record<string, unknown>)[key] = value;
                }
                return { count: 1 };
            }),
        },
    };

    const storedDetail = (statusType: string, updatedDate = "2026-10-02T09:00:00.000Z"): never => ({
        id: documentId,
        document_name: "산모신생아건강관리서비스 계약서",
        template: { id: "template-1", name: "template" },
        updated_date: Date.parse(updatedDate),
        current_status: {
            status_type: statusType,
            step_type: "06",
            step_index: "3",
            step_name: "완료",
        },
    }) as never;

    let service: EformsignWebhookService;
    let repository: SbEformsignDocRepository;

    beforeEach(() => {
        table = baseRow();
        repository = new SbEformsignDocRepository(prisma as never);
        service = new EformsignWebhookService(
            new UpdateEformsignDocStatusUsecase(repository),
            { execute: jest.fn() } as never,
            { execute: jest.fn(), executeFromDocument: jest.fn() } as never,
            { emit: jest.fn() } as never,
            { sendToBranchUsers: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }) } as never,
            { getAccessToken: jest.fn(), getDocument: jest.fn() } as never,
            { withCredentials: jest.fn() } as never,
            { findById: jest.fn().mockResolvedValue(null) } as never,
            repository,
            { findByClientId: jest.fn().mockResolvedValue([]) } as never,
            { findById: jest.fn().mockResolvedValue(null) } as never,
            { execute: jest.fn(), mirrorRemoteDocument: jest.fn() } as never,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("claims 050 from a completed stored detail using its updated_date and step fields", async () => {
        const result = await service.claimCompletionFromStoredDetail(
            documentId,
            storedDetail("003"),
        );

        expect(result).toEqual({ completionClaim: "claimed", completionBranchId: branchId });
        expect(table.statusType).toBe("050");
        expect(table.statusDetail).toBe("완료");
        expect(table.stepType).toBe("06");
        expect(table.stepIndex).toBe("3");
        expect(table.updatedDate).toEqual(new Date("2026-10-02T09:00:00.000Z"));
    });

    it.each(["060", "070", "061", "062"])(
        "does nothing when the stored detail is %s",
        async (statusType) => {
            const before = { ...table };

            const result = await service.claimCompletionFromStoredDetail(
                documentId,
                storedDetail(statusType),
            );

            expect(result).toBeUndefined();
            expect(table).toEqual(before);
            expect(prisma.eformsign_doc.updateMany).not.toHaveBeenCalled();
        },
    );

    it("does not turn a 062 (participant accepted) contract into terminal completion, so a later 070 still lands", async () => {
        const claim = await service.claimCompletionFromStoredDetail(
            documentId,
            storedDetail("062"),
        );
        expect(claim).toBeUndefined();
        expect(table.statusType).toBe("060");

        await service.processWebhook(
            {
                webhook_id: "wh-070",
                webhook_name: "contract-status",
                company_id: "company-1",
                event_type: "document",
                document: {
                    id: documentId,
                    document_title: "계약서",
                    template_id: "template-1",
                    template_name: "template",
                    workflow_seq: 3,
                    workflow_name: "제공기관 확인",
                    status: "doc_request_reviewer",
                    updated_date: Date.parse("2026-10-02T09:30:00.000Z"),
                },
            } as never,
            { mirroredDocument: storedDetail("070", "2026-10-02T09:30:00.000Z") },
        );

        expect(table.statusType).toBe("070");
    });

    it("keeps the full completed set for a service-record snapshot, which completes at 062", async () => {
        process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = "template-1";
        try {
            const result = await service.claimCompletionFromStoredDetail(
                documentId,
                storedDetail("062"),
            );

            expect(result).toEqual({ completionClaim: "claimed", completionBranchId: branchId });
            expect(table.statusType).toBe("050");
        } finally {
            delete process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
        }
    });

    describe("document kind classification (shared with the mirror linker)", () => {
        const snapshotRow = (overrides: Partial<Row> = {}): Row => baseRow({
            documentKind: "service_record_snapshot",
            templateId: "retired-template",
            ...overrides,
        });
        const retiredTemplateDetail = (statusType: string): never => ({
            ...(storedDetail(statusType) as object),
            template: { id: "retired-template", name: "retired" },
        }) as never;

        it("claims 050 for a persisted service-record snapshot on a retired template at 062", async () => {
            // The template id is no longer in any EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID* config.
            table = snapshotRow();

            const result = await service.claimCompletionFromStoredDetail(
                documentId,
                retiredTemplateDetail("062"),
            );

            expect(result).toEqual({ completionClaim: "claimed", completionBranchId: branchId });
            expect(table.statusType).toBe("050");
        });

        it("reports a retired-template snapshot as eligible at 062", async () => {
            table = snapshotRow();

            await expect(
                service.resolveCompletionHealEligibility(
                    documentId,
                    retiredTemplateDetail("062"),
                ),
            ).resolves.toEqual({
                eligible: true,
                branchId,
                serviceRecordSnapshot: true,
            });
        });

        it("keeps the 062 exclusion for an explicitly classified contract, even on a configured service-record template", async () => {
            process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = "template-1";
            try {
                table = baseRow({ documentKind: "contract", templateId: "template-1" });

                await expect(
                    service.resolveCompletionHealEligibility(documentId, storedDetail("062")),
                ).resolves.toEqual({ eligible: false });
                await expect(
                    service.claimCompletionFromStoredDetail(documentId, storedDetail("062")),
                ).resolves.toBeUndefined();
                expect(table.statusType).toBe("060");
                expect(prisma.eformsign_doc.updateMany).not.toHaveBeenCalled();
            } finally {
                delete process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
            }
        });

        it("keeps the 062 exclusion for an unclassified contract row on an unconfigured template", async () => {
            table = baseRow({ documentKind: null, templateId: "template-1" });

            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("062")),
            ).resolves.toEqual({ eligible: false });
        });

        it("is eligible for a contract only at a final completion", async () => {
            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("003")),
            ).resolves.toEqual({
                eligible: true,
                branchId,
                serviceRecordSnapshot: false,
            });
        });

        it("is not eligible when the row is unassigned, purge-requested, or missing", async () => {
            table = baseRow({ branchId: null as never });
            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("003")),
            ).resolves.toEqual({ eligible: false });

            table = baseRow({ permanentPurgeRequestedAt: new Date("2026-10-02T00:00:00.000Z") });
            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("003")),
            ).resolves.toEqual({ eligible: false });

            prisma.eformsign_doc.findUnique.mockResolvedValueOnce(null as never);
            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("003")),
            ).resolves.toEqual({ eligible: false });
        });
    });

    describe("legacy rows the entity invariant rejects (updatedDate before createdDate)", () => {
        // The shape the eligibility lookup must survive: reconstructing the entity from it
        // throws, so eligibility has to read plain columns instead.
        const legacyRow = (overrides: Partial<Row> = {}): Row => baseRow({
            createdDate: new Date("2026-10-02T00:00:00.000Z"),
            updatedDate: new Date("2026-10-01T00:00:00.000Z"),
            ...overrides,
        });

        it("claims 050 for a configured-template service-record snapshot at 062 and repairs the ordering", async () => {
            process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = "template-1";
            try {
                table = legacyRow({
                    documentKind: "service_record_snapshot",
                    templateId: "template-1",
                });

                await expect(
                    service.resolveCompletionHealEligibility(
                        documentId,
                        storedDetail("062", "2026-10-03T09:00:00.000Z"),
                    ),
                ).resolves.toEqual({
                    eligible: true,
                    branchId,
                    serviceRecordSnapshot: true,
                });
                const result = await service.claimCompletionFromStoredDetail(
                    documentId,
                    storedDetail("062", "2026-10-03T09:00:00.000Z"),
                );

                expect(result).toEqual({ completionClaim: "claimed", completionBranchId: branchId });
                expect(table.statusType).toBe("050");
                expect(table.updatedDate).toEqual(new Date("2026-10-03T09:00:00.000Z"));
            } finally {
                delete process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
            }
        });

        it("claims 050 for a contract at a final completion", async () => {
            table = legacyRow();

            const result = await service.claimCompletionFromStoredDetail(
                documentId,
                storedDetail("003", "2026-10-03T09:00:00.000Z"),
            );

            expect(result).toEqual({ completionClaim: "claimed", completionBranchId: branchId });
            expect(table.statusType).toBe("050");
            expect(table.updatedDate).toEqual(new Date("2026-10-03T09:00:00.000Z"));
        });

        it("keeps the 062 exclusion and the purge and unassigned checks for a legacy row", async () => {
            table = legacyRow({ documentKind: "contract", templateId: "template-1" });
            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("062")),
            ).resolves.toEqual({ eligible: false });

            table = legacyRow({ permanentPurgeRequestedAt: new Date("2026-10-02T00:00:00.000Z") });
            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("003")),
            ).resolves.toEqual({ eligible: false });

            table = legacyRow({ branchId: null as never });
            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("003")),
            ).resolves.toEqual({ eligible: false });
            expect(prisma.eformsign_doc.updateMany).not.toHaveBeenCalled();
        });

        it("reports not eligible instead of throwing when the metadata lookup itself fails", async () => {
            prisma.eformsign_doc.findUnique.mockRejectedValueOnce(new Error("db down") as never);

            await expect(
                service.resolveCompletionHealEligibility(documentId, storedDetail("003")),
            ).resolves.toEqual({ eligible: false });
        });
    });

    it("reports a duplicate when the row is already completed", async () => {
        table = baseRow({ statusType: "050" });

        const result = await service.claimCompletionFromStoredDetail(
            documentId,
            storedDetail("003"),
        );

        expect(result).toEqual({ completionClaim: "duplicate", completionBranchId: branchId });
    });

    it("reports a stale claim when the stored detail is not newer than the row", async () => {
        table = baseRow({ updatedDate: new Date("2026-10-03T00:00:00.000Z") });

        const result = await service.claimCompletionFromStoredDetail(
            documentId,
            storedDetail("003"),
        );

        expect(result).toEqual({ completionClaim: "stale", completionBranchId: branchId });
        expect(table.statusType).toBe("060");
    });

    it("leaves an unassigned row (no branch) alone", async () => {
        table = baseRow({ branchId: null as never });

        const result = await service.claimCompletionFromStoredDetail(
            documentId,
            storedDetail("003"),
        );

        expect(result).toBeUndefined();
        expect(table.statusType).toBe("060");
        expect(prisma.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });
});
