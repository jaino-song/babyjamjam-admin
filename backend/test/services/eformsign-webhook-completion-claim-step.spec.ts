import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

/**
 * The completion claim over the REAL webhook service and the REAL repository, with the
 * database replaced by an in-memory `eformsign_doc` table that honours the claim's
 * where-clause (compare-and-set on status/updatedDate) and its data (absent columns stay).
 * When the completion mirror carries no step fields, the claim must leave the stored step
 * columns alone: re-sending a value read earlier would overwrite a newer concurrent step
 * write, and reading the row at all would throw for a malformed legacy row.
 */
describe("EformsignWebhookService completion claim step columns (real repository, in-memory table)", () => {
    const branchId = "test-branch";
    const documentId = "doc-claim-1";

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

    const mirror = (statusType: string, stepType: string, stepIndex: string): never => ({
        current_status: {
            status_type: statusType,
            step_type: stepType,
            step_index: stepIndex,
            step_name: "단계",
        },
    }) as never;

    const completePayload = (): EformsignWebhookPayloadDto => ({
        webhook_id: "wh-complete",
        webhook_name: "test",
        company_id: "company-1",
        event_type: "document",
        document: {
            id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            template_id: "template-1",
            template_name: "template",
            workflow_seq: 4,
            workflow_name: "워크플로우",
            status: "doc_complete",
            updated_date: Date.parse("2026-10-02T09:00:00.000Z"),
        },
    });

    let service: EformsignWebhookService;

    beforeEach(() => {
        table = baseRow();
        beforeClaimUpdate = undefined;
        const repository = new SbEformsignDocRepository(prisma as never);
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

    const processComplete = (mirroredDocument?: never) =>
        service.processWebhook(completePayload(), {
            ...(mirroredDocument ? { mirroredDocument } : {}),
            deferCompletionEvent: true,
            deferCompletionEffects: true,
        });

    it("keeps a newer concurrent step write when the completion mirror has blank step fields", async () => {
        beforeClaimUpdate = () => {
            // A newer mirror write stores the next step before the (still newer) claim lands.
            table.stepType = "06";
            table.stepIndex = "3";
            table.updatedDate = new Date("2026-10-02T08:00:00.000Z");
        };

        await processComplete(mirror("050", "", ""));

        expect(table.statusType).toBe("050");
        expect(table.stepType).toBe("06");
        expect(table.stepIndex).toBe("3");
    });

    it("keeps the stored step columns when no mirror is available", async () => {
        await processComplete();

        expect(table.statusType).toBe("050");
        expect(table.stepType).toBe("05");
        expect(table.stepIndex).toBe("2");
    });

    it("claims completion for a malformed legacy row (blank statusDetail) with a blank step_index", async () => {
        table = baseRow({ statusDetail: "" });

        const outcome = await processComplete(mirror("050", "06", ""));

        expect(outcome).toMatchObject({ completionClaim: "claimed" });
        expect(table.statusType).toBe("050");
        expect(table.statusDetail).toBe("완료");
        expect(table.stepType).toBe("06");
        expect(table.stepIndex).toBe("2");
    });

    it("still writes the mirrored step when the completion mirror is populated", async () => {
        await processComplete(mirror("050", "06", "5"));

        expect(table.statusType).toBe("050");
        expect(table.stepType).toBe("06");
        expect(table.stepIndex).toBe("5");
    });
});
