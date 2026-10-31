import type { PrismaClient } from "@prisma/client";

/**
 * Every model the integrity factories create rows in.
 */
export type TrackedModel =
    | "auth_refresh_token"
    | "auth_session"
    | "branch"
    | "client"
    | "eformsign_doc"
    | "employee"
    | "employee_schedule"
    | "message_log"
    | "message_trigger_job"
    | "message_trigger_rule"
    | "user"
    | "user_branch";

/**
 * Untracked models whose app-created child rows cleanup sweeps before it
 * deletes the tracked parents. A service under test can create rows here for
 * tracked parents; without the sweep their Restrict/NoAction foreign keys
 * would keep the tracked parents alive. Derived from the FK graph in
 * `prisma/schema.prisma`.
 */
type SweepModel =
    | "call_record"
    | "client_draft"
    | "eformsign_dispatch_intent"
    | "eformsign_doc_file"
    | "eformsign_document_job"
    | "end_date_review_item"
    | "message_log"
    | "message_trigger_job"
    | "notification"
    | "schedule_change_request"
    | "service_record"
    | "service_record_assignment"
    | "service_record_case"
    | "service_record_day"
    | "service_record_day_edit_log"
    | "service_record_edit_draft"
    | "service_record_revision_document_state";

/**
 * Fixed cleanup rank per tracked model — LOWER RUNS FIRST (children before
 * parents), derived from the FK graph in `prisma/schema.prisma`. Do not
 * reorder without re-deriving. The pairs that force this order:
 *
 * - group 1: `auth_refresh_token.session_id` → auth_session (Cascade);
 *   `auth_session.user_id` → user (Cascade), `.selected_branch_id` → branch
 *   (SetNull); `user_branch` → branch/user (Cascade).
 * - group 2: `message_log.branch_id` → branch (NoAction!), client/trigger job
 *   (SetNull); `message_trigger_job` → rule (Cascade), branch (NoAction!);
 *   `message_trigger_rule.branch_id` → branch (NoAction!).
 * - group 3: `eformsign_doc.branch_id` → branch (NoAction!), client/schedule
 *   (SetNull) and `client.e_doc_id` → eformsign_doc (SetNull); employee_schedule
 *   → client (Cascade), branch (NoAction!), primary employee (Restrict!).
 * - group 4 (in this exact order): employee → branch (NoAction!), client →
 *   branch (NoAction!), branch.owner_id → user (NoAction!), user (leaf).
 */
const MODEL_RANK: Record<TrackedModel, number> = {
    auth_refresh_token: 0,
    auth_session: 1,
    user_branch: 2,
    message_log: 10,
    message_trigger_job: 11,
    message_trigger_rule: 12,
    eformsign_doc: 20,
    employee_schedule: 21,
    employee: 30,
    client: 31,
    branch: 32,
    user: 33,
};

interface SweepFilter {
    column: string;
    trackedModel: TrackedModel;
}

interface SweepStep {
    model: SweepModel;
    filters: SweepFilter[];
}

/**
 * Sweep steps, in FK-safe order derived from `prisma/schema.prisma` (children
 * before parents among the swept models: `client_draft` before `call_record`,
 * assignment/day/record and the revision-adjacent rows before
 * `service_record_case`). Each step deletes the rows that reference ANY tracked
 * parent (OR of the `in` filters) and runs before the ranked tracked deletes.
 *
 * `admin_audit_event` is deliberately absent: it has no FK constraints at all
 * (so it cannot keep a parent alive) and an append-only trigger (migration
 * `20260828150000_add_admin_audit_events`) raises on every DELETE, so there is
 * nothing to sweep and no way to sweep it. Its rows simply stay behind until
 * the runner drops the throwaway database.
 */
