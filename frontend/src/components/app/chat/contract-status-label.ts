import { getClientDocumentStatusMeta } from "@babyjamjam/shared/constants/client-document-status";
import {
    CONTRACT_DOC_DISPLAY_STATUS_LABELS,
    isContractDocDisplayStatus,
} from "@babyjamjam/shared/constants/eformsign-doc-status";
import { isReviewerRejectedEformsignStatus } from "@babyjamjam/shared/constants/eformsign-status-codes";
import type { EformsignDocument } from "@/lib/eformsign/types";
import type { DocumentStatus } from "@/lib/client/types";

/**
 * Whether the contract DOCUMENT is rejected by the provider's reviewer (eformsign 071). The coarse
 * client summary cannot say so: it reports a rejected contract as signed. The document's own display
 * status decides; its status code only stands in when the display status is absent.
 */
export function isRejectedContractDocument(
    contractDocument: Pick<EformsignDocument, "display_status" | "current_status"> | null | undefined,
): boolean {
    const displayStatus = contractDocument?.display_status;
    return isContractDocDisplayStatus(displayStatus)
        ? displayStatus === "rejected_by_reviewer"
        : isReviewerRejectedEformsignStatus(contractDocument?.current_status?.status_type);
}

/** The label the chat's contract-status answer shows: 반려됨 for a rejected contract, else the summary's wording. */
export function contractStatusResultLabel(result: {
    documentStatus: DocumentStatus;
    hasSigned: boolean;
    rejectedByReviewer?: boolean;
}): string {
    if (result.rejectedByReviewer) return CONTRACT_DOC_DISPLAY_STATUS_LABELS.rejected_by_reviewer;
    return getClientDocumentStatusMeta(result.documentStatus, { hasSigned: result.hasSigned }).label;
}
