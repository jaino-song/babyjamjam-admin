import {
    ConflictException,
    HttpException,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    ServiceUnavailableException,
} from "@nestjs/common";

import {
    EformsignCredentialBoundary,
    type EformsignProviderPrincipal,
} from "application/services/eformsign-credential-boundary.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EformsignService } from "application/services/eformsign.service";
import { successfulDeletedDocumentIds } from "application/utils/eformsign-cancel-result";
import { codeOnlyProblemBody, uncertainProblemBody } from "application/utils/problem-bodies";
import { hasCustomerSigned, isCancellableUnsignedContract } from "domain/utils/eformsign-customer-signature";
import {
    CONTRACT_SUPERSEDE_REPOSITORY,
    IContractSupersedeRepository,
} from "domain/repositories/contract-supersede.repository.interface";
import { isEformsignDocumentAbsentError } from "infrastructure/api/eformsign-api.error";

export interface SupersedeContractParams {
    branchId: string;
    clientId: number;
    documentId: string;
    principal: EformsignProviderPrincipal;
}

/**
 * Cancel a contract that a re-issue replaced. Unlike a delete, this never
 * touches a signed or otherwise finished contract. Supersede never records a
 * purge intent, so reconciliation can never purge on its behalf. The local copy
 * is removed only after eformsign confirms the cancellation in this call.
 *
 * This service verifies the document belongs to the given branch (the lookup is
 * branch-scoped) and to the given client. Callers verify the rest: the HTTP route
 * checks the replacement is the client's linked contract; the job worker checks
 * the client belongs to the job's branch.
 */
@Injectable()
export class ContractSupersedeService {
    constructor(
        @Inject(CONTRACT_SUPERSEDE_REPOSITORY)
        private readonly repository: IContractSupersedeRepository,
        private readonly credentialBoundary: EformsignCredentialBoundary,
        private readonly eformsignService: EformsignService,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
    ) {}

    async supersede(params: SupersedeContractParams): Promise<{ documentId: string; superseded: true }> {
        const { branchId, clientId, documentId, principal } = params;
        let cancelAttempted = false;
        let vendorCancelled = false;
        try {
            // Only this client's own contract can be superseded, never another
            // client's document or a service-record snapshot.
            const document = await this.repository.findSupersedeCandidate(branchId, documentId);
            if (
                !document
                || document.documentKind === "service_record_snapshot"
                // Positive ownership only: an unowned (clientId null) legacy document is
                // not this client's, so a caller must not be able to cancel and purge it
                // just by knowing its id.
                || document.clientId !== clientId
                || hasCustomerSigned(document)
            ) {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }
            const terminalDocumentIds = await this.documentMirrorService
                .findTerminalDocumentIds([documentId]);
            if (terminalDocumentIds.length > 0) {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }

            const fresh = await this.credentialBoundary.withCredentials(
                principal,
                "document.read",
                ({ accessToken }) => this.eformsignService.getDocumentById(accessToken, documentId),
            ).catch((error: unknown) => {
                if (isEformsignDocumentAbsentError(error)) {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                }
                throw new ServiceUnavailableException(codeOnlyProblemBody("DEPENDENCY_UNAVAILABLE"));
            });
            const freshContract = {
                statusType: fresh?.current_status?.status_type,
                stepType: fresh?.current_status?.step_type ?? null,
                stepName: fresh?.current_status?.step_name ?? null,
            };
            if (hasCustomerSigned(freshContract) || !isCancellableUnsignedContract(freshContract)) {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }

            const result = await this.credentialBoundary.withCredentials(
                principal,
                "document.cancel",
                ({ accessToken }) => {
                    cancelAttempted = true;
                    return this.eformsignService.cancelDocuments(accessToken, [documentId]);
                },
            );
            if (!successfulDeletedDocumentIds(result).includes(documentId)) {
                // A refusal (possibly signed in the meantime) leaves the local record intact.
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }
            vendorCancelled = true;
            await this.documentMirrorService.purgeDocuments([documentId]);
            return { documentId, superseded: true };
        } catch (error) {
            if (error instanceof HttpException) throw error;
            if (cancelAttempted && !vendorCancelled) {
                Logger.warn({
                    message: "supersede cancel outcome ambiguous; old contract left intact and visible",
                    documentId,
                    clientId,
                    branchId,
                }, ContractSupersedeService.name);
            }
            throw new InternalServerErrorException(uncertainProblemBody("INTERNAL_ERROR"));
        }
    }
}