const SWEEP_STEPS: SweepStep[] = [
    { model: "eformsign_doc_file", filters: [{ column: "eformsignDocId", trackedModel: "eformsign_doc" }] },
    {
        model: "client_draft",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "clientId", trackedModel: "client" }],
    },
    {
        model: "call_record",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "matchedClientId", trackedModel: "client" }],
    },
    {
        model: "end_date_review_item",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "clientId", trackedModel: "client" }],
    },
    {
        model: "schedule_change_request",
        filters: [
            { column: "branchId", trackedModel: "branch" },
            { column: "clientId", trackedModel: "client" },
            { column: "scheduleId", trackedModel: "employee_schedule" },
        ],
    },
    { model: "service_record_assignment", filters: [{ column: "branchId", trackedModel: "branch" }] },
    { model: "service_record_day", filters: [{ column: "branchId", trackedModel: "branch" }] },
    { model: "service_record", filters: [{ column: "branchId", trackedModel: "branch" }] },
    // Revision-adjacent rows, all NoAction-FK children of tracked parents (and
    // of swept cases) — none has a DELETE trigger (migrations 20260908000000 /
    // 20260908030000 / 20261028000000: only `edit_draft` UPDATE is
    // trigger-guarded), so sweeping them is unconditional. Each must run
    // before the `service_record_case` sweep and the ranked client/branch
    // deletes or its NoAction FKs keep those parents alive.
    {
        model: "service_record_revision_document_state",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "clientId", trackedModel: "client" }],
    },
    { model: "service_record_edit_draft", filters: [{ column: "branchId", trackedModel: "branch" }] },
    { model: "service_record_day_edit_log", filters: [{ column: "branchId", trackedModel: "branch" }] },
    {
        model: "service_record_case",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "clientId", trackedModel: "client" }],
    },
    {
        model: "eformsign_document_job",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "clientId", trackedModel: "client" }],
    },
    { model: "eformsign_dispatch_intent", filters: [{ column: "branchId", trackedModel: "branch" }] },
    { model: "notification", filters: [{ column: "branchId", trackedModel: "branch" }] },
    {
        model: "message_log",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "clientId", trackedModel: "client" }],
    },
    {
        model: "message_trigger_job",
        filters: [{ column: "branchId", trackedModel: "branch" }, { column: "clientId", trackedModel: "client" }],
    },
];

/** Why a row was left behind: an append-only `service_record_revision` row pins it. */
const REVISION_PIN_REASON =
    "pinned by an append-only service_record_revision row (trigger service_record_revision_append_only, " +
    "migration 20260908000000, blocks UPDATE and DELETE)";

interface TrackedRow {
    model: TrackedModel;
    id: string | number;
    /** Registration index — with the same MODEL_RANK, later registration deletes first. */
    order: number;
}

/** A row cleanup intentionally left behind because an append-only table pins it. */
export interface LeakedRow {
    model: string;
    id: string | number;
    reason: string;
}

export interface CleanupResult {
    /** Number of rows actually deleted (swept app rows + tracked rows). */
    deleted: number;
    /**
     * Tracked rows that could not be deleted because an append-only
     * `service_record_revision` row still references them (their FK actions are
     * NoAction and the trigger blocks removing the revision). Never causes a
     * throw — the runner drops the whole throwaway database afterwards.
     */
    leaked: LeakedRow[];
}

/**
 * The one operation cleanup performs per tracked row; `deleteMany` is
 * deliberately used so an already-deleted row is not an error.
 */
interface SweepDelegate {
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
    findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<Array<Record<string, unknown>>>;
}

/**
 * Registers every row a spec creates and removes them FK-safely. `cleanup` never
 * throws because a test already deleted a tracked row itself: `deleteMany` on a
 * missing id deletes nothing and returns `{ count: 0 }`.
 */
export class RowTracker {
    private readonly rows: TrackedRow[] = [];
    private nextOrder = 0;

    /** Rows still registered (created and not yet cleaned up). */
    get size(): number {
        return this.rows.length;
    }

