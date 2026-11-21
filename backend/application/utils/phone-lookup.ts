import { normalizePhone } from "./normalize-phone";

export function phoneLookupForms(phone: string): string[] {
    const digits = normalizePhone(phone);
    if (!digits) return [phone];

    const formatted = digits.length === 11
        ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
        : digits.length === 10
            ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
            : digits;
    return [...new Set([digits, formatted])];
}
