import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

export const EFORMSIGN_COMPLETED_STATUS_CODES: ReadonlySet<string> = new Set([
    "003",
    "012",
    "022",
    "032",
    "050",
    "062",
    "072",
    "092",
]);

/**
 * Completed values that may already exist in storage from legacy/raw vendor writes.
 * New writes are normalized, but publication queries must also fence old aliases and
 * unpadded numeric forms until a normal sync rewrites them canonically.
 */
export const EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES: readonly string[] = [
    ...EFORMSIGN_COMPLETED_STATUS_CODES,
    "3",
    "03",
    "12",
    "22",
    "32",
    "50",
    "62",
    "72",
    "92",
    "doc_complete",
    "doc_accept_approval",
    "doc_accept_reception",
    "doc_accept_outsider",
    "doc_accept_participant",
    "doc_accept_reviewer",
    "face_signature_complete",
];

/**
 * "040" (doc_request_revoke) and "045" (doc_request_reject) are deliberately absent. They
 * record that cancellation was REQUESTED, not that it happened: the document stays live,
 * and eformsign can still refuse the request (doc_refuse_revoke, 041) or the signer can
 * carry on (060). The revoked ending is "042". Treating 040 as terminal froze the row at
 * 040 — the terminal-downgrade guard then refused the later 060 and the client read
 * "revoked" for a document that is still signable — and let a delete purge a document
 * whose cancellation the vendor had not completed. 045 gets exactly the same treatment.
 * "041" (a refused revoke) is not a rejection either: the document continues.
 *
 * "071" (doc_reject_reviewer, 계약-04) is absent too: the provider's reviewer rejected the
 * document, but a later 070 (resubmitted for review) or 072 (accepted) legitimately follows,
 * and the customer's signature stays valid. It is a live, in-progress document shown "반려됨"
 * (see {@link EFORMSIGN_REVIEWER_REJECTED_STATUS_CODE}).
 */
export const EFORMSIGN_REJECTED_STATUS_CODES: ReadonlySet<string> = new Set([
    "011",
    "021",
    "031",
    "042",
    "047",
    "049",
    "061",
    "080",
]);

/**
 * "040" (doc_request_revoke) and "045" (doc_request_reject): cancellation was requested but
 * has not happened. They are not terminal (see above), yet nothing may treat the document as
 * an ordinary live one: finalize must not report progress on it and must not start on it.
 */
export const EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES: ReadonlySet<string> = new Set(["040", "045"]);

/** The canonical (040) member of {@link EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES}. */
export const EFORMSIGN_REVOKE_REQUESTED_STATUS_CODE = "040";

/**
 * "041" (doc_refuse_revoke): the revoke request was refused and the document continues. It
 * is the document's live in-progress state, exactly like 060 (request participant).
 */
export const EFORMSIGN_REFUSE_REVOKE_STATUS_CODE = "041";

/**
 * The status detail a revoke-requested document (040/045) carries. The webhook writes the
 * same text literally; every other writer must use this constant so manual sync, headless
 * dispatch and the webhook never leave different details on the same status.
 */
export const EFORMSIGN_REVOKE_REQUESTED_STATUS_DETAIL = "철회 요청";

/**
 * "071" (doc_reject_reviewer, 계약-04): the provider's reviewer rejected the document. Not
 * terminal and not "rejected" in the sense of {@link EFORMSIGN_REJECTED_STATUS_CODES}, yet no
 * writer may treat it as an ordinary live document either: finalize must not start on it, and
 * the status detail it carries stays "거부"/"검토 반려" as before.
 */
export const EFORMSIGN_REVIEWER_REJECTED_STATUS_CODE = "071";

export function isReviewerRejectedStatus(
    statusType: string | number | null | undefined,
): boolean {
    return normalizeEformsignStatusCode(statusType) === EFORMSIGN_REVIEWER_REJECTED_STATUS_CODE;
}

/**
 * In-progress codes: the document is live and waiting on someone (041 reads exactly like 060).
 * 071 (a reviewer rejection) is live too: 070 and 072 still follow it.
 */
