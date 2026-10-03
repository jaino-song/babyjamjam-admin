/**
 * Helpers for re-sending a client's contract after its service period changed.
 */

/** The maternity contract template's payment-date fields, as dispatch writes them (YY / MM / DD). */
const PAYMENT_DATE_FIELD_IDS = {
    year: "본인부담금 수령 년도",
    month: "본인부담금 수령 월",
    day: "본인부담금 수령 일",
} as const;

/** Unsigned statuses: eformsign can still cancel these, which expires the signing link. */
const CANCELLABLE_CONTRACT_STATUSES: ReadonlySet<string> = new Set(["created", "requested", "opened"]);

export function isCancellableContractStatus(status: string | null | undefined): boolean {
    return status != null && CANCELLABLE_CONTRACT_STATUSES.has(status);
}

function fieldValue(fields: readonly unknown[], id: string): string | null {
    for (const field of fields) {
        if (!field || typeof field !== "object") continue;
        const record = field as Record<string, unknown>;
        if (record.id !== id) continue;
        const value = record.value;
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number") return String(value);
    }
    return null;
}

/** Reads the payment date (본인부담금 수령일) of a sent contract as YYYY-MM-DD, or null when absent or invalid. */
export function contractPaymentDateFromFields(fields: readonly unknown[] | null | undefined): string | null {
    if (!fields) return null;
    const year = fieldValue(fields, PAYMENT_DATE_FIELD_IDS.year);
    const month = fieldValue(fields, PAYMENT_DATE_FIELD_IDS.month);
    const day = fieldValue(fields, PAYMENT_DATE_FIELD_IDS.day);
    if (!year || !month || !day || !/^\d{2}(\d{2})?$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
        return null;
    }
    const fullYear = year.length === 2 ? `20${year}` : year;
    const iso = `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
