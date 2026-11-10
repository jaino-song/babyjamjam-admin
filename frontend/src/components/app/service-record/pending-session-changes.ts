import { formatReviewFieldValue, REVIEW_EMPTY_LABEL, REVIEW_SECTIONS } from "@babyjamjam/service-record-ui";
import { SERVICE_RECORD_HEADER_KEYS } from "@babyjamjam/shared/utils/service-record-input";
import type { AdminServiceRecordEditHeaderChanges, AdminServiceRecordEditSessionChanges } from "@/features/service-records/types";

import { revisionChangeLabel } from "./revision-change-display";

export interface PendingChangeRow {
    key: string;
    label: string;
    before: string;
    after: string;
}

export interface PendingSessionChange {
    sessionIndex: number;
    rows: PendingChangeRow[];
}

/** Compare the same formatted values the review form displays, preserving omitted answers. */
export function computePendingSessionChanges(
    baseSessions: ReadonlyArray<{ sessionIndex: number; draft: Record<string, unknown> }>,
    patches: ReadonlyArray<AdminServiceRecordEditSessionChanges>,
): PendingSessionChange[] {
    return patches.flatMap((patch) => {
        const before = baseSessions.find((session) => session.sessionIndex === patch.sessionIndex)?.draft ?? {};
        const after = { ...before, ...patch.answers,
            ...(patch.etcService !== undefined ? { etcService: patch.etcService } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            ...(patch.paymentConfirmed !== undefined ? { paymentConfirmed: patch.paymentConfirmed } : {}),
        };
        const rows = REVIEW_SECTIONS.flatMap((section) => section.fields.flatMap((field) => {
            const oldValue = formatReviewFieldValue(field, before).value;
            const newValue = formatReviewFieldValue(field, after).value;
            return oldValue === newValue ? [] : [{ key: field.key, label: revisionChangeLabel(`session.answers.${field.key}`),
                before: oldValue || REVIEW_EMPTY_LABEL, after: newValue || REVIEW_EMPTY_LABEL }];
        }));
        return rows.length ? [{ sessionIndex: patch.sessionIndex, rows }] : [];
    }).sort((left, right) => left.sessionIndex - right.sessionIndex);
}

export function computePendingHeaderChanges(
    base: Record<string, string>,
    patch: AdminServiceRecordEditHeaderChanges,
): PendingChangeRow[] {
    return SERVICE_RECORD_HEADER_KEYS.flatMap((key) => {
        if (patch[key] === undefined || patch[key] === (base[key] ?? "")) return [];
        return [{ key, label: revisionChangeLabel(`header.${key}`),
            before: base[key] || REVIEW_EMPTY_LABEL, after: patch[key] || REVIEW_EMPTY_LABEL }];
    });
}
