import { MessageTriggerTemplateKey } from "./message-trigger-catalog";
import { SystemTemplateKey } from "./system-template-registry";
import {
    SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
    SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
} from "./service-record-link-message";
import {
    SERVICE_END_NOTICE_SMS_AUTOMATION_KEY,
    SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY,
    SERVICE_END_NOTICE_SMS_TITLE,
    SERVICE_END_NOTICE_SMS_TRIGGER_TYPE,
} from "./service-end-notice-message";

export interface SmsTemplateDeliveryConfig {
    smsLogTemplateKey: string;
    automationKey: string;
    triggerType: string;
    title: string;
    systemTemplateKey?: SystemTemplateKey;
    usePayloadMessage?: boolean;
}

/**
 * `title` here is NOT the in-app template label. It is sent to Aligo and shown
 * to the recipient as the LMS subject line, so it is outgoing message content.
 *
 * Ten of these match the in-app label; THANKS ("예약 완료" vs "예약 완료(입금 확인)")
 * and INFO ("정보 안내" vs "정보 요청") deliberately do not. They were reviewed and
 * left alone on 2026-08-12: "정보 요청" in a recipient's inbox reads as a request
 * *for* their information, which is not what the message does. Do not "fix" these
 * to match the label map — the divergence is the decision.
 *
 * Editing any title also invalidates every persisted approval snapshot (the value
 * feeds configHash and snapshotHash), so a change needs SMS_DELIVERY_CONFIG_VERSION
 * bumped and every pending approval re-approved.
 */
export const SMS_TEMPLATE_DELIVERY: Partial<Record<MessageTriggerTemplateKey, SmsTemplateDeliveryConfig>> = {
    [MessageTriggerTemplateKey.CAREGIVER_SERVICE_START_NOTICE]: {
        smsLogTemplateKey: "caregiver_service_start_notice_sms", automationKey: "CAREGIVER_SERVICE_START_NOTICE_SMS",
        triggerType: "caregiver_service_start", title: "제공인력 서비스 시작 안내", systemTemplateKey: SystemTemplateKey.CAREGIVER_SERVICE_START_NOTICE,
    },
    [MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE]: {
        smsLogTemplateKey: "caregiver_service_end_notice_sms", automationKey: "CAREGIVER_SERVICE_END_NOTICE_SMS",
        triggerType: "caregiver_service_end", title: "제공인력 서비스 종료 안내", systemTemplateKey: SystemTemplateKey.CAREGIVER_SERVICE_END_NOTICE,
    },
    [MessageTriggerTemplateKey.SERVICE_INFO]: {
        smsLogTemplateKey: "service_info_sms",
        automationKey: "SERVICE_INFO_SMS",
        triggerType: "service_start_before_7_days",
        title: "서비스 안내",
        systemTemplateKey: SystemTemplateKey.SERVICE_INFO,
    },
    [MessageTriggerTemplateKey.CLIENT_GREETING]: {
        smsLogTemplateKey: "client_greeting_sms",
        automationKey: "CLIENT_GREETING_SMS",
        triggerType: "client_created",
        title: "인사 메시지",
        systemTemplateKey: SystemTemplateKey.GREETING,
    },
    [MessageTriggerTemplateKey.PRICE_INFO]: {
        smsLogTemplateKey: "price_info_sms",
        automationKey: "PRICE_INFO_SMS",
        triggerType: "price_info",
        title: "비용 안내",
        systemTemplateKey: SystemTemplateKey.PRICE_INFO,
    },
    [MessageTriggerTemplateKey.REMINDER]: {
        smsLogTemplateKey: "reminder_sms",
        automationKey: "REMINDER_SMS",
        triggerType: "reminder",
        title: "리마인드",
        systemTemplateKey: SystemTemplateKey.REMINDER,
    },
    [MessageTriggerTemplateKey.THANKS]: {
        smsLogTemplateKey: "thanks_sms",
        automationKey: "THANKS_SMS",
        triggerType: "thanks",
        title: "예약 완료",
        systemTemplateKey: SystemTemplateKey.THANKS,
    },
    [MessageTriggerTemplateKey.SURVEY]: {
        smsLogTemplateKey: "survey_sms",
        automationKey: "SURVEY_SMS",
        triggerType: "survey",
        title: "모니터링 설문",
        systemTemplateKey: SystemTemplateKey.SURVEY,
    },
    [MessageTriggerTemplateKey.INFO]: {
        smsLogTemplateKey: "info_sms",
        automationKey: "INFO_SMS",
        triggerType: "info",
        title: "정보 안내",
        systemTemplateKey: SystemTemplateKey.INFO,
    },
    [MessageTriggerTemplateKey.SERVICE_RECORD_LINK]: {
        smsLogTemplateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
        automationKey: SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
        triggerType: SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
        title: SERVICE_RECORD_LINK_SMS_TITLE,
        systemTemplateKey: SystemTemplateKey.SERVICE_RECORD_LINK,
    },
    [MessageTriggerTemplateKey.SERVICE_END_NOTICE]: {
        smsLogTemplateKey: SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY,
        automationKey: SERVICE_END_NOTICE_SMS_AUTOMATION_KEY,
        triggerType: SERVICE_END_NOTICE_SMS_TRIGGER_TYPE,
        title: SERVICE_END_NOTICE_SMS_TITLE,
        systemTemplateKey: SystemTemplateKey.SERVICE_END_NOTICE,
    },
};

