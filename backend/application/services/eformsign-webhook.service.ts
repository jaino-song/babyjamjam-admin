import { Injectable, Logger, Inject } from "@nestjs/common";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { LinkDocumentToClientUsecase } from "application/usecases/eformsign-doc/link-document-to-client.usecase";
import { SyncClientEndDateUsecase } from "application/usecases/eformsign-doc/sync-client-end-date.usecase";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { AlimtalkService } from "./alimtalk.service";
import { EformsignDocsEventBus } from "./eformsign-docs-event-bus.service";
import { NotificationService } from "./notification.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    type EformsignApiDocumentResponse,
    type IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

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
    DOC_REQUEST_APPROVAL: "doc_request_approval",       // 결재 요청
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
    DOCUMENT_ACTION: "document_action",    // Document action (open, view, etc.)
    READY_DOCUMENT_PDF: "ready_document_pdf", // PDF generation complete
};

const REVIEW_REQUIRED_NOTIFICATION_TYPE = "eformsign-review-required";

const STATUS_NAME_TO_CODE: Record<string, string> = {
    doc_complete: "003",
    doc_accept_approval: "012",
    doc_accept_reception: "022",
    doc_accept_outsider: "032",
    doc_request_revoke: "040",
    doc_revoke: "042",
    doc_request_reject: "045",
    doc_request_delete: "047",
    doc_delete: "049",
    doc_request_participant: "060",
    doc_reject_participant: "061",
    doc_accept_participant: "062",
    doc_rerequest_participant: "063",
    doc_open_participant: "064",
    doc_request_reviewer: "070",
    doc_reject_reviewer: "071",
    doc_accept_reviewer: "072",
    doc_expired: "080",
    face_signature_complete: "092",
};

const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"]);

@Injectable()
export class EformsignWebhookService {
    private readonly logger = new Logger(EformsignWebhookService.name);

