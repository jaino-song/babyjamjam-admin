import type { PrismaClient } from "@prisma/client";

/**
 * Every model the integrity factories create rows in. Cleanup deletes tracked rows
 * in REVERSE registration order, so a spec must register a parent row before any row
 * that references it — which the factories guarantee by taking their parents (branch,
 * user, rule, ...) as explicit arguments instead of creating them behind the caller's
 * back. That ordering matters where a foreign key is Restrict/NoAction (for example
 * `employee_schedule.primary_employee_id` is Restrict, `client.branch_id` is NoAction
 * on delete): the referencing rows are always gone before the referenced row.
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

interface TrackedRow {
    model: TrackedModel;
    id: string | number;
}

/** The one operation cleanup performs; `deleteMany` is deliberately used so an already-deleted row is not an error. */
interface DeleteByIdDelegate {
    deleteMany(args: { where: { id: string | number } }): Promise<{ count: number }>;
}

/**
 * Registers every row a spec creates and removes them FK-safely. `cleanup` never
 * throws because a test already deleted a tracked row itself: `deleteMany` on a
 * missing id deletes nothing and returns `{ count: 0 }`.
 */
export class RowTracker {
    private readonly rows: TrackedRow[] = [];

    /** Rows still registered (created and not yet cleaned up). */
    get size(): number {
        return this.rows.length;
    }

    /** Registers a created row. `null`/`undefined` ids are ignored so callers can pass optional ids straight through. */
    track(model: TrackedModel, id: string | number | null | undefined): void {
        if (id === null || id === undefined) {
            return;
        }
        this.rows.push({ model, id });
    }

    /**
     * Deletes every tracked row, children before parents (reverse registration
     * order). Returns the number of rows actually deleted, which is `size` unless
     * a test deleted some rows itself. Safe to call more than once.
     */
    async cleanup(prisma: PrismaClient): Promise<number> {
        const delegates = prisma as unknown as Record<TrackedModel, DeleteByIdDelegate | undefined>;
        let deleted = 0;
        for (let index = this.rows.length - 1; index >= 0; index -= 1) {
            const row = this.rows[index]!;
            const delegate = delegates[row.model];
            if (!delegate) {
                throw new Error(`RowTracker has no Prisma delegate for model "${row.model}"`);
            }
            const result = await delegate.deleteMany({ where: { id: row.id } });
            deleted += result.count;
        }
        this.rows.length = 0;
        return deleted;
    }
}
