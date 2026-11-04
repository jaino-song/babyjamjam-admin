/**
 * A test-only, in-memory stand-in for the Prisma client, shaped for the service-record correction
 * sequence specs. The services under test run for real on top of it, so each step reads exactly
 * what the previous step wrote and nothing is re-typed between steps.
 *
 * It is not a SQL emulator and not a model of all of Prisma: it is a behavioural double for the declared
 * service-call subset. It implements the delegates and call shapes those services actually issue, and
 * refuses everything else:
 *  - a delegate is a plain object holding only the methods the store implements; an unmodelled
 *    table is `undefined` (production branches on `typeof tx.X?.method === "function"` and on
 *    `$queryRaw` existing, so a fake that answered every call would change which branch runs);
 *  - there is no `$queryRaw` / `$executeRaw`;
 *  - an unsupported `where` / `data` / `select` / `include` / `orderBy` shape, a column it does
 *    not know, a nested relation write, a write to a table it does not model and a `$transaction`
 *    option other than `isolationLevel` all THROW, so a silent no-op can never make a test pass.
 *    Every request is validated BEFORE any row is matched, so a bad shape throws whether it matches
 *    one row, many or none (a lazy check would let `updateMany` on an empty match accept a column
 *    that does not exist);
 *  - nested shapes are checked too, against each column's kind from prisma/schema.prisma: a `where` field
 *    takes a literal, null or supported operators over literals (`not` recursively, `in` / `notIn` over
 *    literal lists), a Json column takes no filter, and a scalar `data` value is a literal, null or
 *    `{ increment: <int> }` on an int column; any other object is what Prisma's generated types reject;
 *  - single-row operations (`findUnique`, `update`, `upsert`) require a `where` that names a modelled
 *    single-column unique key with a scalar literal value (`{ equals }` is refused, as Prisma refuses it),
 *    and every top-level single-column unique field it supplies must be such a literal (one valid key never
 *    excuses an object, list, null or wrong-kind value in another); other fields and nested AND / OR / NOT
 *    are ordinary filters. Every insert path (`create`, upsert-create, `insert`, seeding) enforces the modelled uniqueness;
 *  - `where` is evaluated by the shared prisma-where-evaluator (SQL NULL semantics included);
 *  - `$transaction` snapshots every table first and restores the snapshot when the callback
 *    throws, so an injected failure leaves the store exactly as it was before the transaction.
 *
 * `service_record` and `eformsign_doc` are modelled as empty tables with `updateMany` only: the
 * lifecycle sync issues a blind `updateMany` on both, and with no rows it matches nothing.
 * They have no `findMany`, so the editor's document-scope read keeps its "unverified" fallback.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { matchesWhere } from "./prisma-where-evaluator";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Method = "findMany" | "findFirst" | "findUnique" | "create" | "update" | "updateMany" | "upsert";
/** A delegate exposes exactly the listed methods; every other method is simply absent. */
type Delegate<M extends Method> = { [K in M]: (args?: Row) => Promise<unknown> };

export interface WriteLogEntry {
    table: string;
    method: "create" | "update" | "updateMany" | "upsert";
    where: unknown;
    data: unknown;
    /** Rows the call touched (`updateMany` count; 1 for a single-row write). */
    count: number;
    /** Set when the call reached the store but threw (an injected failure). */
    failed?: boolean;
}

const now = (): Date => new Date();
const uuid = (): string => randomUUID();
const nul = (): null => null;
const no = (): boolean => false;