    /** Registers a created row. `null`/`undefined` ids are ignored so callers can pass optional ids straight through. */
    track(model: TrackedModel, id: string | number | null | undefined): void {
        if (id === null || id === undefined) {
            return;
        }
        this.rows.push({ model, id, order: this.nextOrder });
        this.nextOrder += 1;
    }

    /**
     * FK-safe cleanup, in two phases:
     *
     * 1. **App-row sweep.** Deletes untracked child rows (rows a service under
     *    test created in models the factories don't cover) that reference any
     *    tracked parent, in {@link SWEEP_STEPS} order. Without this those rows'
     *    Restrict/NoAction foreign keys keep the tracked parents alive.
     * 2. **Ranked tracked deletes.** Deletes tracked rows by {@link MODEL_RANK}
     *    — children before parents — keeping reverse registration order within
     *    one model. Because the rank is fixed, a foreign key set AFTER
     *    registration (e.g. `branch.owner_id`, `employee_schedule.primary_employee_id`)
     *    is still deleted safely; registration order only breaks ties within
     *    one model.
     *
     * One failing delete never aborts the rest: every delete runs, `rows` is
     * cleared, and one `AggregateError` listing every failure is thrown.
     * Rows pinned by an append-only `service_record_revision` row cannot be
     * deleted at all (NoAction FK + a trigger blocking DELETE); they are
     * reported in `leaked` (and `console.warn`-ed) instead of failing cleanup —
     * the runner drops the whole throwaway database afterwards. Safe to call
     * more than once.
     */
    async cleanup(prisma: PrismaClient): Promise<CleanupResult> {
        const delegates = prisma as unknown as Record<string, SweepDelegate | undefined>;
        const leaked: LeakedRow[] = [];
        const failures: Error[] = [];

        const idsByModel = this.idsByModel();
        const pinnedBranchIds = await this.revisionPinnedBranchIds(delegates, idsByModel.get("branch") ?? []);
        const sweptFromSweep = await this.runSweep(delegates, idsByModel, leaked, failures);

        let deletedTracked = 0;
        const rankedRows = [...this.rows].sort((a, b) => {
            const rankDiff = MODEL_RANK[a.model] - MODEL_RANK[b.model];
            return rankDiff !== 0 ? rankDiff : b.order - a.order;
        });
        for (const row of rankedRows) {
            if (row.model === "branch" && pinnedBranchIds.has(row.id)) {
                leaked.push({ model: row.model, id: row.id, reason: REVISION_PIN_REASON });
                continue;
            }
            const delegate = delegates[row.model];
            if (!delegate) {
                throw new Error(`RowTracker has no Prisma delegate for model "${row.model}"`);
            }
            try {
                const result = await delegate.deleteMany({ where: { id: row.id } });
                deletedTracked += result.count;
            } catch (error) {
                failures.push(this.describeFailure(row.model, row.id, error));
            }
        }

        this.rows.length = 0;
        if (failures.length > 0) {
            throw new AggregateError(
                failures,
                `RowTracker cleanup: ${failures.length} delete(s) failed: ${failures.map((failure) => failure.message).join("; ")}`,
            );
        }
        if (leaked.length > 0) {
            console.warn(
                `[RowTracker] ${leaked.length} row(s) intentionally left behind (append-only service_record_revision pins their parents; ` +
                    `the runner drops the throwaway database): ${leaked.map((row) => `${row.model}#${row.id}`).join(", ")}`,
            );
        }
        return { deleted: sweptFromSweep + deletedTracked, leaked };
    }

    private idsByModel(): Map<TrackedModel, Array<string | number>> {
        const idsByModel = new Map<TrackedModel, Array<string | number>>();
        for (const row of this.rows) {
            const ids = idsByModel.get(row.model) ?? [];
            ids.push(row.id);
            idsByModel.set(row.model, ids);
        }
        return idsByModel;
    }

