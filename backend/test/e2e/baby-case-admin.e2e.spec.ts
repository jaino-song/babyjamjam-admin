import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";

import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { getJwtSecret } from "infrastructure/auth/jwt-secret";
import { PrismaService } from "infrastructure/database/prisma.service";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ClientModule } from "module/client.module";
import { MessageDeliveryModule } from "module/message-delivery.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

import { issueAdminServiceRecordEditHttpToken } from "./helpers/admin-service-record-edit-http.helper";

const DATABASE_ORIGIN = "postgresql://bjj_revision_test@127.0.0.1:62295/";
const LEGACY_DB = `${DATABASE_ORIGIN}throwaway_baby_admin_verify_legacy`;
const ALLOWED = new Set([
    `${DATABASE_ORIGIN}throwaway_baby_admin_work`,
    `${DATABASE_ORIGIN}throwaway_baby_admin_verify`,
    `${DATABASE_ORIGIN}throwaway_baby_period_work`,
    `${DATABASE_ORIGIN}throwaway_baby_period_verify`,
    LEGACY_DB,
]);
const enabled = process.env["E2E_VENDOR_STUBS"] === "1";
const describeE2E = enabled ? describe : describe.skip;
const legacyMode = process.env["DATABASE_URL"] === LEGACY_DB;
const at = (date: string) => new Date(`${date}T00:00:00Z`);
const START = at("2026-09-07");
const END = at("2026-09-11");
const MISMATCH_DATE = at("2026-09-14");
const ORIGINAL_TOKEN_EXPIRY = new Date("2026-09-18T15:00:00.000Z");
const FITTED_TOKEN_EXPIRY = new Date("2026-09-21T15:00:00.000Z");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function assertTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || !ALLOWED.has(url) || process.env["DIRECT_URL"] !== url
        || process.env["NODE_ENV"] !== "test" || !enabled) {
        throw new Error("Admin baby-case E2E requires identical explicit URLs for an approved disposable loopback PostgreSQL database");
    }
}

