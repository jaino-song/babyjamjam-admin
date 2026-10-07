import type {
    AdminServiceRecordEditHeaderChanges,
    AdminServiceRecordEditSessionChanges,
} from "../types";

/**
 * Mirror of what the backend stores for an admin draft, so a staged edit already
 * holds the value the server will return and "is this draft exactly my batch?"
 * can stay a strict comparison.
 *
 * - header strings are trimmed (`validateHeader`);
 * - `etcService` and `notes` are trimmed (`validateServiceRecordEditText`);
 * - `answers` are stored exactly as sent (the answer policy only validates:
 *   numeric answers keep their string or number form, nothing is coerced).
 */
export function normalizeHeaderChanges(changes: AdminServiceRecordEditHeaderChanges): AdminServiceRecordEditHeaderChanges {
    const normalized: AdminServiceRecordEditHeaderChanges = {};
    for (const key of Object.keys(changes) as Array<keyof AdminServiceRecordEditHeaderChanges>) {
        const value = changes[key];
        if (typeof value === "string") normalized[key] = value.trim();
    }
    return normalized;
}

export function normalizeSessionChanges(changes: AdminServiceRecordEditSessionChanges): AdminServiceRecordEditSessionChanges {
    const normalized = { ...changes };
    if (typeof normalized.etcService === "string") normalized.etcService = normalized.etcService.trim();
    if (typeof normalized.notes === "string") normalized.notes = normalized.notes.trim();
    return normalized;
}
