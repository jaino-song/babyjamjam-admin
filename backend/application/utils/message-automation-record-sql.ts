import { Prisma } from "@prisma/client";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";

export function ordinaryAutomationJobWhere(): Pick<Prisma.message_trigger_jobWhereInput, "AND"> {
    return { AND: [{ ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID } },
        { NOT: { dedupeKey: { startsWith: AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX } } },
        // SQL NULL at this JSON path means the key is absent; JSON null is reserved too.
        { payload: { path: [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY], equals: Prisma.DbNull } }] };
}

/** Static column expressions only. Values, including the reserved payload key, stay parameters. */
export function ordinaryAutomationJobSql(columns: { ruleId: Prisma.Sql; dedupeKey: Prisma.Sql; payload: Prisma.Sql }): Prisma.Sql {
    return Prisma.sql`(${columns.ruleId} <> ${MESSAGE_AUTOMATION_INTENT_RULE_ID}
        AND left(${columns.dedupeKey}, ${AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX.length}::integer) <> ${AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX}
        AND NOT (${columns.payload} ? ${AGENT_AUTOMATION_RECORD_PAYLOAD_KEY}))`;
}
