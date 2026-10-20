import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import {
    EFORMSIGN_IN_PROGRESS_STATUS_CODES,
    EFORMSIGN_REJECTED_STATUS_CODES,
    TERMINAL_STATUS_CODES,
    UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE,
    UNASSIGNED_TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

/**
 * 계약-04 event-sequence regression: 071 (doc_reject_reviewer, the provider's reviewer rejected
 * the document) is NOT terminal. A later 070 (resubmitted for review) or 072 (accepted) is applied,
 * for linked (branch-owned) rows and for unassigned rows alike. Run through the REAL webhook
 * service and the REAL update usecase over an in-memory document row.
 *
 * Linked rows are written only by UpdateEformsignDocStatusUsecase (the webhook's
 * updateStatusAndLinkClient), whose terminal-downgrade guard is the single place a stored 071
 * used to freeze the row. Unassigned rows go through the webhook's review-stage guard and
 * upsertUnassignedByDocumentId (the Prisma predicates are pinned by sb.eformsign-doc.repository.spec).
 */
describe("EformsignWebhookService reviewer-rejection (071) sequences (real usecase, in-memory row)", () => {
    const branchId = "test-branch";
    const documentId = "doc-071-seq";

    const at = (hour: number) => Date.parse(`2026-10-01T${String(hour).padStart(2, "0")}:00:00.000Z`);

    const createRow = (statusType: string, updatedDate: Date): EformsignDocEntity =>
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
            updatedDate,
            statusType,
            statusDetail: "서명 요청됨",
            stepType: "06",
            stepIndex: "3",
            stepName: "제공기관 확인",
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
        updateWithOutcome: jest.fn(),
        updateIfSourceNewer: jest.fn(),
        upsertUnassignedByDocumentId: jest.fn(),
    };

    const linkDocumentUsecase = { execute: jest.fn() };
    const eventBus = { emit: jest.fn() };
    const notificationService = { sendToBranchUsers: jest.fn() };
    const clientRepository = { findById: jest.fn() };

    let service: EformsignWebhookService;

    beforeEach(() => {
        row = createRow("060", new Date(at(1)));

        eformsignDocRepository.findByDocumentIdUnscoped.mockImplementation(
            async () => ({ document: row, branchId }),
        );
        eformsignDocRepository.findByDocumentId.mockImplementation(async () => row);
        eformsignDocRepository.findBranchIdByDocumentId.mockResolvedValue(branchId);
        eformsignDocRepository.update.mockImplementation(
            async (_branch: string, doc: EformsignDocEntity) => {
                row = doc;
                return doc;
            },
        );
        eformsignDocRepository.updateWithOutcome.mockImplementation(
            async (_branch: string, doc: EformsignDocEntity) => {
                row = doc;
                return { document: doc, applied: true };
            },
        );
        // Mirrors the real repository's contract: a source-timestamped write lands only when it is
        // strictly newer than the stored updatedDate.
        eformsignDocRepository.updateIfSourceNewer.mockImplementation(
            async (_branch: string, doc: EformsignDocEntity) => {
                if (row.updatedDate.getTime() < doc.updatedDate.getTime()) {
                    row = doc;
                    return { document: doc, applied: true };
                }
                return { document: row, applied: false };
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

    const deliver = (
        event: string,
        mirrorStatusType: string,
        updatedDate: number,
    ): Promise<unknown> => {
        const payload: EformsignWebhookPayloadDto = {
            webhook_id: `wh-${event}-${updatedDate}`,
            webhook_name: "test",
            company_id: "company-1",
            event_type: "document",
            document: {
                id: documentId,
                document_title: "산모신생아건강관리서비스 계약서",
                template_id: "template-1",
                template_name: "template",
                workflow_seq: 3,
                workflow_name: "제공기관 확인",
                status: event,
                updated_date: updatedDate,
            },
        };
        return service.processWebhook(payload, {
            mirroredDocument: {
                current_status: {
                    status_type: mirrorStatusType,
                    step_type: "06",
                    step_name: "제공기관 확인",
                },
            },
        } as never);
    };

    it("classifies 071 as in-progress: out of every terminal and rejected set, in the in-progress set", () => {
        expect(TERMINAL_STATUS_CODES.has("071")).toBe(false);
        expect(EFORMSIGN_REJECTED_STATUS_CODES.has("071")).toBe(false);
        expect(UNASSIGNED_TERMINAL_STATUS_CODES.has("071")).toBe(false);
        expect(EFORMSIGN_IN_PROGRESS_STATUS_CODES.has("071")).toBe(true);
        // The genuine endings are unchanged.
        for (const code of ["011", "021", "031", "042", "047", "049", "061", "080", "090", "099"]) {
            expect(TERMINAL_STATUS_CODES.has(code)).toBe(true);
        }
        // For unassigned rows 071 stays a review-stage code that 070 and 072 may follow.
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("070")).toBe(true);
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("072")).toBe(true);
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("071")).toBe(true);
    });

    describe("linked (branch-owned) row", () => {
        it("070 -> 071 -> 070 -> 072 is applied step by step", async () => {
            row = createRow("070", new Date(at(1)));

            await deliver("doc_reject_reviewer", "071", at(2));
            expect(row.statusType).toBe("071");
            expect(row.statusDetail).toBe("검토 반려");

            await deliver("doc_request_reviewer", "070", at(3));
            expect(row.statusType).toBe("070");
            expect(row.statusDetail).toBe("검토 요청");

            await deliver("doc_reject_reviewer", "071", at(4));
            expect(row.statusType).toBe("071");

            await deliver("doc_accept_reviewer", "072", at(5));
            expect(row.statusType).toBe("072");
            expect(row.statusDetail).toBe("검토 완료");
            expect(row.updatedDate.getTime()).toBe(at(5));
        });

        it("ignores a 070 event older than the stored 071", async () => {
            row = createRow("071", new Date(at(5)));

            await deliver("doc_request_reviewer", "070", at(4));

            expect(row.statusType).toBe("071");
            expect(row.updatedDate.getTime()).toBe(at(5));
        });

        it("a stored 080 still refuses a later 070 and 071", async () => {
            row = createRow("080", new Date(at(1)));

            await deliver("doc_request_reviewer", "070", at(2));
            await deliver("doc_reject_reviewer", "071", at(3));

            expect(row.statusType).toBe("080");
            expect(row.updatedDate.getTime()).toBe(at(1));
        });

        it("a stored 072 (completed, terminal) refuses a later 071: the guard never downgrades a terminal status", async () => {
            row = createRow("072", new Date(at(1)));

            await deliver("doc_reject_reviewer", "071", at(2));

            expect(row.statusType).toBe("072");
            expect(row.updatedDate.getTime()).toBe(at(1));
        });

        it("the 062 terminal guard is unchanged: a stored 062 still refuses a later 070", async () => {
            row = createRow("062", new Date(at(1)));

            await deliver("doc_request_reviewer", "070", at(2));

            expect(row.statusType).toBe("062");
        });
    });

    describe("unassigned row", () => {
        beforeEach(() => {
            eformsignDocRepository.findByDocumentIdUnscoped.mockImplementation(
                async () => ({ document: row, branchId: null }),
            );
            eformsignDocRepository.upsertUnassignedByDocumentId.mockImplementation(
                async (doc: EformsignDocEntity) => {
                    row = doc;
                    return doc;
                },
            );
        });

        const remoteAt = (statusType: string, updatedDate: number) => ({
            id: documentId,
            document_number: "DOC-071",
            document_name: "산모신생아건강관리서비스 계약서",
            created_date: Date.parse("2026-09-30T00:00:00.000Z"),
            updated_date: updatedDate,
            template: { id: "template-1", name: "template" },
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            current_status: {
                status_type: statusType,
                step_type: "06",
                step_index: "3",
                step_name: "제공기관 확인",
                step_recipients: [],
                expired_date: 0,
            },
        });

        it("060 -> 062 -> 070 -> 071 -> 070 -> 072 is applied step by step", async () => {
            // 060 -> 062: the participant signed. Webhook events cannot write 062 (they project it
            // as 060), so the sweep/mirror writer does — the real mirror usecase, in memory.
            const mirrorUsecase = new MirrorUnassignedEformsignDocUsecase(
                { withCredentials: jest.fn() } as never,
                { execute: jest.fn() } as never,
                eformsignDocRepository as never,
            );
            row = createRow("060", new Date(at(1)));
            await mirrorUsecase.mirrorRemoteDocument(remoteAt("062", at(2)) as never);
            expect(row.statusType).toBe("062");

            await deliver("doc_request_reviewer", "070", at(3));
            expect(row.statusType).toBe("070");

            await deliver("doc_reject_reviewer", "071", at(4));
            expect(row.statusType).toBe("071");
            expect(row.statusDetail).toBe("검토 반려");

            await deliver("doc_request_reviewer", "070", at(5));
            expect(row.statusType).toBe("070");

            await deliver("doc_accept_reviewer", "072", at(6));
            expect(row.statusType).toBe("072");
            expect(row.statusDetail).toBe("검토 완료");
            expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledTimes(5);
        });

        it("071 -> 072 directly is applied too", async () => {
            row = createRow("071", new Date(at(1)));

            await deliver("doc_accept_reviewer", "072", at(2));

            expect(row.statusType).toBe("072");
        });

        it("the mirror writer keeps today's 071 detail text and no longer pins the expired flag to false", async () => {
            const mirrorUsecase = new MirrorUnassignedEformsignDocUsecase(
                { withCredentials: jest.fn() } as never,
                { execute: jest.fn() } as never,
                eformsignDocRepository as never,
            );
            row = createRow("070", new Date(at(1)));

            const mirrored = await mirrorUsecase.mirrorRemoteDocument(remoteAt("071", at(2)) as never);

            expect(mirrored.statusType).toBe("071");
            expect(mirrored.statusDetail).toBe("검토 반려");
            // knowsExpiredState is false for a non-terminal 071, so the list sweep leaves `expired` alone.
            expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ updateExpired: false }),
            );
        });
    });
});