/** Column defaults per table; a column missing here is "unknown" and every use of it throws. */
const COLUMNS: Record<string, Record<string, () => unknown>> = {
    client: {
        id: nul, branchId: nul, name: nul, duration: nul, startDate: nul, endDate: nul, serviceStatus: nul,
        bookingConfirmedAt: nul, birthDate: nul, eDocId: nul, deletedAt: nul,
        allowSaturdayService: no, allowSundayService: no, allowHolidayService: no,
    },
    employee: { id: nul, branchId: nul, name: nul, phone: nul },
    branch: { id: nul, name: nul },
    employee_schedule: {
        id: nul, branchId: nul, clientId: nul, primaryEmployeeId: nul, secondaryEmployeeId: nul, workAddress: nul,
        startDate: nul, endDate: nul, replaced: no, terminatedAt: nul,
    },
    service_record_case: {
        id: uuid, branchId: nul, clientId: nul, version: () => 1, formVersion: () => 1, status: nul,
        completedAt: nul, finalizationDueAt: nul, finalizationStartedAt: nul, finalizedAt: nul,
        documentsCompletedAt: nul, currentRevisionId: nul, currentUsableRevisionId: nul,
        currentUsableDocumentVersion: nul, requiredSessionCount: nul, startDate: nul, endDate: nul,
        momName: nul, momBirth: nul, babyName: nul, babyBirth: nul, deliveryType: nul, babyWeight: nul,
        plannedSessions: nul, nextAttemptAt: nul, finalizationAttempts: () => 0, lastError: nul,
    },
    service_record_assignment: {
        id: uuid, branchId: nul, serviceRecordCaseId: nul, scheduleId: nul, employeeId: nul,
        employeeNameSnapshot: nul, employeePhoneSnapshot: nul, startDate: nul, endDate: nul,
    },
    service_record_day: {
        id: uuid, branchId: nul, scheduleId: nul, serviceRecordCaseId: nul, caseSessionIndex: nul,
        sessionIndex: nul, employeeId: nul, employeeNameSnapshot: nul, formVersion: () => 1,
        serviceDate: nul, answers: () => ({}), etcService: nul, notes: nul, paymentConfirmed: no,
        momApproval: nul, clientSignature: nul, clientSignedAt: nul, locked: no, submittedAt: nul,
        createdAt: now,
    },
    service_record_token: {
        id: uuid, branchId: nul, scheduleId: nul, employeeId: nul, serviceRecordCaseId: nul,
        linkTokenHash: nul, expectedPhoneHash: nul, active: () => true, revokedAt: nul, expiresAt: nul,
        accessTokenHash: nul, verifiedAt: nul,
    },
    service_record_edit_draft: {
        id: uuid, branchId: nul, serviceRecordCaseId: nul, createdByUserId: nul, updatedByUserId: nul,
        discardedByUserId: nul, sourceCaseVersion: nul, sourceFingerprint: nul, sourceSnapshot: nul,
        changes: () => ({}), draftVersion: () => 1, status: () => "ACTIVE", createdAt: now, updatedAt: now,
        discardedAt: nul, confirmedByUserId: nul, confirmedAt: nul, confirmationIdempotencyKey: nul,
        confirmationFingerprint: nul, confirmationResponse: nul,
    },
    service_record_revision: {
        id: uuid, branchId: nul, serviceRecordCaseId: nul, revisionNumber: nul, confirmedByUserId: nul,
        confirmedAt: now, payload: nul, beforeSnapshot: nul, plannedSessions: nul, provenance: nul,
        formVersionAtConfirm: nul, snapshotReference: nul,
    },
    schedule_change_request: {
        id: uuid, branchId: nul, scheduleId: nul, clientId: nul, sessionIndex: nul, fromDate: nul, toDate: nul,
        oldEndDate: nul, newEndDate: nul, status: nul, reason: nul, decidedBy: nul, requestedAt: now,
        decidedAt: nul,
    },
    service_record: { id: nul, scheduleId: nul, branchId: nul, serviceRecordCaseId: nul },
    eformsign_doc: { id: nul, branchId: nul, employeeScheduleId: nul, documentKind: nul, serviceRecordCaseId: nul },
};

/**
 * Unique keys, taken from prisma/schema.prisma (`@id`, `@unique`, `@@unique`), for the tables the services
 * write. A key is enforced on every insert path when all of its columns are non-null (SQL: a NULL never
 * collides). Only the single-column keys can identify a row in `findUnique` / `update` / `upsert`: a
 * compound key needs Prisma's `a_b: { a, b }` selector, which no modelled call uses and the store refuses.
 */
const UNIQUES: Record<string, string[][]> = {
    client: [["id"], ["eDocId"]],
    employee: [["id"]],
    branch: [["id"]],
    employee_schedule: [["id"]],
    service_record_case: [["id"], ["clientId"]],
    service_record_assignment: [["id"], ["scheduleId"]],
    service_record_day: [["id"], ["scheduleId", "sessionIndex"], ["serviceRecordCaseId", "caseSessionIndex"]],
    service_record_token: [["id"]],
    service_record_edit_draft: [["id"]],
    service_record_revision: [["id"], ["serviceRecordCaseId", "revisionNumber"]],
    schedule_change_request: [["id"]],
    service_record: [["id"], ["scheduleId"]],
    eformsign_doc: [["id"]],
};

/**
 * What each modelled column is, read from prisma/schema.prisma (the schema has no enums: `status` and the
 * like are plain strings). The kind decides which literals, filter operators and atomic writes Prisma's
 * generated types would accept for the column; a column missing here is a modelling error caught at load.
 */
type Kind = "string" | "int" | "boolean" | "datetime" | "json";