async function seedFamily(db: PrismaService, options: { twins: boolean; submit?: boolean; sharedProvider?: boolean }) {
    const unique = randomUUID();
    const branch = await db.branch.create({ data: { name: "QA-Admin records", slug: `qa-admin-records-${unique}` } });
    const { id: branchId } = branch;
    const client = await db.client.create({ data: {
        branchId, name: "QA-Record family", bookingConfirmedAt: at("2026-09-01"), voucherClient: true,
        duration: 5, startDate: START, endDate: END,
        ...(options.twins ? { fetalConfirmation: "CONFIRMED", fetalType: "TWINS" } : { fetalConfirmation: "UNCONFIRMED" }),
    } });
    const owner = await db.user.create({ data: {
        email: `${unique}@admin-case.test`, name: "QA-Record admin", role: "admin", approvalStatus: "approved",
    } });
    await db.user_branch.create({ data: { branchId, userId: owner.id, role: "admin" } });
    const session = await db.auth_session.create({ data: {
        userId: owner.id, selectedBranchId: branchId, expiresAt: new Date(Date.now() + 3600_000),
    } });
    const principal = {
        userId: owner.id, sessionId: session.id, branchId, role: "admin", branchRole: "admin", tokenVersion: owner.tokenVersion,
    };
    const scope = { branchId, clientId: client.id };
    const primary = await db.employee.create({ data: { branchId, name: "QA-Primary", grade: "스탠다드", phone: "01000000001" } });
    const assistant = options.twins && !options.sharedProvider
        ? await db.employee.create({ data: { branchId, name: "QA-Assistant", grade: "스탠다드", phone: "01000000002" } })
        : primary;
    const schedule = await db.employee_schedule.create({ data: {
        ...scope, primaryEmployeeId: primary.id, secondaryEmployeeId: primary.id === assistant.id ? null : assistant.id,
        startDate: START, endDate: END, workAddress: "QA-Synthetic",
    } });
    const assignees = [primary, assistant];
    const slots = new Map<number, string>();
    if (options.twins) {
        for (const [slot, employee] of assignees.entries()) {
            if (slots.has(employee.id)) continue;
            const row = await db.service_record_team_slot.create({ data: {
                ...scope, scheduleId: schedule.id, employeeId: employee.id, slot,
            } });
            slots.set(employee.id, row.id);
        }
    }
    const cases = [];
    for (const [index, employee] of assignees.slice(0, options.twins ? 2 : 1).entries()) {
        const baby = options.twins ? await db.client_baby.create({ data: { ...scope, ordinal: index + 1 } }) : null;
        const record = await db.service_record_case.create({ data: {
            ...scope, babyId: baby?.id, startDate: START, endDate: END, status: "IN_PROGRESS",
            requiredSessionCount: 5, momName: client.name, babyName: baby ? null : "QA-Legacy name",
        } });
        if (baby) {
            await db.service_record_baby_assignment.create({ data: {
                ...scope, babyId: baby.id, scheduleId: schedule.id, employeeId: employee.id,
                teamSlotId: slots.get(employee.id)!,
            } });
        }
        await db.service_record_assignment.create({ data: {
            branchId, serviceRecordCaseId: record.id, scheduleId: schedule.id, employeeId: employee.id,
            employeeNameSnapshot: employee.name, startDate: START, endDate: END,
        } });
        const days = options.submit === false ? [] : await db.service_record_day.createManyAndReturn({ data: [
            { sessionIndex: 1, serviceDate: START },
            { sessionIndex: 2, serviceDate: at("2026-09-08") },
        ].map(({ sessionIndex, serviceDate }) => ({
            branchId, serviceRecordCaseId: record.id, scheduleId: schedule.id, employeeId: employee.id,
            employeeNameSnapshot: `QA-Author ${index + 1}`, caseSessionIndex: sessionIndex, sessionIndex, serviceDate,
            notes: `prior-${index + 1}-${sessionIndex}`, locked: true, submittedAt: serviceDate,
        })) }).then((rows) => rows.sort((a, b) => a.sessionIndex - b.sessionIndex));
        cases.push({ record, employee, days });
    }
    return { ...scope, schedule, principal, cases };
}

type Fixture = Awaited<ReturnType<typeof seedFamily>>;

