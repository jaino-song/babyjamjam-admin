import { Prisma } from "@prisma/client";
import { MANUAL_MESSAGE_JOB_MATCHERS } from "domain/constants/message-trigger-job-ownership";

/** Columns are static SQL expressions supplied by the caller, never request strings. */
export function manualMessageTriggerJobPredicate(columns: {
    templateKey: Prisma.Sql;
    ruleId: Prisma.Sql;
    dedupeKey: Prisma.Sql;
}): Prisma.Sql {
    const predicates = MANUAL_MESSAGE_JOB_MATCHERS.map((matcher) => {
        switch (matcher.kind) {
            case "rule-prefix": return Prisma.sql`left(${columns.ruleId}, ${matcher.prefix.length}::integer) = ${matcher.prefix}`;
            case "dedupe-prefix": return Prisma.sql`left(${columns.dedupeKey}, ${matcher.prefix.length}::integer) = ${matcher.prefix}`;
            case "rule-dedupe": return Prisma.sql`(${columns.ruleId} = ${matcher.ruleId} AND ${columns.dedupeKey} ~ ${matcher.pattern})`;
            // Rule-level only (see isManualMessageTriggerRule); never contributes to job ownership.
            case "rule-id": return Prisma.sql`FALSE`;
        }
    });
    return Prisma.sql`(${Prisma.join(predicates, " OR ")})`;
}