    constructor(
        private readonly updateStatusUsecase: UpdateEformsignDocStatusUsecase,
        private readonly linkDocumentUsecase: LinkDocumentToClientUsecase,
        private readonly syncClientEndDateUsecase: SyncClientEndDateUsecase,
        private readonly alimtalkService: AlimtalkService,
        private readonly eventBus: EformsignDocsEventBus,
        private readonly notificationService: NotificationService,
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignApiClient: IEformsignClientRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async processWebhook(branchid: string, payload: EformsignWebhookPayloadDto): Promise<void> {
        const { event_type, webhook_id, document, ready_document_pdf, document_action } = payload;
        const documentId = document?.id ?? ready_document_pdf?.document_id ?? document_action?.document_id;
        const resolvedBranchId = documentId
            ? await this.resolveBranchIdForDocument(branchid, documentId)
            : branchid;

        this.logger.log(`Processing webhook ${webhook_id}: event_type=${event_type}`);

        // Handle document events (status changes)
        if (event_type === EVENT_TYPES.DOCUMENT && document) {
            await this.handleDocumentEvent(resolvedBranchId, document);
            return;
        }

        // Handle document_action events (open, view actions)
        // Note: eformsign sends action data inside the `document` object (document.action field)
        if (event_type === EVENT_TYPES.DOCUMENT_ACTION && document) {
            await this.handleDocumentActionEvent(resolvedBranchId, document);
            return;
        }

        // Handle PDF ready events - also update status since it contains document_status
        if (event_type === EVENT_TYPES.READY_DOCUMENT_PDF && ready_document_pdf) {
            await this.handleReadyDocumentPdfEvent(resolvedBranchId, ready_document_pdf);
            return;
        }

        this.logger.warn(`Unknown webhook event type: ${event_type}`);
    }

    /**
     * Handle ready_document_pdf event - PDF is ready and document is complete
     * This event contains document_status which we should use to update our DB
     */
    private async handleReadyDocumentPdfEvent(
        branchid: string,
        pdfEvent: NonNullable<EformsignWebhookPayloadDto["ready_document_pdf"]>
    ): Promise<void> {
        const { document_id: documentId, document_status: status, workflow_seq, workflow_name } = pdfEvent;

        this.logger.log(`PDF ready event: ${documentId} -> status=${status}, workflow=${workflow_name}`);

        // Map status to Korean detail and determine status type
        const { statusType, statusDetail } = this.mapStatus(status);

        // Update document status in DB
        try {
            await this.updateStatusUsecase.execute(branchid, {
                documentId,
                statusType,
                statusDetail,
                stepType: String(workflow_seq),
                stepIndex: String(workflow_seq),
                stepName: workflow_name,
                expired: false,
            });

            this.logger.log(`Document ${documentId} status updated from PDF event: ${status} -> ${statusDetail}`);
        } catch (error) {
            // Document not found - frontend must create record first
            this.logger.warn(
                `[ready_document_pdf] Document ${documentId} not found in DB. ` +
                `Ensure frontend calls POST /eformsign-docs to create the record with clientId first. Error: ${error}`
            );
            return;
        }

        if (status === DOCUMENT_STATUS.DOC_COMPLETE) {
            this.logger.log(`Document ${documentId} completed (from PDF event), linking to client`);
            try {
                await this.linkDocumentUsecase.execute(branchid, documentId);
                this.logger.log(`Document ${documentId} successfully linked to client`);

                try {
                    const accessTokenResponse = await this.eformsignApiClient.getAccessToken(Date.now());
                    await this.syncClientEndDateUsecase.execute(
                        branchid,
                        documentId,
                        accessTokenResponse.oauth_token.access_token
                    );
                } catch (error) {
                    this.logger.error(`Failed to sync end date for document ${documentId}: ${error}`);
                }

                await this.sendContractSignedAlimtalkByDocumentId(
                    branchid,
                    documentId,
                    workflow_name
                );
            } catch (error) {
                this.logger.error(`Failed to link document ${documentId} to client: ${error}`);
            }
        }

        this.eventBus.emit({ branchId: branchid, documentId, reason: `pdf:${status}` });
    }

    /**
     * Handle document_action events (when document is opened or viewed)
     * Updates status to reflect document has been opened
     * Note: eformsign sends action in document.action field (e.g., "doc_open_participant")
     */
    private async handleDocumentActionEvent(
        branchid: string,
        document: NonNullable<EformsignWebhookPayloadDto["document"]>
    ): Promise<void> {
        const { id: documentId, action, workflow_seq, workflow_name } = document;

        this.logger.log(`Document action event: ${documentId} -> action=${action}, workflow=${workflow_name}`);

        // Map action type to status (opened = 서명 페이지 열림)
        const isOpenAction = action?.includes("open");
        const statusDetail = isOpenAction ? "서명 페이지 열림" : `액션: ${action}`;

        try {
            await this.updateStatusUsecase.execute(branchid, {
                documentId,
                statusType: "020", // In-progress/opened
                statusDetail,
                stepType: String(workflow_seq || 0),
                stepIndex: String(workflow_seq || 0),
                stepName: workflow_name || "unknown",
                expired: false,
            });

            this.logger.log(`Document ${documentId} action recorded: ${action}`);
        } catch (error) {
            this.logger.warn(
                `[document_action] Document ${documentId} not found in DB. ` +
                `Ensure frontend calls POST /eformsign-docs to create the record first. Error: ${error}`
            );
            return;
        }

        this.eventBus.emit({ branchId: branchid, documentId, reason: `action:${action ?? "unknown"}` });
    }

    private async handleDocumentEvent(
        branchid: string,
        document: NonNullable<EformsignWebhookPayloadDto["document"]>
    ): Promise<void> {
        const { id: documentId, status, document_title, workflow_seq, workflow_name } = document;

        this.logger.log(`Document event: ${documentId} -> status=${status}, title=${document_title}`);

        // Map status to Korean detail and determine status type
        const { statusType, statusDetail } = this.mapStatus(status);

        // Update document status in DB
        try {
            await this.updateStatusUsecase.execute(branchid, {
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
            // Document might not exist in our DB - frontend must create it first
            this.logger.warn(
                `[${status}] Document ${documentId} not found in DB. ` +
                `Ensure frontend calls POST /eformsign-docs to create the record with clientId first. Error: ${error}`
            );
            return;
        }

        await this.notifyReviewRequiredIfNeeded(branchid, documentId, document_title, statusType);

        if (status === DOCUMENT_STATUS.DOC_COMPLETE) {
            this.logger.log(`Document ${documentId} completed, linking to client`);
            try {
                await this.linkDocumentUsecase.execute(branchid, documentId);
                this.logger.log(`Document ${documentId} successfully linked to client`);

                try {
                    const accessTokenResponse = await this.eformsignApiClient.getAccessToken(Date.now());
                    await this.syncClientEndDateUsecase.execute(
                        branchid,
                        documentId,
                        accessTokenResponse.oauth_token.access_token
                    );
                } catch (error) {
                    this.logger.error(`Failed to sync end date for document ${documentId}: ${error}`);
                }

                await this.sendContractSignedAlimtalkByDocumentId(
                    branchid,
                    documentId,
                    workflow_name
                );
            } catch (error) {
                this.logger.error(`Failed to link document ${documentId} to client: ${error}`);
            }
        }

        this.eventBus.emit({ branchId: branchid, documentId, reason: `doc:${status}` });
    }

    private async sendContractSignedAlimtalkByDocumentId(
        branchid: string,
        documentId: string,
        workflowName: string
    ): Promise<void> {
        try {
            const doc = await this.eformsignDocRepository.findByDocumentId(branchid, documentId);
            if (!doc) {
                this.logger.warn(`Cannot send alimtalk: document ${documentId} not found`);
                return;
            }

            const client = await this.clientRepository.findById(branchid, doc.clientId);
            if (!client) {
                this.logger.warn(`Cannot send alimtalk: client ${doc.clientId} not found`);
                return;
            }

            const today = new Date();
            const contractInfo = {
                contractType: workflowName || "방문요양 계약서",
                signedDate: this.formatDate(today),
                serviceStartDate: client.startDate ? this.formatDate(client.startDate) : this.formatDate(today),
                employeeName: await this.getEmployeeNameForClient(branchid, doc.clientId),
            };

            await this.alimtalkService.sendContractSignedAlimtalk(client, contractInfo);
            this.logger.log(`Contract signed alimtalk sent for client ${client.id}`);
        } catch (error) {
            this.logger.error(`Failed to send contract signed alimtalk: ${error}`);
        }
    }

    // 클라이언트에 배정된 담당 직원 이름을 조회
    private async getEmployeeNameForClient(branchId: string, clientId: number): Promise<string> {
        try {
            const schedules = await this.employeeScheduleRepository.findByClientId(branchId, clientId);
            const activeSchedule = schedules.find(s => !s.replaced);
            if (!activeSchedule) return "담당자";

            const employee = await this.employeeRepository.findById(branchId, activeSchedule.primaryEmployeeId);
            return employee?.name ?? "담당자";
        } catch {
            return "담당자";
        }
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    private async resolveBranchIdForDocument(fallbackBranchId: string, documentId: string): Promise<string> {
        try {
            const branchId = await this.eformsignDocRepository.findBranchIdByDocumentId(documentId);
            return branchId ?? fallbackBranchId;
        } catch (error) {
            this.logger.warn(`Failed to resolve branch for document ${documentId}: ${error}`);
            return fallbackBranchId;
        }
    }

    private normalizeStatusCode(statusType: string | null | undefined): string {
        const normalized = statusType?.trim().toLowerCase();
        if (!normalized) {
            return "000";
        }

        return STATUS_NAME_TO_CODE[normalized] ?? normalized.padStart(3, "0");
    }

    private isReviewRequiredStatus(
        currentStatus: EformsignApiDocumentResponse["current_status"] | null | undefined
    ): boolean {
        const statusCode = this.normalizeStatusCode(currentStatus?.status_type);
        if (COMPLETED_STATUS_CODES.has(statusCode) || REJECTED_STATUS_CODES.has(statusCode)) {
            return false;
        }

        const recipients = currentStatus?.step_recipients ?? [];
        return recipients.length > 0 && recipients.every((recipient) => recipient.recipient_type === "01");
    }

    private async notifyReviewRequiredIfNeeded(
        branchid: string,
        documentId: string,
        documentTitle: string,
        localStatusType: string,
    ): Promise<void> {
        if (localStatusType !== "060") {
            return;
        }

        try {
            const accessTokenResponse = await this.eformsignApiClient.getAccessToken(Date.now());
            const document = await this.eformsignApiClient.getDocument(
                accessTokenResponse.oauth_token.access_token,
                documentId,
            );

            if (!this.isReviewRequiredStatus(document.current_status)) {
                return;
            }

            const title = "전자문서 검토 필요";
            const body = `${documentTitle || "전자문서"} 검토가 필요합니다. 최종 확인을 진행해 주세요.`;
            const data = {
                type: REVIEW_REQUIRED_NOTIFICATION_TYPE,
                documentId,
                url: `/contracts?documentId=${encodeURIComponent(documentId)}`,
            };

            const result = await this.notificationService.sendToBranchUsers(
                branchid,
                title,
                body,
                data,
                {
                    dedupe: {
                        type: REVIEW_REQUIRED_NOTIFICATION_TYPE,
                        documentId,
                    },
                },
            );
            this.logger.log(
                `Review-required notification for document ${documentId}: ${result.sent} sent, ${result.failed} failed`,
            );
        } catch (error) {
            this.logger.warn(
                `Failed to send review-required notification for document ${documentId}: ${error}`
            );
        }
    }

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
            case DOCUMENT_STATUS.DOC_REQUEST_APPROVAL:
                return { statusType: "060", statusDetail: "결재 요청됨" };
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
