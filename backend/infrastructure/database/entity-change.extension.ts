import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    entityChangeEventBus,
    type EntityChangeInput,
    type EntityChangeKind,
} from "application/services/entity-change-event-bus.service";
import { tenantContextStore } from "../tenant/tenant-context.store";

/**
 * Prisma Client extension that tells the realtime stream "a watched entity changed". Chained
 * after `tenantIsolationExtension()` in `database.module.ts`. It only emits a coalesced hint
 * (see `EntityChangeEventBus`); clients refetch, so no row data leaves this file.
 */

const logger = new Logger("EntityChangeExtension");

/** Prisma model names (== table names; the schema has no `@@map`) to the kind clients refetch. */
const ENTITY_KIND_BY_MODEL: Readonly<Record<string, EntityChangeKind>> = {
    client: "client",
    employee: "employee",
    eformsign_doc: "document",
    eformsign_document_job: "document",
    eformsign_dispatch_intent: "document",
    message_trigger_job: "message",
    message_log: "message",
    service_record: "service-record",
    service_record_day: "service-record",
    service_record_case: "service-record",
};

const ROW_WRITE_OPERATIONS: ReadonlySet<string> = new Set(["create", "update", "upsert", "delete"]);
const COUNT_WRITE_OPERATIONS: ReadonlySet<string> = new Set(["createMany", "updateMany", "deleteMany"]);
const ARRAY_WRITE_OPERATIONS: ReadonlySet<string> = new Set([
    "createManyAndReturn",
    "updateManyAndReturn",
]);

/** Longest first so `service_record_day` is never shadowed by its `service_record` prefix. */
const WATCHED_TABLES = Object.keys(ENTITY_KIND_BY_MODEL).sort((a, b) => b.length - a.length);

/**
 * Matches the write verbs anywhere in the text (so `WITH ... UPDATE` CTEs are covered) and the
 * table right after them. `SELECT ... FOR UPDATE` never matches: no watched table follows it.
 */
const RAW_WRITE_PATTERN = new RegExp(
    `\\b(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+(?:"?public"?\\.)?"?(${WATCHED_TABLES.join("|")})"?(?![\\w$])`,
    "gi",
);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowBranchId(row: unknown): string | undefined {
    return isRecord(row) && typeof row["branchId"] === "string" ? row["branchId"] : undefined;
}

/** Did the write touch anything? A no-op background `updateMany` must not wake every screen. */
function changedSomething(operation: string, result: unknown): boolean {
    if (COUNT_WRITE_OPERATIONS.has(operation)) {
        return isRecord(result) && typeof result["count"] === "number" && result["count"] > 0;
    }
    if (ARRAY_WRITE_OPERATIONS.has(operation)) {
        return Array.isArray(result) && result.length > 0;
    }
    return result !== null && result !== undefined;
}

/**
 * Branches to notify: the returned row(s) first, then the ambient tenant store, else `null`
 * (broadcast). Never re-reads the DB to find a branch.
 */
function resolveBranchIds(operation: string, result: unknown): Array<string | null> {
    const fromRows = new Set<string>();
    if (ARRAY_WRITE_OPERATIONS.has(operation) && Array.isArray(result)) {
        for (const row of result) {
            const branchId = rowBranchId(row);
            if (branchId !== undefined) fromRows.add(branchId);
        }
    } else if (ROW_WRITE_OPERATIONS.has(operation)) {
        const branchId = rowBranchId(result);
        if (branchId !== undefined) fromRows.add(branchId);
    }
    if (fromRows.size > 0) return [...fromRows];
    return [tenantContextStore.get()?.branchId ?? null];
}

/** Emitting must never fail or slow the write it reports on. */
function safeEmit(bus: { emit(input: EntityChangeInput): void }, branchIds: Array<string | null>, kinds: Iterable<EntityChangeKind>): void {
    try {
        for (const kind of kinds) {
            for (const branchId of branchIds) {
                bus.emit({ branchId, kind });
            }
        }
    } catch (error) {
        logger.warn(`entity-change emit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

type EntityChangeBus = { emit(input: EntityChangeInput): void };

/** Exported (like `handleModelOperation`) so tests can drive it with a stubbed `query`. */
export async function handleEntityModelOperation(
    params: {
        model: string | undefined;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
    },
    bus: EntityChangeBus = entityChangeEventBus,
): Promise<unknown> {
    const { model, operation, args, query } = params;
    const kind = model === undefined ? undefined : ENTITY_KIND_BY_MODEL[model];
    const isWrite =
        ROW_WRITE_OPERATIONS.has(operation) ||
        COUNT_WRITE_OPERATIONS.has(operation) ||
        ARRAY_WRITE_OPERATIONS.has(operation);

    // If the write throws, nothing is emitted and the error propagates unchanged.
    const result = await query(args);
    if (kind === undefined || !isWrite) return result;

    try {
        if (changedSomething(operation, result)) {
            safeEmit(bus, resolveBranchIds(operation, result), [kind]);
        }
    } catch (error) {
        logger.warn(`entity-change resolve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
}

/** SQL text from the tagged / `Prisma.sql` form (`{strings, values}`) or the Unsafe form (`args[0]`). */
function rawSqlText(args: unknown): string {
    if (Array.isArray(args)) return typeof args[0] === "string" ? args[0] : "";
    if (isRecord(args) && Array.isArray(args["strings"])) return (args["strings"] as unknown[]).join("");
    return "";
}

export function watchedKindsInSql(sql: string): Set<EntityChangeKind> {
    const kinds = new Set<EntityChangeKind>();
    for (const match of sql.matchAll(RAW_WRITE_PATTERN)) {
        const kind = ENTITY_KIND_BY_MODEL[(match[1] ?? "").toLowerCase()];
        if (kind) kinds.add(kind);
    }
    return kinds;
}

/** `$executeRaw*` returns the affected count, `$queryRaw*` rows; an unrecognised shape is not skipped. */
function rawChangedSomething(result: unknown): boolean {
    if (typeof result === "number") return result > 0;
    if (typeof result === "bigint") return result > 0n;
    if (Array.isArray(result)) return result.length > 0;
    return true;
}

export async function handleEntityRawOperation(
    params: { args: unknown; query: (args: unknown) => Promise<unknown> },
    bus: EntityChangeBus = entityChangeEventBus,
): Promise<unknown> {
    const { args, query } = params;
    const result = await query(args);

    try {
        const kinds = watchedKindsInSql(rawSqlText(args));
        if (kinds.size > 0 && rawChangedSomething(result)) {
            safeEmit(bus, [tenantContextStore.get()?.branchId ?? null], kinds);
        }
    } catch (error) {
        logger.warn(`entity-change raw resolve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
}

export function entityChangeExtension(bus: EntityChangeBus = entityChangeEventBus) {
    return Prisma.defineExtension({
        name: "entity-change",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    return handleEntityModelOperation({ model, operation, args, query }, bus);
                },
            },
            async $queryRaw({ args, query }) {
                return handleEntityRawOperation({ args, query }, bus);
            },
            async $queryRawUnsafe({ args, query }) {
                return handleEntityRawOperation({ args, query }, bus);
            },
            async $executeRaw({ args, query }) {
                return handleEntityRawOperation({ args, query }, bus);
            },
            async $executeRawUnsafe({ args, query }) {
                return handleEntityRawOperation({ args, query }, bus);
            },
        },
    });
}