const KIND_COLUMNS: Record<string, Partial<Record<Kind, string>>> = {
    client: {
        int: "id duration", string: "branchId name serviceStatus eDocId",
        datetime: "startDate endDate bookingConfirmedAt birthDate deletedAt",
        boolean: "allowSaturdayService allowSundayService allowHolidayService",
    },
    employee: { int: "id", string: "branchId name phone" },
    branch: { string: "id name" },
    employee_schedule: {
        int: "id clientId primaryEmployeeId secondaryEmployeeId", string: "branchId workAddress",
        datetime: "startDate endDate terminatedAt", boolean: "replaced",
    },
    service_record_case: {
        string: "id branchId status currentRevisionId currentUsableRevisionId momName momBirth babyName babyBirth deliveryType babyWeight lastError",
        int: "clientId version formVersion currentUsableDocumentVersion requiredSessionCount finalizationAttempts",
        datetime: "completedAt finalizationDueAt finalizationStartedAt finalizedAt documentsCompletedAt startDate endDate nextAttemptAt",
        json: "plannedSessions",
    },
    service_record_assignment: {
        string: "id branchId serviceRecordCaseId employeeNameSnapshot employeePhoneSnapshot",
        int: "scheduleId employeeId", datetime: "startDate endDate",
    },
    service_record_day: {
        string: "id branchId serviceRecordCaseId employeeNameSnapshot etcService notes momApproval clientSignature",
        int: "scheduleId caseSessionIndex sessionIndex employeeId formVersion",
        datetime: "serviceDate clientSignedAt submittedAt createdAt", boolean: "paymentConfirmed locked", json: "answers",
    },
    service_record_token: {
        string: "id branchId serviceRecordCaseId linkTokenHash expectedPhoneHash accessTokenHash",
        int: "scheduleId employeeId", boolean: "active", datetime: "revokedAt expiresAt verifiedAt",
    },
    service_record_edit_draft: {
        string: "id branchId serviceRecordCaseId createdByUserId updatedByUserId discardedByUserId sourceFingerprint status confirmedByUserId confirmationIdempotencyKey confirmationFingerprint",
        int: "sourceCaseVersion draftVersion", datetime: "createdAt updatedAt discardedAt confirmedAt",
        json: "sourceSnapshot changes confirmationResponse",
    },
    service_record_revision: {
        string: "id branchId serviceRecordCaseId confirmedByUserId snapshotReference",
        int: "revisionNumber formVersionAtConfirm", datetime: "confirmedAt",
        json: "payload beforeSnapshot plannedSessions provenance",
    },
    schedule_change_request: {
        string: "id branchId status reason decidedBy", int: "scheduleId clientId sessionIndex",
        datetime: "fromDate toDate oldEndDate newEndDate requestedAt decidedAt",
    },
    service_record: { string: "id branchId serviceRecordCaseId", int: "scheduleId" },
    eformsign_doc: { int: "id employeeScheduleId", string: "branchId documentKind serviceRecordCaseId" },
};

const KINDS: Record<string, Record<string, Kind>> = {};
for (const [table, byKind] of Object.entries(KIND_COLUMNS)) {
    KINDS[table] = {};
    for (const [kind, names] of Object.entries(byKind)) {
        for (const name of (names as string).split(" ")) {
            if (KINDS[table]![name]) throw new Error(`service-record-sequence-store: ${table}.${name} has two kinds`);
            KINDS[table]![name] = kind as Kind;
        }
    }
    const modelled = Object.keys(COLUMNS[table] ?? {}).sort().join(",");
    if (modelled !== Object.keys(KINDS[table]!).sort().join(",")) {
        throw new Error(`service-record-sequence-store: the kinds of ${table} do not cover exactly its columns`);
    }
}

/** Operators the shared prisma-where-evaluator knows; anything else is refused up front. */
const WHERE_OPERATORS = new Set(["equals", "not", "in", "notIn", "lt", "lte", "gt", "gte"]);
const LIST_OPERATORS = new Set(["in", "notIn"]);
/** Prisma's boolean filter has no ordering or list operators. */
const BOOLEAN_OPERATORS = new Set(["equals", "not"]);
/** The only atomic number write production issues (`version: { increment: 1 }`, `finalizationAttempts`). */
const DATA_OPERATIONS = new Set(["increment"]);

interface Relation {
    target: string;
    many: boolean;
    local: string;
    foreign: string;
}

const RELATIONS: Record<string, Record<string, Relation>> = {
    client: {
        employeeSchedules: { target: "employee_schedule", many: true, local: "id", foreign: "clientId" },
    },
    employee_schedule: {
        client: { target: "client", many: false, local: "clientId", foreign: "id" },
        primaryEmployee: { target: "employee", many: false, local: "primaryEmployeeId", foreign: "id" },
        secondaryEmployee: { target: "employee", many: false, local: "secondaryEmployeeId", foreign: "id" },
        serviceRecordAssignment: { target: "service_record_assignment", many: false, local: "id", foreign: "scheduleId" },
    },
    service_record_case: {
        branch: { target: "branch", many: false, local: "branchId", foreign: "id" },
        client: { target: "client", many: false, local: "clientId", foreign: "id" },
        days: { target: "service_record_day", many: true, local: "id", foreign: "serviceRecordCaseId" },
        assignments: { target: "service_record_assignment", many: true, local: "id", foreign: "serviceRecordCaseId" },
    },
    service_record_assignment: {
        schedule: { target: "employee_schedule", many: false, local: "scheduleId", foreign: "id" },
    },
};