export const EFORMSIGN_IN_PROGRESS_STATUS_CODES: ReadonlySet<string> = new Set([
    "001",
    "002",
    "010",
    "020",
    "030",
    "041",
    "043",
    "060",
    "063",
    "064",
    "070",
    "071",
]);

export function isRevokeRequestedStatus(
    statusType: string | number | null | undefined,
): boolean {
    return EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES.has(normalizeEformsignStatusCode(statusType));
}

// "090"(철회)·"099"(삭제됨)은 웹훅 상태 매핑이 합성해 영속화하는 종료 코드다.
export const TERMINAL_STATUS_CODES = new Set<string>([
    ...EFORMSIGN_COMPLETED_STATUS_CODES,
    ...EFORMSIGN_REJECTED_STATUS_CODES,
    "090",
    "099",
]);

// 미배정 문서는 이용자 서명 완료(062) 뒤 제공기관 검토(070)로 진행할 수 있다.
/**
 * Codes that end the reviewer stage but not the document: 062 is participant acceptance
 * and 071 is a reviewer rejection, and a review request or re-request legitimately
 * follows either. Treating them as terminal freezes a mirrored row forever — nothing
 * re-mirrors a document that already has a local row.
 */
export const UNASSIGNED_REVIEW_STAGE_STATUS_CODES = new Set<string>(["062", "071"]);

export function isUnassignedReviewStageStatus(
    statusType: string | number | null | undefined,
): boolean {
    return UNASSIGNED_REVIEW_STAGE_STATUS_CODES.has(
        normalizeEformsignStatusCode(statusType),
    );
}

/** A current body PDF is readable while the provider review audit trail is pending. */
export function isReviewStageDocumentPdfReadable(
    statusType: string | number | null | undefined,
): boolean {
    return normalizeEformsignStatusCode(statusType) === "070"
        || isUnassignedReviewStageStatus(statusType);
}

/**
 * Canonical review-stage codes plus raw values written by older vendor-ingestion paths.
 * The repository normally receives normalized codes now, but an equal-generation forward
 * transition must also be able to replace a legacy row without broadly reopening every
 * completed status.
 */
export const UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES = [
    "062",
    "071",
    "62",
    "71",
    "doc_accept_participant",
    "doc_reject_reviewer",
] as const;

export const UNASSIGNED_TERMINAL_STATUS_CODES = new Set<string>(
    [...TERMINAL_STATUS_CODES].filter(
        (statusCode) => !UNASSIGNED_REVIEW_STAGE_STATUS_CODES.has(statusCode),
    ),
);

/**
 * What may follow a review-stage code: a real terminal, the review request, or the other
 * review-stage code. The review stage is a cycle — a reviewer can reject (071) what a
 * participant accepted (062), and a corrected document can be accepted again after a
 * rejection — and the intermediate 070 is exactly the webhook a backfill exists to
 * reconcile. Only the earlier in-progress codes are genuinely backward from here.
 */
export const UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE = new Set<string>([
    ...UNASSIGNED_TERMINAL_STATUS_CODES,
    ...UNASSIGNED_REVIEW_STAGE_STATUS_CODES,
    "070",
    // 040 and 045 left the terminal set (a cancellation request does not end the document),
    // which also dropped them from UNASSIGNED_TERMINAL_STATUS_CODES above. A newer revoke
    // request is still a forward event after 062/071, so list them explicitly.
    ...EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES,
]);

/** The one code that means the document passed its expiry date. */
export const EFORMSIGN_EXPIRED_STATUS_CODE = "080";

/**
 * What an ended document's status detail should read when the vendor did not supply one.
 * List responses carry no `status_doc_detail`, and the detail a document held while it
 * was open — "서명 요청됨" — is plainly wrong once it has finished; the UI renders this
 * string directly. Wording matches the webhook's own mapping so a row reads the same
 * however it was reconciled. Codes whose meaning is not unambiguous from the code alone
 * are deliberately absent: for those, keeping the stored detail beats inventing one.
 */
export const EFORMSIGN_TERMINAL_STATUS_DETAILS: Readonly<Record<string, string>> = {
    "003": "완료",
    "050": "완료",
    "061": "거부",
    "071": "검토 반려",
    "072": "검토 완료",
    "080": "만료",
    "090": "철회",
    "099": "삭제됨",
};
