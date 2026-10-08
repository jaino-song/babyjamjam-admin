import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import {
    TERMINAL_STATUS_CODES,
    UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE,
    UNASSIGNED_TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

/**
 * Event-sequence regression for the revoke path, run through the REAL webhook service and
 * the REAL update usecase over an in-memory document row.
 *
 * "040" (doc_request_revoke) only records that cancellation was requested. It used to sit
 * in the terminal set, so the usecase's terminal-downgrade guard froze the row at 040 and
 * refused the 060 that follows when the request is refused or the signer carries on — the
 * client then read "revoked" for a document that is still live. "042" (doc_revoke) is the
 * genuine ending and must keep blocking later non-terminal events.
 */
describe("EformsignWebhookService revoke event sequences (real usecase, in-memory row)", () => {
    const branchId = "test-branch";
    const documentId = "doc-seq-1";

    const OCT_1 = Date.parse("2026-10-01T09:00:00.000Z");
    const OCT_2 = Date.parse("2026-10-02T09:00:00.000Z");
    const OCT_3 = Date.parse("2026-10-03T09:00:00.000Z");

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
            stepType: "05",
            stepIndex: "2",
            stepName: "이용자",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-12-01T00:00:00.000Z"),
            expired: false,
            clientId: 9,
        });

    // The in-memory persistence mirrors the real repository's contract: a source-timestamped
    // write lands only when it is strictly newer than the stored updatedDate.
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
        row = createRow("060", new Date(OCT_1));

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
                workflow_seq: 2,
                workflow_name: "이용자",
                status: event,
                updated_date: updatedDate,
            },
        };
        return service.processWebhook(payload, {
            mirroredDocument: {
                current_status: {
                    status_type: mirrorStatusType,
                    step_type: "05",
                    step_name: "이용자",
                },
            },
        } as never);
    };

    it("060 -> 040 (revoke requested) -> 060 (request refused / signer continues) ends at 060", async () => {
        await deliver("doc_request_revoke", "040", OCT_2);
        expect(row.statusType).toBe("040");
        expect(row.statusDetail).toBe("철회 요청");

        await deliver("doc_request_participant", "060", OCT_3);

        expect(row.statusType).toBe("060");
        expect(row.updatedDate.getTime()).toBe(OCT_3);
    });

    it("keeps refusing a stale event that predates the stored 040", async () => {
        await deliver("doc_request_revoke", "040", OCT_2);

        // A late-arriving 060 stamped before the 040 it supposedly follows.
        await deliver("doc_request_participant", "060", OCT_1 + 1000);

        expect(row.statusType).toBe("040");
        expect(row.updatedDate.getTime()).toBe(OCT_2);
    });

    it("classifies 040 (revoke requested) as open and 042 (revoked) as ended", () => {
        expect(TERMINAL_STATUS_CODES.has("040")).toBe(false);
        expect(UNASSIGNED_TERMINAL_STATUS_CODES.has("040")).toBe(false);
        expect(TERMINAL_STATUS_CODES.has("042")).toBe(true);
        expect(UNASSIGNED_TERMINAL_STATUS_CODES.has("042")).toBe(true);
        // The remaining ended codes are unchanged.
        for (const code of ["011", "021", "031", "045", "047", "049", "061", "071", "080", "090", "099"]) {
            expect(TERMINAL_STATUS_CODES.has(code)).toBe(true);
        }
    });

    it("keeps 042 (revoked) terminal: a later 060 cannot reopen the row", async () => {
        await deliver("doc_revoke", "042", OCT_2);
        expect(row.statusType).toBe("042");
        expect(row.statusDetail).toBe("철회");

        await deliver("doc_request_participant", "060", OCT_3);

        expect(row.statusType).toBe("042");
        expect(row.updatedDate.getTime()).toBe(OCT_2);
    });

    /**
     * An unassigned row (no branch owner yet) takes the webhook's review-stage path. 062 and
     * 071 end the reviewer stage but not the document, so a newer revoke request must still
     * land: removing 040 from the terminal set also removed it from the forward set that
     * guard consults, and the request was dropped as ignored_backward_transition.
     */
    describe("unassigned rows (review-stage forward guard)", () => {
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

        it.each(["062", "071"])("persists a newer revoke request (040) over an unassigned %s row", async (stored) => {
            row = createRow(stored, new Date(OCT_1));

            await deliver("doc_request_revoke", "040", OCT_2);

            expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledTimes(1);
            expect(row.statusType).toBe("040");
            expect(row.statusDetail).toBe("철회 요청");
            expect(row.updatedDate.getTime()).toBe(OCT_2);
        });

        it("keeps refusing an in-progress code that is genuinely backward from 062", async () => {
            row = createRow("062", new Date(OCT_1));

            await deliver("doc_request_participant", "060", OCT_2);

            expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
            expect(row.statusType).toBe("062");
        });

        it("keeps refusing a stale revoke request over an unassigned 062 row", async () => {
            row = createRow("062", new Date(OCT_2));

            await deliver("doc_request_revoke", "040", OCT_1);

            expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
            expect(row.statusType).toBe("062");
        });

        it("keeps 042 (revoked) terminal against a later revoke request on an unassigned row", async () => {
            row = createRow("042", new Date(OCT_1));

            await deliver("doc_request_revoke", "040", OCT_2);

            expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
            expect(row.statusType).toBe("042");
        });
    });

    it("lists 040 in the forward-after-review set while it stays non-terminal", () => {
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("040")).toBe(true);
    });
});
