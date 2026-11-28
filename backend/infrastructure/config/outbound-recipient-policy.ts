const ALLOWLIST_KEYS = {
    SMS: "SMS_RECIPIENT_ALLOWLIST",
    email: "EMAIL_RECIPIENT_ALLOWLIST",
} as const;

type RecipientChannel = keyof typeof ALLOWLIST_KEYS;

export class OutboundRecipientBlockedError extends Error {
    constructor(detail: string) {
        super(`Blocked by staging recipient allowlist: ${detail}`);
        this.name = "OutboundRecipientBlockedError";
    }
}

export function isRecipientAllowlistEnforced(channel: RecipientChannel): boolean {
    return process.env["OUTBOUND_ALLOWLIST_REQUIRED"] === "true"
        || process.env[ALLOWLIST_KEYS[channel]] !== undefined;
}

function normalizeSms(value: string): string {
    const compact = value.trim().replace(/[ -]/g, "");
    if (!/^\+?\d+$/.test(compact)) return "";
    return compact.replace(/^\+82/, "0").replace(/^\+/, "");
}

function normalizeEmail(value: string): string {
    const address = value.trim().toLowerCase();
    // Only bare addresses can be compared safely across SMTP and HTTP providers.
    return /^[a-z0-9.!#$%&'*+/=?^`{|}~_-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(address)
        ? address
        : "";
}

export function maskSmsRecipient(value: string): string {
    const digits = normalizeSms(value);
    return digits.length > 4 ? `***${digits.slice(-4)}` : "***";
}

export function maskEmailRecipient(value: string): string {
    const domain = normalizeEmail(value).split("@")[1];
    return domain ? `***@${domain}` : "***";
}

export function maskOutboundContacts(value: string): string {
    return value
        .replace(/\+?\d(?:[ .-]*\d){6,}/g, maskSmsRecipient)
        .replace(/[a-z0-9.!#$%&'*+/=?^`{|}~_-]+@[a-z0-9.-]+/gi, maskEmailRecipient);
}

export function assertOutboundRecipients(channel: RecipientChannel, recipients: readonly unknown[]): void {
    if (!isRecipientAllowlistEnforced(channel)) return;

    const normalize = channel === "SMS" ? normalizeSms : normalizeEmail;
    const mask = channel === "SMS" ? maskSmsRecipient : maskEmailRecipient;
    const list = process.env[ALLOWLIST_KEYS[channel]] ?? "";
    const allowed = new Set(list.split(",").map(normalize).filter(Boolean));

    for (const recipient of recipients) {
        const key = typeof recipient === "string" ? normalize(recipient) : "";
        if (!key || !allowed.has(key)) {
            throw new OutboundRecipientBlockedError(`${channel} recipient ${typeof recipient === "string" ? mask(recipient) : "***"}`);
        }
    }
}
