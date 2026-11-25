import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";

import { resolveBabyRecordAllocation } from "@babyjamjam/shared/client/baby-record-allocation";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { ServiceRecordStartDateChangeService } from "application/services/service-record-start-date-change.service";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
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

const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;
const PRICE_YEAR = 2026;
const prices = ["B가①형", "B가②형", "C가①형", "C가②형", "D가①형", "D가②형"];

function assertTestTarget(): void {
    const origin = "postgresql://bjj_revision_test@127.0.0.1:62295/";
    const allowed = new Set([`${origin}throwaway_baby_reg_worker`, `${origin}throwaway_baby_reg_verify`]);
    const url = process.env["DATABASE_URL"];
    if (!url || !allowed.has(url) || process.env["DIRECT_URL"] !== url || process.env["NODE_ENV"] !== "test") {
        throw new Error("Registration fixtures require matching DATABASE_URL and DIRECT_URL for the approved loopback PostgreSQL clone");
    }
}

function dateAt(daysFromToday: number): string {
    return new Date(Date.now() + 9 * 3_600_000 + daysFromToday * 86_400_000).toISOString().slice(0, 10);
}

type Baby = { babyId: string; ordinal: number };
type Owner = Baby & { providerSlot: number | null };
type Registration = {
    id: number;
    babies: Baby[];
    babyAssignments: Owner[];
    allocationVersion: string;
    endDate: string | null;
};

function twins(primary?: number, assistant?: number) {
    return {
        type: "B-가-2형",
        voucherIssuanceYear: PRICE_YEAR,
        fetalType: "TWINS",
        babyCount: 2,
        providers: [
            ...(primary === undefined ? [] : [{ slot: 0, employeeId: primary }]),
            ...(assistant === undefined ? [] : [{ slot: 1, employeeId: assistant }]),
        ],
        babyAssignments: [
            { ordinal: 1, providerSlot: primary === undefined ? null : 0 },
            { ordinal: 2, providerSlot: assistant === undefined ? primary === undefined ? null : 0 : 1 },
        ],
    };
}

function twinsEdit(client: Registration, primary?: number, assistant?: number) {
    const input = twins(primary, assistant);
    return {
        ...input,
        expectedAllocationVersion: client.allocationVersion,
        babyAssignments: client.babies.map(({ babyId }, index) => ({
            babyId, providerSlot: input.babyAssignments[index]!.providerSlot,
        })),
    };
}

function quadruplets(employees: number[]) {
    return {
        type: "D가2형",
        voucherIssuanceYear: PRICE_YEAR,
        fetalType: "QUADRUPLETS_PLUS",
        babyCount: 4,
        providers: employees.map((employeeId, slot) => ({ slot, employeeId })),
        babyAssignments: Array.from({ length: 4 }, (_, index) => ({ ordinal: index + 1, providerSlot: index })),
    };
}

