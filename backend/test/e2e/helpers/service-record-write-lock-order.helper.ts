import { PrismaClient } from "@prisma/client";

export const SERVICE_RECORD_WRITE_LOCK_DATABASE =
    "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task3";

const APPROVED_DATABASE_HOST = "127.0.0.1";
const APPROVED_DATABASE_PORT = "62295";
const APPROVED_DATABASE_USER = "bjj_revision_test";
const APPROVED_DATABASE_NAME = "bjj_revision_task3";

/**
 * Guard the task-3 disposable database before PrismaClient is constructed.
 * Callers must set both URLs explicitly to the same literal target.
 */
export function assertApprovedServiceRecordWriteLockDatabaseTarget(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): void {
    if (!databaseUrl || !directUrl) {
        throw new Error(
            "Refusing service-record write-lock E2E without DATABASE_URL and DIRECT_URL",
        );
    }
    assertTask3DatabaseUrl(databaseUrl, "DATABASE_URL");
    assertTask3DatabaseUrl(directUrl, "DIRECT_URL");
    if (databaseUrl !== directUrl) {
        throw new Error(
            "Refusing service-record write-lock E2E with mismatched database URLs",
        );
    }
}

/** Construct a client only after assertApprovedServiceRecordWriteLockDatabaseTarget. */
export function createApprovedServiceRecordWriteLockClient(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): PrismaClient {
    // Keep the complete guard at the construction boundary too. A future
    // caller cannot accidentally validate DATABASE_URL and then bypass the
    // required DIRECT_URL equality check before opening a socket.
    assertApprovedServiceRecordWriteLockDatabaseTarget(databaseUrl, directUrl);
    if (!databaseUrl) throw new Error("Refusing service-record write-lock E2E without DATABASE_URL");
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function assertTask3DatabaseUrl(rawUrl: string, variableName: string): void {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(
            `Refusing service-record write-lock E2E with invalid ${variableName}`,
        );
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
        || databaseName !== APPROVED_DATABASE_NAME
    ) {
        throw new Error(
            `Refusing service-record write-lock E2E against unsafe ${variableName} target`,
        );
    }
}
