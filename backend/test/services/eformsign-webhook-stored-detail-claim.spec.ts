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

    it.each(["060", "070", "061"])(
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
