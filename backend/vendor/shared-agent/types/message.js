"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_SENDER_APPROVAL_STATUSES = exports.CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS = exports.SMS_TRIGGER_TEMPLATE_KEYS = exports.SMS_TRIGGER_TO_SYSTEM_TEMPLATE = exports.MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS = void 0;
exports.getTriggerTemplateChannel = getTriggerTemplateChannel;
/**
 * Variables each scheduler can derive without operator input.
 * Backend parity is enforced by message-trigger-template-consistency.spec.ts.
 */
exports.MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS = {
    CLIENT_WELCOME: ["name", "clientName", "registrationDate", "serviceType"],
    SERVICE_START_REMINDER: ["name", "clientName", "serviceStartDate", "timingText"],
    SERVICE_INFO: ["name", "clientName", "phone"],
    SERVICE_END_REMINDER: ["name", "clientName", "serviceEndDate", "timingText"],
    EMPLOYEE_ASSIGNED: ["name", "employeeName", "clientName", "serviceStartDate"],
    SERVICE_RECORD_LINK: [
        "name",
        "employeeName",
        "clientName",
        "serviceStartDate",
        "serviceEndDate",
        "buttonUrl",
        "serviceRecordUrl",
    ],
    CLIENT_GREETING: ["name", "clientName", "phone"],
    PRICE_INFO: [
        "name",
        "clientName",
        "phone",
        "weeks",
        "duration",
        "type",
        "fullPrice",
        "grant",
        "actualPrice",
        "bankName",
        "accNum",
    ],
    REMINDER: ["name", "clientName", "phone"],
    THANKS: ["name", "clientName", "phone"],
    SURVEY: ["name", "clientName", "phone"],
    INFO: ["name", "clientName", "phone"],
    SERVICE_END_NOTICE: ["name", "clientName", "phone", "receiptUrl"],
};
// Which system template's body each SMS trigger template renders. One source of
// truth for both the backend SMS delivery and the form preview.
exports.SMS_TRIGGER_TO_SYSTEM_TEMPLATE = {
    SERVICE_INFO: "SERVICE_INFO",
    SERVICE_RECORD_LINK: "SERVICE_RECORD_LINK",
    CLIENT_GREETING: "GREETING",
    PRICE_INFO: "PRICE_INFO",
    REMINDER: "REMINDER",
    THANKS: "THANKS",
    SURVEY: "SURVEY",
    INFO: "INFO",
    SERVICE_END_NOTICE: "SERVICE_END_NOTICE",
};
// Canonical source of truth for trigger templates delivered over SMS.
// Adding a new SMS template here flows it through the SMS form's
// data-driven dropdowns, the channel filters, and the backend delivery drift
// guard without hardcoded per-surface lists.
exports.SMS_TRIGGER_TEMPLATE_KEYS = [
    "SERVICE_INFO",
    "SERVICE_RECORD_LINK",
    "CLIENT_GREETING",
    "PRICE_INFO",
    "REMINDER",
    "THANKS",
    "SURVEY",
    "INFO",
    "SERVICE_END_NOTICE",
];
// SERVICE_RECORD_LINK is scheduled by the dedicated service-record lifecycle
// (it needs a signed URL and an assigned employee). Exposing it in the generic
// rule builder would create a rule that cannot supply those values safely.
exports.CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS = exports.SMS_TRIGGER_TEMPLATE_KEYS.filter((key) => key !== "SERVICE_RECORD_LINK");
function getTriggerTemplateChannel(key) {
    return exports.SMS_TRIGGER_TEMPLATE_KEYS.includes(key) ? "sms" : "unsupported";
}
exports.MESSAGE_SENDER_APPROVAL_STATUSES = [
    "not_requested",
    "pending",
    "approved",
];
