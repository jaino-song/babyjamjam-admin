import {
    assertOutboundRecipients,
    isRecipientAllowlistEnforced,
    OutboundRecipientBlockedError,
} from "./outbound-recipient-policy";

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

export function isEformsignRecipientAllowlistEnforced(): boolean {
    return isRecipientAllowlistEnforced("SMS") || isRecipientAllowlistEnforced("email");
}

function unverifiedRecipients(): OutboundRecipientBlockedError {
    return new OutboundRecipientBlockedError("eformsign recipients could not be verified");
}

export function assertEformsignPhone(phone: unknown, countryCode?: unknown): void {
    if (!isRecipientAllowlistEnforced("SMS")) return;
    if (countryCode === undefined || countryCode === "") {
        assertOutboundRecipients("SMS", [phone]);
        return;
    }
    // A separate country code changes the destination of the national number.
    if (typeof countryCode !== "string" || !/^\+?[1-9]\d{0,2}$/.test(countryCode)
        || typeof phone !== "string") {
        throw unverifiedRecipients();
    }
    const code = countryCode.replace(/^\+/, "");
    const number = phone.trim().replace(/[ -]/g, "");
    if (code === "82" && /^(?:0|\+82)\d+$/.test(number)) {
        assertOutboundRecipients("SMS", [number]);
        return;
    }
    if (!/^\d+$/.test(number)) throw unverifiedRecipients();
    assertOutboundRecipients("SMS", [`+${code}${number}`]);
}

export function assertEformsignRecipients(recipients: unknown, stored = false): void {
    if (!isEformsignRecipientAllowlistEnforced()) return;
    if (!Array.isArray(recipients)) throw unverifiedRecipients();
    for (const input of recipients) {
        const recipient = asRecord(input);
        if (!recipient) throw unverifiedRecipients();
        const member = asRecord(recipient["member"]) ?? recipient;
        const sms = member["sms"];
        const smsDetails = asRecord(sms);
        const phone = smsDetails?.["phone_number"] ?? sms;
        const email = member["id"];
        const useSms = recipient["use_sms"];
        const useMail = recipient["use_mail"];
        if ((useSms !== undefined && typeof useSms !== "boolean")
            || (useMail !== undefined && typeof useMail !== "boolean")) {
            throw unverifiedRecipients();
        }

        if (useSms === true || (useSms !== false && phone)) {
            assertEformsignPhone(phone, smsDetails?.["country_code"]);
        }
        if (useMail === true || (useMail !== false && email)) {
            assertOutboundRecipients("email", [email]);
        }
        if (stored && !phone && !email
            && ((useSms !== false && isRecipientAllowlistEnforced("SMS"))
                || (useMail !== false && isRecipientAllowlistEnforced("email")))) {
            throw unverifiedRecipients();
        }
    }
}

export function assertEformsignCreationOptions(options: Record<string, unknown>): void {
    if (!isEformsignRecipientAllowlistEnforced()) return;
    const mode = asRecord(options["mode"]);
    const prefill = asRecord(options["prefill"]);
    if (mode?.["type"] !== "01" || mode["document_id"] !== undefined || !prefill) throw unverifiedRecipients();
    assertEformsignRecipients(prefill["recipients"]);
}

export function assertStoredEformsignRecipients(document: unknown): void {
    if (!isEformsignRecipientAllowlistEnforced()) return;
    const detail = asRecord(document);
    const current = asRecord(detail?.["current_status"]);
    const currentRecipients = current?.["step_recipients"];
    const previousStatus = detail?.["previous_status"];
    if (!Array.isArray(currentRecipients) || currentRecipients.length === 0 || !Array.isArray(previousStatus)) {
        throw unverifiedRecipients();
    }
    assertEformsignRecipients(currentRecipients, true);
    if (detail?.["recipients"] !== undefined) assertEformsignRecipients(detail["recipients"], true);

    // A subsequent step or completion can notify earlier participants as well.
    for (const statuses of [previousStatus, detail?.["next_status"]]) {
        if (statuses === undefined) continue;
        if (!Array.isArray(statuses)) throw unverifiedRecipients();
        for (const status of statuses) {
            const step = asRecord(status);
            if (!step) throw unverifiedRecipients();
            if (step["step_recipients"] !== undefined) assertEformsignRecipients(step["step_recipients"], true);
        }
    }
}
