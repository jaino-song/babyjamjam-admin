import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { isProviderReviewWorkflowStep } from "domain/utils/eformsign-status-code";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

/**
 * The webhook payload's `workflow_seq` is the document's POSITION in its workflow; the
 * stored `stepType` is the step KIND that `isProviderReviewWorkflowStep` reads ("06" =
 * provider reviewer). The webhook used to write the position into both columns, so a
 * reviewer step at position 3 stored "3" (not review) and any step at position 6 stored
 * "6", which normalises to "06" (review). These specs run the REAL webhook service and the
 * REAL update usecase over an in-memory row and assert the columns hold what the
 * mirror/backfill writer would store: the mirrored `current_status` step kind and index.
 */
describe("EformsignWebhookService step kind persistence (real usecase, in-memory row)", () => {
    const branchId = "test-branch";
    const documentId = "doc-step-1";

    const createRow = (overrides: Partial<{
        statusType: string;
        stepType: string;
        stepIndex: string;
        stepName: string;
    }> = {}): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            documentName: "산모신생아건강관리서비스 계약서",
            templateName: "template",
            customerName: "고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: ["05", "06"],
            createdDate: new Date("2026-09-30T00:00:00.000Z"),
            updatedDate: new Date("2026-10-01T09:00:00.000Z"),
            statusType: overrides.statusType ?? "060",
            statusDetail: "서명 요청됨",
            stepType: overrides.stepType ?? "05",
            stepIndex: overrides.stepIndex ?? "2",
            stepName: overrides.stepName ?? "이용자",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-12-01T00:00:00.000Z"),
            expired: false,
            clientId: 9,
        });

    let row: EformsignDocEntity;
    const eformsignDocRepository = {
        findByDocumentIdUnscoped: jest.fn(),
        findByDocumentId: jest.fn(),
        findBranchIdByDocumentId: jest.fn(),
        claimCompletionStatus: jest.fn(),
        update: jest.fn(),
        updateIfSourceNewer: jest.fn(),
        upsertUnassignedByDocumentId: jest.fn(),
    };
    const linkDocumentUsecase = { execute: jest.fn() };
    const eventBus = { emit: jest.fn() };
    const notificationService = { sendToBranchUsers: jest.fn() };
    const clientRepository = { findById: jest.fn() };

    let service: EformsignWebhookService;

    beforeEach(() => {
        row = createRow();

        eformsignDocRepository.findByDocumentIdUnscoped.mockImplementation(
            async () => ({ document: row, branchId }),
        );
        eformsignDocRepository.findByDocumentId.mockImplementation(async () => row);
        eformsignDocRepository.findBranchIdByDocumentId.mockResolvedValue(branchId);
        eformsignDocRepository.claimCompletionStatus.mockResolvedValue("claimed");
        eformsignDocRepository.update.mockImplementation(
            async (_branch: string, doc: EformsignDocEntity) => {
                row = doc;
                return doc;
            },
        );
        eformsignDocRepository.updateIfSourceNewer.mockImplementation(
            async (_branch: string, doc: EformsignDocEntity) => {
                row = doc;
                return { document: doc, applied: true };
            },
        );
        eformsignDocRepository.upsertUnassignedByDocumentId.mockImplementation(
            async (doc: EformsignDocEntity) => {
                row = doc;
                return doc;
            },
        );
        linkDocumentUsecase.execute.mockResolvedValue(undefined);
        notificationService.sendToBranchUsers.mockResolvedValue({ sent: 0, failed: 0 });
        clientRepository.findById.mockResolvedValue(null);

        service = new EformsignWebhookService(
            new UpdateEformsignDocStatusUsecase(eformsignDocRepository as never),
            linkDocumentUsecase as never,
            { execute: jest.fn(), executeFromDocument: jest.fn() } as never,
            eventBus as never,
            notificationService as never,
            { getAccessToken: jest.fn(), getDocument: jest.fn() } as never,
            { withCredentials: jest.fn() } as never,
            clientRepository as never,
            eformsignDocRepository as never,
            { findByClientId: jest.fn().mockResolvedValue([]) } as never,
            { findById: jest.fn().mockResolvedValue(null) } as never,
            { execute: jest.fn(), mirrorRemoteDocument: jest.fn() } as never,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    const mirror = (
        statusType: string,
        stepType: string,
        stepIndex: string,
    ): never => ({
        current_status: {
            status_type: statusType,
            step_type: stepType,
            step_index: stepIndex,
            step_name: "단계",
        },
    }) as never;

    const documentPayload = (
        status: string,
        workflowSeq: number,
        workflowName = "워크플로우",
    ): EformsignWebhookPayloadDto => ({
        webhook_id: `wh-${status}`,
        webhook_name: "test",
        company_id: "company-1",
        event_type: "document",
        document: {
            id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            template_id: "template-1",
            template_name: "template",
            workflow_seq: workflowSeq,
            workflow_name: workflowName,
            status,
            updated_date: Date.parse("2026-10-02T09:00:00.000Z"),
        },
    });

    const actionPayload = (workflowSeq: number): EformsignWebhookPayloadDto => ({
        webhook_id: "wh-action",
        webhook_name: "test",
        company_id: "company-1",
        event_type: "document_action",
        document: {
            id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            template_id: "template-1",
            template_name: "template",
            workflow_seq: workflowSeq,
            workflow_name: "워크플로우",
            status: "doc_request_reviewer",
            action: "doc_open_participant",
            updated_date: Date.parse("2026-10-02T09:00:00.000Z"),
        },
    });

    const pdfPayload = (status: string, workflowSeq: number): EformsignWebhookPayloadDto => ({
        webhook_id: `wh-pdf-${status}`,
        webhook_name: "test",
        company_id: "company-1",
        event_type: "ready_document_pdf",
        ready_document_pdf: {
            document_id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            template_id: "template-1",
            template_name: "template",
            workflow_seq: workflowSeq,
            workflow_name: "워크플로우",
            document_status: status,
        },
    });

    describe("branch-owned document event", () => {
        it("stores the reviewer step KIND (06) even when the workflow position is not 6", async () => {
            await service.processWebhook(
                documentPayload("doc_request_reviewer", 2),
                { mirroredDocument: mirror("070", "06", "3") },
            );

            expect(row.statusType).toBe("070");
            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
            // The reader that drives hasSigned/display_status sees the reviewer step even
            // though the workflow name carries no provider/review keyword.
            expect(isProviderReviewWorkflowStep({
                stepType: row.stepType,
                stepName: "워크플로우",
            })).toBe(true);
        });

        it("does not store 06 for a non-review step that happens to sit at position 6", async () => {
            await service.processWebhook(
                documentPayload("doc_request_participant", 6),
                { mirroredDocument: mirror("060", "05", "6") },
            );

            expect(row.statusType).toBe("060");
            expect(row.stepType).toBe("05");
            expect(isProviderReviewWorkflowStep({
                stepType: row.stepType,
                stepName: "워크플로우",
            })).toBe(false);
        });

        it("keeps the stored step columns when no mirror is available", async () => {
            row = createRow({ stepType: "06", stepIndex: "3" });

            await service.processWebhook(documentPayload("doc_request_participant", 6));

            expect(row.statusType).toBe("060");
            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });

        it("keeps the stored step columns when the mirror's step fields are blank", async () => {
            row = createRow({ stepType: "06", stepIndex: "3" });

            await service.processWebhook(
                documentPayload("doc_request_participant", 6),
                { mirroredDocument: mirror("060", "  ", "") },
            );

            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });
    });

    describe("branch-owned document_action event", () => {
        it("stores the mirrored step kind instead of the workflow position", async () => {
            await service.processWebhook(actionPayload(6), {
                mirroredDocument: mirror("060", "05", "2"),
            });

            expect(row.stepType).toBe("05");
            expect(row.stepIndex).toBe("2");
        });

        it("keeps the stored step columns without a mirror", async () => {
            row = createRow({ stepType: "06", stepIndex: "3" });

            await service.processWebhook(actionPayload(1));

            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });
    });

    describe("branch-owned ready_document_pdf event", () => {
        it("stores the mirrored step kind for a non-completion status", async () => {
            await service.processWebhook(pdfPayload("doc_request_reviewer", 2), {
                mirroredDocument: mirror("070", "06", "3"),
            });

            expect(row.statusType).toBe("070");
            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });

        it("keeps the stored step columns without a mirror", async () => {
            row = createRow({ stepType: "06", stepIndex: "3" });

            await service.processWebhook(pdfPayload("doc_request_participant", 6));

            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });
    });

    describe("completion claim", () => {
        const claimedParams = (): { stepType: string; stepIndex: string } => {
            const call = eformsignDocRepository.claimCompletionStatus.mock.calls[0] as
                [string, { stepType: string; stepIndex: string }];
            return call[1];
        };

        it("claims with the mirrored step kind, not the workflow position", async () => {
            await service.processWebhook(documentPayload("doc_complete", 4), {
                mirroredDocument: mirror("050", "06", "5"),
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            });

            expect(claimedParams()).toMatchObject({ stepType: "06", stepIndex: "5" });
        });

        it("re-asserts the stored step columns when there is no mirror", async () => {
            row = createRow({ stepType: "06", stepIndex: "3" });

            await service.processWebhook(documentPayload("doc_complete", 4), {
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            });

            expect(claimedParams()).toMatchObject({ stepType: "06", stepIndex: "3" });
        });

        it("uses the mirrored step kind on the ready_document_pdf completion too", async () => {
            await service.processWebhook(pdfPayload("doc_complete", 4), {
                mirroredDocument: mirror("050", "06", "5"),
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            });

            expect(claimedParams()).toMatchObject({ stepType: "06", stepIndex: "5" });
        });
    });

    describe("unassigned rows", () => {
        beforeEach(() => {
            eformsignDocRepository.findByDocumentIdUnscoped.mockImplementation(
                async () => ({ document: row, branchId: null }),
            );
        });

        it("stores the mirrored reviewer step kind for a document event", async () => {
            await service.processWebhook(documentPayload("doc_request_reviewer", 2), {
                mirroredDocument: mirror("070", "06", "3"),
            });

            expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledTimes(1);
            expect(row.statusType).toBe("070");
            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });

        it("does not store 06 for a non-review step at position 6", async () => {
            await service.processWebhook(documentPayload("doc_request_participant", 6), {
                mirroredDocument: mirror("060", "05", "6"),
            });

            expect(row.stepType).toBe("05");
        });

        it("keeps the stored step columns without a mirror", async () => {
            row = createRow({ stepType: "06", stepIndex: "3" });

            await service.processWebhook(documentPayload("doc_request_participant", 6));

            expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledTimes(1);
            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });

        it("stores the mirrored step kind for a document_action event", async () => {
            await service.processWebhook(actionPayload(6), {
                mirroredDocument: mirror("060", "05", "2"),
            });

            expect(row.stepType).toBe("05");
            expect(row.stepIndex).toBe("2");
        });

        it("keeps the stored step columns for a document_action event without a mirror", async () => {
            row = createRow({ stepType: "06", stepIndex: "3" });

            await service.processWebhook(actionPayload(1));

            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });

        it("stores the mirrored step kind for a ready_document_pdf event", async () => {
            await service.processWebhook(pdfPayload("doc_request_reviewer", 2), {
                mirroredDocument: mirror("070", "06", "3"),
            });

            expect(row.statusType).toBe("070");
            expect(row.stepType).toBe("06");
            expect(row.stepIndex).toBe("3");
        });
    });
});
