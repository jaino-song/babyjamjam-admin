export const RECEIPT_LINK_REASON_MESSAGES: Record<string, string> = {
  not_voucher_client: "바우처 이용 산모가 아니어서 영수증 안내를 보낼 수 없어요.",
  missing_birthday: "산모 생년월일이 등록되지 않았습니다. 산모 정보를 먼저 수정해 주세요.",
  no_contract_document: "연결된 계약서를 찾지 못했습니다.",
  document_not_linked: "계약서에 연결된 산모가 없습니다.",
  document_not_found: "계약서를 찾지 못했습니다.",
  missing_end_date: "서비스 종료일이 등록되지 않았습니다. 산모 정보를 먼저 수정해 주세요.",
  service_period_expired: "영수증 링크 유효기간(서비스 종료 후 14일)이 지났습니다.",
  pdf_unavailable: "계약서 PDF를 아직 불러올 수 없어요. 잠시 후 다시 시도해 주세요.",
  render_failed: "영수증 이미지 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  upload_failed: "영수증 이미지 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  missing_phone: "산모 연락처가 없거나 형식이 올바르지 않아요.",
};
export const RECEIPT_LINK_SEND_FALLBACK_MESSAGE = "영수증 문자 발송에 실패했어요. 잠시 후 다시 시도해 주세요.";

/**
 * Maps a receipt-link send failure to a user-facing message: known reason code first,
 * then the server's own message (some 4xx bodies carry a message without a mapped
 * reason, e.g. the 403 sender-approval case), then a generic fallback.
 */
export function describeReceiptLinkError(error: unknown): string {
  const data = (error as { response?: { data?: { reason?: unknown; message?: unknown } } })?.response?.data;
  const reason = data?.reason;
  if (
    typeof reason === "string" &&
    Object.prototype.hasOwnProperty.call(RECEIPT_LINK_REASON_MESSAGES, reason)
  ) {
    return RECEIPT_LINK_REASON_MESSAGES[reason];
  }
  const message = data?.message;
  if (typeof message === "string" && message) {
    return message;
  }
  return RECEIPT_LINK_SEND_FALLBACK_MESSAGE;
}
