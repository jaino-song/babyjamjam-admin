import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { createBranch, createUser } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

import type { IntegrityPrisma } from "../helpers/real-db";

/**
 * Release-1 expand step of the branch owner -> admin rename: trigger
 * `branch_sync_admin_owner` keeps the legacy `owner_id` column (still written by code that
 * has not been redeployed yet) and the new `admin_id` column in lockstep. Application code
 * never touches `owner_id`, so the legacy side is exercised with raw SQL only.
 */
describeReal("branch admin_id / owner_id sync trigger (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    beforeAll(async () => { handle = await createIntegrityPrisma(); });
    beforeEach(() => { tracker = new RowTracker(); });
    afterEach(async () => { await tracker.cleanup(handle.raw); });
    afterAll(async () => { if (handle) await closeIntegrityPrisma(handle); });

    async function columns(branchId: string): Promise<{ admin_id: string | null; owner_id: string | null }> {
        const rows = await handle.raw.$queryRaw<Array<{ admin_id: string | null; owner_id: string | null }>>(
            Prisma.sql`SELECT "admin_id", "owner_id" FROM "branch" WHERE "id" = ${branchId}::uuid`,
        );
        return rows[0]!;
    }

    const newUser = () => createUser(handle.raw, tracker, {});

    invariant("SI-USER-14", "writing only owner_id (old code) mirrors into admin_id on update", async () => {
        const target = await newUser();
        const branch = await createBranch(handle.raw, tracker);

        await handle.raw.$executeRaw`UPDATE "branch" SET "owner_id" = ${target.id}::uuid WHERE "id" = ${branch.id}::uuid`;

        expect(await columns(branch.id)).toEqual({ admin_id: target.id, owner_id: target.id });
    });

    invariant("SI-USER-14", "inserting only owner_id (old code) fills admin_id", async () => {
        const target = await newUser();
        const id = randomUUID();

        await handle.raw.$executeRaw`
            INSERT INTO "branch" ("id", "name", "slug", "owner_id")
            VALUES (${id}::uuid, ${`무결성 트리거 ${id}`}, ${`throwaway-si-trigger-${id}`}, ${target.id}::uuid)
        `;
        tracker.track("branch", id);

        expect(await columns(id)).toEqual({ admin_id: target.id, owner_id: target.id });
    });

    invariant("SI-USER-14", "writing admin_id through Prisma (new code) mirrors into owner_id", async () => {
        const target = await newUser();
        const created = await createBranch(handle.raw, tracker, { adminId: target.id });
        expect(await columns(created.id)).toEqual({ admin_id: target.id, owner_id: target.id });

        const other = await newUser();
        await handle.raw.branch.update({ where: { id: created.id }, data: { adminId: other.id } });
        expect(await columns(created.id)).toEqual({ admin_id: other.id, owner_id: other.id });
    });

    invariant("SI-USER-14", "clearing either column mirrors the null into the other", async () => {
        const target = await newUser();
        const branch = await createBranch(handle.raw, tracker, { adminId: target.id });

        await handle.raw.$executeRaw`UPDATE "branch" SET "owner_id" = NULL WHERE "id" = ${branch.id}::uuid`;
        expect(await columns(branch.id)).toEqual({ admin_id: null, owner_id: null });

        await handle.raw.branch.update({ where: { id: branch.id }, data: { adminId: target.id } });
        await handle.raw.branch.update({ where: { id: branch.id }, data: { adminId: null } });
        expect(await columns(branch.id)).toEqual({ admin_id: null, owner_id: null });
    });

    invariant("SI-USER-14", "a write that sets the two columns to different users raises and changes nothing", async () => {
        const first = await newUser();
        const second = await newUser();
        const third = await newUser();
        const branch = await createBranch(handle.raw, tracker, { adminId: first.id });

        // Both columns change in the same statement and disagree: old and new code raced.
        await expect(handle.raw.$executeRaw`
            UPDATE "branch" SET "admin_id" = ${second.id}::uuid, "owner_id" = ${third.id}::uuid
            WHERE "id" = ${branch.id}::uuid
        `).rejects.toThrow(/must match/);
        expect(await columns(branch.id)).toEqual({ admin_id: first.id, owner_id: first.id });

        // Writing both columns to the SAME user is not a conflict.
        await handle.raw.$executeRaw`
            UPDATE "branch" SET "admin_id" = ${second.id}::uuid, "owner_id" = ${second.id}::uuid
            WHERE "id" = ${branch.id}::uuid
        `;
        expect(await columns(branch.id)).toEqual({ admin_id: second.id, owner_id: second.id });

        const id = randomUUID();
        await expect(handle.raw.$executeRaw`
            INSERT INTO "branch" ("id", "name", "slug", "admin_id", "owner_id")
            VALUES (${id}::uuid, 'conflict', ${`throwaway-si-conflict-${id}`}, ${first.id}::uuid, ${second.id}::uuid)
        `).rejects.toThrow(/must match/);
    });

    invariant("SI-USER-14", "an owner_id written by old code still has to name a real user (the admin_id foreign key)", async () => {
        const branch = await createBranch(handle.raw, tracker);

        await expect(handle.raw.$executeRaw`
            UPDATE "branch" SET "owner_id" = 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid WHERE "id" = ${branch.id}::uuid
        `).rejects.toThrow(/branch_admin_id_fkey/);
        expect(await columns(branch.id)).toEqual({ admin_id: null, owner_id: null });
    });
});
