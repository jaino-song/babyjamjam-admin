import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import { resolveServiceRecordCaseTarget } from "application/services/service-record-case-target";

import { assertThrowawayTarget, describeReal } from "../integrity/helpers/real-db";
import { assertBabyRecordKeyTestTarget } from "./helpers/baby-record-key-target";

const STAGE = readFileSync(resolve(__dirname, "../../prisma/scripts/stage-baby-case-keys.sql"), "utf8");
const HISTORY = process.env["DATABASE_URL"]?.endsWith("_history") === true;
const SERVICE_DATE = new Date("2026-11-25T00:00:00Z");
const ROLLBACK_FIXTURES = new Error("Roll back synthetic case-key fixtures");

const LEGACY_KEYS = {
    service_record_case_client_id_key: "service_record_case USING btree (client_id)",
    service_record_schedule_id_key: "service_record USING btree (schedule_id)",
    service_record_assignment_schedule_id_key: "service_record_assignment USING btree (schedule_id)",
    service_record_day_schedule_id_session_index_key: "service_record_day USING btree (schedule_id, session_index)",
};
const REPLACEMENT_KEYS = {
    uq_record_hdr_sched_case: "service_record USING btree (schedule_id, service_record_case_id)",
    uq_record_asn_sched_case: "service_record_assignment USING btree (schedule_id, service_record_case_id)",
    uq_record_day_sched_case_session: "service_record_day USING btree (schedule_id, service_record_case_id, session_index)",
    uq_record_hdr_sched_unbound: "service_record USING btree (schedule_id) WHERE (service_record_case_id IS NULL)",
    uq_record_day_sched_session_unbound: "service_record_day USING btree (schedule_id, session_index) "
        + "WHERE ((service_record_case_id IS NULL) AND (schedule_id IS NOT NULL))",
    uq_record_case_unbound_client: "service_record_case USING btree (client_id) "
        + "WHERE ((baby_id IS NULL) AND (client_id IS NOT NULL))",
    idx_record_case_client: "service_record_case USING btree (client_id)",
};
const RETAINED_KEYS = [
    "uniq_service_record_case_branch_client_id", "uniq_service_record_case_branch_id",
    "uq_record_case_baby_scope", "uq_record_case_member_scope", "uq_service_record_case_baby",
    "uq_client_baby_ordinal", "uniq_service_record_day_case_session",
];
const PREEXISTING_INDEX = "uq_record_day_sched_session_unbound";
const LEGACY_INDEX_DEFINITIONS = Object.entries(LEGACY_KEYS).map(([name, definition]) =>
    `CREATE UNIQUE INDEX ${name} ON public.${definition}`);
const REPLACEMENT_INDEX_DEFINITIONS = Object.entries(REPLACEMENT_KEYS).map(([name, definition]) =>
    `CREATE ${name === "idx_record_case_client" ? "" : "UNIQUE "}INDEX ${name} ON public.${definition}`);
const LEGACY_PREEXISTING_DEFINITION = `CREATE UNIQUE INDEX ${PREEXISTING_INDEX} ON public.service_record_day `
    + "USING btree (schedule_id, session_index) WHERE ((schedule_id IS NOT NULL) AND (service_record_case_id IS NULL))";

function dropIndexes(names: string[]): string {
    return `DROP INDEX IF EXISTS ${names.map((name) => `public.${name}`).join(", ")}`;
}

function withoutOids(indexes: IndexRow[]) {
    return indexes.map(({ name, definition, usable }) => ({ name, definition, usable }));
}

function psql(sql: string, url: string) {
    return spawnSync("psql", ["-w", "-XqAt", "-v", "ON_ERROR_STOP=1", "-d", url], {
        input: sql, encoding: "utf8", timeout: 12_000,
    });
}

function expectSqlSuccess(result: ReturnType<typeof psql>) {
    expect(result.error).toBeUndefined();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    return result.stdout.trim();
}

type Scope = { branchId: string; clientId: number };
type Tx = Prisma.TransactionClient;

async function createBranch(tx: Tx) {
    const branch = await tx.branch.create({
        data: { name: "QA-Case keys", slug: `qa-case-keys-${randomUUID()}` },
        select: { id: true },
    });
    return branch.id;
}

