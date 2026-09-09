import { PrismaClient } from "@prisma/client";

export const SERVICE_RECORD_EDIT_PERSISTENCE_DATABASES = [
    "bjj_revision_task2_empty",
    "bjj_revision_task2_legacy",
] as const;

export type ServiceRecordEditPersistenceDatabase =
    (typeof SERVICE_RECORD_EDIT_PERSISTENCE_DATABASES)[number];

const APPROVED_DATABASE_HOST = "127.0.0.1";
const APPROVED_DATABASE_PORT = "62295";
const APPROVED_DATABASE_USER = "bjj_revision_test";

/**
 * Validate both Prisma URLs before constructing a client or opening a socket.
 * The persistence E2E is allowed to mutate only the two disposable databases
 * provisioned for this task; a developer or remote URL must fail closed.
 */
export function assertApprovedServiceRecordEditDatabaseTarget(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): ServiceRecordEditPersistenceDatabase {
    if (!databaseUrl || !directUrl) {
        throw new Error("Refusing service-record persistence E2E without DATABASE_URL and DIRECT_URL");
    }

    const database = parseApprovedDatabaseUrl(databaseUrl, "DATABASE_URL");
    const direct = parseApprovedDatabaseUrl(directUrl, "DIRECT_URL");
    if (database !== direct) {
        throw new Error("Refusing service-record persistence E2E with mismatched database URLs");
    }
    return database;
}

/** Construct a client only after the caller has passed the explicit target guard. */
export function createApprovedServiceRecordEditClient(databaseUrl = process.env["DATABASE_URL"]): PrismaClient {
    if (!databaseUrl) throw new Error("Refusing service-record persistence E2E without DATABASE_URL");
    parseApprovedDatabaseUrl(databaseUrl, "DATABASE_URL");
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function parseApprovedDatabaseUrl(
    rawUrl: string,
    variableName: string,
): ServiceRecordEditPersistenceDatabase {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Refusing service-record persistence E2E with invalid ${variableName}`);
    }

    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    const isApprovedName = (SERVICE_RECORD_EDIT_PERSISTENCE_DATABASES as readonly string[]).includes(databaseName);
    if (
        parsed.protocol !== "postgresql:"
        || parsed.hostname !== APPROVED_DATABASE_HOST
        || parsed.port !== APPROVED_DATABASE_PORT
        || parsed.username !== APPROVED_DATABASE_USER
        || parsed.password
        || parsed.search
        || parsed.hash
        || !isApprovedName
    ) {
        throw new Error(`Refusing service-record persistence E2E against unsafe ${variableName} target`);
    }
    return databaseName as ServiceRecordEditPersistenceDatabase;
}
