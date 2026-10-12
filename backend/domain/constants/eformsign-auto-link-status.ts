/**
 * Rule 계약-05: a contract document is linked to a client automatically only when the
 * document is in one of these statuses. Statuses outside the set are either not durable yet
 * (001 temporary save), refused/revoked/deleted endings, or otherwise not a live contract.
 *
 * This set governs CREATING a new client from a document. Linking a document to an
 * already registered client uses {@link isEformsignAutoLinkEligibleStatus}, which also
 * accepts the live statuses below.
 */
export const AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES: ReadonlySet<string> = new Set([
    // 001 is only a temporary save. Start from the first durable document state.
    "002",
    "003",
    "010",
    "012",
    "020",
    "022",
    "030",
    "032",
    // 041 (doc_refuse_revoke): the revoke was refused, the document continues like 060.
    "041",
    "043",
    "050",
    "060",
    "062",
    "063",
    "064",
    "070",
    "072",
    "092",
]);

/**
 * Live contract statuses that an already registered client may still be linked to even though
 * they never create a client: 040/045 (철회 요청됨 - cancellation requested, the contract is
 * still active) and 071 (반려됨 - not terminal, the customer's signature stays valid).
 */
const EXISTING_CLIENT_ONLY_LINK_STATUS_CODES: readonly string[] = ["040", "045", "071"];

/** Every status a document may be in to be linked automatically to an existing client. */
export const EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES: ReadonlySet<string> = new Set([
    ...AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES,
    ...EXISTING_CLIENT_ONLY_LINK_STATUS_CODES,
]);

export function isEformsignAutoLinkEligibleStatus(
    statusType: string | null | undefined,
): boolean {
    return statusType !== null
        && statusType !== undefined
        && EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES.has(statusType);
}