const ALLOWED_ARGS: Record<Method, ReadonlySet<string>> = {
    findMany: new Set(["where", "select", "include", "orderBy"]),
    findFirst: new Set(["where", "select", "include", "orderBy"]),
    findUnique: new Set(["where", "select", "include"]),
    create: new Set(["data", "select", "include"]),
    update: new Set(["where", "data", "select", "include"]),
    updateMany: new Set(["where", "data"]),
    upsert: new Set(["where", "create", "update", "select", "include"]),
};

function fail(message: string): never {
    throw new Error(`service-record-sequence-store: ${message}`);
}

/**
 * Deep copy of plain rows, JSON and Dates. `structuredClone` is avoided on purpose: under Jest it is the
 * outer realm's function and returns Dates the spec's own `instanceof Date` rejects.
 */
function clone<T>(value: T): T {
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
    if (typeof value === "object" && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) out[key] = clone(item);
        return out as T;
    }
    return value;
}

/** A plain object or record: not a Date, an array or a class instance (`Prisma.DbNull`, `Prisma.JsonNull`, ...). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || value instanceof Date || Array.isArray(value)) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === null || Object.getPrototypeOf(proto) === null;
}

/** A non-null literal Prisma accepts for a scalar column of this kind (a DateTime also takes an ISO string). */
function isLiteral(kind: Kind, value: unknown): boolean {
    switch (kind) {
        case "string": return typeof value === "string";
        case "int": return typeof value === "number" && Number.isInteger(value);
        case "boolean": return typeof value === "boolean";
        case "datetime": return typeof value === "string" || (value instanceof Date && !Number.isNaN(value.getTime()));
        case "json": return false;
    }
}

function compareValues(left: unknown, right: unknown): number {
    const l = left instanceof Date ? left.getTime() : left;
    const r = right instanceof Date ? right.getTime() : right;
    if (l === r) return 0;
    return (l as number | string) < (r as number | string) ? -1 : 1;
}

export interface SequenceStoreOptions {
    /** Rows by table; every row is completed with the table's column defaults. */
    tables?: Tables;
}

export class SequenceStore {
    private tables: Tables = {};
    private readonly log: WriteLogEntry[] = [];
    private readonly failures: Array<{ table: string; method: string; error: Error }> = [];
    private inTransaction = false;

    readonly client: Delegate<"findMany" | "findFirst" | "findUnique" | "update" | "updateMany">;
    readonly employee: Delegate<"findMany">;
    readonly employee_schedule: Delegate<"findMany" | "findFirst" | "findUnique" | "update" | "updateMany">;
    readonly service_record_case: Delegate<"findMany" | "findFirst" | "findUnique" | "update" | "updateMany" | "upsert">;
    readonly service_record_assignment: Delegate<"findMany" | "updateMany" | "upsert">;
    readonly service_record_day: Delegate<"findMany" | "update" | "updateMany" | "create">;
    readonly service_record_token: Delegate<"updateMany">;
    readonly service_record_edit_draft: Delegate<"findMany" | "findFirst" | "create" | "updateMany">;
    readonly service_record_revision: Delegate<"findMany" | "findFirst" | "findUnique" | "create">;
    readonly schedule_change_request: Delegate<"findFirst" | "create" | "update">;
    readonly service_record: Delegate<"updateMany">;
    readonly eformsign_doc: Delegate<"updateMany">;

