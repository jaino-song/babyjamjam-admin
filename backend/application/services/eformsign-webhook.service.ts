import { Injectable, Logger } from "@nestjs/common";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { LinkDocumentToClientUsecase } from "application/usecases/eformsign-doc/link-document-to-client.usecase";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

/**
 * Eformsign document status codes (from document.status field)
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_webhook.html
 */
const DOCUMENT_STATUS = {
    // Creation and initial states
    DOC_CREATE: "doc_create",                       // 문서 생성
    DOC_TEMPSAVE_PARTICIPANT: "doc_tempsave_participant", // 참여자 임시저장

    // Participant actions
    DOC_REQUEST_PARTICIPANT: "doc_request_participant", // 참여자 요청
    DOC_ACCEPT_PARTICIPANT: "doc_accept_participant",   // 참여자 승인
    DOC_REJECT_PARTICIPANT: "doc_reject_participant",   // 참여자 거부
    DOC_ACCEPT_OUTSIDER: "doc_accept_outsider",        // 외부자 승인

    // Approval actions
    DOC_ACCEPT_APPROVAL: "doc_accept_approval",        // 결재 승인
    DOC_REJECT_APPROVAL: "doc_reject_approval",        // 결재 거부

    // Final states
    DOC_COMPLETE: "doc_complete",                   // 문서 완료
    DOC_DECLINE: "doc_decline",                     // 거부됨
    DOC_DELETED: "doc_deleted",                     // 삭제됨

    // Revocation
    DOC_REQUEST_REVOKE: "doc_request_revoke",       // 철회 요청
    DOC_REVOKE: "doc_revoke",                       // 철회됨
};

/**
 * Event types for webhook
 */
const EVENT_TYPES = {
    DOCUMENT: "document",                  // Document status change
    READY_DOCUMENT_PDF: "ready_document_pdf", // PDF generation complete
};

@Injectable()
export class EformsignWebhookService {
    private readonly logger = new Logger(EformsignWebhookService.name);

    constructor(
        private readonly updateStatusUsecase: UpdateEformsignDocStatusUsecase,
        private readonly linkDocumentUsecase: LinkDocumentToClientUsecase,
    ) {}

    async processWebhook(payload: EformsignWebhookPayloadDto): Promise<void> {
        const { event_type, webhook_id, document, ready_document_pdf } = payload;

        this.logger.log(`Processing webhook ${webhook_id}: event_type=${event_type}`);

        // Handle document events
        if (event_type === EVENT_TYPES.DOCUMENT && document) {
            await this.handleDocumentEvent(document);
            return;
        }

        // Handle PDF ready events (optional - for future use)
        if (event_type === EVENT_TYPES.READY_DOCUMENT_PDF && ready_document_pdf) {
            this.logger.log(`PDF ready for document ${ready_document_pdf.document_id}`);
            // Could be used to download/store the final PDF
            return;
        }

        this.logger.warn(`Unknown webhook event type: ${event_type}`);
    }

    private async handleDocumentEvent(document: NonNullable<EformsignWebhookPayloadDto["document"]>): Promise<void> {
        const { id: documentId, status, document_title, workflow_seq, workflow_name } = document;

        this.logger.log(`Document event: ${documentId} -> status=${status}, title=${document_title}`);

        // Map status to Korean detail and determine status type
        const { statusType, statusDetail } = this.mapStatus(status);

        // Update document status in DB
        try {
            await this.updateStatusUsecase.execute({
                documentId,
                statusType,
                statusDetail,
                stepType: String(workflow_seq),
                stepIndex: String(workflow_seq),
                stepName: workflow_name,
                expired: false,
            });

            this.logger.log(`Document ${documentId} status updated: ${status} -> ${statusDetail}`);
        } catch (error) {
            // Document might not exist in our DB yet (created externally)
            this.logger.warn(`Failed to update document ${documentId}: ${error}`);
            return;
        }

        // If document is completed, link it to the client
        if (status === DOCUMENT_STATUS.DOC_COMPLETE) {
            this.logger.log(`Document ${documentId} completed, linking to client`);
            try {
                await this.linkDocumentUsecase.execute(documentId);
                this.logger.log(`Document ${documentId} successfully linked to client`);
            } catch (error) {
                this.logger.error(`Failed to link document ${documentId} to client: ${error}`);
            }
        }
    }

    /**
     * Map eformsign document status to internal status type and Korean detail
     */
    private mapStatus(status: string): { statusType: string; statusDetail: string } {
        switch (status) {
            // Completed states
            case DOCUMENT_STATUS.DOC_COMPLETE:
                return { statusType: "050", statusDetail: "완료" };

            // Rejected/Declined states
            case DOCUMENT_STATUS.DOC_REJECT_PARTICIPANT:
            case DOCUMENT_STATUS.DOC_REJECT_APPROVAL:
            case DOCUMENT_STATUS.DOC_DECLINE:
                return { statusType: "080", statusDetail: "거부" };

            // Revoked/Deleted states
            case DOCUMENT_STATUS.DOC_REVOKE:
            case DOCUMENT_STATUS.DOC_REQUEST_REVOKE:
                return { statusType: "090", statusDetail: "철회" };
            case DOCUMENT_STATUS.DOC_DELETED:
                return { statusType: "099", statusDetail: "삭제됨" };

            // Created state
            case DOCUMENT_STATUS.DOC_CREATE:
                return { statusType: "010", statusDetail: "생성됨" };

            // In-progress states (pending action)
            case DOCUMENT_STATUS.DOC_REQUEST_PARTICIPANT:
                return { statusType: "060", statusDetail: "서명 요청됨" };
            case DOCUMENT_STATUS.DOC_ACCEPT_PARTICIPANT:
            case DOCUMENT_STATUS.DOC_ACCEPT_OUTSIDER:
                return { statusType: "060", statusDetail: "서명 진행중" };
            case DOCUMENT_STATUS.DOC_ACCEPT_APPROVAL:
                return { statusType: "060", statusDetail: "결재 승인" };
            case DOCUMENT_STATUS.DOC_TEMPSAVE_PARTICIPANT:
                return { statusType: "060", statusDetail: "임시 저장" };

            // Default - pending
            default:
                this.logger.warn(`Unknown document status: ${status}`);
                return { statusType: "060", statusDetail: status };
        }
    }
}
