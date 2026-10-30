import { AsyncLocalStorage } from "node:async_hooks";

import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import {
    entityChangeEventBus,
    type EntityChangeInput,
    type EntityChangeKind,
} from "application/services/entity-change-event-bus.service";
import { tenantContextStore } from "../tenant/tenant-context.store";
import { isEntityChangeHintsSuppressed } from "./entity-change-suppression";

/**
 * Prisma Client extension that tells the realtime stream "a watched entity changed". Chained
 * after `tenantIsolationExtension()` in `database.module.ts`. It only emits a coalesced hint
 * (see `EntityChangeEventBus`); clients refetch, so no row data leaves this file.
 *
 * Only committed writes are announced: a write inside a `$transaction` is buffered and handed to
 * the bus after the transaction commits, and dropped if it rejects (see `runInEntityChangeScope`).
 * Writes wrapped in `withoutEntityChangeHints` are never announced.
 */

const logger = new Logger("EntityChangeExtension");

type EntityChangeBus = { emit(input: EntityChangeInput): void };

/**
 * Prisma model names (== table names) to the kind clients refetch. The schema has exactly one
 * `@@map` - `message_trigger_rule_branch_override`, mapping to its own name - so a model name is
 * always the physical table name and the raw-SQL table matching below holds.
 */
export const ENTITY_KIND_BY_MODEL: Readonly<Record<string, EntityChangeKind>> = {
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
    service_record_revision: "service-record",
    service_record_day_edit_log: "service-record",
    service_record_revision_document_state: "service-record",
    employee_schedule: "service-record",
    service_record_token: "service-record",
    message_template: "message",
    message_trigger_rule: "message",
    message_trigger_rule_branch_override: "message",
    consultation_inquiry: "inquiry",
    call_record: "call",
    client_draft: "call",
    // The file library; unrelated to the eformsign `document` kind above despite the model name.
    document: "file",
    document_category: "file",
    public_holiday: "holiday",
    branch_holiday_override: "holiday",
    holiday_year_snapshot: "holiday",
    holiday_calendar_revision: "holiday",
    holiday_change_event: "holiday",
    end_date_review_item: "holiday",
    system_setting: "settings",
    area: "settings",
    doc_template: "settings",
    voucher_price_info: "settings",
    out_of_pocket_price_info: "settings",
    bank_account_info: "settings",
    system_template: "settings",
    branch: "settings",
    notification: "notification",
};

/**
 * Models with no `branchId` column: one row set shared by every branch. A write is always
 * broadcast (`branchId: null`) - falling back to the requester's branch would leave every other
 * branch showing stale data.
 */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set([
    "voucher_price_info",
    "out_of_pocket_price_info",
    "public_holiday",
    "holiday_year_snapshot",
    "holiday_calendar_revision",
    "system_template",
    "system_setting",
    "doc_template",
    "bank_account_info",
    "branch",
]);

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

/**
 * `string` = the row's branch, `null` = the row explicitly has no branch (broadcast),
 * `undefined` = the result does not carry a `branchId` at all (e.g. a `select` dropped it).
 */