    constructor(options: SequenceStoreOptions = {}) {
        for (const table of Object.keys(COLUMNS)) this.tables[table] = [];
        for (const [table, rows] of Object.entries(options.tables ?? {})) {
            if (!COLUMNS[table]) fail(`cannot seed unmodelled table "${table}"`);
            for (const row of rows) this.insert(table, row);
        }
        this.client = this.delegate("client", ["findMany", "findFirst", "findUnique", "update", "updateMany"]);
        this.employee = this.delegate("employee", ["findMany"]);
        this.employee_schedule = this.delegate("employee_schedule", [
            "findMany", "findFirst", "findUnique", "update", "updateMany",
        ]);
        this.service_record_case = this.delegate("service_record_case", [
            "findMany", "findFirst", "findUnique", "update", "updateMany", "upsert",
        ]);
        this.service_record_assignment = this.delegate("service_record_assignment", ["findMany", "updateMany", "upsert"]);
        this.service_record_day = this.delegate("service_record_day", [
            "findMany", "update", "updateMany", "create",
        ]);
        this.service_record_token = this.delegate("service_record_token", ["updateMany"]);
        this.service_record_edit_draft = this.delegate("service_record_edit_draft", [
            "findMany", "findFirst", "create", "updateMany",
        ]);
        this.service_record_revision = this.delegate("service_record_revision", [
            "findMany", "findFirst", "findUnique", "create",
        ]);
        this.schedule_change_request = this.delegate("schedule_change_request", ["findFirst", "create", "update"]);
        this.service_record = this.delegate("service_record", ["updateMany"]);
        this.eformsign_doc = this.delegate("eformsign_doc", ["updateMany"]);
    }

    // ------------------------------------------------------------------ test-facing API

    /** A new store holding a deep copy of the current rows (an independent branch of the sequence). */
    clone(): SequenceStore {
        return new SequenceStore({ tables: clone(this.tables) });
    }

    snapshot(): Tables {
        return clone(this.tables);
    }

    /** The live rows of a table. Tests use this to read the persisted state and for documented direct mutations. */
    rows(table: string): Row[] {
        const rows = this.tables[table];
        if (!rows) fail(`unmodelled table "${table}"`);
        return rows;
    }

    /** The single live row matching `where`; throws unless exactly one matches. */
    one(table: string, where: Row): Row {
        const found = this.rows(table).filter((row) => matchesWhere(row, where));
        if (found.length !== 1) fail(`expected exactly one ${table} row for ${JSON.stringify(where)}, found ${found.length}`);
        return found[0]!;
    }

    /** Inserts a fully formed row (test seeding / simulated submissions), completing column defaults. */
    insert(table: string, row: Row): Row {
        const complete = this.complete(table, row);
        this.assertUnique(table, complete);
        this.rows(table).push(complete);
        return complete;
    }

    mark(): number {
        return this.log.length;
    }

    writesSince(mark: number): WriteLogEntry[] {
        return this.log.slice(mark).map((entry) => clone(entry));
    }

    /** The next call of `method` on `table` throws `error` before it changes anything. */
    injectFailure(table: string, method: Method, error: Error): void {
        this.failures.push({ table, method, error });
    }

    async $transaction<T>(
        callback: (tx: SequenceStore) => Promise<T>,
        options?: Record<string, unknown>,
    ): Promise<T> {
        if (typeof callback !== "function") fail("only the interactive $transaction(callback) form is supported");
        for (const key of Object.keys(options ?? {})) {
            if (key !== "isolationLevel") fail(`unsupported $transaction option "${key}"`);
        }
        if (this.inTransaction) fail("nested $transaction");
        const before = clone(this.tables);
        this.inTransaction = true;
        try {
            return await callback(this);
        } catch (error) {
            this.tables = before;
            throw error;
        } finally {
            this.inTransaction = false;
        }
    }

    // ------------------------------------------------------------------ implementation

    private complete(table: string, input: Row): Row {
        const columns = COLUMNS[table];
        if (!columns) fail(`unmodelled table "${table}"`);
        for (const key of Object.keys(input)) {
            if (!(key in columns)) fail(`unknown column ${table}.${key}`);
        }
        const row: Row = {};
        for (const [column, makeDefault] of Object.entries(columns)) {
            row[column] = column in input && input[column] !== undefined ? clone(input[column]) : makeDefault();
        }
        return row;
    }

    private delegate<M extends Method>(table: string, methods: readonly M[]): Delegate<M> {
        const delegate: Partial<Record<Method, (args?: Row) => Promise<unknown>>> = {};
        for (const method of methods) {
            delegate[method] = async (args: Row = {}) => this.call(table, method, args);
        }
        return delegate as Delegate<M>;
    }

    private async call(table: string, method: Method, args: Row): Promise<unknown> {
        for (const key of Object.keys(args)) {
            if (!ALLOWED_ARGS[method].has(key)) fail(`${table}.${method}: unsupported argument "${key}"`);
        }
        // The whole request shape is checked before any row is matched or any injected failure is consumed.
        this.assertRequest(table, method, args);
        const injected = this.failures.findIndex((entry) => entry.table === table && entry.method === method);
        if (injected >= 0) {
            const error = this.failures.splice(injected, 1)[0]!.error;
            this.log.push({ table, method: method as WriteLogEntry["method"], where: clone(args["where"]), data: clone(args["data"]), count: 0, failed: true });
            throw error;
        }
        switch (method) {
            case "findMany": return this.matching(table, args).map((row) => this.project(table, row, args));
            case "findFirst": {
                const row = this.matching(table, args)[0];
                return row ? this.project(table, row, args) : null;
            }
            case "findUnique": {
                const row = this.matching(table, args)[0];
                return row ? this.project(table, row, args) : null;
            }
            case "create": return this.create(table, args);
            case "update": return this.update(table, args);
            case "updateMany": return this.updateMany(table, args);
            case "upsert": return this.upsert(table, args);
        }
    }

