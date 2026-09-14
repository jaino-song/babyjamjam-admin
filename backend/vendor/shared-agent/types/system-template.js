"use strict";
// Shared system-template contracts used by both frontend and mobile.
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewSystemTemplateSchema = exports.validateSystemTemplateSchema = exports.updateSystemTemplateSchema = exports.customVariableSchema = exports.resolveSystemTemplateDelivery = exports.getSystemTemplateDeliveryMode = exports.SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY = exports.SYSTEM_TEMPLATE_DELIVERY_MODES = exports.systemTemplateKeySchema = exports.SYSTEM_TEMPLATE_KEYS = void 0;
exports.resolveSystemTemplateDeliveryMode = resolveSystemTemplateDeliveryMode;
const zod_1 = require("zod");
//
// The source of truth for these shapes is the backend contract surface:
// - backend/interface/dto/system-template.dto.ts
// - backend/domain/constants/system-template-registry.ts
// - backend/domain/entities/system-template.entity.ts
// - backend/domain/entities/system-template-version.entity.ts
// - backend/application/dto/system-template-with-registry.dto.ts
// - backend/interface/controllers/system-template.controller.ts
// - backend/application/services/system-template.service.ts
//
// Read endpoints return registry-enriched DTOs, while update/rollback/reset
// endpoints return the raw SystemTemplateEntity. Date-backed values serialize
// to ISO strings on the wire, so the client-facing response types below use
// string while Raw* variants retain Date for backend-reference parity.
exports.SYSTEM_TEMPLATE_KEYS = [
    'CLIENT_WELCOME',
    'SERVICE_START_REMINDER',
    'SERVICE_END_REMINDER',
    'EMPLOYEE_ASSIGNED',
    'PRICE_INFO',
    'GREETING',
    'THANKS',
    'SURVEY',
    'SERVICE_INFO',
    'SERVICE_RECORD_LINK',
    'SERVICE_END_NOTICE',
    'REMINDER',
    'INFO',
];
/** Runtime key validation for system-template BFF route parameters. */
exports.systemTemplateKeySchema = zod_1.z.enum(exports.SYSTEM_TEMPLATE_KEYS);
exports.SYSTEM_TEMPLATE_DELIVERY_MODES = [
    "sms",
    "service-feedback-link",
    "receipt-link",
];
/**
 * Keep the delivery path explicit for every backend registry key.  The
 * `satisfies` constraint makes adding a registry key without choosing a
 * delivery path a compile-time error instead of silently falling back to SMS.
 */
exports.SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY = {
    CLIENT_WELCOME: "sms",
    SERVICE_START_REMINDER: "sms",
    SERVICE_END_REMINDER: "sms",
    EMPLOYEE_ASSIGNED: "sms",
    PRICE_INFO: "sms",
    GREETING: "sms",
    THANKS: "sms",
    SURVEY: "sms",
    SERVICE_INFO: "sms",
    SERVICE_RECORD_LINK: "service-feedback-link",
    SERVICE_END_NOTICE: "receipt-link",
    REMINDER: "sms",
    INFO: "sms",
};
/**
 * Resolve the delivery preparation path for a system template.
 *
 * SERVICE_RECORD_LINK and SERVICE_END_NOTICE are not generic SMS bodies: they
 * require a service-record link or a receipt link respectively. Every other
 * current system template is delivered as an ordinary SMS body.
 */
function resolveSystemTemplateDeliveryMode(templateKey) {
    return exports.SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY[templateKey];
}
exports.getSystemTemplateDeliveryMode = resolveSystemTemplateDeliveryMode;
exports.resolveSystemTemplateDelivery = resolveSystemTemplateDeliveryMode;
/**
 * Backend DTO-compatible request schemas.
 *
 * The production backend uses `forbidNonWhitelisted`, so these schemas reject
 * unknown top-level and nested fields instead of silently forwarding a body
 * that the backend will reject later. `data` remains an open record because
 * preview variables are intentionally caller-defined.
 */
exports.customVariableSchema = zod_1.z.object({
    key: zod_1.z.string().min(1),
    label: zod_1.z.string().min(1),
    required: zod_1.z.boolean(),
}).strict();
exports.updateSystemTemplateSchema = zod_1.z.object({
    content: zod_1.z.string().min(1),
    customVariables: zod_1.z.array(exports.customVariableSchema).optional(),
}).strict();
exports.validateSystemTemplateSchema = zod_1.z.object({
    content: zod_1.z.string().min(1),
}).strict();
exports.previewSystemTemplateSchema = zod_1.z.object({
    content: zod_1.z.string().optional(),
    data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
}).strict();
