import { Inject, Injectable, Logger } from "@nestjs/common";
import { ContractDataDto } from "application/dto/contract.dto";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { AreaTemplateService } from "application/services/area-template.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";

const DEFAULT_DOCUMENT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"]);

export interface DispatchHeadlessParams {
    contractData: ContractDataDto;
    clientId?: number;
    progressId?: string;
}

export interface DispatchHeadlessSuccess {
    ok: true;
    documentId: string;
    durationMs: number;
}

export interface DispatchHeadlessFailure {
    ok: false;
    reason: string;
    fallbackHint: "iframe";
    durationMs: number;
    failedStep?: EformsignHeadlessProgressStep;
}

export type DispatchHeadlessResult = DispatchHeadlessSuccess | DispatchHeadlessFailure;

interface CreatedDocumentStatus {
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    expiredDate: Date;
}

/**
 * Backend-driven creation flow:
 *   1. Build the SDK option payload (same as the iframe path).
 *   2. Hand it to EformsignHeadlessService, which loads the SDK in a hidden
 *      Chromium and walks the iframe gate sequence.
 *   3. On success, persist a doc record. On failure, return a fallback hint
 *      so the frontend can re-open the iframe modal.
 */
@Injectable()
export class DispatchDocumentHeadlessUsecase {
    private readonly logger = new Logger(DispatchDocumentHeadlessUsecase.name);

    constructor(
        private readonly eformsignService: EformsignService,
        private readonly headlessService: EformsignHeadlessService,
        private readonly areaTemplateService: AreaTemplateService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        private readonly progressService: EformsignHeadlessProgressService,
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchId: string, params: DispatchHeadlessParams): Promise<DispatchHeadlessResult> {
        const start = Date.now();
        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        try {
            const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token;
            const refreshToken = tokenResponse.oauth_token.refresh_token;

            let templateId: string | undefined;
            if (params.contractData.area) {
                const areaTemplate = await this.areaTemplateService.findByArea(branchId, params.contractData.area);
                templateId = areaTemplate?.templateId;
            }

            const documentOption = this.eformsignService.generateDocumentOptions(
                params.contractData,
                accessToken,
                refreshToken,
                templateId,
            ) as Record<string, unknown>;

            const result = await this.headlessService.dispatchCreation({
                documentOption,
                onProgress: (step) => {
                    latestProgressStep = step;
                    this.progressService.emit(params.progressId, step);
                },
            });

            if (!result.ok) {
                this.progressService.emit(params.progressId, "failed", result.reason, latestProgressStep);
                return {
                    ok: false,
                    reason: result.reason,
                    fallbackHint: "iframe",
                    durationMs: result.durationMs,
                    failedStep: latestProgressStep,
                };
            }

            // The SDK success callback (`__eformsignSuccess.document_id`) is
            // the only authoritative source of the new document id — mode:"01"
            // payloads don't carry one. If it's missing we treat the run as a
            // soft failure and fall back to the iframe so the user can retry.
            const documentId = result.documentId;
            if (!documentId) {
                this.logger.warn("Headless creation finished without a document_id from the SDK callback; falling back.");
                this.progressService.emit(
                    params.progressId,
                    "failed",
                    "missing document_id from eformsign success callback",
                    latestProgressStep,
                );
                return {
                    ok: false,
                    reason: "missing document_id from eformsign success callback",
                    fallbackHint: "iframe",
                    durationMs: result.durationMs,
                    failedStep: latestProgressStep,
                };
            }

            if (params.clientId && documentId) {
                const client = await this.clientRepository.findById(branchId, params.clientId).catch(() => null);
                const createdDocumentStatus = await this.resolveCreatedDocumentStatus(
                    accessToken,
                    documentId,
                    templateId,
                );
                await this.createEformsignDocUsecase.execute(branchId, {
                    documentId,
                    clientId: params.clientId,
                    statusType: createdDocumentStatus.statusType,
                    statusDetail: createdDocumentStatus.statusDetail,
                    stepType: createdDocumentStatus.stepType,
                    stepIndex: createdDocumentStatus.stepIndex,
                    stepName: createdDocumentStatus.stepName,
                    stepRecipientType: "01",
                    stepRecipientName: params.contractData.customerName,
                    stepRecipientSms: params.contractData.customerContact || client?.phone || "",
                    expiredDate: createdDocumentStatus.expiredDate,
                    linkToClient: true,
                }).catch((error) => {
                    this.logger.error(`Failed to persist doc record for ${documentId}: ${error}`);
                });
            }

            return {
                ok: true,
                documentId,
                durationMs: result.durationMs,
            };
        } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown headless dispatch error";
            this.logger.error(`DispatchDocumentHeadlessUsecase failed: ${reason}`);
            this.progressService.emit(params.progressId, "failed", reason, latestProgressStep);
            return {
                ok: false,
                reason,
                fallbackHint: "iframe",
                durationMs: Date.now() - start,
                failedStep: latestProgressStep,
            };
        }
    }

    private async resolveCreatedDocumentStatus(
        accessToken: string,
        documentId: string,
        expectedTemplateId?: string,
    ): Promise<CreatedDocumentStatus> {
        const fallback = this.initialSignRequestStatus();
        try {
            const document = await this.fetchEformsignDocFromApiUsecase.execute(accessToken, documentId);
            const actualTemplateId = document.template?.id?.trim();
            if (expectedTemplateId && actualTemplateId && actualTemplateId !== expectedTemplateId) {
                this.logger.warn(
                    `Created document ${documentId} used template ${actualTemplateId}, expected ${expectedTemplateId}.`,
                );
            }

            const currentStatus = document.current_status;
            const statusType = this.normalizeStatusCode(currentStatus?.status_type);
            return {
                statusType,
                statusDetail: this.statusDetail(statusType, currentStatus?.step_name),
                stepType: currentStatus?.step_type?.trim() || fallback.stepType,
                stepIndex: currentStatus?.step_index?.trim() || fallback.stepIndex,
                stepName: currentStatus?.step_name?.trim() || fallback.stepName,
                expiredDate: this.expiredDateFromEpoch(currentStatus?.expired_date) ?? fallback.expiredDate,
            };
        } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown error";
            this.logger.warn(
                `Failed to fetch created eformsign document ${documentId} status; using initial sign-request status. ${reason}`,
            );
            return fallback;
        }
    }

    private initialSignRequestStatus(): CreatedDocumentStatus {
        return {
            statusType: "060",
            statusDetail: "서명 요청됨",
            stepType: "01",
            stepIndex: "1",
            stepName: "서명 요청",
            expiredDate: new Date(Date.now() + DEFAULT_DOCUMENT_EXPIRY_MS),
        };
    }

    private normalizeStatusCode(statusType: string | null | undefined): string {
        return statusType?.trim().padStart(3, "0") || "000";
    }

    private statusDetail(statusType: string, stepName: string | null | undefined): string {
        if (COMPLETED_STATUS_CODES.has(statusType)) {
            return "완료";
        }
        if (REJECTED_STATUS_CODES.has(statusType)) {
            return "거부";
        }
        return stepName?.trim() || "진행중";
    }

    private expiredDateFromEpoch(expiredDate: number | null | undefined): Date | null {
        if (!expiredDate || expiredDate <= 0) {
            return null;
        }
        return new Date(expiredDate);
    }
}