    // ------------------------------------------------------------------ request validation (shape only, no rows)

    private assertRequest(table: string, method: Method, args: Row): void {
        const label = `${table}.${method}`;
        const require = (key: string): void => {
            if (args[key] === undefined) fail(`${label}: "${key}" is required`);
        };
        if (method === "findUnique" || method === "update" || method === "upsert") {
            require("where");
            this.assertUniqueWhere(table, method, args["where"]);
        }
        if (method === "create" || method === "update" || method === "updateMany") require("data");
        if (method === "upsert") {
            require("create");
            require("update");
        }
        this.assertWhere(table, args["where"]);
        if (args["orderBy"] !== undefined) this.parseOrderBy(table, args["orderBy"]);
        if (method === "create" || method === "update" || method === "updateMany") this.assertData(table, args["data"]);
        if (method === "upsert") {
            this.assertData(table, args["create"]);
            this.assertData(table, args["update"]);
        }
        this.assertSelection(table, args as { select?: unknown; include?: unknown });
    }

    /** Field names, operators and operand shapes of a `where`, whether or not any row would reach them. */
    private assertWhere(table: string, where: unknown): void {
        if (where === undefined) return;
        if (!isPlainObject(where)) fail(`${table}: where must be an object`);
        const columns = COLUMNS[table]!;
        for (const [key, value] of Object.entries(where)) {
            if (key === "AND" || key === "OR" || key === "NOT") {
                for (const clause of Array.isArray(value) ? value : [value]) this.assertWhere(table, clause);
                continue;
            }
            if (!(key in columns)) fail(`${table}: unsupported where field "${key}"`);
            this.assertFilter(`${table}.${key}`, KINDS[table]![key]!, value);
        }
    }

    /**
     * One field's filter, the way Prisma's generated types accept it: a literal of the column's kind, null, or an
     * object of supported operators over literals (literal lists for in / notIn). `not` takes a literal, null or a
     * nested operator object, checked by these same rules. A Json column has no modelled filter at all.
     */
    private assertFilter(label: string, kind: Kind, value: unknown): void {
        if (kind === "json") fail(`${label}: a Json column has no modelled filter`);
        if (value === null || isLiteral(kind, value)) return;
        if (!isPlainObject(value)) fail(`${label}: unsupported filter value`);
        for (const [operator, operand] of Object.entries(value)) {
            if (!WHERE_OPERATORS.has(operator) || (kind === "boolean" && !BOOLEAN_OPERATORS.has(operator))) {
                fail(`${label}: unsupported operator "${operator}"`);
            }
            if (LIST_OPERATORS.has(operator)) {
                if (!Array.isArray(operand)) fail(`${label}: operator "${operator}" needs a list`);
                if (!operand.every((item) => isLiteral(kind, item))) fail(`${label}: operator "${operator}" needs a list of ${kind} literals`);
            } else if (operator === "not") {
                this.assertFilter(`${label}.not`, kind, operand);
            } else if (operator === "equals") {
                if (operand !== null && !isLiteral(kind, operand)) fail(`${label}: operator "equals" needs a ${kind} literal or null`);
            } else if (!isLiteral(kind, operand)) {
                fail(`${label}: operator "${operator}" needs a ${kind} literal`);
            }
        }
    }

    /**
     * `findUnique` / `update` / `upsert` accept only a where that names a modelled single-column unique key with a
     * literal value (Prisma's WhereUniqueInput rejects `{ equals }`, null and lists there), and EVERY top-level
     * single-column unique field it supplies must be such a literal: another valid key never excuses an object,
     * list, null or wrong-kind value in a second one. Non-unique fields and nested AND / OR / NOT are ordinary
     * filters, checked by `assertWhere`, and get no unique-selector rule.
     */
    private assertUniqueWhere(table: string, method: Method, where: unknown): void {
        if (!isPlainObject(where)) fail(`${table}.${method}: where must be an object`);
        const keys = UNIQUES[table]!.filter((columns) => columns.length === 1).map(([column]) => column!);
        for (const column of keys) {
            if (where[column] !== undefined && !isLiteral(KINDS[table]![column]!, where[column])) {
                fail(`${table}.${method}: unique key "${column}" must be a ${KINDS[table]![column]} literal, got ${JSON.stringify(where[column])}`);
            }
        }
        if (!keys.some((column) => where[column] !== undefined)) {
            fail(`${table}.${method}: where ${JSON.stringify(where)} names none of the unique keys (${keys.join(", ")}) with a literal value`);
        }
    }

