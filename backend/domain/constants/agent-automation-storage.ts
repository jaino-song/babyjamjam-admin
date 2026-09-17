import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "./message-automation-intent";

export const AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX = "agent-automation-record:v1:";
export const AGENT_AUTOMATION_RECORD_PAYLOAD_KEY = "agentAutomationRecord";
export const AGENT_AUTOMATION_RECORD_CANCEL_REASON = "agent_automation_authority_record";
export const AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY = "agentAutomationSeal";

/** Physical internal records and copied/malformed carriers are never delivery jobs. */
export function isReservedAutomationJob(value: { ruleId?: string; dedupeKey?: string; payload?: unknown }): boolean {
    const payload = value.payload;
    return value.ruleId === MESSAGE_AUTOMATION_INTENT_RULE_ID
        || value.dedupeKey?.startsWith(AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX) === true
        || (!!payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY));
}
