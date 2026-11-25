import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";

import { resolveServiceRecordCaseTarget } from "application/services/service-record-case-target";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { E2eAligoApiStub } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { ClientModule } from "module/client.module";
import { EmployeeScheduleModule } from "module/employee-schedule.module";
import { MessageDeliveryModule } from "module/message-delivery.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

const origin = "postgresql://bjj_revision_test@127.0.0.1:62295/";
const allowedTargets = new Set([
    origin + "throwaway_baby_lifecycle_work",
    origin + "throwaway_baby_lifecycle_verify",
]);
const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;
const priceYear = 2026;

function assertTestTarget(): void {
    const database = process.env["DATABASE_URL"];
    if (!database || !allowedTargets.has(database) || database !== process.env["DIRECT_URL"] || process.env["NODE_ENV"] !== "test") {
        throw new Error("Baby lifecycle fixtures require identical approved loopback DATABASE_URL and DIRECT_URL in test mode");
    }
}

function dateAt(offset: number): string {
    return new Date(Date.now() + (9 + 24 * offset) * 3_600_000).toISOString().slice(0, 10);
}

type Registration = { id: number; babies: Array<{ babyId: string; ordinal: number }> };
type CaseRow = { caseId: string; babyId: string | null; startDate: Date; endDate: Date; status: string };
type AssignmentRow = { caseId: string; assignmentId: string; employeeId: number; scheduleId: number; endDate: Date };
type DayRow = { caseId: string; dayId: string; employeeId: number; sessionIndex: number; serviceDate: Date; locked: boolean; answers: Prisma.JsonValue };

