import { ConflictException, ForbiddenException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { EformsignCredentialBoundary, type EformsignProviderPrincipal } from "application/services/eformsign-credential-boundary.service";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { isDefinitiveVendorRefusal, successfulDeletedDocumentIds } from "application/utils/eformsign-cancel-result";
import { resolveEformsignDocDisplayStatus } from "application/utils/eformsign-doc-display-status";
import { DELETED_STATUS_CODES } from "application/utils/eformsign-document-list";
import { codeOnlyProblemBody, uncertainProblemBody } from "application/utils/problem-bodies";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, type IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { hasCustomerSigned } from "domain/utils/eformsign-customer-signature";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

@Injectable()
export class VoidContractDocumentUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY) private readonly repository: IEformsignDocRepository,
        private readonly credentialBoundary: EformsignCredentialBoundary,
        private readonly eformsignService: EformsignService,
        private readonly snapshotService: EformsignDocumentSnapshotService,
        private readonly eventBus: EformsignDocsEventBus,
        private readonly holidayCalendar: HolidayCalendarService,
    ) {}

    async execute(tenant: EformsignProviderPrincipal & { userId: string }, documentId: string): Promise<{
        documentId: string; voidedAt: string; voidedByName: string | null; displayStatus: "voided";
    }> {
        const branchId = tenant.branchId ?? "";
        const document = await this.repository.findVoidCandidate(branchId, documentId);
        if (!document) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        if (document.voidedAt) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        if (document.permanentPurgeRequestedAt) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        if (document.documentKind === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT || document.serviceRecordCaseId) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (document.clientId === null) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        if (DELETED_STATUS_CODES.has(normalizeEformsignStatusCode(document.statusType))) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        const calendar = await this.holidayCalendar.forBranch(branchId);
        const displayStatus = resolveEformsignDocDisplayStatus({
            id: documentId,
            isVoided: document.voidedAt !== null,
            current_status: { status_type: document.statusType, step_type: document.stepType, step_name: document.stepName },
        }, new Date(), calendar);
        if (displayStatus === "revoked" || displayStatus === "expired") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        if (!hasCustomerSigned(document)) {
            let cancelAttempted = false;
            let result: unknown;
            try {
                result = await this.credentialBoundary.withCredentials(tenant, "document.cancel", ({ accessToken }) => {
                    cancelAttempted = true;
                    return this.eformsignService.cancelDocuments(accessToken, [documentId], "계약 파기");
                });
            } catch (error) {
                if (!cancelAttempted) {
                    if (error instanceof ForbiddenException) throw error;
                    throw new ServiceUnavailableException(codeOnlyProblemBody("DEPENDENCY_UNAVAILABLE"));
                }
                Logger.warn({ documentId }, VoidContractDocumentUsecase.name);
                if (isDefinitiveVendorRefusal(error)) {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                }
                throw new InternalServerErrorException(uncertainProblemBody("INTERNAL_ERROR"));
            }
            if (!successfulDeletedDocumentIds(result).includes(documentId)) {
                const fresh = await this.repository.findVoidCandidate(branchId, documentId).catch(() => {
                    Logger.warn({ documentId }, VoidContractDocumentUsecase.name);
                    throw new InternalServerErrorException(uncertainProblemBody("INTERNAL_ERROR"));
                });
                if (!hasCustomerSigned(fresh)) {
                    Logger.warn({ documentId }, VoidContractDocumentUsecase.name);
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                }
            }
        }

        const now = new Date();
        const written = await this.repository.markVoided(branchId, documentId, now, tenant.userId).catch(() => {
            Logger.warn({ documentId }, VoidContractDocumentUsecase.name);
            throw new InternalServerErrorException(uncertainProblemBody("INTERNAL_ERROR"));
        });
        if (!written) {
            Logger.warn({ documentId }, VoidContractDocumentUsecase.name);
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        // 파기 기록 이후 캐시/이벤트 실패로 성공 응답을 뒤집지 않는다.
        try { await this.snapshotService.bumpVersion(branchId); }
        catch { Logger.warn({ documentId }, VoidContractDocumentUsecase.name); }
        try { this.eventBus.emit({ branchId, documentId, reason: "mirror:changed" }); }
        catch { Logger.warn({ documentId }, VoidContractDocumentUsecase.name); }
        let voidedByName: string | null = null;
        try { voidedByName = (await this.repository.findVoidedByNames([tenant.userId])).get(tenant.userId) ?? null; }
        catch { Logger.warn({ documentId }, VoidContractDocumentUsecase.name); }
        return { documentId, voidedAt: now.toISOString(), voidedByName, displayStatus: "voided" };
    }
}