    /**
     * Columns only; a relation key is a nested write the store does not model. A scalar column takes a literal, null
     * or the one atomic operation production issues; a Json column takes any JSON value.
     */
    private assertData(table: string, data: unknown): void {
        if (!isPlainObject(data)) fail(`${table}: data must be an object`);
        const columns = COLUMNS[table]!;
        for (const [column, value] of Object.entries(data)) {
            if (RELATIONS[table]?.[column]) fail(`${table}: nested relation write "${column}" is not modelled`);
            if (!(column in columns)) fail(`${table}: unknown data column "${column}"`);
            const kind = KINDS[table]![column]!;
            if (kind === "json" || value === undefined || value === null || isLiteral(kind, value)) continue;
            const operations = isPlainObject(value) ? Object.keys(value) : [];
            const atomic = kind === "int" && operations.length === 1 && DATA_OPERATIONS.has(operations[0]!)
                && typeof (value as Row)[operations[0]!] === "number" && Number.isInteger((value as Row)[operations[0]!]);
            if (!atomic) fail(`${table}.${column}: unsupported numeric operation or value for a ${kind} column`);
        }
    }

    private assertSelection(table: string, args: { select?: unknown; include?: unknown }): void {
        const { select, include } = args;
        if (select !== undefined && include !== undefined) fail(`${table}: select and include together`);
        if (select !== undefined) {
            if (!isPlainObject(select)) fail(`${table}: select must be an object`);
            for (const [name, value] of Object.entries(select)) {
                if (value === false) continue;
                if (name in COLUMNS[table]!) {
                    if (value !== true) fail(`${table}.${name}: a column select must be true`);
                } else {
                    this.assertRelationArgs(table, name, value);
                }
            }
        }
        if (include !== undefined) {
            if (!isPlainObject(include)) fail(`${table}: include must be an object`);
            for (const [name, value] of Object.entries(include)) {
                if (value !== false) this.assertRelationArgs(table, name, value);
            }
        }
    }

    private assertRelationArgs(table: string, name: string, value: unknown): void {
        const relation = RELATIONS[table]?.[name];
        if (!relation) fail(`${table}: unsupported select/include "${name}"`);
        const nested = value === true ? {} : value;
        if (!isPlainObject(nested)) fail(`${table}.${name}: unsupported relation argument`);
        for (const key of Object.keys(nested)) {
            if (!["where", "orderBy", "select", "include"].includes(key)) {
                fail(`${table}.${name}: unsupported relation argument "${key}"`);
            }
        }
        this.assertWhere(relation.target, nested["where"]);
        if (nested["orderBy"] !== undefined) this.parseOrderBy(relation.target, nested["orderBy"]);
        this.assertSelection(relation.target, nested as { select?: unknown; include?: unknown });
    }