function rowBranchId(row: unknown): string | null | undefined {
    if (!isRecord(row) || !("branchId" in row)) return undefined;
    const branchId = row["branchId"];
    if (typeof branchId === "string") return branchId;
    return branchId === null ? null : undefined;
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
function resolveBranchIds(model: string, operation: string, result: unknown): Array<string | null> {
    if (GLOBAL_MODELS.has(model)) return [null];
    const fromRows = new Set<string | null>();
    if (ARRAY_WRITE_OPERATIONS.has(operation) && Array.isArray(result)) {
        for (const row of result) {
            const branchId = rowBranchId(row);
            if (branchId !== undefined) fromRows.add(branchId);
        }
    } else if (ROW_WRITE_OPERATIONS.has(operation)) {
        const branchId = rowBranchId(result);
        if (branchId !== undefined) fromRows.add(branchId);
    }
    // An explicit `null` row branch stays in the set: that row must broadcast, not fall back.
    if (fromRows.size > 0) return [...fromRows];
    return [tenantContextStore.get()?.branchId ?? null];
}

/** One resolved write waiting for its transaction to settle. Branches are resolved at write time. */
interface PendingEmission {
    bus: EntityChangeBus;
    branchIds: Array<string | null>;
    kinds: EntityChangeKind[];
}

interface TransactionScope {
    /** Set once the transaction committed or rejected; a write arriving later no longer waits. */
    settled: boolean;
    pending: PendingEmission[];
}

/**
 * The transaction a write belongs to, carried by AsyncLocalStorage because the `query` hooks get no
 * transaction handle (and Prisma's `__internalParams` is deliberately not used).
 *
 * The scope is NOT set around the whole `$transaction` call for the interactive form: ambient
 * context is not membership. A continuation created before the transaction can be handed the real
 * `tx` client later and write through it with no scope in sight, and a root-client write made
 * inside the callback runs on its own connection and commits immediately. So the callback receives
 * a thin proxy over `tx` (`bindToScope`) and every call made through that proxy - including the
 * `then` that actually starts Prisma's lazy query - runs inside the scope. Membership follows the
 * client handle, wherever and whenever it is used; a root-client write is never held back.
 *
 * The batch form `$transaction([...])` takes root-client promises created before the call and has
 * no `tx` handle to bind, so it runs under the ambient scope (it is executed inside the call).
 * A separate `$transaction` started inside a callback opens its own scope and flushes on its own
 * commit.
 */
const transactionScopeStore = new AsyncLocalStorage<TransactionScope>();

/**
 * Runs `run` (a `$transaction` call) with a fresh scope: hints raised by writes bound to the scope
 * are held, flushed in write order once `run` resolves (= committed), and discarded if it rejects.
 * The result or error of `run` is passed through unchanged.
 */
export async function runInEntityChangeScope<T>(run: (scope: TransactionScope) => Promise<T>): Promise<T> {
    const scope: TransactionScope = { settled: false, pending: [] };
    let result: T;
    try {
        result = await run(scope);
    } catch (error) {
        scope.settled = true;
        scope.pending = [];
        throw error;
    }
    scope.settled = true;
    const committed = scope.pending;
    scope.pending = [];
    for (const { bus, branchIds, kinds } of committed) safeEmit(bus, branchIds, kinds);
    return result;
}

function inScope<R>(scope: TransactionScope, fn: () => R): R {
    return transactionScopeStore.run(scope, fn);
}

function isThenable(value: unknown): value is object {
    return (
        (typeof value === "object" || typeof value === "function") &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

const PROMISE_METHODS: ReadonlySet<PropertyKey> = new Set(["then", "catch", "finally"]);

/** A query result promise whose `then`/`catch`/`finally` - where Prisma starts the query - run in `scope`. */
function bindThenableToScope(target: object, scope: TransactionScope): object {
    return new Proxy(target, {
        get(inner, property) {
            const value: unknown = Reflect.get(inner, property, inner);
            if (typeof value !== "function") return value;
            if (PROMISE_METHODS.has(property)) {
                return (...args: unknown[]) => inScope(scope, () => value.apply(inner, args) as unknown);
            }
            // Fluent API (`findUnique(...).relation()`): the next link is a lazy promise too.
            return (...args: unknown[]) => bindResultToScope(inScope(scope, () => value.apply(inner, args) as unknown), scope);
        },
    });
}

function bindResultToScope(value: unknown, scope: TransactionScope): unknown {
    return isThenable(value) ? bindThenableToScope(value, scope) : value;
}

/**
 * Wraps the client of an interactive transaction (or one of its model delegates) so that every
 * method call, and the promise it returns, executes inside `scope`. Property reads and `instanceof`
 * fall through to the real client, so callers see the same shape and type.
 */
function bindToScope<T extends object>(target: T, scope: TransactionScope, isDelegate = false): T {
    return new Proxy(target, {
        get(inner, property) {
            const value: unknown = Reflect.get(inner, property, inner);
            if (typeof value === "function") {
                return (...args: unknown[]) =>
                    bindResultToScope(inScope(scope, () => value.apply(inner, args) as unknown), scope);
            }
            // `tx.client`, `tx.employee`, ...: a model delegate. Internals (`_engine`, ...) stay raw.
            if (!isDelegate && typeof property === "string" && !property.startsWith("_") && typeof value === "object" && value !== null) {
                return bindToScope(value, scope, true);
            }
            return value;
        },
    });
}

/** Suppressed writes emit nothing; writes in an open transaction wait for it; the rest emit now. */
function emitOrBuffer(bus: EntityChangeBus, branchIds: Array<string | null>, kinds: EntityChangeKind[]): void {
    if (isEntityChangeHintsSuppressed()) return;
    const scope = transactionScopeStore.getStore();
    // A write that outlived its transaction (e.g. a detached root-client write) completed after the
    // flush, so there is nothing left to wait for.
    if (scope !== undefined && !scope.settled) {
        scope.pending.push({ bus, branchIds, kinds });
        return;
    }
    safeEmit(bus, branchIds, kinds);
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
            emitOrBuffer(bus, resolveBranchIds(model as string, operation, result), [kind]);
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

const DOLLAR_QUOTE_OPEN = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Blanks `-- line` and `/* block *\/` comments (nested, as Postgres allows), single-quoted string
 * literals (with the `''` escape) and dollar-quoted strings, so text such as
 * `SELECT 'UPDATE client'` never looks like a write. Double-quoted identifiers are copied through
 * untouched: `UPDATE "message_trigger_job"` must still match.
 */
export function stripSqlNonCode(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i] as string;
        const next = sql[i + 1];
        if (ch === "-" && next === "-") {
            const end = sql.indexOf("\n", i);
            i = end === -1 ? sql.length : end;
            out += " ";
        } else if (ch === "/" && next === "*") {
            let depth = 1;
            i += 2;
            while (i < sql.length && depth > 0) {
                if (sql[i] === "/" && sql[i + 1] === "*") {
                    depth += 1;
                    i += 2;
                } else if (sql[i] === "*" && sql[i + 1] === "/") {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            out += " ";
        } else if (ch === "'") {
            i += 1;
            while (i < sql.length) {
                if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
                else if (sql[i] === "'") {
                    i += 1;
                    break;
                } else i += 1;
            }
            out += " ";
        } else if (ch === '"') {
            const start = i;
            i += 1;
            while (i < sql.length) {
                if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
                else if (sql[i] === '"') {
                    i += 1;
                    break;
                } else i += 1;
            }
            out += sql.slice(start, i);
        } else if (ch === "$") {
            const open = DOLLAR_QUOTE_OPEN.exec(sql.slice(i, i + 130));
            if (open) {
                const close = sql.indexOf(open[0], i + open[0].length);
                i = close === -1 ? sql.length : close + open[0].length;
                out += " ";
            } else {
                out += ch;
                i += 1;
            }
        } else {
            out += ch;
            i += 1;
        }
    }
    return out;
}

export function watchedKindsInSql(sql: string): Set<EntityChangeKind> {
    return new Set(watchedWritesInSql(sql).keys());
}

/** Watched kinds a statement writes; `global` = at least one written table is in `GLOBAL_MODELS`. */
function watchedWritesInSql(sql: string): Map<EntityChangeKind, { global: boolean }> {
    const kinds = new Map<EntityChangeKind, { global: boolean }>();
    for (const match of stripSqlNonCode(sql).matchAll(RAW_WRITE_PATTERN)) {
        const table = (match[1] ?? "").toLowerCase();
        const kind = ENTITY_KIND_BY_MODEL[table];
        if (!kind) continue;
        const entry = kinds.get(kind) ?? { global: false };
        entry.global = entry.global || GLOBAL_MODELS.has(table);
        kinds.set(kind, entry);
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
        const kinds = watchedWritesInSql(rawSqlText(args));
        if (kinds.size > 0 && rawChangedSomething(result)) {
            const tenantBranch = tenantContextStore.get()?.branchId ?? null;
            // A shared (branch-less) table must reach every branch even when the statement ran in
            // one branch's context; branch-owned kinds in the same statement keep the tenant branch.
            for (const [kind, { global }] of kinds) {
                emitOrBuffer(bus, [global ? null : tenantBranch], [kind]);
            }
        }
    } catch (error) {
        logger.warn(`entity-change raw resolve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
}

type TransactionRunner = (this: unknown, ...args: unknown[]) => Promise<unknown>;

/**
 * Prisma's own `$transaction`, i.e. the method the client-level override below replaces. Calling it
 * with `this` = the extended client keeps the tx client (and so every extension hook) intact; the
 * extended client exposes no "previous" method to call instead.
 */
const prismaTransaction = PrismaClient.prototype.$transaction as unknown as TransactionRunner;

/**
 * `runTransaction` is a seam for tests (the engine needs a database to open a transaction); the
 * default is Prisma's own `$transaction`.
 */
export function entityChangeExtension(
    bus: EntityChangeBus = entityChangeEventBus,
    runTransaction: TransactionRunner = prismaTransaction,
) {
    return Prisma.defineExtension({
        name: "entity-change",
        client: {
            // Wraps every `$transaction` call site (interactive and batch; options pass through) so
            // the hints of its writes are held until it commits. Callers do not change.
            async $transaction(this: unknown, ...args: unknown[]) {
                return runInEntityChangeScope((scope) => {
                    const [first, ...rest] = args;
                    if (typeof first === "function") {
                        // Interactive: bind the callback's tx client to the scope (see the scope store).
                        const callback = first as (tx: object, ...more: unknown[]) => unknown;
                        const bound = (tx: object, ...more: unknown[]) => callback(bindToScope(tx, scope), ...more);
                        return runTransaction.apply(this, [bound, ...rest]);
                    }
                    // Batch: root-client promises executed inside this call.
                    return inScope(scope, () => runTransaction.apply(this, args));
                });
            },
        },
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
