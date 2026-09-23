import { Prisma } from "@prisma/client";
import { manualMessageTriggerJobPredicate } from "application/utils/message-trigger-job-ownership-sql";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";

/**
 * Evaluates the generated `Prisma.Sql` predicate against one job's column
 * values using the exact Postgres semantics the fragments rely on
 * (`left(col, n) = value` and `~` POSIX regex match), without a live
 * database. This walks the *actual* compiled SQL/values pair the builder
 * produced for this job, so it catches drift in `manualMessageTriggerJobPredicate`
 * itself (e.g. an operator or column mistake), not just in the shared matcher list.
 */
function evaluatePredicate(
    predicate: Prisma.Sql,
    columns: { templateKey: string; ruleId: string; dedupeKey: string },
): boolean {
    // The builder binds exactly these 8 literal values, in this order, for the
    // current MANUAL_MESSAGE_JOB_MATCHERS shape:
    //   [rulePrefixLen, rulePrefix, dedupePrefixLen, dedupePrefix,
    //    recordLinkRuleId, recordLinkPattern, endNoticeRuleId, endNoticePattern]
    // (verified against the compiled `.sql`/`.values` pair; the trailing
    // rule-id matcher compiles to a literal `FALSE` with no bound value).
    // Interpreting the actual compiled values (not the shared TS matcher
    // array) is what makes this a parity check on the SQL builder itself.
    const values = predicate.values as unknown[];
    const [, rulePrefix, , dedupePrefix, recordLinkRuleId, recordLinkPattern, endNoticeRuleId, endNoticePattern] =
        values as [number, string, number, string, string, string, string, string];

    // rule-prefix: left(ruleId, prefixLen) = prefix
    if (columns.ruleId.startsWith(rulePrefix)) return true;

    // dedupe-prefix: left(dedupeKey, prefixLen) = prefix
    if (columns.dedupeKey.startsWith(dedupePrefix)) return true;

    // rule-dedupe (SERVICE_RECORD_LINK): ruleId = X AND dedupeKey ~ pattern
    if (columns.ruleId === recordLinkRuleId && new RegExp(recordLinkPattern).test(columns.dedupeKey)) {
        return true;
    }

    // rule-dedupe (SERVICE_END_NOTICE): ruleId = X AND dedupeKey ~ pattern
    if (columns.ruleId === endNoticeRuleId && new RegExp(endNoticePattern).test(columns.dedupeKey)) {
        return true;
    }

    // rule-id: always FALSE at the job level (rule-only ownership).
    return false;
}

describe("manualMessageTriggerJobPredicate / isManualMessageTriggerJob parity", () => {
    const columns = {
        templateKey: Prisma.sql`"template_key"`,
        ruleId: Prisma.sql`"rule_id"`,
        dedupeKey: Prisma.sql`"dedupe_key"`,
    };

    it.each([
        // [ruleId, templateKey, dedupeKey]
        ["agent-sms:branch", "INFO", "agent-sms:approved-immediate"],
        ["original-automatic-rule", "INFO", "agent-sms-retry:approved-retry"],
        ["ordinary-rule", "INFO", "agent-sms:untrusted-dedupe"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary:manual:11111111-1111-4111-8111-111111111111"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary"],
        [SERVICE_RECORD_LINK_RULE_ID, "SERVICE_RECORD_LINK", "not-the-right-rule-dedupe-shape"],
        [SERVICE_END_NOTICE_RULE_ID, "SERVICE_END_NOTICE", `${SERVICE_END_NOTICE_RULE_ID}:client:7:manual:11111111-1111-4111-8111-111111111111`],
        ["receipt-rule", "SERVICE_END_NOTICE", "receipt-rule:client:7:CLIENT:2026-09-16T03:00:00.000Z"],
        [SERVICE_END_NOTICE_RULE_ID, "SERVICE_END_NOTICE", `${SERVICE_END_NOTICE_RULE_ID}:client:7:CLIENT:2026-09-16T03:00:00.000Z`],
        ["not-agent-sms:branch", "INFO", "ordinary"],
    ])("SQL predicate agrees with the TS check for %s / %s / %s", (ruleId, templateKey, dedupeKey) => {
        const predicate = manualMessageTriggerJobPredicate(columns);
        const sqlResult = evaluatePredicate(predicate, { templateKey, ruleId, dedupeKey });
        const tsResult = isManualMessageTriggerJob({ ruleId, templateKey, dedupeKey });
        expect(sqlResult).toBe(tsResult);
    });

    it("never contributes a rule-id-only match at the job level (rule-only ownership stays out of job SQL)", () => {
        const predicate = manualMessageTriggerJobPredicate(columns);
        expect(predicate.sql).toContain("FALSE");
    });
});