    private parseOrderBy(table: string, orderBy: unknown): Array<{ column: string; direction: "asc" | "desc" }> {
        return (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((entry) => {
            if (!isPlainObject(entry)) fail(`${table}: unsupported orderBy`);
            return Object.entries(entry).map(([column, direction]) => {
                if (!(column in COLUMNS[table]!)) fail(`${table}: orderBy on unknown column "${column}"`);
                if (direction !== "asc" && direction !== "desc") fail(`${table}: unsupported orderBy direction`);
                return { column, direction: direction as "asc" | "desc" };
            });
        });
    }

    /** Throws when `row` would collide with an existing row on a modelled unique key. */
    private assertUnique(table: string, row: Row): void {
        for (const columns of UNIQUES[table]!) {
            if (columns.some((column) => row[column] === null || row[column] === undefined)) continue;
            const clash = this.tables[table]!.some((existing) => existing !== row
                && columns.every((column) => compareValues(existing[column], row[column]) === 0));
            if (clash) fail(`${table}: unique constraint (${columns.join(", ")}) violated`);
        }
    }

    // ------------------------------------------------------------------ evaluation (the request is already valid)

    private matching(table: string, args: Row): Row[] {
        const rows = this.rows(table).filter((row) => matchesWhere(row, args["where"] as Row | undefined));
        const orderBy = args["orderBy"];
        if (orderBy === undefined) return rows;
        const keys = this.parseOrderBy(table, orderBy);
        return [...rows].sort((left, right) => {
            for (const { column, direction } of keys) {
                const l = left[column];
                const r = right[column];
                // PostgreSQL: NULLs sort last ascending, first descending.
                const nullOrder = (l === null ? 1 : 0) - (r === null ? 1 : 0);
                const result = l === null || r === null ? nullOrder : compareValues(l, r);
                if (result !== 0) return direction === "asc" ? result : -result;
            }
            return 0;
        });
    }

    private scalars(table: string, row: Row): Row {
        const out: Row = {};
        for (const column of Object.keys(COLUMNS[table]!)) out[column] = clone(row[column]);
        return out;
    }

    private project(table: string, row: Row, args: { select?: unknown; include?: unknown }): Row {
        const { select, include } = args;
        if (select !== undefined && include !== undefined) fail(`${table}: select and include together`);
        if (select === undefined) {
            const out = this.scalars(table, row);
            if (include !== undefined) {
                if (!isPlainObject(include)) fail(`${table}: include must be an object`);
                for (const [name, value] of Object.entries(include)) {
                    if (value === false) continue;
                    out[name] = this.relation(table, row, name, value);
                }
            }
            return out;
        }
        if (!isPlainObject(select)) fail(`${table}: select must be an object`);
        const out: Row = {};
        for (const [name, value] of Object.entries(select)) {
            if (value === false) continue;
            if (name in COLUMNS[table]!) {
                if (value !== true) fail(`${table}.${name}: a column select must be true`);
                out[name] = clone(row[name]);
            } else {
                out[name] = this.relation(table, row, name, value);
            }
        }
        return out;
    }

    private relation(table: string, row: Row, name: string, value: unknown): unknown {
        const relation = RELATIONS[table]?.[name];
        if (!relation) fail(`${table}: unsupported select/include "${name}"`);
        const nested = value === true ? {} : value;
        if (!isPlainObject(nested)) fail(`${table}.${name}: unsupported relation argument`);
        for (const key of Object.keys(nested)) {
            if (!["where", "orderBy", "select", "include"].includes(key)) {
                fail(`${table}.${name}: unsupported relation argument "${key}"`);
            }
        }
        const related = this.matching(relation.target, {
            where: { AND: [{ [relation.foreign]: row[relation.local] }, ...(nested["where"] ? [nested["where"]] : [])] },
            ...(nested["orderBy"] !== undefined ? { orderBy: nested["orderBy"] } : {}),
        });
        // A null local key matches nothing (the evaluator treats equality with null as "is null").
        const candidates = row[relation.local] === null || row[relation.local] === undefined ? [] : related;
        const projected = candidates.map((candidate) => this.project(relation.target, candidate, nested as Row));
        return relation.many ? projected : (projected[0] ?? null);
    }

    private applyData(table: string, row: Row, data: unknown): void {
        const columns = COLUMNS[table]!;
        for (const [column, value] of Object.entries(data as Row)) {
            if (value === undefined) continue;
            if (value === Prisma.JsonNull || value === Prisma.DbNull) {
                row[column] = null;
            } else if (KINDS[table]![column] !== "json" && isPlainObject(value) && "increment" in value) {
                row[column] = (row[column] as number) + (value["increment"] as number);
            } else {
                row[column] = clone(value);
            }
        }
        if ("updatedAt" in columns) row["updatedAt"] = new Date();
    }

    private record(entry: WriteLogEntry): void {
        this.log.push(clone(entry));
    }

    private create(table: string, args: Row): Row {
        const data = args["data"];
        const row = this.complete(table, {});
        this.applyData(table, row, data);
        this.assertUnique(table, row);
        this.tables[table]!.push(row);
        this.record({ table, method: "create", where: undefined, data, count: 1 });
        return this.project(table, row, args);
    }

    private update(table: string, args: Row): Row {
        const matched = this.matching(table, args)[0];
        if (!matched) fail(`${table}.update: record to update not found for ${JSON.stringify(args["where"])}`);
        this.applyData(table, matched, args["data"]);
        this.record({ table, method: "update", where: args["where"], data: args["data"], count: 1 });
        return this.project(table, matched, args);
    }

    private updateMany(table: string, args: Row): { count: number } {
        const matched = this.matching(table, args);
        for (const row of matched) this.applyData(table, row, args["data"]);
        this.record({ table, method: "updateMany", where: args["where"], data: args["data"], count: matched.length });
        return { count: matched.length };
    }

    private upsert(table: string, args: Row): Row {
        const existing = this.matching(table, args)[0];
        if (existing) {
            this.applyData(table, existing, args["update"]);
            this.record({ table, method: "upsert", where: args["where"], data: args["update"], count: 1 });
            return this.project(table, existing, args);
        }
        const row = this.complete(table, {});
        this.applyData(table, row, args["create"]);
        this.assertUnique(table, row);
        this.tables[table]!.push(row);
        this.record({ table, method: "upsert", where: args["where"], data: args["create"], count: 1 });
        return this.project(table, row, args);
    }
}
