import { Inject, Injectable, Logger } from "@nestjs/common";
import { ContractDataDto } from "application/dto/contract.dto";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { AreaTemplateService } from "application/services/area-template.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";

export interface DispatchHeadlessParams {
    contractData: ContractDataDto;
    clientId?: number;
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
}

export type DispatchHeadlessResult = DispatchHeadlessSuccess | DispatchHeadlessFailure;

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
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchId: string, params: DispatchHeadlessParams): Promise<DispatchHeadlessResult> {
        const start = Date.now();
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

            const result = await this.headlessService.dispatchCreation({ documentOption });

            if (!result.ok) {
                return {
                    ok: false,
                    reason: result.reason,
                    fallbackHint: "iframe",
                    durationMs: result.durationMs,
                };
            }

            const documentId = result.documentId ?? this.tryExtractDocumentIdFromOption(documentOption) ?? "";
            if (!documentId) {
                this.logger.warn("Headless creation succeeded but no documentId was captured.");
            }

            if (params.clientId && documentId) {
                const client = await this.clientRepository.findById(branchId, params.clientId).catch(() => null);
                const expiredDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                await this.createEformsignDocUsecase.execute(branchId, {
                    documentId,
                    clientId: params.clientId,
                    statusType: "060",
                    statusDetail: "대기",
                    stepType: "01",
                    stepIndex: "1",
                    stepName: "서명 요청",
                    stepRecipientType: "01",
                    stepRecipientName: client?.name ?? params.contractData.customerName,
                    stepRecipientSms: client?.phone ?? params.contractData.customerContact,
                    expiredDate,
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
            return {
                ok: false,
                reason,
                fallbackHint: "iframe",
                durationMs: Date.now() - start,
            };
        }
    }

    private tryExtractDocumentIdFromOption(option: Record<string, unknown>): string | undefined {
        const mode = option["mode"] as { document_id?: string } | undefined;
        return mode?.document_id;
    }
}