    private async runSweep(
        delegates: Record<string, SweepDelegate | undefined>,
        idsByModel: Map<TrackedModel, Array<string | number>>,
        leaked: LeakedRow[],
        failures: Error[],
    ): Promise<number> {
        let deleted = 0;
        for (const step of SWEEP_STEPS) {
            const orFilters: Array<Record<string, unknown>> = [];
            for (const filter of step.filters) {
                const ids = idsByModel.get(filter.trackedModel) ?? [];
                if (ids.length > 0) {
                    orFilters.push({ [filter.column]: { in: ids } });
                }
            }
            if (orFilters.length === 0) {
                continue;
            }
            const delegate = delegates[step.model];
            if (!delegate) {
                throw new Error(`RowTracker has no Prisma delegate for model "${step.model}"`);
            }
            try {
                if (step.model === "service_record_case") {
                    deleted += await this.sweepServiceRecordCases(delegates, delegate, orFilters, leaked);
                } else {
                    const result = await delegate.deleteMany({ where: { OR: orFilters } });
                    deleted += result.count;
                }
            } catch (error) {
                failures.push(this.describeFailure(step.model, "(sweep)", error));
            }
        }
        return deleted;
    }

    /**
     * Sweeps untracked `service_record_case` rows, excluding the ones an
     * append-only `service_record_revision` still references — those cases can
     * never be deleted and are reported as leaked instead.
     */
    private async sweepServiceRecordCases(
        delegates: Record<string, SweepDelegate | undefined>,
        delegate: SweepDelegate,
        orFilters: Array<Record<string, unknown>>,
        leaked: LeakedRow[],
    ): Promise<number> {
        const candidates = await delegate.findMany({ where: { OR: orFilters }, select: { id: true } });
        const candidateIds = candidates.map((candidate) => candidate["id"] as string | number);
        if (candidateIds.length === 0) {
            return 0;
        }
        const pinnedIds = await this.revisionPinnedCaseIds(delegates, candidateIds);
        const deletableIds = candidateIds.filter((id) => !pinnedIds.has(id));
        let deleted = 0;
        if (deletableIds.length > 0) {
            const result = await delegate.deleteMany({ where: { id: { in: deletableIds } } });
            deleted += result.count;
        }
        for (const id of pinnedIds) {
            leaked.push({ model: "service_record_case", id, reason: REVISION_PIN_REASON });
        }
        return deleted;
    }

    /** Tracked branches an append-only `service_record_revision` still references (`branch_id` FK is NoAction). */
    private async revisionPinnedBranchIds(
        delegates: Record<string, SweepDelegate | undefined>,
        branchIds: Array<string | number>,
    ): Promise<Set<string | number>> {
        if (branchIds.length === 0) {
            return new Set();
        }
        const revisionDelegate = this.revisionDelegate(delegates);
        const pinned = await revisionDelegate.findMany(
            { where: { branchId: { in: branchIds } }, select: { branchId: true } },
        );
        return new Set(pinned.map((row) => row["branchId"] as string | number));
    }

    private async revisionPinnedCaseIds(
        delegates: Record<string, SweepDelegate | undefined>,
        caseIds: Array<string | number>,
    ): Promise<Set<string | number>> {
        if (caseIds.length === 0) {
            return new Set();
        }
        const revisionDelegate = this.revisionDelegate(delegates);
        const pinned = await revisionDelegate.findMany(
            { where: { serviceRecordCaseId: { in: caseIds } }, select: { serviceRecordCaseId: true } },
        );
        return new Set(pinned.map((row) => row["serviceRecordCaseId"] as string | number));
    }

    private revisionDelegate(delegates: Record<string, SweepDelegate | undefined>): SweepDelegate {
        const delegate = delegates["service_record_revision"];
        if (!delegate) {
            throw new Error('RowTracker has no Prisma delegate for model "service_record_revision"');
        }
        return delegate;
    }

    private describeFailure(model: string, id: string | number, error: unknown): Error {
        const message = error instanceof Error ? error.message : String(error);
        return new Error(`delete ${model}#${id} failed: ${message}`);
    }
}
