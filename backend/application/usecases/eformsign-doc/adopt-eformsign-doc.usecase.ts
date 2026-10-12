import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";

import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { documentCustomerNameValue } from "application/utils/eformsign-document-customer-name";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { compareEformsignClientIdentity } from "application/utils/eformsign-client-identity";
import { extractEformsignContractClientCandidate } from "application/utils/eformsign-contract-client-candidate";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { eformsignExpiryDateFromRemainingDays } from "domain/utils/eformsign-expiry-date";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import {
    EformsignCredentialBoundary,
    type EformsignProviderPrincipal,
} from "application/services/eformsign-credential-boundary.service";

import { CreateEformsignDocResult, CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";

export interface AdoptEformsignDocParams {
    documentId: string;
    clientId?: number;
}

@Injectable()
export class AdoptEformsignDocUsecase {
    private readonly logger = new Logger(AdoptEformsignDocUsecase.name);

    constructor(
        private readonly credentialBoundary: EformsignCredentialBoundary,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(
        branchId: string,
        params: AdoptEformsignDocParams,
        principal: EformsignProviderPrincipal,
    ): Promise<CreateEformsignDocResult> {
        return this.credentialBoundary.withCredentials(
            principal,
            "contract.adopt",
            async ({ accessToken }) => {
                if (params.clientId !== undefined
                    && !await this.clientRepository.findById(branchId, params.clientId)) {
                    throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                }
                const remote = await this.fetchEformsignDocFromApiUsecase.execute(
                    accessToken,
                    params.documentId,
                );
                const recipient = remote.current_status.step_recipients?.[0];

                const clientId = params.clientId
                    ?? await this.inferClientId(branchId, remote, params.documentId, recipient?.id);
                if (!clientId) {
                    throw new Error("clientId가 필요합니다.");
                }

                const result = await this.createEformsignDocUsecase.execute(branchId, {
                    documentId: remote.id || params.documentId,
                    clientId,
                    statusType: normalizeEformsignStatusCode(remote.current_status.status_type),
                    statusDetail: remote.current_status.status_doc_detail || remote.current_status.step_name || "진행중",
                    stepType: remote.current_status.step_type || "01",
                    stepIndex: remote.current_status.step_index || "1",
                    stepName: remote.current_status.step_name || "서명 요청",
                    stepRecipientType: recipient?.recipient_type || "01",
                    stepRecipientName: recipient?.name || remote.document_name || "수신자",
                    stepRecipientSms: recipient?.id || "미확인",
                    expiredDate: eformsignExpiryDateFromRemainingDays(
                        remote.current_status.expired_date,
                        Date.now(),
                    ),
                    linkToClient: true,
                    // Existing ready detail/PDFs describe the stored projection. Assign
                    // ownership first, but let the fenced mirror sync below publish the
                    // newly fetched vendor projection only after its artifacts are ready.
                    preserveExistingMirrorProjection: true,
                    documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                    templateId: remote.template?.id ?? null,
                    documentName: remote.document_name,
                    templateName: remote.template?.name ?? null,
                    customerName: documentCustomerNameValue(remote),
                    creatorName: remote.creator?.name ?? null,
                    lastEditorName: remote.last_editor?.name ?? null,
                    stepRecipientTypes: remote.current_status.step_recipients
                        ?.map((item) => item.recipient_type)
                        ?? null,
                });

                try {
                    await this.documentMirrorService.syncDocumentWithToken(
                        accessToken,
                        remote.id || params.documentId,
                        { expectedUpdatedDate: remote.updated_date },
                    );
                } catch {
                    // Ownership and client linkage were committed above. Returning a failure
                    // here would tell the caller to retry an adoption that already succeeded.
                    // Keep the row non-ready and expose a machine-readable warning so callers
                    // cannot report the local detail/PDF mirror as complete. The durable failed
                    // state remains eligible for an operational reconciliation without claiming
                    // that a scheduler or distributed lock is currently available.
                    this.logger.warn(
                        "Eformsign adoption committed, but the local mirror remains incomplete",
                    );
                    return Object.assign(result, {
                        warnings: [
                            ...(result.warnings ?? []),
                            "mirror_sync_failed" as const,
                        ],
                    });
                }

                return result;
            },
        );
    }

    /**
     * Picks a client for an adoption nobody chose a client for. A phone match is only a
     * candidate: the contract's name and birthday must agree too, and a document already
     * linked to another client is never moved (business rule 계약-05). Any rejection
     * returns undefined, so the caller reports the usual "clientId required" error.
     */
    private async inferClientId(
        branchId: string,
        remote: EformsignApiDocumentResponse,
        requestedDocumentId: string,
        recipientPhone: string | undefined,
    ): Promise<number | undefined> {
        if (!recipientPhone) return undefined;
        const client = await this.clientRepository.findByPhone(branchId, recipientPhone);
        if (!client) return undefined;

        const candidate = extractEformsignContractClientCandidate(remote);
        if (compareEformsignClientIdentity(candidate, client, new Date()).length > 0) {
            return undefined;
        }

        const existing = await this.eformsignDocRepository.findByDocumentId(
            branchId,
            remote.id || requestedDocumentId,
        );
        if (existing?.clientId != null && existing.clientId !== client.id) {
            return undefined;
        }
        return client.id;
    }
}
