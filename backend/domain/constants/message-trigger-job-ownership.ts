import { AGENT_SMS_RULE_ID_PREFIX, AGENT_SMS_RETRY_DEDUPE_KEY_PREFIX, MessageTriggerTemplateKey } from "./message-trigger-catalog";
import { SERVICE_RECORD_LINK_MANUAL_DEDUPE_PATTERN, SERVICE_RECORD_LINK_RULE_ID } from "./service-record-link-message";

type ManualJobMatcher =
    | { kind: "template"; templateKey: string }
    | { kind: "rule-prefix"; prefix: string }
    | { kind: "dedupe-prefix"; prefix: string }
    | { kind: "rule-dedupe"; ruleId: string; pattern: string };

/** Shared by runtime ownership checks and the database claim/cancellation predicates. */
export const MANUAL_MESSAGE_JOB_MATCHERS: readonly ManualJobMatcher[] = [
    { kind: "template", templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE },
    { kind: "rule-prefix", prefix: AGENT_SMS_RULE_ID_PREFIX },
    { kind: "dedupe-prefix", prefix: AGENT_SMS_RETRY_DEDUPE_KEY_PREFIX },
    { kind: "rule-dedupe", ruleId: SERVICE_RECORD_LINK_RULE_ID, pattern: SERVICE_RECORD_LINK_MANUAL_DEDUPE_PATTERN },
];

interface JobOwnership {
    templateKey: string;
    ruleId: string;
    dedupeKey: string;
}

export function isManualMessageTriggerJob(job: JobOwnership): boolean {
    return MANUAL_MESSAGE_JOB_MATCHERS.some((matcher) => {
        switch (matcher.kind) {
            case "template": return job.templateKey === matcher.templateKey;
            case "rule-prefix": return job.ruleId.startsWith(matcher.prefix);
            case "dedupe-prefix": return job.dedupeKey.startsWith(matcher.prefix);
            case "rule-dedupe": return job.ruleId === matcher.ruleId && new RegExp(matcher.pattern).test(job.dedupeKey);
        }
    });
}

/** Mixed automatic/manual service-record rules remain owned by automation. */
export function isManualMessageTriggerRule(rule: { id: string; templateKey: string }): boolean {
    return MANUAL_MESSAGE_JOB_MATCHERS.some((matcher) => {
        switch (matcher.kind) {
            case "template": return rule.templateKey === matcher.templateKey;
            case "rule-prefix": return rule.id.startsWith(matcher.prefix);
            case "dedupe-prefix": return false;
            case "rule-dedupe": return false;
        }
    });
}
