import {
    defaultMessageAutomationPolicy,
    MESSAGE_POLICY_RECIPIENT_GROUPS,
    MessageAutomationPolicyConfiguration,
    MessagePolicyRecipientGroup,
} from "./entities/system-setting.entity";

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MINUTE = 60_000;
const KST_OFFSET = 9 * 60 * MINUTE;

/** Validates and returns fixed-key-order JSON data. No coercion or partial updates. */
export function validateMessageAutomationPolicy(value: unknown): MessageAutomationPolicyConfiguration {
    const fail = (): never => { throw new Error("Invalid message automation policy configuration"); };
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const candidate = value as Record<string, unknown>;
    const defaults = defaultMessageAutomationPolicy();
    if (Object.keys(candidate).length !== Object.keys(defaults).length
        || Object.keys(candidate).some(key => !Object.prototype.hasOwnProperty.call(defaults, key)) || candidate["schemaVersion"] !== 1) return fail();
    for (const [key, min, max] of [
        ["dispatchCheckIntervalMinutes", 1, 1440], ["triggerRetryIntervalMinutes", 1, 1440],
        ["processingReclaimMinutes", 10, 1440], ["smsRetryIntervalMinutes", 1, 1440],
        ["pastExpiryHours", 1, 720], ["pastSendIntervalMinutes", 1, 1440],
        ["duplicateWindowHours", 1, 720],
    ] as const) {
        const number = candidate[key];
        if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) return fail();
    }
    if (typeof candidate["defaultRuleSendTime"] !== "string" || !TIME.test(candidate["defaultRuleSendTime"])) return fail();
    if (!Array.isArray(candidate["pastRuleOrder"]) || candidate["pastRuleOrder"].some(id => typeof id !== "string" || !id.trim())
        || new Set(candidate["pastRuleOrder"]).size !== candidate["pastRuleOrder"].length) return fail();
    const quiet = candidate["quietHours"] as Record<string, unknown> | null;
    if (!quiet || typeof quiet !== "object" || Array.isArray(quiet) || Object.keys(quiet).length !== 6
        || Object.keys(quiet).some(key => !Object.prototype.hasOwnProperty.call(defaults.quietHours, key))
        || typeof quiet["enabled"] !== "boolean" || quiet["timezone"] !== "Asia/Seoul"
        || typeof quiet["start"] !== "string" || !TIME.test(quiet["start"])
        || typeof quiet["end"] !== "string" || !TIME.test(quiet["end"]) || quiet["start"] === quiet["end"]
        || !["DEFER", "CANCEL"].includes(quiet["action"] as string)
        || !Array.isArray(quiet["recipientGroups"])
        || quiet["recipientGroups"].some(group => !MESSAGE_POLICY_RECIPIENT_GROUPS.includes(group))
        || new Set(quiet["recipientGroups"]).size !== quiet["recipientGroups"].length
        || (quiet["enabled"] && quiet["recipientGroups"].length === 0)) return fail();
    const typed = candidate as unknown as MessageAutomationPolicyConfiguration;
    return {
        schemaVersion: 1,
        dispatchCheckIntervalMinutes: typed.dispatchCheckIntervalMinutes,
        defaultRuleSendTime: typed.defaultRuleSendTime,
        triggerRetryIntervalMinutes: typed.triggerRetryIntervalMinutes,
        processingReclaimMinutes: typed.processingReclaimMinutes,
        smsRetryIntervalMinutes: typed.smsRetryIntervalMinutes,
        pastExpiryHours: typed.pastExpiryHours,
        pastSendIntervalMinutes: typed.pastSendIntervalMinutes,
        pastRuleOrder: [...typed.pastRuleOrder],
        duplicateWindowHours: typed.duplicateWindowHours,
        quietHours: {
            enabled: typed.quietHours.enabled, start: typed.quietHours.start, end: typed.quietHours.end,
            recipientGroups: MESSAGE_POLICY_RECIPIENT_GROUPS.filter(group => typed.quietHours.recipientGroups.includes(group)),
            action: typed.quietHours.action, timezone: "Asia/Seoul",
        },
    };
}

export interface MessagePolicyPreviewCandidate {
    dueAt: Date;
    recipientGroups: MessagePolicyRecipientGroup[];
    recipientPhone: string | null;
}
export type MessageQuietHoursDecision =
    | { action: "ALLOW"; reevaluateAt: null }
    | { action: "CANCEL"; reevaluateAt: null }
    | { action: "DEFER"; reevaluateAt: Date };

/** Start inclusive/end exclusive, including overnight windows; KST has no DST. */
export function evaluateMessageQuietHours(
    quiet: MessageAutomationPolicyConfiguration["quietHours"],
    groups: readonly MessagePolicyRecipientGroup[],
    at: Date,
): MessageQuietHoursDecision {
    if (!quiet["enabled"] || !groups.some(group => quiet["recipientGroups"].includes(group))) return { action: "ALLOW", reevaluateAt: null };
    const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const start = minuteOf(quiet["start"]);
    const end = minuteOf(quiet["end"]);
    const local = new Date(at.getTime() + KST_OFFSET);
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
    if (!inside) return { action: "ALLOW", reevaluateAt: null };
    if (quiet["action"] === "CANCEL") return { action: "CANCEL", reevaluateAt: null };
    const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const endDay = start > end && minute >= start ? 24 * 60 * MINUTE : 0;
    return { action: "DEFER", reevaluateAt: new Date(dayStart + endDay + end * MINUTE - KST_OFFSET) };
}
