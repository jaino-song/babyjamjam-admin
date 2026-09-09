"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RECORD_REVISION_DOCUMENT_STATUSES = exports.SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS = void 0;
/** The three independently progressing document operations for a revision. */
exports.SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS = [
    "record_snapshot",
    "contract_period",
    "receipt_refresh",
];
/** Public state vocabulary shared by history, retry, and worker consumers. */
exports.SERVICE_RECORD_REVISION_DOCUMENT_STATUSES = [
    "not_required",
    "waiting_for_completion",
    "waiting_for_signature",
    "capability_unverified",
    "manual_review",
    "pending",
    "processing",
    "unknown",
    "failed",
    "completed",
];
