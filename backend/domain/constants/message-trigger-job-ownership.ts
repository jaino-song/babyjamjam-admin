import { AGENT_SMS_RULE_ID_PREFIX, AGENT_SMS_RETRY_DEDUPE_KEY_PREFIX } from "./message-trigger-catalog";
import { SERVICE_RECORD_LINK_MANUAL_DEDUPE_PATTERN, SERVICE_RECORD_LINK_RULE_ID } from "./service-record-link-message";
import { SERVICE_END_NOTICE_MANUAL_DEDUPE_PATTERN, SERVICE_END_NOTICE_RULE_ID } from "./service-end-notice-message";

type ManualJobMatcher =
    | { kind: "rule-prefix"; prefix: string }
    | { kind: "dedupe-prefix"; prefix: string }
    | { kind: "rule-dedupe"; ruleId: string; pattern: string }
    | { kind: "rule-id"; ruleId: string };

/** Shared by runtime ownership checks and the database claim/cancellation predicates. */
export const MANUAL_MESSAGE_JOB_MATCHERS: readonly ManualJobMatcher[] = [
    { kind: "rule-prefix", prefix: AGENT_SMS_RULE_ID_PREFIX },
    { kind: "dedupe-prefix", prefix: AGENT_SMS_RETRY_DEDUPE_KEY_PREFIX },
    { kind: "rule-dedupe", ruleId: SERVICE_RECORD_LINK_RULE_ID, pattern: SERVICE_RECORD_LINK_MANUAL_DEDUPE_PATTERN },
    // SERVICE_END_NOTICE branch rules generate ordinary scheduled/automatic jobs
    // (message-trigger-recipes.ts buildClientMessageRecipe); only the manual-send
    // service's job against the branchless system rule row is manual.
    { kind: "rule-dedupe", ruleId: SERVICE_END_NOTICE_RULE_ID, pattern: SERVICE_END_NOTICE_MANUAL_DEDUPE_PATTERN },
    // Rule-level only: the system row itself is always the manual rule, regardless
    // of any branch SERVICE_END_NOTICE rule's template key.
    { kind: "rule-id", ruleId: SERVICE_END_NOTICE_RULE_ID },
];

interface JobOwnership {
    templateKey: string;
    ruleId: string;
    dedupeKey: string;
}

export function isManualMessageTriggerJob(job: JobOwnership): boolean {
    return MANUAL_MESSAGE_JOB_MATCHERS.some((matcher) => {
        switch (matcher.kind) {
            case "rule-prefix": return job.ruleId.startsWith(matcher.prefix);
            case "dedupe-prefix": return job.dedupeKey.startsWith(matcher.prefix);
            case "rule-dedupe": return job.ruleId === matcher.ruleId && new RegExp(matcher.pattern).test(job.dedupeKey);
            case "rule-id": return false;
        }
    });
}

/** Mixed automatic/manual service-record and service-end-notice rules remain owned by automation. */
export function isManualMessageTriggerRule(rule: { id: string; templateKey: string }): boolean {
    return MANUAL_MESSAGE_JOB_MATCHERS.some((matcher) => {
        switch (matcher.kind) {
            case "rule-prefix": return rule.id.startsWith(matcher.prefix);
            case "dedupe-prefix": return false;
            case "rule-dedupe": return false;
            case "rule-id": return rule.id === matcher.ruleId;
        }
    });
}