describeE2E("baby case lifecycle with the staged PostgreSQL keys", () => {
    let app: INestApplication;
    let db: PrismaService;
    let lifecycle: ServiceRecordLifecycleService;
    let branchId: string;
    let otherBranchId: string;
    let ownerId: string;
    let employeeIds: number[];
    const sms = new E2eAligoApiStub();
    const priceRowIds: number[] = [];

    beforeAll(async () => {
        assertTestTarget();
        const fixture = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                TenantModule, ClientModule, EmployeeScheduleModule, MessageDeliveryModule, SchedulerLeaseModule,
            ],
        })
            .overrideGuard(JwtGuard).useValue({
                canActivate(context: ExecutionContext) {
                    const req = context.switchToHttp().getRequest();
                    req.user = { branchId: req.headers["x-test-branch"] ?? branchId, userId: ownerId, role: "owner" };
                    return true;
                },
            })
            .overrideProvider(ALIGO_SMS_API_PORT).useValue(sms)
            .compile();
        app = fixture.createNestApplication({ logger: false });
        const tenant = app.get(TenantAlsMiddleware);
        app.use(tenant.use.bind(tenant));
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new PrismaExceptionFilter());
        await app.init();
        db = app.get(PrismaService);
        lifecycle = app.get(ServiceRecordLifecycleService);

        const prices = ["B가①형", "B가②형", "D가①형", "D가②형"];
        const existing = await db.voucher_price_info.findMany({
            where: { year: priceYear, type: { in: prices }, duration: 31999 }, select: { type: true },
        });
        const maxId = (await db.voucher_price_info.aggregate({ _max: { id: true } }))._max.id ?? 0;
        for (const [index, type] of prices.entries()) {
            if (existing.some((row) => row.type === type)) continue;
            const row = await db.voucher_price_info.create({
                data: { id: maxId + index + 1, year: priceYear, type, duration: 31999,
                    fullPrice: "1400000", grant: "1000000", actualPrice: "400000" },
                select: { id: true },
            });
            priceRowIds.push(row.id);
        }
        ownerId = (await db.user.create({ data: { role: "owner", name: "QA-Lifecycle owner" } })).id;
        otherBranchId = (await db.branch.create({
            data: { name: "QA-Lifecycle other branch", slug: `qa-lifecycle-other-${randomUUID()}` },
        })).id;
    }, 45_000);

    beforeEach(async () => {
        branchId = (await db.branch.create({
            data: { name: "QA-Lifecycle", slug: `qa-lifecycle-${randomUUID()}` },
        })).id;
        employeeIds = (await db.employee.createManyAndReturn({
            data: Array.from({ length: 5 }, (_, index) => ({
                branchId, name: `QA-Lifecycle caregiver ${index + 1}`, phone: `0100000010${index}`,
                grade: "스탠다드", openToNextWork: true,
            })),
            select: { id: true },
        })).map(({ id }) => id);
        jest.spyOn(sms, "sendSms");
    });

    afterEach(() => {
        expect(sms.sendSms).not.toHaveBeenCalled();
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        try {
            if (priceRowIds.length) await db.voucher_price_info.deleteMany({ where: { id: { in: priceRowIds } } });
            // The approved disposable target retains the append-only synthetic history.
        } finally {
            await app?.close();
        }
    });

    const http = () => request(app.getHttpServer());

    const allocation = (fetalType: string, type: string, slots: number[], owners: number[]) => ({
        fetalType, type, voucherIssuanceYear: priceYear, babyCount: owners.length,
        providers: slots.map((employeeId, slot) => ({ employeeId, slot })),
        babyAssignments: owners.map((providerSlot, index) => ({ ordinal: index + 1, providerSlot })),
    });
    const twins = (employees = employeeIds.slice(0, 2)) =>
        allocation("TWINS", "B가2형", employees, [0, employees.length > 1 ? 1 : 0]);

    async function register(values: object): Promise<Registration> {
        const response = await http().post("/clients").send({
            name: "QA-Lifecycle client", voucherClient: true, breastPump: false,
            applyMessageAutomation: false, serviceStatus: "pre_booking", startDate: dateAt(7), endDate: dateAt(24),
            ...values,
        });
        expect({ status: response.status, code: response.body.code }).toEqual({ status: 201, code: undefined });
        return response.body;
    }

    const book = (clientId: number) => http().patch(`/clients/${clientId}/confirm-booking`).send({});
    const getCases = (clientId: number) => db.$queryRaw<CaseRow[]>`
        SELECT c.id AS "caseId", c.baby_id AS "babyId", c.start_date AS "startDate",
            c.end_date AS "endDate", c.status
        FROM service_record_case c
        LEFT JOIN client_baby b ON b.id = c.baby_id AND b.branch_id = c.branch_id AND b.client_id = c.client_id
        WHERE c.branch_id = ${branchId}::uuid AND c.client_id = ${clientId}
        ORDER BY b.ordinal NULLS LAST, c.id
    `;
    const getAssignments = (clientId: number) => db.$queryRaw<AssignmentRow[]>`
        SELECT a.service_record_case_id AS "caseId", a.id AS "assignmentId", a.employee_id AS "employeeId",
            a.schedule_id AS "scheduleId", a.end_date AS "endDate"
        FROM service_record_assignment a
        JOIN service_record_case c ON c.id = a.service_record_case_id AND c.branch_id = a.branch_id
        LEFT JOIN client_baby b ON b.id = c.baby_id
        WHERE a.branch_id = ${branchId}::uuid AND c.client_id = ${clientId}
        ORDER BY b.ordinal NULLS LAST, a.schedule_id
    `;
    const getDays = (clientId: number) => db.$queryRaw<DayRow[]>`
        SELECT d.service_record_case_id AS "caseId", d.id AS "dayId", d.employee_id AS "employeeId",
            d.case_session_index AS "sessionIndex", d.service_date AS "serviceDate", d.locked, d.answers
        FROM service_record_day d
        JOIN service_record_case c ON c.id = d.service_record_case_id AND c.branch_id = d.branch_id
        LEFT JOIN client_baby b ON b.id = c.baby_id
        WHERE d.branch_id = ${branchId}::uuid AND c.client_id = ${clientId}
        ORDER BY b.ordinal NULLS LAST, d.case_session_index
    `;

    async function addDays(clientId: number): Promise<DayRow[]> {
        const assignments = await getAssignments(clientId);
        await db.service_record_day.createMany({
            data: assignments.map(({ caseId, scheduleId, employeeId }, index) => ({
                branchId, serviceRecordCaseId: caseId, scheduleId, employeeId, caseSessionIndex: 1, sessionIndex: 1,
                serviceDate: new Date(dateAt(8)), answers: { fixture: index }, locked: true,
                submittedAt: new Date(), clientSignedAt: new Date(), momApproval: "approved",
            })),
        });
        const days = await getDays(clientId);
        expect(new Set(days.map(({ dayId }) => dayId)).size).toBe(assignments.length);
        expect(days.map(({ caseId, sessionIndex, employeeId }) => [caseId, sessionIndex, employeeId])).toEqual(
            assignments.map(({ caseId, employeeId }) => [caseId, 1, employeeId]));
        return days;
    }

    it("prebooking then booking creates two independent baby records", async () => {
        const client = await register(twins());
        const schedules = await db.employee_schedule.findMany({ where: { branchId, clientId: client.id } });
        expect(schedules).toHaveLength(1);
        expect(await lifecycle.ensureAllForClient(client.id)).toEqual([]);
        expect(await getCases(client.id)).toEqual([]);
        expect(await db.message_trigger_job.count({ where: { branchId, clientId: client.id } })).toBe(0);

        await book(client.id).expect(200);
        const records = await getCases(client.id);
        expect(records.map(({ babyId }) => babyId)).toEqual(client.babies.map(({ babyId }) => babyId));
        expect(new Set(records.map(({ caseId }) => caseId)).size).toBe(2);
        expect((await getAssignments(client.id)).map(({ employeeId }) => employeeId)).toEqual(employeeIds.slice(0, 2));
        const headers = await db.$queryRaw<Array<{ id: string; caseId: string }>>`
            SELECT id, service_record_case_id AS "caseId" FROM service_record
            WHERE branch_id = ${branchId}::uuid AND schedule_id = ${schedules[0]!.id}
        `;
        expect(headers.map(({ caseId }) => caseId).sort()).toEqual(records.map(({ caseId }) => caseId).sort());
        expect(new Set(headers.map(({ id }) => id)).size).toBe(2);
        const links = app.get(ServiceRecordLinkService);
        await expect(links.prepareLink(schedules[0]!.id)).rejects.toMatchObject({ status: 409 });
        await expect(links.scheduleForServiceStart(schedules[0]!.id)).resolves.toBe(false);
        expect(await db.service_record_token.count({ where: { branchId, scheduleId: schedules[0]!.id } })).toBe(0);
        await book(client.id).expect(200);
        expect(await getCases(client.id)).toEqual(records);
        expect(await db.employee_schedule.count({ where: { branchId, clientId: client.id } })).toBe(1);
        expect(await db.message_trigger_job.count({
            where: { branchId, clientId: client.id, ruleId: SERVICE_RECORD_LINK_RULE_ID, status: "pending" },
        })).toBe(0);
    });

    it("two concurrent ensures preserve every sibling case id", async () => {
        const client = await register(twins(employeeIds.slice(0, 1)));
        const schedule = await db.employee_schedule.findFirstOrThrow({ where: { branchId, clientId: client.id } });
        expect(await getCases(client.id)).toEqual([]);
        // Make the fixture eligible without running the booking lifecycle first,
        // so both workers independently encounter missing case rows.
        await db.client.update({
            where: { id: client.id, branchId },
            data: { bookingConfirmedAt: new Date(), serviceStatus: "waiting" },
        });
        const results = await Promise.all([lifecycle.ensureAllForClient(client.id), lifecycle.ensureAllForSchedule(schedule.id)]);
        const expected = await getCases(client.id);
        expect(expected).toHaveLength(2);
        for (const result of results) expect(result.map(({ id }) => id)).toEqual(expected.map(({ caseId }) => caseId));
        expect(await getCases(client.id)).toEqual(expected);
        expect((await getAssignments(client.id)).map(({ employeeId }) => employeeId)).toEqual([employeeIds[0], employeeIds[0]]);
        expect(await lifecycle.ensureForClient(client.id)).toBeNull();
        expect(await lifecycle.ensureForSchedule(schedule.id)).toBeNull();
        const scope = { branchId, clientId: client.id };
        await expect(resolveServiceRecordCaseTarget(db, scope)).resolves.toEqual({ kind: "ambiguous" });
        await expect(resolveServiceRecordCaseTarget(db, { ...scope, caseId: expected[1]!.caseId }))
            .resolves.toMatchObject({ kind: "resolved", rank: 2, babyId: client.babies[1]!.babyId });
        await expect(resolveServiceRecordCaseTarget(db, { ...scope, branchId: otherBranchId, caseId: expected[1]!.caseId }))
            .resolves.toEqual({ kind: "missing" });
        await addDays(client.id);
    });

    it("severe singleton is owned by its assigned assistant", async () => {
        const values = allocation("SEVERE_SINGLETON", "B가2형", employeeIds.slice(0, 2), [1]);
        const client = await register(values);
        await book(client.id).expect(200);
        const [record] = await getCases(client.id);
        expect(record?.babyId).toBe(client.babies[0]!.babyId);
        expect(await getAssignments(client.id)).toEqual([expect.objectContaining({
            caseId: record!.caseId, employeeId: employeeIds[1],
        })]);
        expect(await lifecycle.ensureForClient(client.id)).toMatchObject({ id: record!.caseId });
        expect((await addDays(client.id))[0]!.employeeId).toBe(employeeIds[1]);
        const schedule = await db.employee_schedule.findFirstOrThrow({ where: { branchId, clientId: client.id } });
        await expect(app.get(ServiceRecordLinkService).prepareLink(schedule.id)).rejects.toMatchObject({ status: 409 });
    });

    it("five babies keep separate records across four staff", async () => {
        const client = await register(allocation("QUADRUPLETS_PLUS", "D가2형", employeeIds.slice(0, 4), [0, 1, 2, 3, 0]));
        await book(client.id).expect(200);
        const records = await getCases(client.id);
        expect(records.map(({ babyId }) => babyId)).toEqual(client.babies.map(({ babyId }) => babyId));
        expect(new Set(records.map(({ caseId }) => caseId)).size).toBe(5);
        const assignments = await getAssignments(client.id);
        expect(assignments.map(({ employeeId }) => employeeId)).toEqual([...employeeIds.slice(0, 4), employeeIds[0]]);
        expect(new Set(assignments.map(({ scheduleId }) => scheduleId)).size).toBe(1);
        expect(new Set(assignments.map(({ assignmentId }) => assignmentId)).size).toBe(5);
        await addDays(client.id);
    });

    it("explicit legacy adoption preserves original case and artifacts", async () => {
        const client = await register(twins());
        const schedule = await db.employee_schedule.findFirstOrThrow({ where: { branchId, clientId: client.id } });
        const record = await db.service_record_case.create({
            data: {
                branchId, clientId: client.id, status: "COMPLETED", startDate: schedule.startDate, endDate: schedule.endDate,
                requiredSessionCount: 1, momName: "QA-Historical mother", babyName: "QA-Historical baby",
            },
        });
        const caseScope = { branchId, scheduleId: schedule.id, serviceRecordCaseId: record.id };
        const bound = await db.service_record_day.create({
            data: { ...caseScope, caseSessionIndex: 1, sessionIndex: 1, serviceDate: schedule.startDate,
                employeeId: employeeIds[1], locked: true, clientSignedAt: new Date(), momApproval: "approved" },
        });
        const token = await db.service_record_token.create({
            data: { ...caseScope, employeeId: employeeIds[1]!, linkTokenHash: randomUUID(),
                expectedPhoneHash: randomUUID(), expiresAt: new Date(dateAt(29)) },
        });
        const revision = await db.service_record_revision.create({
            data: {
                branchId, serviceRecordCaseId: record.id, revisionNumber: 1, confirmedByUserId: ownerId,
                payload: { fixture: true }, plannedSessions: [], provenance: {}, formVersionAtConfirm: 1,
            },
        });
        await db.service_record_case.update({
            where: { id: record.id }, data: { currentRevisionId: revision.id },
        });
        const document = await db.eformsign_doc.create({
            data: { branchId, clientId: client.id, serviceRecordCaseId: record.id, employeeScheduleId: schedule.id,
                documentId: randomUUID(), revisionId: revision.id, documentKind: "service_record_snapshot", createdDate: new Date(),
                updatedDate: new Date(), expiredDate: new Date(), statusType: "003", statusDetail: "",
                stepType: "", stepIndex: "", stepName: "", stepRecipientType: "", stepRecipientName: "", stepRecipientSms: "" },
        });
        const pdf = await db.eformsign_doc_file.create({
            data: { eformsignDocId: document.id, fileType: "document", content: Buffer.from("fixture"), byteSize: 7,
                contentType: "application/pdf", sha256: "f".repeat(64), sourceUpdatedDate: document.updatedDate },
        });
        const orphan = await db.service_record_day.create({
            data: { branchId, scheduleId: schedule.id, sessionIndex: 1, serviceDate: schedule.startDate },
        });
        await book(client.id).expect(200);
        expect(await getCases(client.id)).toEqual([expect.objectContaining({ caseId: record.id, babyId: null })]);

        const params = { branchId, clientId: client.id, caseId: record.id, babyId: client.babies[1]!.babyId };
        await expect(lifecycle.linkLegacyCaseToBaby({ ...params, branchId: otherBranchId })).rejects.toMatchObject({ status: 404 });
        await expect(lifecycle.linkLegacyCaseToBaby(params)).resolves.toEqual({ caseId: record.id, babyId: params.babyId });
        const expected = await getCases(client.id);
        expect(expected).toHaveLength(2);
        expect(expected[1]).toMatchObject({ caseId: record.id, babyId: params.babyId, status: "COMPLETED" });
        await lifecycle.linkLegacyCaseToBaby(params);
        await expect(lifecycle.linkLegacyCaseToBaby({ ...params, babyId: client.babies[0]!.babyId }))
            .rejects.toMatchObject({ status: 409 });
        expect(await getCases(client.id)).toEqual(expected);
        expect(await db.service_record_day.findUnique({ where: { id: bound.id } })).toEqual(bound);
        expect(await db.service_record_day.findUnique({ where: { id: orphan.id } })).toEqual(orphan);
        const savedToken = await db.service_record_token.findUniqueOrThrow({ where: { id: token.id } });
        expect(savedToken).toMatchObject({ serviceRecordCaseId: record.id, employeeId: employeeIds[1], active: true });
        expect(savedToken.linkTokenHash === token.linkTokenHash && savedToken.expectedPhoneHash === token.expectedPhoneHash).toBe(true);
        expect(savedToken.expiresAt).toEqual(token.expiresAt);
        expect(await db.service_record_revision.findUnique({ where: { id: revision.id } })).toEqual(revision);
        expect(await db.service_record_case.findUnique({ where: { id: record.id } }))
            .toMatchObject({ currentRevisionId: revision.id });
        expect(await db.eformsign_doc.findUnique({ where: { id: document.id } })).toEqual(document);
        expect(await db.eformsign_doc_file.findUnique({
            where: { id: pdf.id }, select: { eformsignDocId: true, sha256: true, byteSize: true },
        })).toEqual({ eformsignDocId: document.id, sha256: pdf.sha256, byteSize: pdf.byteSize });
    });

    it("one schedule date update preserves authored sibling history", async () => {
        const client = await register(twins());
        await book(client.id).expect(200);
        const days = await addDays(client.id);
        const records = await getCases(client.id);
        const before = await getAssignments(client.id);
        const endDate = dateAt(28);
        await http().patch(`/clients/${client.id}`).send({ endDate }).expect(200);
        expect(await getDays(client.id)).toEqual(days);
        expect(await getCases(client.id)).toEqual(records.map((record) => ({ ...record, endDate: new Date(endDate) })));
        expect(await getAssignments(client.id)).toEqual(before.map((assignment) => ({ ...assignment, endDate: new Date(endDate) })));
        expect(await db.employee_schedule.count({ where: { branchId, clientId: client.id } })).toBe(1);

        await http().patch(`/clients/${client.id}/request-replacement`).send({
            newPrimaryEmployeeId: employeeIds[2], newSecondaryEmployeeId: employeeIds[1],
        }).expect(200);
        expect(await getDays(client.id)).toEqual(days);
        expect(await getCases(client.id)).toEqual(records.map((record) => ({ ...record, endDate: new Date(endDate) })));
        const current = await db.employee_schedule.findFirstOrThrow({ where: { branchId, clientId: client.id, replaced: false } });
        expect((await getAssignments(client.id)).filter(({ scheduleId }) => scheduleId === current.id)
            .map(({ employeeId }) => employeeId)).toEqual([employeeIds[2], employeeIds[1]]);
    });

    it("moves written dates for both siblings while preserving their source and archive", async () => {
        const client = await register(twins());
        await book(client.id).expect(200);
        const before = await addDays(client.id);
        const startDate = dateAt(11);
        const edit = () => http().patch(`/clients/${client.id}`).send({ startDate, startDateChangeMode: "MOVE" });
        await edit().expect(200);
        const after = await getDays(client.id);
        expect(after.map((day, index) => ({ ...day, serviceDate: before[index]?.serviceDate }))).toEqual(before);
        expect(after[0]!.serviceDate).toEqual(after[1]!.serviceDate);
        expect(after[0]!.serviceDate.toISOString()).not.toBe(before[0]!.serviceDate.toISOString());
        expect((await getCases(client.id)).map(({ startDate: date }) => date)).toEqual([new Date(startDate), new Date(startDate)]);
        const archives = await db.service_record_day_archive.findMany({
            where: { branchId, clientId: client.id }, select: { originalDayId: true, serviceRecordCaseId: true, reason: true },
        });
        expect(archives).toHaveLength(2);
        expect(archives).toEqual(expect.arrayContaining(before.map(({ dayId, caseId }) => ({
            originalDayId: dayId, serviceRecordCaseId: caseId, reason: "MOVE",
        }))));
        await edit().expect(200);
        expect(await getDays(client.id)).toEqual(after);
        expect(await db.service_record_day_archive.count({ where: { branchId, clientId: client.id } })).toBe(2);
    });

    it.each([2, 3])("creates all cases when a D household uses %s of its provider slots", async (count) => {
        const owners = Array.from({ length: 5 }, (_, index) => index < count ? index : 0);
        const client = await register(allocation("QUADRUPLETS_PLUS", "D가2형", employeeIds.slice(0, count), owners));
        await book(client.id).expect(200);
        expect((await getCases(client.id)).map(({ babyId }) => babyId)).toEqual(client.babies.map(({ babyId }) => babyId));
        expect((await getAssignments(client.id)).map(({ employeeId }) => employeeId)).toEqual(owners.map((slot) => employeeIds[slot]));
    });

    it("leaves retired case history untouched when service is terminated", async () => {
        const client = await register(twins());
        await book(client.id).expect(200);
        const retired = await db.client_baby.create({ data: { branchId, clientId: client.id, ordinal: 3, active: false } });
        const archivedCase = await db.service_record_case.create({
            data: { branchId, clientId: client.id, babyId: retired.id, status: "SCHEDULED" },
        });
        await lifecycle.markTerminated(client.id, undefined, branchId);
        expect(await getCases(client.id)).toEqual([
            expect.objectContaining({ babyId: client.babies[0]!.babyId, status: "TERMINATED_REVIEW_REQUIRED" }),
            expect.objectContaining({ babyId: client.babies[1]!.babyId, status: "TERMINATED_REVIEW_REQUIRED" }),
            expect.objectContaining({ caseId: archivedCase.id, babyId: retired.id, status: archivedCase.status }),
        ]);
    });

    it("keeps a booked baby without an owner in the assignment waiting state", async () => {
        const client = await register({
            ...allocation("SEVERE_SINGLETON", "B가2형", [], []),
            babyCount: 1,
            babyAssignments: [{ ordinal: 1, providerSlot: null }],
        });
        await book(client.id).expect(200);
        expect(await getCases(client.id)).toEqual([expect.objectContaining({
            babyId: client.babies[0]!.babyId, status: "WAITING_FOR_ASSIGNMENT",
        })]);
        expect(await getAssignments(client.id)).toEqual([]);
    });

    it("keeps the legacy singleton UUID as its sole lifecycle result", async () => {
        const client = await register({ primaryEmployeeId: employeeIds[0] });
        await book(client.id).expect(200);
        const [record] = await getCases(client.id);
        expect(await getCases(client.id)).toHaveLength(1);
        expect(record?.babyId).toBeNull();
        expect(await lifecycle.ensureForClient(client.id)).toMatchObject({ id: record!.caseId });
        expect((await getAssignments(client.id)).map(({ employeeId }) => employeeId)).toEqual([employeeIds[0]]);
    });
});
