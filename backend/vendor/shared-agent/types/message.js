"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RECORD_LINK_RULE_ID = exports.STORED_MESSAGE_SETTINGS_POLICY_IDS = exports.MESSAGE_SETTINGS_POLICY_IDS = exports.MESSAGE_SENDER_APPROVAL_STATUSES = exports.updateMessageTriggerRuleDtoSchema = exports.createMessageTriggerRuleDtoSchema = exports.UpdateMessageTriggerRuleSchema = exports.CreateMessageTriggerRuleSchema = exports.updateMessageTriggerRuleSchema = exports.createMessageTriggerRuleSchema = exports.CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS = exports.SMS_TRIGGER_TEMPLATE_KEYS = exports.SMS_TRIGGER_TO_SYSTEM_TEMPLATE = exports.MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS = exports.messageTriggerTemplateKeySchema = exports.messageTriggerRecipientTypeSchema = exports.messageTriggerOffsetTypeSchema = exports.messageTriggerEventTypeSchema = exports.MESSAGE_TRIGGER_TEMPLATE_KEYS = exports.MESSAGE_TRIGGER_RECIPIENT_TYPES = exports.MESSAGE_TRIGGER_OFFSET_TYPES = exports.MESSAGE_TRIGGER_EVENT_TYPES = void 0;
exports.getTriggerTemplateChannel = getTriggerTemplateChannel;
const zod_1 = require("zod");
// Shared message contracts used by both frontend and mobile.
//
// The source of truth for these shapes is the backend contract surface:
// - backend/interface/dto/message.dto.ts
// - backend/interface/dto/message-template.dto.ts
// - backend/interface/dto/message-delivery.dto.ts
// - backend/interface/dto/message-sender-approval.dto.ts
// - backend/interface/dto/message-trigger.dto.ts
// - backend/interface/dto/system-admin.dto.ts
// - backend/domain/entities/message.entity.ts
// - backend/domain/entities/message-template.entity.ts
// - backend/domain/entities/message-log.entity.ts
// - backend/domain/entities/message-trigger-rule.entity.ts
// - backend/domain/constants/message-trigger-catalog.ts
// - backend/interface/controllers/message-delivery.controller.ts
// - backend/interface/controllers/system-setting.controller.ts
// - backend/application/services/message-trigger.service.ts
// - backend/application/services/system-admin.service.ts
//
// Message, message-template, message-trigger, and message-log controllers
// currently return Date-backed entities/views directly. Those dates serialize to
// ISO strings on the wire, so the client-facing response types below use string
// while Raw* variants retain Date for backend-reference parity.
/** Canonical values shared by the trigger API, forms, and scheduler. */
exports.MESSAGE_TRIGGER_EVENT_TYPES = [
    "CLIENT_CREATED",
    "SERVICE_START",
    "SERVICE_END",
    "EMPLOYEE_ASSIGNED",
];
exports.MESSAGE_TRIGGER_OFFSET_TYPES = [
    "IMMEDIATE",
    "SAME_DAY",
    "BEFORE_DAYS",
    "AFTER_DAYS",
];
exports.MESSAGE_TRIGGER_RECIPIENT_TYPES = [
    "CLIENT",
    "PRIMARY_EMPLOYEE",
    "SECONDARY_EMPLOYEE",
];
exports.MESSAGE_TRIGGER_TEMPLATE_KEYS = [
    "CLIENT_WELCOME",
    "SERVICE_START_REMINDER",
    "SERVICE_INFO",
    "SERVICE_END_REMINDER",
    "EMPLOYEE_ASSIGNED",
    "SERVICE_RECORD_LINK",
    "CLIENT_GREETING",
    "PRICE_INFO",
    "REMINDER",
    "THANKS",
    "SURVEY",
    "INFO",
    "SERVICE_END_NOTICE",
];
exports.messageTriggerEventTypeSchema = zod_1.z.enum(exports.MESSAGE_TRIGGER_EVENT_TYPES);
exports.messageTriggerOffsetTypeSchema = zod_1.z.enum(exports.MESSAGE_TRIGGER_OFFSET_TYPES);
exports.messageTriggerRecipientTypeSchema = zod_1.z.enum(exports.MESSAGE_TRIGGER_RECIPIENT_TYPES);
exports.messageTriggerTemplateKeySchema = zod_1.z.enum(exports.MESSAGE_TRIGGER_TEMPLATE_KEYS);
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
/**
 * Runtime validation for `POST /message-trigger-rules`.
 *
 * Backend-owned fields are intentionally preserved instead of stripped. This
 * lets a client validate the shared fields while forwarding fields added by a
 * newer backend without silently losing them.
 */
exports.createMessageTriggerRuleSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(1),
    isActive: zod_1.z.boolean().optional(),
    eventType: exports.messageTriggerEventTypeSchema,
    offsetType: exports.messageTriggerOffsetTypeSchema,
    offsetDays: zod_1.z.number().int().min(0).optional(),
    sendTime: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    recipientType: exports.messageTriggerRecipientTypeSchema,
    templateKey: exports.messageTriggerTemplateKeySchema,
})
    .passthrough();
/** Runtime validation for `PATCH/PUT /message-trigger-rules/:id`. */
exports.updateMessageTriggerRuleSchema = exports.createMessageTriggerRuleSchema
    .partial()
    .passthrough();
// Pascal-case aliases make the schema names discoverable beside the DTO types
// while the lower camel-case names match the existing shared auth schemas.
exports.CreateMessageTriggerRuleSchema = exports.createMessageTriggerRuleSchema;
exports.UpdateMessageTriggerRuleSchema = exports.updateMessageTriggerRuleSchema;
exports.createMessageTriggerRuleDtoSchema = exports.createMessageTriggerRuleSchema;
exports.updateMessageTriggerRuleDtoSchema = exports.updateMessageTriggerRuleSchema;
exports.MESSAGE_SENDER_APPROVAL_STATUSES = [
    "not_requested",
    "pending",
    "approved",
];
exports.MESSAGE_SETTINGS_POLICY_IDS = [
    "trigger-dispatch",
    "trigger-job-retry",
    "sms-retry",
    "past-trigger",
    "service-feedback-link",
    "duplicate-send-confirmation",
];
exports.STORED_MESSAGE_SETTINGS_POLICY_IDS = [
    "trigger-dispatch",
    "trigger-job-retry",
    "sms-retry",
    "past-trigger",
    "duplicate-send-confirmation",
];
exports.SERVICE_RECORD_LINK_RULE_ID = "system:service_record_link";
