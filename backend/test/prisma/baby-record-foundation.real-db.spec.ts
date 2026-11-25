import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FetalConfirmation, FetalType, Prisma, PrismaClient } from "@prisma/client";

import { assertThrowawayTarget, describeReal } from "../integrity/helpers/real-db";

const PRISMA = resolve(__dirname, "../../prisma");
const MIGRATION = "migrations/20261126000000_baby_record_foundation/migration.sql";
const BACKFILL = "scripts/backfill-baby-record-foundation.sql";
const COUNTS = "scripts/verify-baby-record-foundation.sql";
const REVERSAL = "scripts/rollback-baby-record-foundation.sql";
const ROLLBACK_FIXTURES = new Error("Roll back the synthetic baby-record fixtures");
const SERVICE_DATE = new Date("2026-11-25T00:00:00Z");
const FETAL_LABELS = {
    SINGLETON: "단태아",
    SEVERE_SINGLETON: "중증 단태아",
    TWINS: "쌍생아",
    SEVERE_TWINS: "중증 쌍태아",
    TRIPLETS: "삼태아",
    SEVERE_TRIPLETS_PLUS: "중증 삼태아 이상",
    QUADRUPLETS_PLUS: "사태아 이상",
};
const PROVIDER_LABELS = {
    0: "주 제공인력",
    1: "보조 제공인력 1",
    2: "보조 제공인력 2",
    3: "보조 제공인력 3",
};
const NEW_TABLES = [
    "client_baby", "service_record_team_slot", "service_record_baby_assignment", "service_record_job_member",
];

function readSql(file: string) {
    return readFileSync(resolve(PRISMA, file), "utf8").trim();
}

function executeSql(sql: string) {
    assertThrowawayTarget();
    const url = process.env["DATABASE_URL"] as string;
    return spawnSync("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
        input: sql, encoding: "utf8", timeout: 25_000,
    });
}

function runSql(sql: string): string {
    const result = executeSql(sql);
    expect(result.error).toBeUndefined();
    expect({ exit: result.status, errors: result.status ? result.stderr : "" }).toEqual({ exit: 0, errors: "" });
    return result.stdout.trim();
}