describeE2E("case-bound administration using the real app and PostgreSQL", () => {
    let app: INestApplication;
    let db: PrismaService;
    let jwt: JwtService;

    beforeAll(async () => {
        assertTarget();
        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                PassportModule.register({ defaultStrategy: "jwt" }),
                JwtModule.register({ global: true, secret: getJwtSecret() }),
                TenantModule, ClientModule, MessageDeliveryModule, SchedulerLeaseModule,
            ],
            providers: [JwtStrategy],
        }).compile();
        app = module.createNestApplication({ logger: false });
        const middleware = app.get(TenantAlsMiddleware);
        app.use(middleware.use.bind(middleware));
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new PrismaExceptionFilter());
        await app.init();
        db = app.get(PrismaService);
        jwt = app.get(JwtService);
    }, 45_000);

    afterAll(async () => {
        await app?.close();
    });

    const path = ({ clientId }: Fixture, suffix = "") => `/admin/service-records/client/${clientId}${suffix}`;
    const as = async ({ principal }: Fixture) => {
        const token = await issueAdminServiceRecordEditHttpToken(jwt, principal);
        const client = request(app.getHttpServer());
        return {
            get: (url: string) => client.get(url).auth(token, { type: "bearer" }),
            post: (url: string) => client.post(url).auth(token, { type: "bearer" }),
            patch: (url: string) => client.patch(url).auth(token, { type: "bearer" }),
        };
    };

    async function seedPeriodMismatch() {
        const fixture = await seedFamily(db, { twins: true });
        const credentials = [];
        for (const { record, employee, days } of fixture.cases) {
            for (const day of days) {
                const serviceDate = day.sessionIndex === 2 ? MISMATCH_DATE : day.serviceDate;
                await db.service_record_day.update({
                    where: { id: day.id },
                    data: {
                        serviceDate, submittedAt: serviceDate, clientSignedAt: serviceDate,
                        answers: { synthetic: day.notes }, momApproval: "approved",
                        clientSignature: `QA-Signature ${day.notes}`, paymentConfirmed: true,
                    },
                });
            }
            const binding = {
                branchId: fixture.branchId, scheduleId: fixture.schedule.id,
                serviceRecordCaseId: record.id, employeeId: employee.id, active: true,
            };
            const { id } = await db.service_record_token.create({
                data: {
                    ...binding, expiresAt: ORIGINAL_TOKEN_EXPIRY,
                    linkTokenHash: digest(randomUUID()), accessTokenHash: digest(randomUUID()),
                    expectedPhoneHash: digest(employee.phone!),
                },
                select: { id: true },
            });
            credentials.push({ ...binding, id });
        }
        return { fixture, credentials };
    }

    async function periodSnapshot({ branchId, clientId, schedule }: Fixture) {
        const [client, scheduleRow, cases, tokens] = await Promise.all([
            db.client.findUniqueOrThrow({ where: { id: clientId } }),
            db.employee_schedule.findUniqueOrThrow({ where: { id: schedule.id } }),
            db.service_record_case.findMany({
                where: { branchId, clientId },
                orderBy: { baby: { ordinal: "asc" } },
                include: { days: { orderBy: [{ caseSessionIndex: "asc" }, { id: "asc" }] } },
            }),
            db.service_record_token.findMany({
                where: { OR: [{ scheduleId: schedule.id }, { serviceRecordCase: { branchId, clientId } }] },
                orderBy: [{ employeeId: "asc" }, { id: "asc" }],
            }),
        ]);
        expect(cases).toHaveLength(2);
        const [first, second] = cases;
        return {
            client, schedule: scheduleRow, first: first!, second: second!,
            // Compare every credential field without showing the stored hashes in Jest diffs.
            tokens: tokens.map(({ linkTokenHash, accessTokenHash, expectedPhoneHash, ...row }) => ({
                ...row,
                linkTokenFingerprint: digest(linkTokenHash),
                accessTokenFingerprint: accessTokenHash === null ? null : digest(accessTokenHash),
                phoneFingerprint: digest(expectedPhoneHash),
            })),
        };
    }

    async function periodScenario() {
        const { fixture, credentials } = await seedPeriodMismatch();
        const before = await periodSnapshot(fixture);
        for (const [index, record] of [before.first, before.second].entries()) {
            const order = index + 1;
            expect(record).toMatchObject({
                id: fixture.cases[index]!.record.id, startDate: START, endDate: END, requiredSessionCount: 5,
                days: [
                    { sessionIndex: 1, serviceDate: START, periodMismatchKeptAt: null,
                        clientSignedAt: START, clientSignature: `QA-Signature prior-${order}-1` },
                    { sessionIndex: 2, serviceDate: MISMATCH_DATE, periodMismatchKeptAt: null,
                        clientSignedAt: MISMATCH_DATE, clientSignature: `QA-Signature prior-${order}-2`,
                        locked: true, submittedAt: MISMATCH_DATE, notes: `prior-${order}-2` },
                ],
            });
        }
        expect(before.tokens).toHaveLength(2);
        expect(before.tokens).toMatchObject(credentials.map((binding) => ({ ...binding, expiresAt: ORIGINAL_TOKEN_EXPIRY })));
        return { fixture, before, http: await as(fixture) };
    }

    const readDay = async (id: string) => {
        const [row] = await db.$queryRaw<Array<{
            id: string; caseId: string; employeeId: number; notes: string; serviceDate: string;
        }>>`
            SELECT id, service_record_case_id AS "caseId", employee_id AS "employeeId",
                   notes, service_date::text AS "serviceDate"
            FROM service_record_day WHERE id = ${id}::uuid
        `;
        expect(row).toBeDefined();
        return row!;
    };

    async function applyCorrection(fixture: Fixture, entry: Fixture["cases"][number]) {
        const http = await as(fixture);
        const { record, days: [chosen, neighbor] } = entry;
        const prior = await readDay(chosen!.id);
        const unchangedNeighbor = await readDay(neighbor!.id);
        const expected = record.babyId === null ? "prior-1-1" : "prior-2-1";
        expect(prior).toMatchObject({ caseId: record.id, notes: expected, serviceDate: "2026-09-07" });
        const { body: { draft } } = await http.post(path(fixture, "/draft")).query({ caseId: record.id }).send({}).expect(201);
        expect(draft.serviceRecordCaseId).toBe(record.id);
        const draftRoute = `/admin/service-records/drafts/${draft.id}`;
        const { body: updated } = await http.patch(draftRoute).send({
            expectedDraftVersion: draft.draftVersion,
            changes: { sessions: [{ sessionIndex: 1, notes: "QA-Corrected selected day" }] },
        }).expect(200);
        const { body: preview } = await http.post(`${draftRoute}/preview`).send({
            expectedDraftVersion: updated.draft.draftVersion,
        }).expect(201);
        expect(preview.blockingReasons).toEqual([]);
        expect(preview.previewId).toBeTruthy();
        const { body: confirmed } = await http.post(`${draftRoute}/confirm`).send({
            expectedDraftVersion: updated.draft.draftVersion,
            previewId: preview.previewId, idempotencyKey: randomUUID(),
        }).expect(201);
        expect(confirmed).toMatchObject({ status: "confirmed", caseId: record.id });
        expect(await readDay(chosen!.id)).toEqual({ ...prior, notes: "QA-Corrected selected day" });
        expect(await readDay(neighbor!.id)).toEqual(unchangedNeighbor);
        const revisionPath = `/admin/service-records/clients/${fixture.clientId}/revisions`;
        const { body: history } = await http.get(revisionPath).query({ caseId: record.id }).expect(200);
        expect(history).toMatchObject({ caseId: record.id, revisions: [{ id: confirmed.revisionId }] });
        return confirmed.revisionId;
    }

    it("an unconfirmed existing case remains selectable without adoption", async () => {
        const fixture = await seedFamily(db, { twins: false });
        const record = fixture.cases[0]!.record;
        const http = await as(fixture);
        const explicit = await http.get(path(fixture, "/editor")).query({ caseId: record.id }).expect(200);
        const implicit = await http.get(path(fixture, "/editor")).expect(200);
        expect(explicit.body.record.id).toBe(record.id);
        expect(implicit.body.record.id).toBe(record.id);
        expect(explicit.body.cases).toMatchObject([{ caseId: record.id, babyId: null, legacyName: "QA-Legacy name", rank: null }]);
        expect(await db.$queryRaw`SELECT baby_id FROM service_record_case WHERE id = ${record.id}::uuid`)
            .toEqual([{ baby_id: null }]);
        expect(await db.client_baby.count({ where: { branchId: fixture.branchId, clientId: fixture.clientId } })).toBe(0);
    });

    if (legacyMode) {
        it("a legacy singleton correction changes only its selected recorded day", async () => {
            const fixture = await seedFamily(db, { twins: false });
            await applyCorrection(fixture, fixture.cases[0]!);
        });
    } else {
        it("two sibling records are listed with their respective assignees", async () => {
            const fixture = await seedFamily(db, { twins: true });
            const http = await as(fixture);
            const { body } = await http.get(path(fixture)).expect(200);
            expect(body.record).toBeNull();
            const rows = await db.$queryRaw`
                SELECT c.id AS "caseId", c.baby_id AS "babyId", b.ordinal AS rank,
                       a.employee_id AS "employeeId", a.schedule_id AS "scheduleId"
                FROM service_record_case c
                JOIN client_baby b ON b.id = c.baby_id
                JOIN service_record_baby_assignment a ON a.baby_id = b.id AND a.active_owner
                WHERE c.branch_id = ${fixture.branchId}::uuid AND c.client_id = ${fixture.clientId}
                ORDER BY b.ordinal
            `;
            expect(rows).toEqual(fixture.cases.map(({ record, employee }, index) => ({
                caseId: record.id, babyId: record.babyId, rank: index + 1, employeeId: employee.id, scheduleId: fixture.schedule.id,
            })));
            expect(body.cases).toMatchObject(fixture.cases.map(({ record, employee }, index) => ({
                caseId: record.id, babyId: record.babyId, rank: index + 1, babyCount: 2,
                assignees: [{ id: employee.id, name: employee.name }], submittedSessions: 2, totalSessions: 5,
            })));
        });

        it("selecting the second case returns only its own day and author", async () => {
            const fixture = await seedFamily(db, { twins: true, sharedProvider: true });
            const [first, second] = fixture.cases;
            const [firstDay, secondDay] = await Promise.all([readDay(first!.days[0]!.id), readDay(second!.days[0]!.id)]);
            expect(firstDay.id).not.toBe(secondDay.id);
            expect(firstDay.caseId).not.toBe(secondDay.caseId);
            expect(firstDay.employeeId).toBe(secondDay.employeeId);
            const http = await as(fixture);
            const { body } = await http.get(path(fixture, "/editor")).query({ caseId: secondDay.caseId }).expect(200);
            expect(body.record.id).toBe(secondDay.caseId);
            expect(body.record.sessions).toMatchObject([
                { sessionIndex: 1, employeeId: secondDay.employeeId, employeeName: "QA-Author 2", notes: secondDay.notes },
                { sessionIndex: 2, employeeName: "QA-Author 2", notes: "prior-2-2" },
            ]);
            expect(body.assignments).toMatchObject([{ scheduleId: fixture.schedule.id, sessions: [
                { notes: "prior-2-1" }, { notes: "prior-2-2" },
            ] }]);
        });

        it("an ambiguous or foreign target cannot start an edit", async () => {
            const fixture = await seedFamily(db, { twins: true });
            const foreign = await seedFamily(db, { twins: false });
            const http = await as(fixture);
            const endpoint = path(fixture, "/draft");
            await http.post(endpoint).send({}).expect(409);
            await http.post(endpoint).query({ caseId: foreign.cases[0]!.record.id }).send({}).expect(404);
            await http.post(endpoint).query({ caseId: randomUUID() }).send({}).expect(404);
            await http.post(endpoint).query({ caseId: fixture.cases[1]!.record.id, branchId: foreign.branchId }).send({}).expect(400);
            const foreignHttp = await as(foreign);
            await foreignHttp.get(path(fixture, "/editor")).query({ caseId: fixture.cases[1]!.record.id }).expect(404);
            expect(await db.service_record_edit_draft.count({ where: { branchId: fixture.branchId } })).toBe(0);
        });

        it("a single-case correction or callback leaves the sibling intact", async () => {
            const fixture = await seedFamily(db, { twins: true });
            const [first, second] = fixture.cases;
            const firstBefore = await readDay(first!.days[0]!.id);
            const revisionId = await applyCorrection(fixture, second!);
            expect(await readDay(firstBefore.id)).toEqual(firstBefore);
            const http = await as(fixture);
            await http.get(`/admin/service-records/clients/${fixture.clientId}/revisions/${revisionId}/changes`)
                .query({ caseId: first!.record.id }).expect(404);
            const { body: changes } = await http.get(`/admin/service-records/clients/${fixture.clientId}/revisions/${revisionId}/changes`)
                .query({ caseId: second!.record.id }).expect(200);
            expect(changes.sessions).toEqual([expect.objectContaining({ sessionIndex: 1 })]);
        });

        it("moving the selected case day preserves sibling dates and the household schedule", async () => {
            const fixture = await seedFamily(db, { twins: true, sharedProvider: true });
            const [first, second] = fixture.cases;
            const firstDay = await readDay(first!.days[1]!.id);
            const secondDay = await readDay(second!.days[1]!.id);
            expect(firstDay.id).not.toBe(secondDay.id);
            expect(secondDay.serviceDate).toBe("2026-09-08");
            const http = await as(fixture);
            const { body: { draft } } = await http.post(path(fixture, "/draft"))
                .query({ caseId: second!.record.id }).send({}).expect(201);
            const route = `/admin/service-records/drafts/${draft.id}`;
            const { body: changed } = await http.patch(route).send({
                expectedDraftVersion: draft.draftVersion,
                changes: {},
                dateMove: { sessionIndex: 2, toDate: "2026-09-10", shiftFollowing: true },
            }).expect(200);
            const { body: preview } = await http.post(`${route}/preview`)
                .send({ expectedDraftVersion: changed.draft.draftVersion }).expect(201);
            expect(preview.blockingReasons).toEqual([]);
            const { body: saved } = await http.post(`${route}/confirm`).send({
                expectedDraftVersion: changed.draft.draftVersion, previewId: preview.previewId, idempotencyKey: randomUUID(),
            }).expect(201);
            expect(saved).toMatchObject({ caseId: second!.record.id, status: "confirmed" });
            expect(await readDay(firstDay.id)).toEqual(firstDay);
            expect(await readDay(secondDay.id)).toEqual({ ...secondDay, serviceDate: "2026-09-10" });
            const [schedule, client, sibling] = await Promise.all([
                db.employee_schedule.findUniqueOrThrow({ where: { id: fixture.schedule.id } }),
                db.client.findUniqueOrThrow({ where: { id: fixture.clientId } }),
                db.service_record_case.findUniqueOrThrow({ where: { id: first!.record.id } }),
            ]);
            for (const row of [schedule, client, sibling]) {
                expect(row).toMatchObject({ startDate: START, endDate: END });
            }
        });

        it("keeping an explicit second case leaves sibling mismatch and household dates untouched", async () => {
            const { fixture, before, http } = await periodScenario();
            const { body } = await http.post(path(fixture, "/period-mismatch/keep"))
                .query({ caseId: before.second.id }).send({ sessionIndexes: [2] }).expect(200);
            expect(body).toEqual({ keptSessionIndexes: [2] });

            const after = await periodSnapshot(fixture);
            expect(after.second).toMatchObject({
                id: before.second.id, startDate: START, endDate: END, requiredSessionCount: 5,
            });
            expect(after.second.days).toEqual([
                before.second.days[0],
                { ...before.second.days[1], periodMismatchKeptAt: expect.any(Date), updatedAt: expect.any(Date) },
            ]);
            expect(after.first).toEqual(before.first);
            expect(after.client).toEqual(before.client);
            expect(after.schedule).toEqual(before.schedule);
            expect(after.tokens).toHaveLength(2);
            expect(after.tokens).toEqual(before.tokens);
        });

        it("fitting an explicit second case preserves sibling days and household dates", async () => {
            const { fixture, before, http } = await periodScenario();
            const { body } = await http.post(path(fixture, "/period-mismatch/fit"))
                .query({ caseId: before.second.id }).send({}).expect(200);
            expect(body).toEqual({ startDate: "2026-09-07", endDate: "2026-09-14" });

            const after = await periodSnapshot(fixture);
            expect(after.second).toMatchObject({
                id: before.second.id, startDate: START, endDate: MISMATCH_DATE, requiredSessionCount: 5,
            });
            expect(after.second.days).toEqual(before.second.days);
            expect(after.first).toEqual(before.first);
            expect(after.client).toEqual(before.client);
            expect(after.schedule).toEqual(before.schedule);
            expect(after.tokens).toHaveLength(2);
            expect(after.tokens).toEqual([
                before.tokens[0],
                { ...before.tokens[1], expiresAt: FITTED_TOKEN_EXPIRY },
            ]);
        });

        it("ambiguous and foreign period mutations leave the household untouched", async () => {
            const { fixture, before, http } = await periodScenario();
            const { fixture: foreign, before: foreignBefore } = await periodScenario();
            const targets = [
                { query: {}, status: 409, code: "REQUEST_CONFLICT", reason: "SERVICE_RECORD_CASE_SELECTION_REQUIRED" },
                { query: { caseId: foreignBefore.second.id }, status: 404, code: "RESOURCE_NOT_FOUND", reason: null },
                { query: { caseId: randomUUID() }, status: 404, code: "RESOURCE_NOT_FOUND", reason: null },
            ];
            const actions = [
                { route: "/period-mismatch/fit", payload: {} },
                { route: "/period-mismatch/keep", payload: { sessionIndexes: [2] } },
            ];
            for (const { route, payload } of actions) {
                for (const { query, status, code, reason } of targets) {
                    const { body } = await http.post(path(fixture, route)).query(query).send(payload).expect(status);
                    expect(body.code).toBe(code);
                    expect(body.reason ?? null).toBe(reason);
                    expect(await periodSnapshot(fixture)).toEqual(before);
                    expect(await periodSnapshot(foreign)).toEqual(foreignBefore);
                }
            }
        });

        it("a retired case has explicit historical detail with writes disabled", async () => {
            const fixture = await seedFamily(db, { twins: true });
            const retired = fixture.cases[1]!.record;
            const http = await as(fixture);
            const target = { caseId: retired.id };
            const { body: { draft } } = await http.post(path(fixture, "/draft")).query(target).send({}).expect(201);
            await db.$transaction(async (tx) => {
                await tx.service_record_baby_assignment.updateMany({
                    where: { branchId: fixture.branchId, babyId: retired.babyId! },
                    data: { endedAt: new Date(), activeOwner: null },
                });
                await tx.client_baby.update({ where: { id: retired.babyId! }, data: { active: false } });
            });
            const response = await http.get(path(fixture, "/editor")).query(target).expect(200);
            expect(response.body.record.id).toBe(retired.id);
            expect(response.body.cases.find(({ caseId }: { caseId: string }) => caseId === retired.id))
                .toMatchObject({ retired: true, rank: null });
            await http.post(path(fixture, "/draft")).query(target).send({}).expect(409);
            await http.patch(`/admin/service-records/drafts/${draft.id}`).send({
                expectedDraftVersion: draft.draftVersion, changes: { sessions: [{ sessionIndex: 1, notes: "blocked" }] },
            }).expect(404);
            expect(await readDay(fixture.cases[1]!.days[0]!.id)).toMatchObject({ notes: "prior-2-1" });
        });

        it("case-level missing progress preserves distinct client totals", async () => {
            const fixture = await seedFamily(db, { twins: true, submit: false });
            const http = await as(fixture);
            const { body } = await http.get("/clients/service-record-missing").expect(200);
            expect(body).toMatchObject({ count: 1, recordCount: 2, items: fixture.cases.map(({ record, employee }, index) => ({
                clientId: fixture.clientId, caseId: record.id, rank: index + 1, primaryEmployeeName: employee.name,
                unwrittenThroughSessionIndex: 5,
            })) });
            const [first] = fixture.cases;
            await db.service_record_day.create({ data: {
                branchId: fixture.branchId, serviceRecordCaseId: first!.record.id, scheduleId: fixture.schedule.id,
                sessionIndex: 1, caseSessionIndex: 1, serviceDate: START, locked: true,
            } });
            const next = await http.get("/clients/service-record-missing").expect(200);
            expect(next.body).toMatchObject({ count: 1, recordCount: 1, items: [{ caseId: fixture.cases[1]!.record.id }] });
        });

        it("redelivering a ready case PDF callback leaves the sibling document pending", async () => {
            const fixture = await seedFamily(db, { twins: true });
            const [first, second] = fixture.cases;
            const detailsDate = at("2026-09-11");
            const documentRows = [];
            for (const { record } of fixture.cases) {
                await db.service_record_case.update({ where: { id: record.id }, data: { status: "DOCUMENTS_CREATED" } });
                const doc = await db.eformsign_doc.create({ data: {
                    branchId: fixture.branchId, clientId: fixture.clientId, employeeScheduleId: fixture.schedule.id,
                    serviceRecordCaseId: record.id, documentId: randomUUID(), documentKind: "service_record_snapshot",
                    createdDate: detailsDate, updatedDate: detailsDate, expiredDate: detailsDate,
                    statusType: "003", statusDetail: "003", stepType: "06", stepIndex: "3", stepName: "QA-Complete",
                    stepRecipientType: "group", stepRecipientName: "QA-Recipient", stepRecipientSms: "",
                    snapshotVersion: 1, snapshotChunkIndex: 1, syncStatus: "ready",
                    detailPayload: { synthetic: true }, detailSourceUpdatedDate: detailsDate, detailSyncedAt: detailsDate,
                } });
                documentRows.push(doc);
            }
            const [firstDoc, secondDoc] = documentRows;
            const content = Buffer.from("%PDF-1.4 synthetic case fixture");
            for (const fileType of ["document", "audit_trail"]) {
                await db.eformsign_doc_file.create({ data: {
                    eformsignDocId: secondDoc!.id, fileType, content, contentType: "application/pdf",
                    byteSize: content.length, sha256: createHash("sha256").update(content).digest("hex"),
                    sourceUpdatedDate: detailsDate,
                } });
            }
            const callback = app.get(ServiceRecordLifecycleService);
            const notification = { branchId: fixture.branchId, documentId: secondDoc!.documentId };
            expect(await callback.completeServiceRecordSnapshotIfReady(notification)).toBe(true);
            expect(await callback.completeServiceRecordSnapshotIfReady(notification)).toBe(false);
            const http = await as(fixture);
            const secondView = await http.get(path(fixture, "/editor")).query({ caseId: second!.record.id }).expect(200);
            expect(secondView.body.record.status).toBe("COMPLETED");
            expect(secondView.body.record.signatureDocs).toMatchObject([{ documentId: secondDoc!.documentId }]);
            const fileStore = app.get(EformsignDocumentMirrorService);
            const pdf = await fileStore.getStoredFile(secondView.body.record.signatureDocs[0].documentId, "document");
            expect(pdf?.body).toEqual(content);
            expect(await fileStore.getStoredFile(firstDoc!.documentId, "document")).toBeNull();
            const firstView = await http.get(path(fixture, "/editor")).query({ caseId: first!.record.id }).expect(200);
            expect(firstView.body.record.status).toBe("DOCUMENTS_CREATED");
            expect(firstView.body.record.signatureDocs).toMatchObject([{ documentId: firstDoc!.documentId }]);
            const rows = await db.$queryRaw`
                SELECT d.service_record_case_id AS "caseId", d.document_id AS "documentId", c.status,
                       (SELECT count(*)::int FROM eformsign_doc_file f WHERE f.eformsign_doc_id = d.id) AS "fileCount"
                FROM eformsign_doc d JOIN service_record_case c ON c.id = d.service_record_case_id
                WHERE d.branch_id = ${fixture.branchId}::uuid AND d.client_id = ${fixture.clientId}
                ORDER BY c.status
            `;
            expect(rows).toEqual([
                { caseId: second!.record.id, documentId: secondDoc!.documentId, status: "COMPLETED", fileCount: 2 },
                { caseId: first!.record.id, documentId: firstDoc!.documentId, status: "DOCUMENTS_CREATED", fileCount: 0 },
            ]);
        });
    }
});