describeE2E("baby record registration over the real client HTTP routes", () => {
    let app: INestApplication;
    let db: PrismaService;
    let branchId: string;
    let employeeIds: number[];
    let ownerId: string;
    let otherBranchId: string;
    let outsideEmployee: number;
    let priceRowIds: number[];
    let priorTombstoneSetting: string | undefined;

    beforeAll(async () => {
        assertTestTarget();
        priorTombstoneSetting = process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"];
        process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = "true";
        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                TenantModule, ClientModule, EmployeeScheduleModule, MessageDeliveryModule, SchedulerLeaseModule,
            ],
        })
            .overrideGuard(JwtGuard).useValue({
                canActivate(context: ExecutionContext) {
                    const req = context.switchToHttp().getRequest();
                    req.user = {
                        branchId: req.headers["x-test-branch"] ?? branchId,
                        userId: req.headers["x-test-member"] ?? ownerId,
                        role: req.headers["x-test-member"] ? "user" : "owner",
                    };
                    return true;
                },
            })
            .overrideProvider(ALIGO_SMS_API_PORT).useValue(new E2eAligoApiStub())
            .compile();
        app = module.createNestApplication({ logger: ["error", "warn"] });
        const tenantMiddleware = app.get(TenantAlsMiddleware);
        app.use(tenantMiddleware.use.bind(tenantMiddleware));
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new PrismaExceptionFilter());
        await app.init();
        db = app.get(PrismaService);
        const priced = await db.voucher_price_info.findMany({
            where: { year: PRICE_YEAR, type: { in: prices }, duration: 31999 },
            select: { type: true },
        });
        const missingPrices = prices.filter((type) => !priced.some((row) => row.type === type));
        const { _max: { id: maxPriceId } } = await db.voucher_price_info.aggregate({ _max: { id: true } });
        // The disposable seed may import explicit IDs without advancing its
        // sequence. Allocate fixture IDs explicitly so a PK collision cannot
        // silently remove a required voucher code.
        priceRowIds = (await db.voucher_price_info.createManyAndReturn({
            data: missingPrices.map((type, index) => ({
                id: (maxPriceId ?? 0) + index + 1,
                year: PRICE_YEAR, type, duration: 31999, fullPrice: "1400000", grant: "1000000", actualPrice: "400000",
            })),
            select: { id: true },
        })).map(({ id }) => id);
        ownerId = (await db.user.create({ data: { role: "owner", name: "QA-Registration owner" } })).id;
        otherBranchId = (await db.branch.create({
            data: { name: "QA-Registration other branch", slug: `qa-baby-other-${randomUUID()}` },
        })).id;
        outsideEmployee = (await db.employee.create({
            data: { branchId: otherBranchId, name: "QA-Other employee", phone: "01000000999", grade: "스탠다드", openToNextWork: true },
        })).id;
    }, 45_000);

    beforeEach(async () => {
        branchId = (await db.branch.create({
            data: { name: "QA-Baby registration", slug: `qa-baby-${randomUUID()}` },
        })).id;
        employeeIds = (await db.employee.createManyAndReturn({
            data: Array.from({ length: 5 }, (_, index) => ({
                branchId, name: `QA-Caregiver ${index}`, grade: "스탠다드", openToNextWork: true,
                phone: `0100000000${index}`,
            })),
            select: { id: true },
        })).map(({ id }) => id);
    });

    afterAll(async () => {
        try {
            if (priceRowIds?.length) await db.voucher_price_info.deleteMany({ where: { id: { in: priceRowIds } } });
            // History is deliberately retained by the migrations. The runner
            // disposes of the database, so each scenario uses a fresh branch.
            await app?.close();
        } finally {
            if (priorTombstoneSetting === undefined) delete process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"];
            else process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = priorTombstoneSetting;
        }
    });

    const http = () => request(app.getHttpServer());
    const create = (values: object, path = "/clients") => http().post(path).send({
        name: "QA-Client", voucherClient: true, breastPump: false,
        ...values,
    });
    const edit = (id: number, values: object) => http().patch(`/clients/${id}`).send(values);
    const get = (id: number) => http().get(`/clients/${id}`);
    const schedules = (clientId: number) => db.employee_schedule.findMany({
        where: { branchId, clientId }, orderBy: { id: "asc" },
    });
    const errorAt = (body: { errors?: object[] }, pointer: string, code = "INVALID_VALUE") => {
        expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ pointer, code })]));
    };

    async function assertNoRecordEffects(clientId: number) {
        const where = { branchId, clientId };
        expect(await db.service_record_case.count({ where })).toBe(0);
        expect(await db.message_trigger_job.count({ where })).toBe(0);
        expect(await db.message_log.count({ where })).toBe(0);
    }

    it.each([false, true])("retains one pre-booking schedule with staff (service dates supplied: %s)", async (dated) => {
        const [primary, assistant] = employeeIds as [number, number];
        const response = await create({
            ...twins(primary, assistant), serviceStatus: "pre_booking",
            ...(dated ? { startDate: dateAt(8), endDate: dateAt(28) } : {}),
        });
        expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
        const { body } = response;
        const all = await schedules(body.id);
        expect(all).toHaveLength(1);
        expect(all[0]).toMatchObject({ primaryEmployeeId: primary, secondaryEmployeeId: assistant });
        if (dated) expect(all[0]!.startDate.toISOString().slice(0, 10)).toBe(dateAt(8));
        const reopened = await get(body.id).expect(200);
        expect(reopened.body).toMatchObject({
            fetalType: "TWINS", fetalConfirmation: "CONFIRMED", babyCount: 2, historicalMaxOrdinal: 2,
            babies: body.babies,
            providers: twins(primary, assistant).providers,
            babyAssignments: [
                { ...body.babies[0], providerSlot: 0 },
                { ...body.babies[1], providerSlot: 1 },
            ],
            allocationVersion: body.allocationVersion,
        });
        expect(new Set(body.babies.map((baby: Baby) => baby.babyId)).size).toBe(2);
        const list = await http().get("/clients?page=1").expect(200);
        expect(list.body.data).toEqual([expect.objectContaining({
            id: body.id, allocationVersion: body.allocationVersion, babyAssignments: reopened.body.babyAssignments,
        })]);
        await assertNoRecordEffects(body.id);
    });

    it("keeps unstaffed twins without a schedule and reuses the first assignment path", async () => {
        const { body } = await create(twins()).expect(201);
        expect(await schedules(body.id)).toHaveLength(0);
        expect(body.babyAssignments).toEqual(body.babies.map((baby: Baby) => ({ ...baby, providerSlot: null })));
        const primary = employeeIds[0]!;
        await edit(body.id, { primaryEmployeeId: primary }).expect(200);
        const reopened = await get(body.id).expect(200);
        expect(reopened.body.babies).toEqual(body.babies);
        expect(reopened.body.babyAssignments).toEqual(body.babies.map((baby: Baby) => ({ ...baby, providerSlot: 0 })));
        expect(await schedules(body.id)).toHaveLength(1);
        await assertNoRecordEffects(body.id);
    });

    it("holds a configured customer's case and jobs until booking confirmation", async () => {
        const { body } = await create(twins(employeeIds[0], employeeIds[1])).expect(201);
        const [initialSchedule] = await schedules(body.id);
        const dates = { startDate: dateAt(7), endDate: dateAt(22) };
        await edit(body.id, dates).expect(200);
        expect(await schedules(body.id)).toEqual([expect.objectContaining({
            id: initialSchedule!.id, startDate: new Date(dates.startDate), endDate: new Date(dates.endDate),
        })]);
        await assertNoRecordEffects(body.id);
        const confirmed = await http().patch(`/clients/${body.id}/confirm-booking`).send({}).expect(200);
        expect(confirmed.body).toMatchObject({
            fetalConfirmation: "CONFIRMED", babies: body.babies, bookingConfirmedAt: expect.any(String),
        });
        expect(await db.service_record_case.count({ where: { branchId, clientId: body.id } })).toBe(1);
        const before = await committedRows(body.id);
        await http().patch(`/clients/${body.id}/confirm-booking`).send({}).expect(200);
        expect(await committedRows(body.id)).toEqual(before);
    });

    it("round-trips a severe singleton's explicit assistant owner and preserves it on a legacy edit", async () => {
        const [primary, assistant] = employeeIds as [number, number];
        const { body } = await create({
            ...twins(primary, assistant), fetalType: "SEVERE_SINGLETON", babyCount: 1,
            babyAssignments: [{ ordinal: 1, providerSlot: 1 }],
        }).expect(201);
        const edited = await edit(body.id, { name: "QA-Edited" }).expect(200);
        const reopened = await get(body.id).expect(200);
        expect(reopened.body).toMatchObject({
            name: "QA-Edited", fetalType: "SEVERE_SINGLETON", babyCount: 1,
            babyAssignments: [{ ...body.babies[0], providerSlot: 1 }],
            allocationVersion: body.allocationVersion,
        });
        expect(edited.body.babyAssignments).toEqual(reopened.body.babyAssignments);
        const remove = await edit(body.id, { secondaryEmployeeId: null }).expect(409);
        errorAt(remove.body, "/secondaryEmployeeId");
        const downgrade = await edit(body.id, { type: "B가1형" }).expect(409);
        errorAt(downgrade.body, "/type");
        await assertNoRecordEffects(body.id);
    });

    it("round-trips an unassigned severe singleton and tombstones retained babies", async () => {
        const payload = {
            ...twins(), fetalType: "SEVERE_SINGLETON", babyCount: 1,
            babyAssignments: [{ ordinal: 1, providerSlot: null }],
        };
        const { body } = await create(payload).expect(201);
        expect((await get(body.id).expect(200)).body.babyAssignments).toEqual([
            { ...body.babies[0], providerSlot: null },
        ]);
        await assertNoRecordEffects(body.id);
        await http().delete(`/clients/${body.id}`).expect(200);
        expect(await db.client.findUnique({ where: { id: body.id }, select: { deletedAt: true } }))
            .toEqual({ deletedAt: expect.any(Date) });
        expect(await db.client_baby.count({ where: { clientId: body.id } })).toBe(1);
        const hard = await create({ applyMessageAutomation: false }).expect(201);
        await http().delete(`/clients/${hard.body.id}`).expect(200);
        expect(await db.client.findUnique({ where: { id: hard.body.id } })).toBeNull();
    });

    it("keeps a legacy B client unconfirmed and uses its original single record lifecycle", async () => {
        await db.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
        const { body } = await create({
            type: "B가2형", primaryEmployeeId: employeeIds[0],
            startDate: dateAt(7), endDate: dateAt(28), duration: 3,
            serviceStatus: "waiting", applyMessageAutomation: false,
        }).expect(201);
        expect(body).toMatchObject({ fetalConfirmation: "UNCONFIRMED", babyCount: 0, babies: [] });
        expect(await db.service_record_case.count({ where: { branchId, clientId: body.id, babyId: null } })).toBe(1);
        expect(await db.message_trigger_job.count({ where: { branchId, clientId: body.id, ruleId: SERVICE_RECORD_LINK_RULE_ID } })).toBe(1);
    });

    it("reports nested pointers, missing/catalog year, unknown voucher, and mixed staff fields", async () => {
        const input = twins(employeeIds[0], employeeIds[1]);
        for (const { fields, pointer, code } of [
            { fields: { voucherIssuanceYear: undefined }, pointer: "/voucherIssuanceYear", code: "REQUIRED" },
            { fields: { voucherIssuanceYear: 2177 }, pointer: "/voucherIssuanceYear" },
            { fields: { type: "B가3형" }, pointer: "/type" },
            { fields: { type: "B가1형" }, pointer: "/providers/1/slot" },
            { fields: { secondaryEmployeeId: null }, pointer: "/providers" },
            { fields: { fetalType: "TRIPLETS" }, pointer: "/fetalType" },
            { fields: { providers: [input.providers[1], { ...input.providers[0], employeeId: employeeIds[1] }] }, pointer: "/providers/1/employeeId" },
            { fields: { providers: [{ ...input.providers[0], branchId }] }, pointer: "/providers/0/branchId", code: "UNEXPECTED_FIELD" },
            { fields: { babyAssignments: [{ ordinal: 1, providerSlot: 1 }, { ordinal: 2, providerSlot: 0 }] }, pointer: "/babyAssignments/0/providerSlot" },
        ]) {
            const response = await create({ ...input, ...fields }).expect(400);
            expect(response.body.code).toBe("VALIDATION_FAILED");
            errorAt(response.body, pointer, code);
        }
        const assistantOnly = await create({
            secondaryEmployeeId: employeeIds[1], applyMessageAutomation: false,
        }).expect(400);
        errorAt(assistantOnly.body, "/secondaryEmployeeId", "INVALID_FORMAT");
        expect(await db.client.count({ where: { branchId } })).toBe(0);
    });

    it("checks C and D caps against dated catalog codes", async () => {
        const desired = quadruplets(employeeIds.slice(0, 4));
        const tooMany = await create({ ...desired, type: "D가1형" }).expect(400);
        // D① has a lower staff cap even when the fetal type is valid.
        errorAt(tooMany.body, "/providers/2/slot");
        const three = await create({
            ...desired, type: "C가2형", fetalType: "TRIPLETS", babyCount: 3,
            providers: desired.providers.slice(0, 3), babyAssignments: desired.babyAssignments.slice(0, 3),
        }).expect(201);
        expect(three.body.providers).toHaveLength(3);
        const rules = resolveBabyRecordAllocation({
            service: "voucher", mode: "submission", code: "C가①형", issuanceYear: PRICE_YEAR,
            catalog: { [PRICE_YEAR]: ["C가①형"] }, fetalType: "TRIPLETS", babyCount: 3,
            providers: [{ slot: 2, employeeId: employeeIds[2]! }],
        });
        expect(rules).toMatchObject({ status: "invalid", issue: { field: "providers", code: "disabled-slot" } });
    });

    it("checks slot 2/3 activation and availability and includes both in schedule reads", async () => {
        const payload = quadruplets(employeeIds.slice(0, 4));
        await db.employee.updateMany({ where: { id: { in: employeeIds.slice(2, 4) } }, data: { openToNextWork: false } });
        const unavailable = await create(payload).expect(409);
        expect(unavailable.body).toMatchObject({
            code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
            unavailableEmployees: employeeIds.slice(2, 4).map((id) => ({ id, name: expect.any(String) })),
        });
        await create({ ...payload, confirmedUnavailableEmployeeIds: [employeeIds[2]] }, "/clients/with-employee-activation").expect(409);
        const created = await create({
            ...payload, confirmedUnavailableEmployeeIds: employeeIds.slice(2, 4),
        }, "/clients/with-employee-activation").expect(201);
        const schedule = (await schedules(created.body.id))[0]!;
        for (const employeeId of employeeIds.slice(2, 4)) {
            const list = await http().get(`/employee-schedules/secondary-employee?secondaryEmployeeId=${employeeId}`).expect(200);
            expect(list.body).toEqual([expect.objectContaining({ id: schedule.id, providers: payload.providers })]);
            const overlap = await create({
                ...twins(employeeId), startDate: dateAt(1), endDate: dateAt(10),
            }).expect(409);
            expect(overlap.body.code).toBe("EMPLOYEE_SCHEDULE_OVERLAP");
        }
        await assertNoRecordEffects(created.body.id);
    });

    it("rejects foreign staff, foreign babies, and a member without branch access", async () => {
        const input = twins(employeeIds[0], employeeIds[1]);
        const foreign = await create(twins(employeeIds[0], outsideEmployee)).expect(400);
        expect(foreign.body.code).toBe("EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE");
        const { body } = await create(input).expect(201);
        const foreignBaby = await edit(body.id, {
            ...twinsEdit(body, employeeIds[0], employeeIds[1]),
            babyAssignments: [{ babyId: randomUUID(), providerSlot: 0 }, { babyId: body.babies[1].babyId, providerSlot: 1 }],
        }).expect(400);
        errorAt(foreignBaby.body, "/babyAssignments/0/babyId");
        const member = await db.user.create({ data: { name: "QA-Member", role: "user" } });
        await db.user_branch.create({ data: { userId: member.id, branchId: otherBranchId, role: "manager" } });
        await get(body.id).set("x-test-member", member.id).expect(403);
        await edit(body.id, { name: "QA-Wrong branch" }).set("x-test-branch", otherBranchId).expect(404);
        expect((await get(body.id).expect(200)).body.allocationVersion).toBe(body.allocationVersion);
    });

    it("keeps gapped stored ordinals, never recycles retired ordinals, and retries an identical addition", async () => {
        const [primary, assistant] = employeeIds as [number, number];
        const { body } = await create({
            ...twins(primary, assistant), fetalType: "SEVERE_SINGLETON", babyCount: 1,
            babyAssignments: [{ ordinal: 1, providerSlot: 0 }],
        }).expect(201);
        const firstAdd = {
            ...twins(primary, assistant), expectedAllocationVersion: body.allocationVersion,
            babyAssignments: [{ babyId: body.babies[0].babyId, providerSlot: 0 }, { ordinal: 2, providerSlot: 1 }],
        };
        const added = (await edit(body.id, firstAdd).expect(200)).body;
        const duplicate = await edit(body.id, firstAdd).expect(200);
        expect(duplicate.body.babies).toEqual(added.babies);
        expect(duplicate.body.allocationVersion).toBe(added.allocationVersion);
        const reduced = await edit(body.id, {
            ...twins(primary, assistant), fetalType: "SEVERE_SINGLETON", babyCount: 1,
            expectedAllocationVersion: added.allocationVersion,
            babyAssignments: [{ babyId: added.babies[0].babyId, providerSlot: 0 }],
        }).expect(200);
        expect(reduced.body.historicalMaxOrdinal).toBe(2);
        const resurrect = await edit(body.id, { ...firstAdd, expectedAllocationVersion: reduced.body.allocationVersion }).expect(400);
        errorAt(resurrect.body, "/babyAssignments/1/ordinal");
        const gapped = await edit(body.id, {
            ...firstAdd, expectedAllocationVersion: reduced.body.allocationVersion,
            babyAssignments: [firstAdd.babyAssignments[0], { ordinal: 3, providerSlot: 1 }],
        }).expect(200);
        expect(gapped.body.babies).toEqual([added.babies[0], { babyId: expect.any(String), ordinal: 3 }]);
        expect(gapped.body.babies[1].babyId).not.toBe(added.babies[1].babyId);
        expect((await get(body.id).expect(200)).body.babyAssignments[1].providerSlot).toBe(1);
        const stale = await edit(body.id, {
            ...twinsEdit(gapped.body, primary, assistant), expectedAllocationVersion: added.allocationVersion,
            babyAssignments: gapped.body.babies.map(({ babyId }: Baby) => ({ babyId, providerSlot: 0 })),
        }).expect(409);
        errorAt(stale.body, "/expectedAllocationVersion");
    });

    it("admits only one divergent concurrent save and one create per phone", async () => {
        const [primary, assistant, replacement] = employeeIds as [number, number, number];
        const values = { ...twins(primary, assistant), phone: "010-0000-4201" };
        const createResults = await Promise.all([create(values), create(values)]);
        expect(createResults.map(({ status }) => status).sort()).toEqual([201, 409]);
        const initial: Registration = createResults.find(({ status }) => status === 201)!.body;
        const left = twinsEdit(initial, replacement, assistant);
        const right = twinsEdit(initial, primary, replacement);
        const edits = await Promise.all([edit(initial.id, left), edit(initial.id, right)]);
        expect(edits.map(({ status }) => status).sort()).toEqual([200, 409]);
        errorAt(edits.find(({ status }) => status === 409)!.body, "/expectedAllocationVersion");
        expect(await db.client_baby.count({ where: { branchId, clientId: initial.id } })).toBe(2);
        expect(await schedules(initial.id)).toHaveLength(2);
        await assertNoRecordEffects(initial.id);
    });

    async function bookedTwin() {
        const [primary, assistant] = employeeIds as [number, number];
        const { body } = await create({
            ...twins(primary, assistant), startDate: dateAt(-5), endDate: dateAt(20),
            duration: 5, serviceStatus: "active", applyMessageAutomation: false,
        }).expect(201);
        const record = await db.service_record_case.findFirstOrThrow({ where: { branchId, clientId: body.id } });
        return { client: body as Registration, record };
    }

    it("applies the booked twin's date and staff edit in a single commit with one final record lifecycle effect", async () => {
        const { client, record } = await bookedTwin();
        const original = (await schedules(client.id))[0]!;
        const calendar = await app.get(HolidayCalendarService).forBranch(branchId);
        const sourceAssignment = await db.service_record_assignment.findUniqueOrThrow({ where: { scheduleId: original.id } });
        expect(record.requiredSessionCount).toBeGreaterThan(0);
        const vector = Array.from({ length: record.requiredSessionCount! }, (_, index) => {
            const serviceDate = calendar.calcEndDateBusinessDays(original.startDate.toISOString().slice(0, 10), index + 1);
            return {
                sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
                assignmentId: sourceAssignment.id, scheduleId: original.id,
                employeeId: original.primaryEmployeeId, provenanceVersion: String(record.version),
            };
        });
        await db.service_record_case.update({ where: { id: record.id }, data: { plannedSessions: vector } });
        const startDate = dateAt(9);
        const form = {
            ...twinsEdit(client, employeeIds[2], employeeIds[1]),
            startDate, startDateChangeMode: "CONFIRM_STARTED",
        };
        const response = await edit(client.id, form).expect(200);
        expect(response.body.babies).toEqual(client.babies);
        const rows = await schedules(client.id);
        expect(rows).toHaveLength(2);
        const [old, successor] = rows;
        expect(old).toMatchObject({ id: original.id, replaced: true, primaryEmployeeId: employeeIds[0] });
        expect(successor).toMatchObject({ replaced: false, primaryEmployeeId: employeeIds[2] });
        expect(successor!.startDate.toISOString().slice(0, 10)).toBe(calendar.calcEndDateBusinessDays(startDate, 1));
        expect(successor!.endDate.toISOString()).toBe(response.body.endDate);
        const markers = await db.message_trigger_job.findMany({
            where: { branchId, clientId: client.id, ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID, employeeScheduleId: { not: null } },
        });
        expect(markers.map((marker) => marker.employeeScheduleId)).toEqual([successor!.id]);
        expect(await db.message_trigger_job.count({
            where: { branchId, clientId: client.id, ruleId: SERVICE_RECORD_LINK_RULE_ID, status: "pending" },
        })).toBeLessThanOrEqual(1);
        expect((await db.service_record_case.findUnique({ where: { id: record.id } }))?.startDate?.toISOString().slice(0, 10)).toBe(startDate);
        expect((await edit(client.id, form).expect(200)).body.allocationVersion).toBe(response.body.allocationVersion);
    });

    it("keeps legacy combined date/staff refusal and persists date-only reevaluation on the current schedule", async () => {
        const { client } = await bookedTwin();
        const [original] = await schedules(client.id);
        const date = { startDate: dateAt(9), startDateChangeMode: "CONFIRM_STARTED" };
        const combined = await edit(client.id, { ...date, primaryEmployeeId: employeeIds[2] }).expect(409);
        expect(combined.body.scheduleCode).toBe("REALIGNMENT_REQUIRES_MANUAL_SCHEDULE");
        const corrected = await edit(client.id, date).expect(200);
        expect(corrected.body).toMatchObject({
            allocationVersion: expect.any(String), babies: client.babies, babyAssignments: client.babyAssignments,
        });
        expect(await schedules(client.id)).toEqual([expect.objectContaining({
            id: original!.id, primaryEmployeeId: employeeIds[0], replaced: false,
        })]);
        expect(await db.message_trigger_job.findMany({
            where: { branchId, clientId: client.id, ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID, employeeScheduleId: { not: null } },
        })).toEqual([expect.objectContaining({ employeeScheduleId: original!.id })]);
    });

    async function committedRows(clientId: number) {
        const where = { branchId, clientId };
        return {
            client: await db.client.findUnique({ where: { id: clientId } }),
            schedules: await schedules(clientId),
            cases: await db.service_record_case.findMany({ where, orderBy: { id: "asc" } }),
            babies: await db.client_baby.findMany({ where, orderBy: { id: "asc" } }),
            team: await db.service_record_team_slot.findMany({ where, orderBy: { id: "asc" } }),
            owners: await db.service_record_baby_assignment.findMany({ where, orderBy: { id: "asc" } }),
            jobs: await db.message_trigger_job.findMany({ where, orderBy: { id: "asc" } }),
            archives: await db.service_record_day_archive.findMany({ where, orderBy: { id: "asc" } }),
        };
    }

    it("rolls back every row on a genuine stored-vector refusal", async () => {
        const { client, record } = await bookedTwin();
        await db.service_record_case.update({
            where: { id: record.id }, data: { plannedSessions: [{ sessionIndex: 9 }] as Prisma.InputJsonValue },
        });
        const before = await committedRows(client.id);
        const response = await edit(client.id, {
            ...twinsEdit(client, employeeIds[2], employeeIds[1]),
            startDate: dateAt(9), startDateChangeMode: "CONFIRM_STARTED",
        }).expect(409);
        expect(response.body.code).toBe("SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE");
        expect(await committedRows(client.id)).toEqual(before);
    });

    it("rolls back period and allocation when an exception occurs after realignment", async () => {
        const { client, record } = await bookedTwin();
        const before = await committedRows(client.id);
        let correctedPeriod: { startDate: Date | null; sessionCount: number | null } | undefined;
        const dateChanges = app.get(ServiceRecordStartDateChangeService);
        const apply = dateChanges.applyInTransaction.bind(dateChanges);
        const injected = jest.spyOn(dateChanges, "applyInTransaction").mockImplementationOnce(async (tx, params) => {
            const result = await apply(tx, params);
            correctedPeriod = {
                startDate: (await tx.client.findUniqueOrThrow({ where: { id: client.id } })).startDate,
                sessionCount: result.restoreRequiredSessionCount,
            };
            throw new Error("QA rollback after period correction");
        });
        try {
            await edit(client.id, {
                ...twinsEdit(client, employeeIds[2], employeeIds[1]),
                startDate: dateAt(9), startDateChangeMode: "CONFIRM_STARTED",
            }).expect(500);
            expect(injected).toHaveBeenCalledTimes(1);
            expect(correctedPeriod).toEqual({
                startDate: new Date(dateAt(9)), sessionCount: record.requiredSessionCount,
            });
            expect(await committedRows(client.id)).toEqual(before);
        } finally {
            injected.mockRestore();
        }
    });

    it("preserves signed history across staff replacement and refuses authored-baby retirement", async () => {
        const { client, record } = await bookedTwin();
        const original = (await schedules(client.id))[0]!;
        const signed = await db.service_record_day.create({
            data: {
                branchId, scheduleId: original.id, serviceRecordCaseId: record.id,
                caseSessionIndex: 1, sessionIndex: 1, serviceDate: original.startDate,
                employeeId: employeeIds[0], clientSignedAt: new Date(), locked: true, submittedAt: new Date(),
            },
        });
        await db.service_record_case.update({ where: { id: record.id }, data: { babyId: client.babies[1]!.babyId } });
        const remove = await edit(client.id, {
            ...twins(employeeIds[0], employeeIds[1]), fetalType: "SEVERE_SINGLETON", babyCount: 1,
            expectedAllocationVersion: client.allocationVersion,
            babyAssignments: [{ babyId: client.babies[0]!.babyId, providerSlot: 0 }],
        }).expect(409);
        errorAt(remove.body, "/babyCount");
        const replaced = await http().patch(`/clients/${client.id}/request-replacement`).send({
            newPrimaryEmployeeId: employeeIds[2], newSecondaryEmployeeId: employeeIds[1],
        }).expect(200);
        expect(replaced.body.babies).toEqual(client.babies);
        expect(await db.service_record_day.findUnique({ where: { id: signed.id } })).toEqual(signed);
        expect(await schedules(client.id)).toHaveLength(2);
    });

    it("rejects legacy replacement colliding with slot 3 and then copies both assistants to the successor", async () => {
        const payload = quadruplets(employeeIds.slice(0, 4));
        const { body } = await create({
            ...payload, startDate: dateAt(-5), endDate: dateAt(20), serviceStatus: "active", applyMessageAutomation: false,
        }).expect(201);
        const replacement = (primary: number) => http().patch(`/clients/${body.id}/request-replacement`).send({
            newPrimaryEmployeeId: primary, newSecondaryEmployeeId: employeeIds[1],
        });
        const refused = await replacement(employeeIds[3]!).expect(409);
        errorAt(refused.body, "/newPrimaryEmployeeId");
        expect(await schedules(body.id)).toHaveLength(1);
        const accepted = await replacement(employeeIds[4]!).expect(200);
        expect(accepted.body.providers.slice(1)).toEqual(payload.providers.slice(1));
        expect(accepted.body.babyAssignments).toEqual(body.babyAssignments);
        expect(await schedules(body.id)).toHaveLength(2);
    });
});
