export const SERVICE_FEEDBACK_LINK_RULE_ID = "system:service_feedback_link";
export const SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY = "service_feedback_link_sms";
export const SERVICE_FEEDBACK_LINK_SMS_AUTOMATION_KEY = "SERVICE_FEEDBACK_LINK_SMS";
export const SERVICE_FEEDBACK_LINK_SMS_TITLE = "제공기록지 작성 링크";
export const SERVICE_FEEDBACK_LINK_SMS_TRIGGER_TYPE = "service_start_at_15";

const KST_OFFSET = "+09:00";

export function atKstHour(date: Date, hour: number): Date {
    const ymd = date.toISOString().slice(0, 10);
    const hh = String(hour).padStart(2, "0");
    return new Date(`${ymd}T${hh}:00:00${KST_OFFSET}`);
}

export function getServiceFeedbackLinkScheduledFor(startDate: Date): Date {
    return atKstHour(startDate, 15);
}

export function getServiceFeedbackTokenExpiresAt(endDate: Date): Date {
    return atKstHour(endDate, 20);
}