describeReal("baby record foundation (executed on PostgreSQL)", () => {
    let db: PrismaClient;

    beforeAll(() => {
        assertThrowawayTarget();
        db = new PrismaClient({ datasourceUrl: process.env["DATABASE_URL"] });
    });

    afterAll(async () => db?.$disconnect());

    async function withFixtures(test: (tx: Prisma.TransactionClient) => Promise<void>) {
        await expect(db.$transaction(async (tx) => {
            await test(tx);
            throw ROLLBACK_FIXTURES;
        }, { timeout: 20_000 })).rejects.toBe(ROLLBACK_FIXTURES);
    }

    // Keep negative statements isolated so all checks run against the same real rows.
    async function rejectSql(tx: Prisma.TransactionClient, sql: Prisma.Sql, code: string, constraint?: string) {
        await tx.$executeRaw`SAVEPOINT invalid_record_relation`;
        await expect(tx.$executeRaw(sql)).rejects.toMatchObject({
            code: "P2010",
            meta: { code, ...(constraint && { message: expect.stringContaining(constraint) }) },
        });
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_record_relation`;
        await tx.$executeRaw`RELEASE SAVEPOINT invalid_record_relation`;
    }

    it("reruns the actual DDL twice and retains vocabulary, RLS and restrictive ownership keys", async () => {
        const migration = readSql(MIGRATION);
        runSql(`${migration}\n${migration}`);
        const enums = await db.$queryRaw<Array<{ type: string; values: string[] }>>`
            SELECT t.typname::text AS type, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
            FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.oid IN ('public.client_fetal_type'::regtype, 'public.client_fetal_confirmation'::regtype)
            GROUP BY t.typname ORDER BY type
        `;
        expect(enums).toEqual([
            { type: "client_fetal_confirmation", values: ["UNCONFIRMED", "CONFIRMED"] },
            { type: "client_fetal_type", values: Object.keys(FETAL_LABELS) },
        ]);
        expect(FetalType).toEqual(Object.fromEntries(Object.keys(FETAL_LABELS).map((code) => [code, code])));
        expect(FetalConfirmation).toEqual({ UNCONFIRMED: "UNCONFIRMED", CONFIRMED: "CONFIRMED" });

        const acl = await db.$queryRaw<Array<{ name: string; rls: boolean; exposed: boolean }>>`
            SELECT c.relname::text AS name, c.relrowsecurity AS rls,
                EXISTS (
                    SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                    WHERE a.grantee = 0
                ) OR EXISTS (
                    SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                      AND has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                ) AS exposed
            FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
              AND c.relname::text IN (${Prisma.join(NEW_TABLES)}) ORDER BY c.relname
        `;
        expect(acl).toEqual([...NEW_TABLES].sort().map((name) => ({ name, rls: true, exposed: false })));
        const fks = await db.$queryRaw<Array<{ name: string; deleteAction: string; updateAction: string }>>`
            SELECT conname::text AS name, confdeltype::text AS "deleteAction", confupdtype::text AS "updateAction"
            FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace AND contype = 'f'
              AND (conrelid IN (
                'public.client_baby'::regclass, 'public.service_record_team_slot'::regclass,
                'public.service_record_baby_assignment'::regclass, 'public.service_record_job_member'::regclass
              ) OR conname IN ('fk_record_case_baby', 'fk_record_job_recipient'))
            ORDER BY conname
        `;
        expect(fks).toEqual([
            "fk_client_baby_owner", "fk_record_assignment_active_baby", "fk_record_assignment_active_slot",
            "fk_record_assignment_baby", "fk_record_assignment_employee", "fk_record_assignment_schedule",
            "fk_record_assignment_slot", "fk_record_case_baby", "fk_record_job_recipient",
            "fk_record_member_assignment", "fk_record_member_case", "fk_record_member_job",
            "fk_record_slot_client", "fk_record_slot_employee", "fk_record_slot_schedule",
        ].map((name) => ({ name, deleteAction: "r", updateAction: "a" })));
    });

    const legacyFixture = `
            INSERT INTO branch (name, slug) VALUES ('QA Foundation', 'baby-foundation-replay') RETURNING id AS branch_id \\gset
            INSERT INTO branch (name, slug) VALUES ('QA Other', 'baby-foundation-replay-other') RETURNING id AS other_branch_id \\gset
            INSERT INTO client (name, voucher_client, type, branch_id)
            VALUES ('QA Proven A', true, 'A통합-①형', :'branch_id') RETURNING id AS proven_id \\gset
            INSERT INTO client (name, voucher_client, type, branch_id)
            VALUES ('QA Ambiguous B', true, 'B가-②형', :'branch_id') RETURNING id AS ambiguous_id \\gset
            INSERT INTO client (name, voucher_client, type, branch_id)
            VALUES ('QA Ambiguous C', true, 'C통합1형', :'branch_id'),
                   ('QA Ambiguous D', true, 'D라-2형', :'branch_id');
            INSERT INTO client (name, voucher_client, type, branch_id)
            VALUES ('QA Incomplete A', true, 'A라2형', :'branch_id') RETURNING id AS incomplete_id \\gset
            INSERT INTO client (name, voucher_client, type)
            VALUES ('QA Null Branch A', true, 'A라2형') RETURNING id AS null_branch_id \\gset
            INSERT INTO client (name, voucher_client, type, branch_id)
            VALUES ('QA Deleted Legacy A', true, 'A라3형', :'other_branch_id') RETURNING id AS delete_id \\gset
            INSERT INTO employee (name, work_area, phone, grade, branch_id) VALUES
                ('QA Primary', '{}', 'synthetic-primary', 'QA', :'branch_id') RETURNING id AS primary_id \\gset
            INSERT INTO employee (name, work_area, phone, grade, branch_id) VALUES
                ('QA Assistant', '{}', 'synthetic-assistant', 'QA', :'branch_id') RETURNING id AS assistant_id \\gset
            INSERT INTO employee (name, work_area, phone, grade, branch_id) VALUES
                ('QA Foreign Staff', '{}', 'synthetic-foreign', 'QA', :'other_branch_id') RETURNING id AS foreign_id \\gset
            INSERT INTO employee_schedule (client_id, branch_id, primary_employee_id, work_address, start_date, end_date)
            VALUES (:proven_id, :'branch_id', :primary_id, 'QA', '2026-11-25', '2026-11-25') RETURNING id AS schedule_id \\gset
            INSERT INTO employee_schedule (
                client_id, branch_id, primary_employee_id, secondary_employee_id, work_address, start_date, end_date
            ) VALUES
                (:ambiguous_id, :'branch_id', :primary_id, :assistant_id, 'QA', '2026-11-25', '2026-11-25'),
                (:incomplete_id, :'branch_id', :primary_id, :foreign_id, 'QA', '2026-11-25', '2026-11-25'),
                (:null_branch_id, NULL, :primary_id, NULL, 'QA', '2026-11-25', '2026-11-25');
            INSERT INTO service_record_case (client_id, branch_id, updated_at)
            VALUES (:proven_id, :'branch_id', now()) RETURNING id AS case_id \\gset
            INSERT INTO service_record_case (client_id, branch_id, updated_at) VALUES
                (:ambiguous_id, :'branch_id', now()),
                (:incomplete_id, :'branch_id', now()),
                (:null_branch_id, :'branch_id', now()),
                (:delete_id, :'other_branch_id', now());
            INSERT INTO service_record_case (client_id, branch_id, updated_at)
            SELECT id, branch_id, now() FROM client WHERE branch_id = :'branch_id'
                AND name IN ('QA Ambiguous C', 'QA Ambiguous D');
            -- Legacy SET NULL still works for an unlinked legacy case.
            DELETE FROM client WHERE id = :delete_id;
            INSERT INTO service_record_assignment (
                branch_id, service_record_case_id, schedule_id, employee_id, employee_name_snapshot, start_date, end_date, updated_at
            ) VALUES (:'branch_id', :'case_id', :schedule_id, :primary_id, 'QA Primary', '2026-11-25', '2026-11-25', now());
            INSERT INTO service_record_token (
                branch_id, service_record_case_id, schedule_id, employee_id, link_token_hash, expected_phone_hash, expires_at, active
            ) VALUES
                (:'branch_id', :'case_id', :schedule_id, :primary_id, 'synthetic-linked-hash', 'synthetic-hash', now(), true),
                (:'branch_id', NULL, :schedule_id, :primary_id, 'synthetic-unlinked-hash', 'synthetic-hash', now(), false);
            INSERT INTO service_record_day (
                branch_id, service_record_case_id, schedule_id, employee_id, case_session_index, session_index, service_date, client_signature, updated_at
            ) VALUES
                (:'branch_id', :'case_id', :schedule_id, :primary_id, 1, 1, '2026-11-25', 'synthetic-signature', now()),
                (:'branch_id', NULL, :schedule_id, :primary_id, NULL, 2, '2026-11-25', NULL, now()),
                (:'branch_id', (SELECT id FROM service_record_case WHERE client_id = :incomplete_id),
                    :schedule_id, :primary_id, 3, 3, '2026-11-25', NULL, now());
            INSERT INTO eformsign_doc (
                document_id, document_kind, branch_id, client_id, employee_schedule_id, service_record_case_id,
                created_date, updated_date, expired_date, status_type, status_detail, step_type,
                step_index, step_name, step_recipient_type, step_recipient_name, step_recipient_sms
            ) VALUES ('qa-record-doc', 'service_record_snapshot', :'branch_id', :proven_id, :schedule_id, :'case_id',
                now(), now(), now(), '003', 'QA', 'QA', '1', 'QA', 'QA', 'QA', 'synthetic'),
                ('qa-unlinked-doc', 'service_record_snapshot', :'branch_id', :proven_id, :schedule_id, NULL,
                now(), now(), now(), '003', 'QA', 'QA', '1', 'QA', 'QA', 'QA', 'synthetic');
            INSERT INTO service_record (branch_id, schedule_id, service_record_case_id, updated_at)
            VALUES (:'branch_id', :schedule_id, :'case_id', now());
            INSERT INTO message_trigger_rule (id, name, event_type, offset_type, recipient_type, template_key, updated_at)
            VALUES ('qa-legacy-rule', 'QA Legacy Rule', 'SERVICE_START', 'BEFORE', 'PRIMARY_EMPLOYEE', 'SERVICE_RECORD_LINK', now());
            INSERT INTO message_trigger_job (branch_id, client_id, employee_schedule_id, rule_id, recipient_type,
                template_key, scheduled_for, dedupe_key, updated_at)
            VALUES (:'branch_id', :proven_id, :schedule_id, 'qa-legacy-rule', 'PRIMARY_EMPLOYEE',
                'SERVICE_RECORD_LINK', now(), 'qa-legacy-rule-dedupe', now()) RETURNING id AS job_id \\gset
    `;

    it("backfills proven A and explicit staff, counts unresolved history, reverses and replays without changing legacy rows", () => {
        const audit = readSql(COUNTS).replace(/;$/, "");
        const counts = `(SELECT jsonb_object_agg(metric, row_count) FROM (${audit}) counts)`;
        const snapshot = `
            SELECT jsonb_build_object(
                'counts', ${counts},
                'clients', (SELECT jsonb_object_agg(name, jsonb_build_array(fetal_type, fetal_confirmation)) FROM client),
                'links', (SELECT jsonb_object_agg(id, baby_id) FROM service_record_case),
                'babies', (SELECT coalesce(jsonb_agg(to_jsonb(b) - 'created_at' ORDER BY id), '[]') FROM client_baby b),
                'slots', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_at' ORDER BY id), '[]') FROM service_record_team_slot t),
                'owners', (SELECT coalesce(jsonb_agg(to_jsonb(a) - 'effective_from' ORDER BY id), '[]') FROM service_record_baby_assignment a),
                'legacy', jsonb_build_array(
                    (SELECT jsonb_agg(to_jsonb(c) - ARRAY['fetal_type', 'fetal_confirmation'] ORDER BY id) FROM client c),
                    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM employee_schedule s),
                    (SELECT jsonb_agg(to_jsonb(rc) - 'baby_id' ORDER BY id) FROM service_record_case rc),
                    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM service_record_assignment a),
                    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM service_record_token t),
                    (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM service_record_day d),
                    (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM service_record h),
                    (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM eformsign_doc d),
                    (SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM message_trigger_job j)
                )
            );
        `;
        // Full snapshots catch unintended writes, including changed timestamps.
        const fullNewRows = `
            SELECT jsonb_build_array(
                (SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('row_location', b.ctid::text) ORDER BY id) FROM client_baby b),
                (SELECT jsonb_agg(to_jsonb(t) || jsonb_build_object('row_location', t.ctid::text) ORDER BY id) FROM service_record_team_slot t),
                (SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('row_location', a.ctid::text) ORDER BY id) FROM service_record_baby_assignment a)
            );
        `;
        const backfill = readSql(BACKFILL);
        const reverse = readSql(REVERSAL);
        // Apply the same backfill to the shared DB before adding the fixture, then discard those writes.
        // Subtract its counts so legacy rows committed by other suites cannot change the fixture totals.
        const states = runSql(`
            BEGIN ISOLATION LEVEL REPEATABLE READ;
            -- Keep the control nonempty even when this suite runs first on a clean DB.
            INSERT INTO branch (name, slug) VALUES ('QA Existing', 'baby-foundation-existing')
            RETURNING id AS existing_branch_id \\gset
            INSERT INTO client (name, voucher_client, type, branch_id)
            VALUES ('QA Existing A', true, 'A라2형', :'existing_branch_id') RETURNING id AS existing_client_id \\gset
            INSERT INTO service_record_case (client_id, branch_id, updated_at)
            VALUES (:existing_client_id, :'existing_branch_id', now());
            SAVEPOINT without_fixture;
            ${backfill}
            SELECT ${counts};
            ROLLBACK TO SAVEPOINT without_fixture;
            ${legacyFixture}
            ${snapshot}
            ${backfill}
            ${snapshot}
            ${fullNewRows}
            ${backfill}
            ${snapshot}
            ${fullNewRows}
            ${reverse}
            ${snapshot}
            ${reverse}
            ${snapshot}
            ${backfill}
            ${snapshot}
            ROLLBACK;
        `).split("\n").map((line) => JSON.parse(line));
        const [baselineCounts, before, applied, firstNew, repeated, secondNew, reversed, reversedAgain, replayed] = states;
        expect(states).toHaveLength(9);
        const appliedCounts: Record<string, number> = applied.counts;
        const fixtureCounts = Object.fromEntries(
            Object.entries(appliedCounts).map(([metric, count]) => [metric, count - baselineCounts[metric]]),
        );
        expect(fixtureCounts).toMatchObject({
            clients_unconfirmed: 4,
            backfilled_babies: 2,
            backfilled_team_slots: 4,
            backfilled_owner_assignments: 1,
            cases_linked_to_baby: 1,
            cases_unlinked_to_baby: 6,
            cases_without_client: 1,
            cases_client_null_branch: 1,
            confirmed_cases_unlinked_to_baby: 1,
            live_schedules_null_branch: 1,
            live_schedules_without_declared_assistant_slot: 1,
            legacy_tokens_without_case: 1,
            legacy_days_without_case: 1,
            legacy_record_documents_without_case: 1,
            record_job_members: 0,
        });
        expect(applied.clients).toMatchObject({
            "QA Proven A": ["SINGLETON", "CONFIRMED"],
            "QA Ambiguous B": [null, null],
            "QA Ambiguous C": [null, null],
            "QA Ambiguous D": [null, null],
            "QA Incomplete A": ["SINGLETON", "CONFIRMED"],
            "QA Null Branch A": [null, null],
        });
        expect(applied.legacy).toEqual(before.legacy);
        expect(repeated).toEqual(applied);
        expect(secondNew).toEqual(firstNew);
        expect(reversed).toEqual(before);
        expect(reversedAgain).toEqual(before);
        expect(replayed).toEqual(applied);
    });

    it.each([
        ["an authored baby exists", `
            INSERT INTO client_baby (client_id, branch_id, ordinal) VALUES (:ambiguous_id, :'branch_id', 1);
        `],
        ["a backfilled assignment closes", `
            UPDATE service_record_baby_assignment SET ended_at = effective_from, active_owner = NULL
            WHERE client_id = :proven_id AND legacy_backfilled RETURNING id AS closed_assignment_id \\gset
        `],
        ["a backfilled slot retires", `
            UPDATE service_record_team_slot SET active = false
            WHERE client_id = :ambiguous_id AND slot = 1 AND legacy_backfilled RETURNING id AS retired_slot_id \\gset
        `],
        ["the fetal type changes", `
            UPDATE client SET fetal_type = 'TWINS' WHERE id = :proven_id RETURNING id AS changed_client_id \\gset
        `],
        ["the fetal confirmation changes", `
            UPDATE client SET fetal_confirmation = 'UNCONFIRMED'
            WHERE id = :proven_id RETURNING id AS changed_client_id \\gset
        `],
        ["a job has a recipient and no members", `
            UPDATE message_trigger_job SET recipient_employee_id = :primary_id
            WHERE id = :'job_id' RETURNING id AS recipient_job_id \\gset
        `],
        ["a member remains after its job recipient is cleared", `
            -- A valid member requires a recipient. Defer its FK inside this rollback-only transaction
            -- so the recipient can be cleared and the member alone must trigger the refusal.
            ALTER TABLE service_record_job_member ALTER CONSTRAINT fk_record_member_job DEFERRABLE INITIALLY IMMEDIATE;
            UPDATE message_trigger_job SET recipient_employee_id = :primary_id WHERE id = :'job_id';
            INSERT INTO service_record_job_member (
                job_id, service_record_case_id, branch_id, client_id, schedule_id, baby_id, employee_id, assignment_version
            )
            SELECT :'job_id', :'case_id', branch_id, client_id, schedule_id, baby_id, employee_id, version
            FROM service_record_baby_assignment WHERE client_id = :proven_id AND legacy_backfilled
            RETURNING job_id AS member_job_id \\gset
            SET CONSTRAINTS fk_record_member_job DEFERRED;
            UPDATE message_trigger_job SET recipient_employee_id = NULL WHERE id = :'member_job_id';
        `],
    ])("refuses preactivation reversal when %s", (_scenario, change) => {
        const result = executeSql(`
            BEGIN;
            ${legacyFixture}
            ${readSql(BACKFILL)}
            ${change}
            \\set VERBOSITY verbose
            ${readSql(REVERSAL)}
            ROLLBACK;
        `);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(3);
        expect(result.stderr).toContain("P0001: Baby record foundation reversal requires unchanged preactivation backfill data");
    });

    it("rejects persisted cross-branch, cross-family, cross-schedule and wrong-recipient ownership", async () => {
        await withFixtures(async (tx) => {
            const branch = await tx.branch.create({ data: { name: "QA Foundation", slug: randomUUID() } });
            const otherBranch = await tx.branch.create({ data: { name: "QA Foreign", slug: randomUUID() } });
            const clientFor = (branchId: string) => tx.client.create({
                data: { branchId, name: "QA Client", voucherClient: false },
            });
            const employeeFor = (branchId: string) => tx.employee.create({
                data: { branchId, name: "QA Provider", phone: "synthetic-shared-phone", grade: "QA", workArea: [] },
            });
            const client = await clientFor(branch.id);
            const siblingFamily = await clientFor(branch.id);
            const babyOnlyClient = await clientFor(branch.id);
            const foreignClient = await clientFor(otherBranch.id);
            const firstEmployee = await employeeFor(branch.id);
            const secondEmployee = await employeeFor(branch.id);
            const foreignEmployee = await employeeFor(otherBranch.id);
            const scope = { branchId: branch.id, clientId: client.id };
            const scheduleFor = (clientId: number) => tx.employee_schedule.create({
                data: {
                    branchId: branch.id, clientId, primaryEmployeeId: firstEmployee.id, workAddress: "QA",
                    startDate: SERVICE_DATE, endDate: SERVICE_DATE,
                },
            });
            const schedule = await scheduleFor(client.id);
            const parallelSchedule = await scheduleFor(client.id);
            const outsideSchedule = await scheduleFor(siblingFamily.id);
            // Historical schedules can have an inconsistent branch/client pair.
            const wrongBranchSchedule = await scheduleFor(foreignClient.id);

            const babyFor = (clientId: number, ordinal: number) => tx.client_baby.create({
                data: { branchId: branch.id, clientId, ordinal },
            });
            const babies = await Promise.all([1, 2, 3, 4, 5].map((ordinal) => babyFor(client.id, ordinal)));
            const [baby, sibling] = babies;
            if (!baby || !sibling) throw new Error("Synthetic siblings missing");
            const otherBaby = await babyFor(siblingFamily.id, 1);
            await babyFor(babyOnlyClient.id, 1);
            await rejectSql(tx, Prisma.sql`DELETE FROM client WHERE id = ${babyOnlyClient.id}`, "23503", "fk_client_baby_owner");
            await rejectSql(tx, Prisma.sql`INSERT INTO client_baby (branch_id, client_id, ordinal)
                VALUES (${branch.id}::uuid, ${foreignClient.id}, 1)`, "23503", "fk_client_baby_owner");
            await rejectSql(tx, Prisma.sql`INSERT INTO client_baby (branch_id, client_id, ordinal)
                VALUES (${branch.id}::uuid, ${client.id}, 0)`, "23514", "ck_client_baby_ordinal");
            await rejectSql(tx, Prisma.sql`UPDATE client SET fetal_confirmation = 'CONFIRMED' WHERE id = ${client.id}`,
                "23514", "ck_client_fetal_confirmation");

            const slotFor = (employeeId: number, scheduleId: number, slot: number) =>
                tx.service_record_team_slot.create({ data: { ...scope, scheduleId, employeeId, slot } });
            const slots = [await slotFor(firstEmployee.id, schedule.id, 0), await slotFor(secondEmployee.id, schedule.id, 1)];
            for (const slot of [2, 3]) {
                const employee = await employeeFor(branch.id);
                slots.push(await slotFor(employee.id, schedule.id, slot));
            }
            expect(slots.map(({ slot }) => slot)).toEqual(Object.keys(PROVIDER_LABELS).map(Number));
            const firstSlot = slots[0];
            const secondSlot = slots[1];
            if (!firstSlot || !secondSlot) throw new Error("Synthetic team missing");
            const parallelSlot = await slotFor(firstEmployee.id, parallelSchedule.id, 0);
            const insertSlot = (clientId: number, scheduleId: number, employeeId: number, slot: number) => Prisma.sql`
                INSERT INTO service_record_team_slot (branch_id, client_id, schedule_id, employee_id, slot)
                VALUES (${branch.id}::uuid, ${clientId}, ${scheduleId}, ${employeeId}::smallint, ${slot}::smallint)
            `;
            await rejectSql(tx, insertSlot(client.id, schedule.id, firstEmployee.id, 4), "23514", "ck_record_team_slot_number");
            await rejectSql(tx, insertSlot(client.id, outsideSchedule.id, firstEmployee.id, 0), "23503", "fk_record_slot_schedule");
            await rejectSql(tx, insertSlot(foreignClient.id, wrongBranchSchedule.id, firstEmployee.id, 0), "23503", "fk_record_slot_client");
            await rejectSql(tx, insertSlot(client.id, parallelSchedule.id, foreignEmployee.id, 1), "23503", "fk_record_slot_employee");
            const alternateEmployee = await employeeFor(branch.id);
            await rejectSql(tx, insertSlot(client.id, schedule.id, alternateEmployee.id, 0), "23505");
            await rejectSql(tx, insertSlot(client.id, parallelSchedule.id, firstEmployee.id, 1), "23505");
            await rejectSql(tx, Prisma.sql`DELETE FROM employee_schedule WHERE id = ${schedule.id}`, "23503", "fk_record_slot_schedule");

            const assignmentFor = (babyId: string) => tx.service_record_baby_assignment.create({
                data: {
                    ...scope, babyId, scheduleId: schedule.id, teamSlotId: firstSlot.id,
                    employeeId: firstEmployee.id, effectiveFrom: SERVICE_DATE,
                },
            });
            const firstAssignment = await assignmentFor(baby.id);
            for (const child of babies.slice(1)) await assignmentFor(child.id);
            expect(await tx.service_record_baby_assignment.count({ where: { scheduleId: schedule.id } })).toBe(5);

            const insertAssignment = (babyId: string, teamSlotId: string, employeeId: number, version = 1) => Prisma.sql`
                INSERT INTO service_record_baby_assignment (branch_id, client_id, schedule_id, baby_id, team_slot_id, employee_id, version)
                VALUES (${branch.id}::uuid, ${client.id}, ${schedule.id}, ${babyId}::uuid, ${teamSlotId}::uuid, ${employeeId}::smallint, ${version})
            `;
            await rejectSql(tx, insertAssignment(otherBaby.id, firstSlot.id, firstEmployee.id), "23503", "fk_record_assignment_baby");
            await rejectSql(tx, insertAssignment(baby.id, firstSlot.id, firstEmployee.id, 2), "23505");
            const newBaby = await babyFor(client.id, 6);
            await rejectSql(tx, insertAssignment(newBaby.id, parallelSlot.id, firstEmployee.id), "23503", "fk_record_assignment_slot");
            await rejectSql(tx, insertAssignment(newBaby.id, secondSlot.id, firstEmployee.id), "23503", "fk_record_assignment_slot");
            await rejectSql(tx, insertAssignment(newBaby.id, firstSlot.id, firstEmployee.id, 0), "23514", "ck_record_assignment_version");

            await rejectSql(tx, Prisma.sql`INSERT INTO service_record_case (branch_id, baby_id, updated_at)
                VALUES (${branch.id}::uuid, ${baby.id}::uuid, now())`, "23514", "ck_record_case_baby_owner");
            await rejectSql(tx, Prisma.sql`INSERT INTO service_record_case (branch_id, client_id, baby_id, updated_at)
                VALUES (${branch.id}::uuid, ${client.id}, ${otherBaby.id}::uuid, now())`, "23503", "fk_record_case_baby");
            const serviceCase = await tx.service_record_case.create({ data: { ...scope, babyId: baby.id } });
            const otherCase = await tx.service_record_case.create({
                data: { ...scope, clientId: siblingFamily.id, babyId: otherBaby.id },
            });

            const rule = await tx.message_trigger_rule.create({ data: {
                branchId: branch.id, name: "QA Record Rule", eventType: "SERVICE_START", offsetType: "BEFORE",
                recipientType: "PRIMARY_EMPLOYEE", templateKey: "SERVICE_RECORD_LINK",
            } });
            const jobFor = (employeeId: number, clientId = client.id, scheduleId = schedule.id) =>
                tx.message_trigger_job.create({ data: {
                    branchId: branch.id, clientId, employeeScheduleId: scheduleId, recipientEmployeeId: employeeId,
                    ruleId: rule.id, dedupeKey: randomUUID(), recipientType: rule.recipientType, templateKey: rule.templateKey,
                    recipientPhone: firstEmployee.phone, scheduledFor: SERVICE_DATE,
                } });
            const job = await jobFor(firstEmployee.id);
            const samePhoneJob = await jobFor(secondEmployee.id);
            const wrongClientJob = await jobFor(firstEmployee.id, siblingFamily.id, outsideSchedule.id);
            const wrongScheduleJob = await jobFor(firstEmployee.id, client.id, parallelSchedule.id);
            await rejectSql(tx, Prisma.sql`UPDATE message_trigger_job SET recipient_employee_id = ${foreignEmployee.id}::smallint
                WHERE id = ${job.id}`, "23503", "fk_record_job_recipient");
            await rejectSql(tx, Prisma.sql`UPDATE message_trigger_job SET branch_id = NULL WHERE id = ${job.id}`,
                "23514", "ck_record_job_recipient_scope");

            const membership = {
                ...scope, jobId: job.id, serviceRecordCaseId: serviceCase.id, scheduleId: schedule.id,
                babyId: baby.id, employeeId: firstEmployee.id, assignmentVersion: 1,
            };
            const insertMember = (data: typeof membership) => Prisma.sql`
                INSERT INTO service_record_job_member
                    (job_id, service_record_case_id, branch_id, client_id, schedule_id, baby_id, employee_id, assignment_version)
                VALUES (${data.jobId}, ${data.serviceRecordCaseId}::uuid, ${data.branchId}::uuid, ${data.clientId},
                    ${data.scheduleId}, ${data.babyId}::uuid, ${data.employeeId}::smallint, ${data.assignmentVersion})
            `;
            await rejectSql(tx, insertMember({ ...membership, jobId: samePhoneJob.id }), "23503", "fk_record_member_job");
            await rejectSql(tx, insertMember({ ...membership, jobId: samePhoneJob.id, employeeId: secondEmployee.id }),
                "23503", "fk_record_member_assignment");
            await rejectSql(tx, insertMember({ ...membership, jobId: wrongClientJob.id }), "23503", "fk_record_member_job");
            await rejectSql(tx, insertMember({ ...membership, jobId: wrongScheduleJob.id }), "23503", "fk_record_member_job");
            await rejectSql(tx, insertMember({ ...membership, serviceRecordCaseId: otherCase.id }), "23503", "fk_record_member_case");
            await rejectSql(tx, insertMember({ ...membership, babyId: sibling.id }), "23503", "fk_record_member_case");
            await rejectSql(tx, insertMember({ ...membership, assignmentVersion: 2 }), "23503", "fk_record_member_assignment");
            await tx.service_record_job_member.create({ data: membership });
            await rejectSql(tx, Prisma.sql`DELETE FROM message_trigger_job WHERE id = ${job.id}`, "23503", "fk_record_member_job");
            await rejectSql(tx, Prisma.sql`DELETE FROM service_record_case WHERE id = ${serviceCase.id}::uuid`, "23503", "fk_record_member_case");
            await rejectSql(tx, Prisma.sql`UPDATE service_record_case SET baby_id = ${sibling.id}::uuid
                WHERE id = ${serviceCase.id}::uuid`, "23514");
            await rejectSql(tx, Prisma.sql`DELETE FROM service_record_job_member WHERE job_id = ${job.id}`, "23514");

            // The assignment must close before either of its active parents can retire.
            await rejectSql(tx, Prisma.sql`UPDATE client_baby SET active = false WHERE id = ${baby.id}::uuid`,
                "23503", "fk_record_assignment_active_baby");
            await rejectSql(tx, Prisma.sql`UPDATE service_record_team_slot SET active = false WHERE id = ${firstSlot.id}::uuid`,
                "23503", "fk_record_assignment_active_slot");
            await rejectSql(tx, Prisma.sql`UPDATE service_record_baby_assignment SET employee_id = ${secondEmployee.id}::smallint
                WHERE id = ${firstAssignment.id}::uuid`, "23514");

            await rejectSql(tx, Prisma.sql`UPDATE service_record_baby_assignment SET ended_at = effective_from
                WHERE id = ${firstAssignment.id}::uuid`, "23514", "ck_record_assignment_window");
            await tx.service_record_baby_assignment.updateMany({
                where: { scheduleId: schedule.id },
                data: { endedAt: firstAssignment.effectiveFrom, activeOwner: null },
            });
            await tx.service_record_team_slot.update({ where: { id: firstSlot.id }, data: { active: false } });
            await tx.client_baby.update({ where: { id: sibling.id }, data: { active: false } });
            await rejectSql(tx, insertAssignment(sibling.id, secondSlot.id, secondEmployee.id, 2), "23503", "fk_record_assignment_active_baby");
            await rejectSql(tx, insertAssignment(baby.id, firstSlot.id, firstEmployee.id, 2), "23503", "fk_record_assignment_active_slot");
            await rejectSql(tx, Prisma.sql`UPDATE client_baby SET active = true WHERE id = ${sibling.id}::uuid`, "23514");
            await rejectSql(tx, Prisma.sql`UPDATE client_baby SET ordinal = 9 WHERE id = ${sibling.id}::uuid`, "23514");
            await rejectSql(tx, Prisma.sql`DELETE FROM client_baby WHERE id = ${sibling.id}::uuid`, "23514");
            await rejectSql(tx, Prisma.sql`INSERT INTO client_baby (branch_id, client_id, ordinal)
                VALUES (${branch.id}::uuid, ${client.id}, 2)`, "23505");
            await rejectSql(tx, Prisma.sql`DELETE FROM service_record_baby_assignment WHERE id = ${firstAssignment.id}::uuid`, "23514");

            await tx.service_record_baby_assignment.create({
                data: {
                    ...scope, scheduleId: schedule.id, babyId: baby.id, teamSlotId: secondSlot.id,
                    employeeId: secondEmployee.id, version: 2, effectiveFrom: SERVICE_DATE,
                },
            });
            const oldMember = await tx.service_record_job_member.findFirstOrThrow({
                where: { jobId: job.id }, include: { assignment: true },
            });
            expect(oldMember.assignment).toMatchObject({
                id: firstAssignment.id, employeeId: firstEmployee.id, version: 1,
                endedAt: firstAssignment.effectiveFrom, activeOwner: null,
            });
            expect(await tx.service_record_case.findUniqueOrThrow({ where: { id: serviceCase.id } }))
                .toMatchObject({ clientId: client.id, babyId: baby.id });
        });
    });
});
