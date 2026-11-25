import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";

import { resolveBabyRecordAllocation } from "@babyjamjam/shared/client/baby-record-allocation";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordStartDateChangeService } from "application/services/service-record-start-date-change.service";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
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
const householdTemplates = ["CLIENT_GREETING", "SERVICE_INFO"];

function assertTestTarget(): void {
    const origin = "postgresql://bjj_revision_test@127.0.0.1:62295/";
    const allowed = new Set([
        `${origin}throwaway_baby_reg_worker`,
        `${origin}throwaway_baby_reg_verify`,
        `${origin}throwaway_baby_schema_verify`,
    ]);
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
    const aligo = new E2eAligoApiStub();

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
            .overrideProvider(ALIGO_SMS_API_PORT).useValue(aligo)
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
    const confirm = (id: number) => http().patch(`/clients/${id}/confirm-booking`).send({}).expect(200);
    const schedules = (clientId: number) => db.employee_schedule.findMany({
        where: { branchId, clientId }, orderBy: { id: "asc" },
    });
    const errorAt = (body: { errors?: object[] }, pointer: string, code = "INVALID_VALUE") => {
        expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ pointer, code })]));
    };

    async function assertNoRecordEffects(clientId: number) {
        const where = { branchId, clientId };
        expect(await db.service_record_case.count({ where })).toBe(0);
        expect(await db.service_record_job_member.count({ where })).toBe(0);
        expect(await db.message_trigger_job.count({ where: {
            ...where,
            OR: [
                { ruleId: SERVICE_RECORD_LINK_RULE_ID },
                { templateKey: "SERVICE_RECORD_LINK" },
                { recipientType: { in: ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"] } },
                { ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID, employeeScheduleId: { not: null } },
            ],
        } })).toBe(0);
        expect(await db.message_log.count({ where })).toBe(0);
    }

    const approveSender = () => db.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });

    const householdJobs = (clientId: number, status?: string) => db.message_trigger_job.findMany({
        where: { branchId, clientId, templateKey: { in: householdTemplates }, status },
        orderBy: [{ templateKey: "asc" }, { scheduledFor: "asc" }],
        select: {
            id: true, templateKey: true, clientId: true, employeeScheduleId: true, recipientType: true, recipientPhone: true,
            status: true, scheduledFor: true, payload: true, cancelReason: true,
        },
    });

    async function expectPendingHouseholdRoutines(clientId: number, phone: string, startDate: string) {
        const jobs = await householdJobs(clientId, "pending");
        const rule = await db.message_trigger_rule.findFirstOrThrow({
            where: { branchId, templateKey: "SERVICE_INFO", eventType: "SERVICE_START", offsetDays: 7, isActive: true },
            select: { sendTime: true },
        });
        const serviceInfoDay = new Date(Date.parse(startDate) - 7 * 86_400_000).toISOString().slice(0, 10);
        const recipient = {
            clientId, employeeScheduleId: null, recipientType: "CLIENT", recipientPhone: phone, status: "pending",
            payload: expect.objectContaining({ clientId, recipientPhone: phone }),
        };
        expect(jobs).toEqual([
            expect.objectContaining({ ...recipient, templateKey: "CLIENT_GREETING" }),
            expect.objectContaining({
                ...recipient, templateKey: "SERVICE_INFO",
                scheduledFor: new Date(`${serviceInfoDay}T${rule.sendTime}:00+09:00`),
            }),
        ]);
        return { greeting: jobs[0]!, serviceInfo: jobs[1]! };
    }

    async function expectImmediateGreeting(clientId: number, scheduledFor: Date) {
        const { createdAt } = await db.client.findFirstOrThrow({
            where: { branchId, id: clientId }, select: { createdAt: true },
        });
        expect(createdAt?.getTime()).toBeLessThanOrEqual(scheduledFor.getTime());
        expect(scheduledFor.getTime()).toBeLessThanOrEqual(Date.now());
    }

    it("configured prebooking keeps the household greeting and holds record links", async () => {
        const send = jest.spyOn(aligo, "sendSms");
        try {
            await approveSender();
            const assignmentRule = await db.message_trigger_rule.create({ data: {
                branchId, name: "QA-Prebooking assignment notice", isActive: true, eventType: "EMPLOYEE_ASSIGNED",
                offsetType: "IMMEDIATE", recipientType: "PRIMARY_EMPLOYEE", templateKey: "EMPLOYEE_ASSIGNED",
            } });
            const dates = { startDate: dateAt(10), endDate: dateAt(28) };
            const common = { ...dates, serviceStatus: "pre_booking", applyMessageAutomation: true, smsAutomationEnabled: true };
            const configuredPhone = "010-0000-7101";
            const legacyPhone = "010-0000-7102";
            const { body: configured } = await create({ ...twins(employeeIds[0]), ...common, phone: configuredPhone }).expect(201);
            const configuredJobs = await expectPendingHouseholdRoutines(configured.id, configuredPhone, dates.startDate);
            const { body: legacy } = await create({ ...common, type: "B가2형", primaryEmployeeId: employeeIds[1], phone: legacyPhone }).expect(201);
            const legacyJobs = await expectPendingHouseholdRoutines(legacy.id, legacyPhone, dates.startDate);
            await expectImmediateGreeting(configured.id, configuredJobs.greeting.scheduledFor);
            await expectImmediateGreeting(legacy.id, legacyJobs.greeting.scheduledFor);
            expect(configuredJobs.serviceInfo.scheduledFor).toEqual(legacyJobs.serviceInfo.scheduledFor);
            await assertNoRecordEffects(configured.id);
            expect(send).not.toHaveBeenCalled();

            await confirm(configured.id);
            await confirm(legacy.id);
            const confirmed = await committedRows(configured.id);
            await confirm(configured.id);
            await confirm(legacy.id);
            expect(await committedRows(configured.id)).toEqual(confirmed);
            for (const { greeting, serviceInfo } of [configuredJobs, legacyJobs]) {
                expect(await householdJobs(greeting.clientId!)).toEqual([greeting, serviceInfo]);
            }
            const scope = { branchId, clientId: configured.id };
            expect(await db.service_record_case.count({ where: { ...scope, babyId: { not: null } } })).toBe(2);
            expect(await db.service_record_job_member.count({ where: scope })).toBe(0);
            expect(await db.message_trigger_job.count({ where: { ...scope, ruleId: SERVICE_RECORD_LINK_RULE_ID } })).toBe(0);
            expect(await db.message_trigger_job.count({
                where: { ...scope, ruleId: assignmentRule.id, status: "pending" },
            })).toBe(1);
            expect(send).not.toHaveBeenCalled();
        } finally {
            send.mockRestore();
        }
    });

    it("unstaffed configured prebooking schedules household routines like legacy registration", async () => {
        const send = jest.spyOn(aligo, "sendSms");
        try {
            await approveSender();
            const dates = { startDate: dateAt(10), endDate: dateAt(28) };
            const common = { ...dates, serviceStatus: "pre_booking", applyMessageAutomation: true, smsAutomationEnabled: true };
            const configuredPhone = "010-0000-7151";
            const legacyPhone = "010-0000-7152";
            const { body: legacy } = await create({ ...common, type: "B가2형", phone: legacyPhone }).expect(201);
            const { body: configured } = await create({ ...twins(), ...common, phone: configuredPhone }).expect(201);
            expect(configured).toMatchObject({ fetalConfirmation: "CONFIRMED", providers: [] });

            const legacyJobs = await expectPendingHouseholdRoutines(legacy.id, legacyPhone, dates.startDate);
            const configuredJobs = await expectPendingHouseholdRoutines(configured.id, configuredPhone, dates.startDate);
            await expectImmediateGreeting(legacy.id, legacyJobs.greeting.scheduledFor);
            await expectImmediateGreeting(configured.id, configuredJobs.greeting.scheduledFor);
            expect(configuredJobs.serviceInfo.scheduledFor).toEqual(legacyJobs.serviceInfo.scheduledFor);
            expect(await schedules(configured.id)).toEqual([]);
            await assertNoRecordEffects(configured.id);
            expect(send).not.toHaveBeenCalled();
        } finally {
            send.mockRestore();
        }
    });

    it("confirmed allocation edits reschedule pending household jobs for the current phone", async () => {
        await approveSender();
        const startDate = dateAt(10);
        const common = { startDate, endDate: dateAt(30), serviceStatus: "pre_booking", applyMessageAutomation: true, smsAutomationEnabled: true };
        const { body: transition } = await create({ ...common, type: "B가2형", phone: "010-0000-7111" }).expect(201);
        const { body: legacy } = await create({ ...common, type: "B가2형", phone: "010-0000-7121" }).expect(201);
        const initial = await expectPendingHouseholdRoutines(transition.id, "010-0000-7111", startDate);
        const legacyInitial = await expectPendingHouseholdRoutines(legacy.id, "010-0000-7121", startDate);

        const transitionedStart = dateAt(14);
        await edit(transition.id, {
            ...twins(employeeIds[0]), expectedAllocationVersion: transition.allocationVersion,
            startDate: transitionedStart, phone: "010-0000-7112",
        }).expect(200);
        await edit(legacy.id, { startDate: transitionedStart, phone: "010-0000-7122" }).expect(200);
        await assertNoRecordEffects(transition.id);
        const transitioned = await expectPendingHouseholdRoutines(transition.id, "010-0000-7112", transitionedStart);
        const legacyEdited = await expectPendingHouseholdRoutines(legacy.id, "010-0000-7122", transitionedStart);
        expect(transitioned.serviceInfo.scheduledFor).toEqual(legacyEdited.serviceInfo.scheduledFor);

        const finalStart = dateAt(17);
        await edit(transition.id, { startDate: finalStart, phone: "010-0000-7113" }).expect(200);
        await edit(legacy.id, { startDate: finalStart, phone: "010-0000-7123" }).expect(200);
        await assertNoRecordEffects(transition.id);
        const final = await expectPendingHouseholdRoutines(transition.id, "010-0000-7113", finalStart);
        const legacyFinal = await expectPendingHouseholdRoutines(legacy.id, "010-0000-7123", finalStart);
        expect(final.serviceInfo.scheduledFor).toEqual(legacyFinal.serviceInfo.scheduledFor);
        for (const [original, intermediate, latest] of [[initial, transitioned, final], [legacyInitial, legacyEdited, legacyFinal]] as const) {
            for (const { greeting } of [intermediate, latest]) {
                expect(greeting).toMatchObject({ id: original.greeting.id, scheduledFor: original.greeting.scheduledFor });
            }
            expect(await householdJobs(original.greeting.clientId!, "canceled")).toContainEqual(expect.objectContaining({
                id: original.serviceInfo.id, templateKey: "SERVICE_INFO", recipientPhone: original.serviceInfo.recipientPhone,
                scheduledFor: original.serviceInfo.scheduledFor,
            }));
        }
    });

    it("configured prebooking respects each recipient's automation setting", async () => {
        const send = jest.spyOn(aligo, "sendSms");
        try {
            await approveSender();
            const trigger = app.get(MessageTriggerService);
            await trigger.ensureDefaultRulesForBranch(branchId);
            const key = SystemTemplateKey.SERVICE_RECORD_LINK;
            await db.system_template.upsert({
                where: { templateKey: key }, update: {},
                create: { templateKey: key, content: SYSTEM_TEMPLATE_REGISTRY[key].defaultContent },
            });
            const [configuredEmployee, legacyEmployee] = employeeIds as [number, number];
            await db.employee.updateMany({ where: { branchId, id: { in: [configuredEmployee, legacyEmployee] } }, data: { smsAutomationEnabled: true } });
            const common = {
                serviceStatus: "pre_booking", startDate: dateAt(10), endDate: dateAt(30),
                applyMessageAutomation: false, smsAutomationEnabled: false,
            };
            const { body: configured } = await create({ ...twins(configuredEmployee), ...common, phone: "010-0000-7131" }).expect(201);
            const { body: legacy } = await create({ ...common, type: "B가2형", phone: "010-0000-7141" }).expect(201);
            const cases = [
                { clientId: configured.id as number, phone: "010-0000-7132", employeeId: configuredEmployee, staffPhone: "01000000000" },
                { clientId: legacy.id as number, phone: "010-0000-7142", employeeId: legacyEmployee, staffPhone: "01000000001" },
            ];

            for (const { clientId } of cases) {
                await assertNoRecordEffects(clientId);
                expect(await householdJobs(clientId)).toEqual([]);
            }
            expect(send).not.toHaveBeenCalled();

            const newStart = dateAt(14);
            const canceledRoutines = [];
            for (const { clientId, phone } of cases) {
                await edit(clientId, { startDate: newStart, phone }).expect(200);
                await assertNoRecordEffects(clientId);
                // The legacy update path reserves service info for a future date.
                // Exercise its dispatch guard without advancing the scheduler's clock.
                const jobs = await householdJobs(clientId);
                expect(jobs).toEqual([expect.objectContaining({ templateKey: "SERVICE_INFO", status: "pending", clientId, recipientPhone: phone })]);
                await trigger.dispatchPendingJobNow(jobs[0]!.id, { expectedBranchId: branchId });
                const canceled = await householdJobs(clientId);
                expect(canceled).toEqual([{
                    ...jobs[0], status: "canceled", cancelReason: "sms_automation_safeguard:recipient",
                }]);
                canceledRoutines.push(canceled);
                expect(send).not.toHaveBeenCalled();
                // A start date of today makes the ordinary staff link due at confirmation.
                await edit(clientId, { startDate: dateAt(0) }).expect(200);
                await assertNoRecordEffects(clientId);
                expect(await householdJobs(clientId)).toEqual(canceled);
            }

            await confirm(configured.id);
            await confirm(legacy.id);
            // Legacy's ordinary assignment on a confirmed booking creates its link.
            await edit(legacy.id, { primaryEmployeeId: legacyEmployee }).expect(200);
            const statusBeforeReplay = await Promise.all(cases.map(({ clientId }) => committedRows(clientId)));
            await confirm(configured.id);
            await confirm(legacy.id);
            expect(await Promise.all(cases.map(({ clientId }) => committedRows(clientId)))).toEqual(statusBeforeReplay);
            expect(send).not.toHaveBeenCalled();

            for (const [index, { clientId, employeeId, staffPhone }] of cases.entries()) {
                expect(await householdJobs(clientId)).toEqual(canceledRoutines[index]);
                const links = await db.message_trigger_job.findMany({ where: { branchId, clientId, ruleId: SERVICE_RECORD_LINK_RULE_ID } });
                if (clientId === configured.id) {
                    // Employee-group delivery is introduced after schema closure. A scalar
                    // link would lose one of the two records even with a single caregiver.
                    expect(await db.service_record_case.count({ where: { branchId, clientId, babyId: { not: null } } })).toBe(2);
                    expect(await db.service_record_job_member.count({ where: { branchId, clientId } })).toBe(0);
                    expect(links).toEqual([]);
                    continue;
                }
                const legacySchedules = await schedules(clientId);
                expect(legacySchedules).toHaveLength(1);
                const [legacySchedule] = legacySchedules;
                if (!legacySchedule) throw new Error("Expected the legacy caregiver's schedule");
                const previousDay = new Date(legacySchedule.startDate.getTime() - 86_400_000).toISOString().slice(0, 10);
                expect(links).toEqual([expect.objectContaining({
                    status: "pending", clientId, recipientType: "PRIMARY_EMPLOYEE", recipientPhone: staffPhone,
                    scheduledFor: new Date(`${previousDay}T12:00:00+09:00`),
                    payload: expect.objectContaining({ clientId, employeeId }),
                })]);
                const result = await trigger.dispatchPendingJobNow(links[0]!.id, { expectedBranchId: branchId });
                expect(result).toMatchObject({ status: "sent", cancelReason: null });
                expect(await householdJobs(clientId)).toEqual(canceledRoutines[index]);
            }
            expect(send.mock.calls.flatMap(([params]) => params.receiver.split(","))).toEqual(["01000000001"]);
        } finally {
            send.mockRestore();
        }
    });

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
        expect(await db.service_record_case.count({ where: { branchId, clientId: body.id } })).toBe(2);
        const before = await committedRows(body.id);
        await http().patch(`/clients/${body.id}/confirm-booking`).send({}).expect(200);
        expect(await committedRows(body.id)).toEqual(before);
    });

    it("confirmed twins have two different case identities for their two registered babies", async () => {
        const dates = { startDate: dateAt(7), endDate: dateAt(22) };
        const { body }: { body: Registration } = await create({
            ...twins(employeeIds[0], employeeIds[1]), ...dates, serviceStatus: "pre_booking",
        }).expect(201);
        expect(body.babies).toHaveLength(2);
        await assertNoRecordEffects(body.id);

        const { body: booked } = await confirm(body.id);
        expect(booked.babies).toEqual(body.babies);
        const rows = await db.service_record_case.findMany({
            where: { branchId, clientId: body.id },
            orderBy: { babyId: "asc" },
            select: { id: true, babyId: true },
        });
        const identities = rows.map(({ id, babyId }) => ({ caseId: id, babyId }));
        expect(rows).toHaveLength(2);
        expect(new Set(identities.map(({ caseId }) => caseId)).size).toBe(2);
        expect(identities.map(({ babyId }) => babyId)).toEqual(body.babies.map(({ babyId }) => babyId).sort());
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
        const period = { startDate: dateAt(1), endDate: dateAt(10) };
        await create({
            ...period, primaryEmployeeId: employeeIds[2], secondaryEmployeeId: employeeIds[3],
            serviceStatus: "pre_booking", applyMessageAutomation: false,
        }).expect(201);
        await db.employee.updateMany({ where: { id: { in: employeeIds.slice(2, 4) } }, data: { openToNextWork: false } });
        const unavailable = await create(payload).expect(409);
        expect(unavailable.body).toMatchObject({
            code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
            unavailableEmployees: employeeIds.slice(2, 4).map((id) => ({ id, name: expect.any(String) })),
        });
        await create({ ...payload, confirmedUnavailableEmployeeIds: [employeeIds[2]] }, "/clients/with-employee-activation").expect(409);
        const created = await create({
            ...payload, ...period, serviceStatus: "pre_booking", confirmedUnavailableEmployeeIds: employeeIds.slice(2, 4),
        }, "/clients/with-employee-activation").expect(201);
        const schedule = (await schedules(created.body.id))[0]!;
        for (const employeeId of employeeIds.slice(2, 4)) {
            const list = await http().get(`/employee-schedules/secondary-employee?secondaryEmployeeId=${employeeId}`).expect(200);
            expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining({
                id: schedule.id, providers: payload.providers,
            })]));
        }
        const overlap = await create({
            ...period, primaryEmployeeId: employeeIds[3], secondaryEmployeeId: employeeIds[2],
            serviceStatus: "pre_booking", applyMessageAutomation: false,
        }).expect(201);
        expect(await schedules(overlap.body.id)).toEqual([expect.objectContaining({
            primaryEmployeeId: employeeIds[3], secondaryEmployeeId: employeeIds[2],
        })]);
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

    async function bookedTwin(babyIndex: 0 | 1 = 0) {
        const [primary, assistant] = employeeIds as [number, number];
        const { body: client }: { body: Registration } = await create({
            ...twins(primary, assistant), startDate: dateAt(-5), endDate: dateAt(20),
            duration: 5, serviceStatus: "active", applyMessageAutomation: false,
        }).expect(201);
        const babyId = client.babies[babyIndex]?.babyId;
        if (!babyId) throw new Error("Expected the booked twin's registered baby ID");
        const record = await db.service_record_case.findUniqueOrThrow({
            where: { branchId_clientId_babyId: { branchId, clientId: client.id, babyId } },
        });
        return { client, record };
    }

    it("materializes one immediate assignment notice for the successor on a configured PATCH without a name", async () => {
        const { client } = await bookedTwin();
        const replacement = employeeIds[2]!;
        await db.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
        const rule = await db.message_trigger_rule.create({
            data: {
                branchId, name: "QA-Immediate assignment", isActive: true, eventType: "EMPLOYEE_ASSIGNED",
                offsetType: "IMMEDIATE", recipientType: "PRIMARY_EMPLOYEE", templateKey: "EMPLOYEE_ASSIGNED",
            },
        });
        const patch = twinsEdit(client, replacement, employeeIds[1]);
        await edit(client.id, patch).expect(200);
        await edit(client.id, patch).expect(200);

        const [, successor] = await schedules(client.id);
        expect(await db.message_trigger_job.findMany({ where: { branchId, clientId: client.id, ruleId: rule.id } })).toEqual([
            expect.objectContaining({
                employeeScheduleId: successor!.id,
                status: "pending",
                payload: expect.objectContaining({ employeeId: replacement }),
            }),
        ]);
    });

    it("applies the booked twin's date and staff edit in a single commit with one final record lifecycle effect", async () => {
        const { client, record } = await bookedTwin();
        const original = (await schedules(client.id))[0]!;
        const calendar = await app.get(HolidayCalendarService).forBranch(branchId);
        const sourceAssignment = await db.service_record_assignment.findUniqueOrThrow({
            where: { scheduleId_serviceRecordCaseId: { scheduleId: original.id, serviceRecordCaseId: record.id } },
        });
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
        expect(markers).toEqual([expect.objectContaining({
            employeeScheduleId: successor!.id,
            payload: expect.objectContaining({ templateVariables: expect.objectContaining({ includePast: "true" }) }),
        })]);
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
        })).toEqual([expect.objectContaining({
            employeeScheduleId: original!.id,
            payload: expect.objectContaining({ templateVariables: expect.objectContaining({ includePast: "false" }) }),
        })]);
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
        const { client } = await bookedTwin();
        const before = await committedRows(client.id);
        let correctedPeriod: {
            startDate: Date | null;
            sessionCount: number | null;
            byCase: ReadonlyMap<string, number | null> | undefined;
        } | undefined;
        const dateChanges = app.get(ServiceRecordStartDateChangeService);
        const apply = dateChanges.applyInTransaction.bind(dateChanges);
        const injected = jest.spyOn(dateChanges, "applyInTransaction").mockImplementationOnce(async (tx, params) => {
            const result = await apply(tx, params);
            correctedPeriod = {
                startDate: (await tx.client.findUniqueOrThrow({ where: { id: client.id } })).startDate,
                sessionCount: result.restoreRequiredSessionCount,
                byCase: result.restoreByCase,
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
                startDate: new Date(dateAt(9)),
                sessionCount: null,
                byCase: new Map(before.cases.map(({ id, requiredSessionCount }) => [id, requiredSessionCount])),
            });
            expect(await committedRows(client.id)).toEqual(before);
        } finally {
            injected.mockRestore();
        }
    });

    it("preserves signed history across staff replacement and refuses authored-baby retirement", async () => {
        const { client, record } = await bookedTwin(1);
        const original = (await schedules(client.id))[0]!;
        const signed = await db.service_record_day.create({
            data: {
                branchId, scheduleId: original.id, serviceRecordCaseId: record.id,
                caseSessionIndex: 1, sessionIndex: 1, serviceDate: original.startDate,
                employeeId: employeeIds[0], clientSignedAt: new Date(), locked: true, submittedAt: new Date(),
            },
        });
        expect(record.babyId).toBe(client.babies[1]!.babyId);
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
