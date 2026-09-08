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
exports.SYSTEM_TEMPLATE_KEYS = void 0;
exports.SYSTEM_TEMPLATE_KEYS = [
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