async function createFamily(tx: Tx, branchId: string, fetalType?: "SINGLETON" | "TWINS") {
    const client = await tx.client.create({
        data: {
            branchId, name: "QA-Case family", voucherClient: false, type: "B",
            fetalType, fetalConfirmation: fetalType ? "CONFIRMED" : null,
        },
        select: { id: true },
    });
    return { branchId, clientId: client.id };
}

function createBaby(tx: Tx, scope: Scope, ordinal: number, active = true) {
    return tx.client_baby.create({ data: { ...scope, ordinal, active }, select: { id: true } });
}

function createCase(tx: Tx, scope: Scope, babyId?: string, finalizedAt?: Date) {
    return tx.service_record_case.create({
        data: { ...scope, babyId, finalizedAt, ...(finalizedAt ? { status: "COMPLETED" } : {}) },
        select: { id: true },
    });
}

type IndexRow = { oid: string; name: string; definition: string; usable: boolean };

function readIndexes(db: PrismaClient): Promise<IndexRow[]> {
    return db.$queryRaw`
        SELECT i.indexrelid::text AS oid, c.relname::text AS name,
            pg_get_indexdef(i.indexrelid) AS definition,
            i.indisvalid AND i.indisready AND i.indislive AS usable
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid IN ('public.service_record_case'::regclass, 'public.service_record'::regclass,
            'public.service_record_assignment'::regclass, 'public.service_record_day'::regclass,
            'public.client_baby'::regclass)
        ORDER BY c.relname
    `;
}

// Fixed old-column projections and fingerprints from the populated rehearsal.
// Return only counts and digests, including for tokens.
const HISTORY_ROWS = [
    ["service_record_assignment", 2, "9368242ea808c1da0e752254f5d5c5ff",
        "id branch_id service_record_case_id schedule_id employee_id employee_name_snapshot employee_phone_snapshot "
        + "start_date end_date created_at updated_at"],
    ["service_record_case", 3, "bbef9215c2dc026ad1f3fa4a11bf9ccb",
        "id branch_id client_id status start_date end_date required_session_count form_version mom_name mom_birth "
        + "baby_name baby_birth delivery_type baby_weight completed_at finalization_due_at finalization_started_at "
        + "finalized_at documents_completed_at finalization_attempts next_attempt_at last_error version created_at "
        + "updated_at planned_sessions current_revision_id current_usable_revision_id current_usable_document_version"],
    ["service_record_day", 0, "",
        "id branch_id schedule_id session_index service_date answers etc_service notes payment_confirmed mom_approval "
        + "locked submitted_at created_at updated_at service_record_case_id case_session_index employee_id "
        + "employee_name_snapshot form_version client_signature client_signed_at period_mismatch_kept_at"],
    ["service_record_revision", 2, "1221d5a2e0787c6fbf042ae3aee82600",
        "id branch_id service_record_case_id revision_number confirmed_by_user_id confirmed_at payload planned_sessions "
        + "provenance form_version_at_confirm snapshot_reference before_snapshot"],
    ["service_record_token", 2, "a28047759f3468d789852fe1ff36afae",
        "id branch_id schedule_id employee_id link_token_hash access_token_hash expected_phone_hash verified_at "
        + "failed_attempts expires_at active revoked_at created_at service_record_case_id challenge_window_started_at locked_at"],
] as const;

function historyFingerprint(url: string) {
    const sql = HISTORY_ROWS.map(([table, , , columns]) =>
        `SELECT '${table}', count(*), md5(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY id))
         FROM (SELECT ${columns.split(" ").join(", ")} FROM public.${table}) t`,
    ).join(" UNION ALL ");
    return expectSqlSuccess(psql(`SET TIME ZONE 'Asia/Seoul'; ${sql} ORDER BY 1;`, url));
}

