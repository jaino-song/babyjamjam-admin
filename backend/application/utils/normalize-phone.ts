/**
 * Normalize a Korean phone number to bare digits ("01012345678").
 * Returns null when the input cannot plausibly be a KR phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("82")) {
        digits = `0${digits.slice(2)}`;
    }
    // KR numbers: 02-XXXXXXXX (9-10) or 0XX-XXXX-XXXX (10-11)
    if (digits.length < 9 || digits.length > 11 || !digits.startsWith("0")) {
        return null;
    }
    return digits;
}

/** Pull every plausible phone number out of free text (e.g. a recording file name). */
export function extractPhoneCandidates(text: string | null | undefined): string[] {
    if (!text) return [];
    const matches = text.match(/(\+?82[-\s.]?|0)1[0-9][-\s.]?\d{3,4}[-\s.]?\d{4}|0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g) ?? [];
    const seen = new Set<string>();
    for (const m of matches) {
        const normalized = normalizePhone(m);
        if (normalized) seen.add(normalized);
    }
    return [...seen];
}
