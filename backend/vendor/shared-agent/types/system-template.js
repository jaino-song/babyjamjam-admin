"use strict";
// Shared system-template contracts used by both frontend and mobile.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSystemTemplateDelivery = exports.getSystemTemplateDeliveryMode = exports.SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY = exports.SYSTEM_TEMPLATE_DELIVERY_MODES = exports.SYSTEM_TEMPLATE_KEYS = void 0;
exports.resolveSystemTemplateDeliveryMode = resolveSystemTemplateDeliveryMode;
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
