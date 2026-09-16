import { randomUUID } from "node:crypto";

import { normalizeClientPhone } from "@babyjamjam/shared";

export interface ProtectedPhoneCandidate {
    candidateRef: string;
    normalizedPhone: string;
}

export interface ProtectedPhoneCapture {
    candidates: ProtectedPhoneCandidate[];
    selectionNeeded: boolean;
    normalizedPhone?: string;
    selectedCandidateRef?: string;
}

// This helper intentionally recognizes only the supported domestic mobile
// shape. It does not attempt language understanding or choose a candidate.
const DOMESTIC_MOBILE_PATTERN = /(?<!\d)01[0-9][\s().-]?\d{3,4}[\s().-]?\d{4}(?!\d)/g;
const PHONE_LIKE_PATTERN = /(?<!\d)01[0-9](?:[\s().-]*\d){1,20}(?!\d)/g;

/** Capture phone candidates before a later model step can mask or rewrite them. */
export function captureProtectedPhoneCandidates(value: unknown): ProtectedPhoneCapture {
    if (typeof value !== "string") return { candidates: [], selectionNeeded: false };

    const candidates: ProtectedPhoneCandidate[] = [];
    const seen = new Set<string>();
    let ambiguous = false;
    for (const raw of value.match(DOMESTIC_MOBILE_PATTERN) ?? []) {
        const normalizedPhone = normalizeClientPhone(raw);
        if (!normalizedPhone || !/^\d{11}$/.test(normalizedPhone)) {
            ambiguous = true;
            continue;
        }
        if (seen.has(normalizedPhone)) continue;
        seen.add(normalizedPhone);
        candidates.push({ candidateRef: randomUUID(), normalizedPhone });
    }

    // A valid candidate is not safe to auto-select when the same input also
    // contains an incomplete, malformed, or overlong phone-like token. Keep
    // the finite parser bounded to the supported domestic prefix and digits;
    // do not infer intent from arbitrary prose or return the raw token.
    for (const raw of value.match(PHONE_LIKE_PATTERN) ?? []) {
        const normalizedPhone = normalizeClientPhone(raw);
        if (!normalizedPhone || !/^\d{11}$/.test(normalizedPhone)) ambiguous = true;
    }

    if (candidates.length !== 1) {
        return { candidates, selectionNeeded: candidates.length > 1 || ambiguous };
    }
    if (ambiguous) return { candidates, selectionNeeded: true };
    return {
        candidates,
        selectionNeeded: false,
        normalizedPhone: candidates[0]!.normalizedPhone,
        selectedCandidateRef: candidates[0]!.candidateRef,
    };
}

/** Short alias for call sites that process one protected input value. */
export const captureProtectedPhoneInput = captureProtectedPhoneCandidates;
