import { normalizePhone } from "./normalize-phone";

export function phoneLookupForms(phone: string): string[] {
    const digits = normalizePhone(phone);
    if (!digits) return [phone];

    if (digits.length !== 10 && digits.length !== 11) return [digits];

    const prefix = digits.slice(0, 3);
    const middle = digits.slice(3, -4);
    const suffix = digits.slice(-4);
    const forms = [digits, `${prefix}-${middle}-${suffix}`];
    if (/^01[016789]$/.test(prefix)) {
        forms.push(`${prefix}-${middle}${suffix}`, `${prefix}${middle}-${suffix}`);
    }
    return [...new Set(forms)];
}
