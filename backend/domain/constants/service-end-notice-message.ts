export const MANUAL_DEDUPE_MARKER = ":manual:";
export const SERVICE_END_NOTICE_RULE_ID = "system:service_end_notice";

/**
 * Exact key shape emitted by ReceiptLinkManualSendService.send manual jobs:
 * `${SERVICE_END_NOTICE_RULE_ID}:client:${clientId}${MANUAL_DEDUPE_MARKER}${randomUUID()}`.
 * Mirrors SERVICE_RECORD_LINK_MANUAL_DEDUPE_PATTERN's precedent.
 */
export const SERVICE_END_NOTICE_MANUAL_DEDUPE_PATTERN =
    `^${SERVICE_END_NOTICE_RULE_ID}:client:[0-9]+${MANUAL_DEDUPE_MARKER}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
export const SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY = "service_end_notice_sms";
export const SERVICE_END_NOTICE_SMS_AUTOMATION_KEY = "SERVICE_END_NOTICE_SMS";
export const SERVICE_END_NOTICE_SMS_TITLE = "서비스 종료 안내";
export const SERVICE_END_NOTICE_SMS_TRIGGER_TYPE = "service_end_notice";
export const SERVICE_END_NOTICE_ALREADY_SENT_CANCEL_REASON = "서비스 종료 안내가 이미 발송됨";

/**
 * Exact key paths `ReceiptLinkDeliveryEnricher` writes into a SERVICE_END_NOTICE
 * job's payload at delivery time (`payload.templateVariables[RECEIPT_URL]` and
 * `payload.[BUTTON_URL]`). The automation binding excludes these from the bound
 * source payload for this template only: the link is server-derived from the
 * client id, and the rendered message text is still covered by the delivery
 * snapshot/provider hash at send time. Shared here so the enricher and the
 * binding cannot drift apart on the exact key names.
 */
export const SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE = "receiptUrl";
export const SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY = "buttonUrl";

export const SERVICE_END_NOTICE_DEFAULT_CONTENT = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{name}}산모님~♡

본인부담금 환급신청을 위한 영수증 다운로드 방법 안내 드립니다 :)

아래의 URL로 접속하시면 본인부담금 영수증 다운로드가 가능하십니다. 환급 신청은 관할지 보건소 방문 또는 인터넷 정부24에서 가능하시고, 다운로드 받으신 영수증 이미지를 첨부하시면 환급 신청 가능 하십니다^^

{{receiptUrl}}

추가 문의사항이 있으시면 상세히 답변 드리도록 하겠습니다.

감사합니다 :)`;