async function rejectDuplicate(tx: Tx, sql: Prisma.Sql, columns: string) {
    await tx.$executeRaw`SAVEPOINT duplicate_case_key`;
    await expect(tx.$executeRaw(sql)).rejects.toMatchObject({
        code: "P2010",
        meta: { code: "23505", message: expect.stringContaining(`Key (${columns})=`) },
    });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_case_key`;
    await tx.$executeRaw`RELEASE SAVEPOINT duplicate_case_key`;
}

describeReal("baby-record case keys (real PostgreSQL)", () => {
    let db: PrismaClient;
    let url: string;
    let original: IndexRow[];
    let migrated: boolean;

    beforeAll(async () => {
        assertBabyRecordKeyTestTarget(process.env);
        assertThrowawayTarget();
        url = process.env["DATABASE_URL"] ?? "";
        db = new PrismaClient({ datasourceUrl: url });
        await db.$connect();
        original = await readIndexes(db);
        migrated = original.some(({ name }) => name === "idx_record_case_client");
        expectBaseline(original);
    });

    afterAll(async () => db?.$disconnect());

    function expectBaseline(indexes: IndexRow[]) {
        const expected = migrated ? REPLACEMENT_INDEX_DEFINITIONS : LEGACY_INDEX_DEFINITIONS;
        for (const definition of expected) {
            expect(indexes).toContainEqual(expect.objectContaining({ definition, usable: true }));
        }
        if (migrated) {
            for (const name of Object.keys(LEGACY_KEYS)) {
                expect(indexes.map((index) => index.name)).not.toContain(name);
            }
        }
    }

    function runIndexTransaction(statements: string[]) {
        expectSqlSuccess(psql(`BEGIN;
            SET LOCAL client_min_messages = warning;
            ${statements.join(";\n")};
            COMMIT;`, url));
    }

    async function withFixtures(test: (tx: Tx) => Promise<void>) {
        await expect(db.$transaction(async (tx) => {
            await test(tx);
            throw ROLLBACK_FIXTURES;
        })).rejects.toBe(ROLLBACK_FIXTURES);
    }

    async function expectStageRefusal(setup: string, cleanup: string, diagnostic: string) {
        expectSqlSuccess(psql(setup, url));
        try {
            const before = await readIndexes(db);
            const attempt = psql(STAGE, url);
            expect(attempt.error).toBeUndefined();
            expect(attempt.status).toBe(3);
            expect(attempt.stderr).toContain(diagnostic);
            expect(await readIndexes(db)).toEqual(before);
        } finally {
            expectSqlSuccess(psql(`BEGIN;\n${cleanup};\nCOMMIT;`, url));
        }
    }

    async function withLegacyIndexLayout(test: () => Promise<void>) {
        if (!migrated) {
            await test();
            return;
        }

        // Only the guarded disposable database may enter this layout. Creating
        // the old unique indexes fails atomically if any sibling rows exist.
        runIndexTransaction([dropIndexes(Object.keys(REPLACEMENT_KEYS)), ...LEGACY_INDEX_DEFINITIONS]);
        try {
            await test();
        } finally {
            const retained = "uniq_service_record_day_case_session";
            const header = "service_record_schedule_id_key";
            runIndexTransaction([
                `ALTER TABLE public.service_record DROP CONSTRAINT IF EXISTS ${header}`,
                dropIndexes([...Object.keys(LEGACY_KEYS), ...Object.keys(REPLACEMENT_KEYS),
                    "qa_duplicate_global_case_key", retained]),
                ...original.filter(({ name }) => name === retained || name in REPLACEMENT_KEYS)
                    .map(({ definition }) => definition),
            ]);
            expect(withoutOids(await readIndexes(db))).toEqual(withoutOids(original));
        }
    }

    it("rejects a duplicate global key before staging", () => withLegacyIndexLayout(async () => {
        const name = "qa_duplicate_global_case_key";
        await expectStageRefusal(
            `CREATE UNIQUE INDEX ${name} ON public.${LEGACY_KEYS.service_record_case_client_id_key}`,
            `DROP INDEX public.${name}`,
            "Unexpected duplicate global key for public.service_record_case_client_id_key",
        );
    }));

    it("rejects a missing retained index before staging", () => withLegacyIndexLayout(async () => {
        const name = "uniq_service_record_day_case_session";
        await expectStageRefusal(
            `DROP INDEX public.${name}`,
            `CREATE UNIQUE INDEX ${name} ON public.service_record_day (service_record_case_id, case_session_index)`,
            `Missing retained index public.${name}`,
        );
    }));

    it("rejects a constraint-backed legacy index before staging", () => withLegacyIndexLayout(async () => {
        const name = "service_record_schedule_id_key";
        await expectStageRefusal(
            `ALTER TABLE public.service_record ADD CONSTRAINT ${name} UNIQUE USING INDEX ${name}`,
            `ALTER TABLE public.service_record DROP CONSTRAINT ${name};
             CREATE UNIQUE INDEX ${name} ON public.${LEGACY_KEYS[name]}`,
            `Constraint depends on legacy index public.${name}`,
        );
    }));

    it.each([1, 2, 3])("rejects initial staging with only %i legacy keys", (legacyCount) => withLegacyIndexLayout(async () => {
        const missingKeys = Object.entries(LEGACY_KEYS).slice(legacyCount);
        await expectStageRefusal(
            `DROP INDEX ${missingKeys.map(([name]) => `public.${name}`).join(", ")}`,
            missingKeys.map(([name, definition]) => `CREATE UNIQUE INDEX ${name} ON public.${definition}`).join(";\n"),
            "Incomplete case-key stage: expected four legacy indexes or all replacements",
        );
    }));

    it("rejects a same-name ineffective index or wrong predicate without changing existing keys", () => withLegacyIndexLayout(async () => {
        const original = await readIndexes(db);
        const malformed = [
            ["uq_record_hdr_sched_case",
                "CREATE INDEX uq_record_hdr_sched_case ON public.service_record (schedule_id, service_record_case_id)"],
            ["uq_record_hdr_sched_unbound",
                "CREATE UNIQUE INDEX uq_record_hdr_sched_unbound ON public.service_record (schedule_id)"
                    + " WHERE service_record_case_id IS NOT NULL"],
        ] as const;
        for (const [name, definition] of malformed) {
            expectSqlSuccess(psql(definition, url));
            try {
                const before = await readIndexes(db);
                const attempt = psql(STAGE, url);
                expect(attempt.error).toBeUndefined();
                expect(attempt.status).toBe(3);
                expect(attempt.stderr).toContain(`Unexpected index definition for public.${name}`);
                expect(await readIndexes(db)).toEqual(before);
            } finally {
                expectSqlSuccess(psql(`DROP INDEX public.${name}`, url));
            }
        }
        expect(await readIndexes(db)).toEqual(original);
    }));

    it("rejects a matching replacement left invalid by an interrupted concurrent build", () => withLegacyIndexLayout(async () => {
        const name = "uq_record_hdr_sched_case";
        const original = await readIndexes(db);
        try {
            await db.$transaction(async (tx) => {
                await tx.$executeRaw`LOCK TABLE public.service_record IN ROW EXCLUSIVE MODE`;
                const create = psql(`SET lock_timeout = '350ms';
                    CREATE UNIQUE INDEX CONCURRENTLY ${name} ON public.${REPLACEMENT_KEYS[name]};`, url);
                expect(create.error).toBeUndefined();
                expect(create.status).toBe(3);
                expect(create.stderr).toContain("lock timeout");
            });

            const invalid = await readIndexes(db);
            expect(invalid).toContainEqual(expect.objectContaining({ name, usable: false }));
            const attempt = psql(STAGE, url);
            expect(attempt.error).toBeUndefined();
            expect(attempt.status).toBe(3);
            expect(attempt.stderr).toContain(`Unexpected index definition for public.${name}`);
            expect(await readIndexes(db)).toEqual(invalid);
        } finally {
            expectSqlSuccess(psql(`SET client_min_messages = warning; DROP INDEX IF EXISTS public.${name};`, url));
        }
        expect(await readIndexes(db)).toEqual(original);
    }));

    describe("staged keys", () => {
        let baseline: IndexRow[];
        let staged: IndexRow[];
        let historyBefore: string;
        let historyAfter: string;

        beforeAll(async () => {
            baseline = await readIndexes(db);
            if (HISTORY) historyBefore = historyFingerprint(url);
            if (!migrated) expectSqlSuccess(psql(LEGACY_PREEXISTING_DEFINITION, url));
            const existing = (await readIndexes(db)).find(({ name }) => name === PREEXISTING_INDEX);
            expect(existing).toBeDefined();
            expectSqlSuccess(psql(STAGE, url));
            staged = await readIndexes(db);
            expect(staged.find(({ name }) => name === PREEXISTING_INDEX)).toEqual(existing);
            expectSqlSuccess(psql(STAGE, url));
            expect(await readIndexes(db)).toEqual(staged);
            if (HISTORY) historyAfter = historyFingerprint(url);
        });

        if (HISTORY) {
            it("populated legacy case history remains unchanged", () => {
                const expected = HISTORY_ROWS.map((row) => row.slice(0, 3).join("|")).join("\n");
                expect(historyBefore).toBe(expected);
                expect(historyAfter).toBe(expected);
            });
        } else {
            it("fresh canonical case key baseline", () => {
                expectBaseline(baseline);
            });
        }

        it("installs the scoped index shapes and keeps the compound ownership and case keys", async () => {
            const replaced = new Set([...Object.keys(LEGACY_KEYS), ...Object.keys(REPLACEMENT_KEYS)]);
            const retained = baseline.filter(({ name }) => !replaced.has(name));
            expect(retained.map(({ name }) => name)).toEqual(expect.arrayContaining(RETAINED_KEYS));
            const added = Object.entries(REPLACEMENT_KEYS).map(([name, definition]) => expect.objectContaining({
                name, usable: true,
                definition: !migrated && name === PREEXISTING_INDEX
                    ? LEGACY_PREEXISTING_DEFINITION
                    : `CREATE ${name === "idx_record_case_client" ? "" : "UNIQUE "}INDEX ${name} ON public.${definition}`,
            }));
            expect(staged).toHaveLength(retained.length + added.length);
            expect(staged).toEqual(expect.arrayContaining([...retained, ...added]));

            const fks = await db.$queryRaw<Array<{ name: string; definition: string }>>`
                SELECT conname::text AS name, pg_get_constraintdef(oid) AS definition
                FROM pg_constraint
                WHERE contype = 'f' AND convalidated AND confrelid = 'public.service_record_case'::regclass
                  AND conrelid IN ('public.service_record_revision'::regclass,
                      'public.service_record_revision_document_state'::regclass)
            `;
            expect(fks).toEqual(expect.arrayContaining([
                {
                    name: "service_record_revision_document_state_case_owner_fkey",
                    definition: "FOREIGN KEY (branch_id, client_id, service_record_case_id) "
                        + "REFERENCES service_record_case(branch_id, client_id, id)",
                },
                {
                    name: "service_record_revision_case_branch_fkey",
                    definition: "FOREIGN KEY (branch_id, service_record_case_id) REFERENCES service_record_case(branch_id, id)",
                },
            ]));
        });

        it("rejects an incomplete replay without changing the staged indexes", async () => {
            const name = "idx_record_case_client";
            const probe = "qa_case_keys_replay_probe";
            expectSqlSuccess(psql(`ALTER INDEX public.${name} RENAME TO ${probe}`, url));
            try {
                const before = await readIndexes(db);
                const attempt = psql(STAGE, url);
                expect(attempt.error).toBeUndefined();
                expect(attempt.status).toBe(3);
                expect(attempt.stderr).toContain("Incomplete case-key stage");
                expect(await readIndexes(db)).toEqual(before);
            } finally {
                expectSqlSuccess(psql(`ALTER INDEX public.${probe} RENAME TO ${name}`, url));
            }
            expect(await readIndexes(db)).toEqual(staged);
        });

        it("unbound and sibling rows coexist", async () => {
            await withFixtures(async (tx) => {
                const branchId = await createBranch(tx);
                const scope = await createFamily(tx, branchId, "TWINS");
                const employee = await tx.employee.create({
                    data: { branchId, name: "QA-Provider", phone: "synthetic", grade: "QA", workArea: [] },
                    select: { id: true },
                });
                const createSchedule = () => tx.employee_schedule.create({
                    data: {
                        ...scope, primaryEmployeeId: employee.id, workAddress: "QA",
                        startDate: SERVICE_DATE, endDate: SERVICE_DATE,
                    },
                    select: { id: true },
                });
                const { id: scheduleId } = await createSchedule();
                const { id: otherScheduleId } = await createSchedule();
                const first = await createBaby(tx, scope, 1);
                const second = await createBaby(tx, scope, 2);
                const caseA = await createCase(tx, scope, first.id);
                const caseB = await createCase(tx, scope, second.id);
                await createCase(tx, scope);
                await rejectDuplicate(tx, Prisma.sql`
                    INSERT INTO public.service_record_case (branch_id, client_id, updated_at)
                    VALUES (${branchId}::uuid, ${scope.clientId}, now())
                `, "client_id");

                const headerData = { branchId, scheduleId, momName: "QA-Legacy header" };
                const unboundHeader = await tx.service_record.create({ data: headerData });
                const dayData = { branchId, scheduleId, sessionIndex: 1, serviceDate: SERVICE_DATE };
                const unboundDay = await tx.service_record_day.create({
                    data: { ...dayData, notes: "QA-Legacy day", locked: true },
                });

                const headerIds = [unboundHeader.id];
                const dayIds = [unboundDay.id];
                const assignmentIds: string[] = [];
                for (const serviceRecordCaseId of [caseA.id, caseB.id]) {
                    const header = await tx.service_record.create({ data: { ...headerData, serviceRecordCaseId } });
                    const day = await tx.service_record_day.create({ data: { ...dayData, serviceRecordCaseId } });
                    const assignment = await tx.service_record_assignment.create({
                        data: {
                            branchId, serviceRecordCaseId, scheduleId, employeeId: employee.id,
                            employeeNameSnapshot: "QA-Provider", startDate: SERVICE_DATE, endDate: SERVICE_DATE,
                        },
                    });
                    headerIds.push(header.id);
                    dayIds.push(day.id);
                    assignmentIds.push(assignment.id);
                    expect(day.caseSessionIndex).toBeNull();
                }
                expect(new Set(headerIds).size).toBe(3);
                expect(new Set(dayIds).size).toBe(3);
                expect(new Set(assignmentIds).size).toBe(2);
                expect(await tx.service_record.findUnique({ where: { id: unboundHeader.id } })).toEqual(unboundHeader);
                expect(await tx.service_record_day.findUnique({ where: { id: unboundDay.id } })).toEqual(unboundDay);

                const duplicateHeader = (recordCase: string | null) => Prisma.sql`
                    INSERT INTO public.service_record (branch_id, schedule_id, service_record_case_id, updated_at)
                    SELECT branch_id, schedule_id, service_record_case_id, now()
                    FROM public.service_record
                    WHERE schedule_id = ${scheduleId} AND service_record_case_id IS NOT DISTINCT FROM ${recordCase}::uuid
                `;
                const insertDay = (schedule: number, recordCase: string | null, session: number, caseSession: number | null) =>
                    Prisma.sql`
                        INSERT INTO public.service_record_day (branch_id, schedule_id, service_record_case_id,
                            session_index, case_session_index, service_date, updated_at)
                        VALUES (${branchId}::uuid, ${schedule}, ${recordCase}::uuid, ${session}, ${caseSession},
                            ${SERVICE_DATE}::date, now())
                    `;
                await rejectDuplicate(tx, duplicateHeader(caseA.id), "schedule_id, service_record_case_id");
                await rejectDuplicate(tx, duplicateHeader(null), "schedule_id");
                await rejectDuplicate(tx, Prisma.sql`
                    INSERT INTO public.service_record_assignment (branch_id, service_record_case_id, schedule_id,
                        employee_name_snapshot, start_date, end_date, updated_at)
                    SELECT branch_id, service_record_case_id, schedule_id, employee_name_snapshot, start_date, end_date, now()
                    FROM public.service_record_assignment
                    WHERE schedule_id = ${scheduleId} AND service_record_case_id = ${caseA.id}::uuid
                `, "schedule_id, service_record_case_id");
                await rejectDuplicate(tx, insertDay(scheduleId, caseA.id, 1, null), "schedule_id, service_record_case_id, session_index");
                await rejectDuplicate(tx, insertDay(scheduleId, null, 1, null), "schedule_id, session_index");
                await tx.$executeRaw(insertDay(scheduleId, caseA.id, 2, 8));
                await rejectDuplicate(tx, insertDay(otherScheduleId, caseA.id, 1, 8), "service_record_case_id, case_session_index");
                await tx.$executeRaw(insertDay(otherScheduleId, caseB.id, 1, 8));

                const archivedAssignment = {
                    branchId, serviceRecordCaseId: caseA.id, scheduleId: null,
                    employeeNameSnapshot: "QA-Archived", startDate: SERVICE_DATE, endDate: SERVICE_DATE,
                };
                const archivedDay = { ...dayData, scheduleId: null };
                expect(await tx.service_record_assignment.createMany({ data: [archivedAssignment, archivedAssignment] }))
                    .toEqual({ count: 2 });
                expect(await tx.service_record_day.createMany({ data: [archivedDay, archivedDay] }))
                    .toEqual({ count: 2 });
            });
        });

        it("resolves gapped active ordinals and keeps partially materialized twins ambiguous", async () => {
            await withFixtures(async (tx) => {
                const scope = await createFamily(tx, await createBranch(tx), "TWINS");
                const third = await createBaby(tx, scope, 3);
                await createBaby(tx, scope, 2, false);
                const first = await createBaby(tx, scope, 1);
                expect(await resolveServiceRecordCaseTarget(tx, scope)).toEqual({ kind: "ambiguous" });

                const caseC = await createCase(tx, scope, third.id, SERVICE_DATE);
                const resolvedC = { kind: "resolved", caseId: caseC.id, babyId: third.id, ordinal: 3, rank: 2, babyCount: 2 };
                expect(await resolveServiceRecordCaseTarget(tx, { ...scope, caseId: caseC.id })).toEqual(resolvedC);
                expect(await resolveServiceRecordCaseTarget(tx, scope)).toEqual({ kind: "ambiguous" });

                const caseA = await createCase(tx, scope, first.id);
                expect(await resolveServiceRecordCaseTarget(tx, { ...scope, caseId: caseA.id })).toEqual({
                    kind: "resolved", caseId: caseA.id, babyId: first.id, ordinal: 1, rank: 1, babyCount: 2,
                });
                expect(await resolveServiceRecordCaseTarget(tx, { ...scope, caseId: caseC.id })).toEqual(resolvedC);
                expect(await resolveServiceRecordCaseTarget(tx, scope)).toEqual({ kind: "ambiguous" });
            });
        });

        it("confirmed singleton keeps its unbound case", async () => {
            await withFixtures(async (tx) => {
                const scope = await createFamily(tx, await createBranch(tx), "SINGLETON");
                const baby = await createBaby(tx, scope, 1);
                const { id: caseId } = await createCase(tx, scope);
                const unbound = { kind: "resolved", caseId, babyId: null, ordinal: null, rank: null, babyCount: 1 };
                expect(await resolveServiceRecordCaseTarget(tx, scope)).toEqual(unbound);
                expect(await resolveServiceRecordCaseTarget(tx, { ...scope, caseId })).toEqual(unbound);
                expect(await tx.service_record_case.findFirst({ where: { id: caseId }, select: { babyId: true } }))
                    .toEqual({ babyId: null });
                await createCase(tx, scope, baby.id);
                expect(await resolveServiceRecordCaseTarget(tx, scope)).toEqual({ kind: "ambiguous" });
            });
        });

        it("keeps confirmed multiple and unresolved legacy cases unbound", async () => {
            await withFixtures(async (tx) => {
                const branchId = await createBranch(tx);
                const legacy = await createFamily(tx, branchId);
                const twins = await createFamily(tx, branchId, "TWINS");
                await createBaby(tx, twins, 1);
                await createBaby(tx, twins, 2);
                const old = await createCase(tx, legacy);
                const confirmed = await createCase(tx, twins, undefined, SERVICE_DATE);
                const unbound = { kind: "resolved", babyId: null, ordinal: null, rank: null };

                expect(await resolveServiceRecordCaseTarget(tx, legacy)).toEqual({
                    ...unbound, caseId: old.id, babyCount: null,
                });
                expect(await resolveServiceRecordCaseTarget(tx, { ...legacy, caseId: old.id })).toEqual({
                    ...unbound, caseId: old.id, babyCount: null,
                });
                await tx.client.update({ where: { id: legacy.clientId }, data: { fetalConfirmation: "UNCONFIRMED" } });
                expect(await resolveServiceRecordCaseTarget(tx, legacy)).toEqual({
                    ...unbound, caseId: old.id, babyCount: null,
                });
                expect(await resolveServiceRecordCaseTarget(tx, twins)).toEqual({ kind: "ambiguous" });
                expect(await resolveServiceRecordCaseTarget(tx, { ...twins, caseId: confirmed.id })).toEqual({
                    ...unbound, caseId: confirmed.id, babyCount: 2,
                });
                expect(await tx.service_record_case.findFirst({ where: { id: confirmed.id }, select: { babyId: true } }))
                    .toEqual({ babyId: null });
            });
        });

        it("requires explicit selection for retired history and resolves an ordinary singleton", async () => {
            await withFixtures(async (tx) => {
                const branchId = await createBranch(tx);
                const singleton = await createFamily(tx, branchId, "SINGLETON");
                const baby = await createBaby(tx, singleton, 1);
                expect(await resolveServiceRecordCaseTarget(tx, singleton)).toEqual({ kind: "missing" });
                const active = await createCase(tx, singleton, baby.id);
                expect(await resolveServiceRecordCaseTarget(tx, singleton)).toEqual({
                    kind: "resolved", caseId: active.id, babyId: baby.id, ordinal: 1, rank: 1, babyCount: 1,
                });

                const retiredFamily = await createFamily(tx, branchId, "SINGLETON");
                const retiredBaby = await createBaby(tx, retiredFamily, 1, false);
                const retired = await createCase(tx, retiredFamily, retiredBaby.id, SERVICE_DATE);
                expect(await resolveServiceRecordCaseTarget(tx, retiredFamily)).toEqual({ kind: "missing" });
                expect(await resolveServiceRecordCaseTarget(tx, { ...retiredFamily, caseId: retired.id })).toEqual({
                    kind: "retired", caseId: retired.id, babyId: retiredBaby.id,
                });
            });
        });

        it("returns missing for absent or deleted clients and never falls back from an explicit ID", async () => {
            await withFixtures(async (tx) => {
                const branchId = await createBranch(tx);
                const otherBranchId = await createBranch(tx);
                const scope = await createFamily(tx, branchId, "TWINS");
                const first = await createBaby(tx, scope, 1);
                await createBaby(tx, scope, 2);
                const own = await createCase(tx, scope, first.id);
                const other = await createFamily(tx, branchId);
                const otherCase = await createCase(tx, other);
                const foreign = await createFamily(tx, otherBranchId);
                const foreignCase = await createCase(tx, foreign);
                const absent = await createFamily(tx, branchId);
                await tx.client.delete({ where: { id: absent.clientId } });

                for (const input of [
                    { ...scope, caseId: otherCase.id },
                    { ...scope, caseId: foreignCase.id },
                    { ...scope, caseId: randomUUID() },
                    { ...scope, caseId: "" },
                    { ...scope, branchId: otherBranchId, caseId: own.id },
                    { ...absent, caseId: own.id },
                    absent,
                ]) {
                    expect(await resolveServiceRecordCaseTarget(tx, input)).toEqual({ kind: "missing" });
                }

                await tx.client.update({ where: { id: scope.clientId }, data: { deletedAt: SERVICE_DATE } });
                expect(await resolveServiceRecordCaseTarget(tx, scope)).toEqual({ kind: "missing" });
                expect(await resolveServiceRecordCaseTarget(tx, { ...scope, caseId: own.id })).toEqual({ kind: "missing" });
            });
        });
    });
});
