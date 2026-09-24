import { Inject, Injectable } from "@nestjs/common";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
    RecentEformsignDocRow,
} from "domain/repositories/eformsign-doc.repository.interface";

/**
 * A `RecentEformsignDocRow` with the mirrored contract end date wired in, the same
 * way `FindEformsignDocsByClientIdUsecase.executeWithContractEndDates` does for the
 * client panel — required for `resolveEformsignDocDisplayStatus` to ever resolve
 * "signed" (vs. "review") for a provider-review-step document.
 */
export interface RecentContractRow extends RecentEformsignDocRow {
    /** YYYY-MM-DD from the mirrored detail payload; null when not recoverable. */
    contractEndDate: string | null;
}

@Injectable()
export class FindRecentContractsUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(branchid: string, take: number): Promise<RecentContractRow[]> {
        const docs = await this.eformsignDocRepository.findRecentContracts(branchid, take);
        const endDates = docs.length > 0
            ? await this.eformsignDocRepository.findContractEndDatesByDocumentIds(
                docs.map((doc) => doc.documentId),
            )
            : new Map<string, string>();
        return docs.map((doc) => ({
            ...doc,
            contractEndDate: endDates.get(doc.documentId) ?? null,
        }));
    }
}
