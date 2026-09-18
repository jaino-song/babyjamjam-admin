import { PrismaClient } from "@prisma/client";

export const AGENT_TASK_PERSISTENCE_DATABASE = "bjj_conversation_test" as const;

const APPROVED_DATABASE_HOST = "127.0.0.1";
const APPROVED_DATABASE_PORT = "55433";
const APPROVED_DATABASE_USER = "bjj_test";

/**
 * Validate both URLs before constructing PrismaClient. This test may mutate
 * only the disposable local conversation database.
 */
export function assertApprovedAgentTaskPersistenceDatabaseTarget(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): typeof AGENT_TASK_PERSISTENCE_DATABASE {
    if (!databaseUrl || !directUrl) {
        throw new Error("Refusing agent-task persistence E2E without DATABASE_URL and DIRECT_URL");
    }
    const database = parseApprovedDatabaseUrl(databaseUrl, "DATABASE_URL");
    const direct = parseApprovedDatabaseUrl(directUrl, "DIRECT_URL");
    if (database !== direct) {
        throw new Error("Refusing agent-task persistence E2E with mismatched database URLs");
    }
    return database;
}

/** Construct a client only after the caller has passed the explicit guard. */
export function createApprovedAgentTaskPersistenceClient(
    databaseUrl = process.env["DATABASE_URL"],
): PrismaClient {
    if (!databaseUrl) throw new Error("Refusing agent-task persistence E2E without DATABASE_URL");
    parseApprovedDatabaseUrl(databaseUrl, "DATABASE_URL");
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function parseApprovedDatabaseUrl(rawUrl: string, variableName: string): typeof AGENT_TASK_PERSISTENCE_DATABASE {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Refusing agent-task persistence E2E with invalid ${variableName}`);
    }
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (
        parsed.protocol !== "postgresql:"
        || parsed.hostname !== APPROVED_DATABASE_HOST
        || parsed.port !== APPROVED_DATABASE_PORT
        || parsed.username !== APPROVED_DATABASE_USER
        || parsed.password
        || parsed.search
        || parsed.hash
        || databaseName !== AGENT_TASK_PERSISTENCE_DATABASE
    ) {
        throw new Error(`Refusing agent-task persistence E2E against unsafe ${variableName} target`);
    }
    return AGENT_TASK_PERSISTENCE_DATABASE;
}
