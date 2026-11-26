import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";

import { closeScheduleAllocation, persistClientAllocation } from "application/services/client-allocation.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { lockClientForScheduleWrite } from "application/policies/employee-schedule-invariants.policy";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ServiceRecordEntryController } from "interface/controllers/service-record-entry.controller";
import { HolidayModule } from "module/holiday.module";

const origin = "postgresql://bjj_revision_test@127.0.0.1:62295/";
const legacyTarget = origin + "throwaway_baby_access_verify_legacy";
const allowed = new Set([origin + "throwaway_baby_access_work", origin + "throwaway_baby_access_verify", origin + "throwaway_baby_schema_verify_consumers", legacyTarget]);
const enabled = process.env["E2E_VENDOR_STUBS"] === "1";
const legacyKeys = process.env["DATABASE_URL"] === legacyTarget;
const describeE2E = enabled ? describe : describe.skip;

function assertTarget() {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl || !allowed.has(databaseUrl) || process.env["DIRECT_URL"] !== databaseUrl
        || process.env["NODE_ENV"] !== "test") {
        throw new Error("Baby case access fixtures require both URLs to match an approved disposable loopback database");
    }
}

const start = new Date("2026-07-20T00:00:00.000Z");
const end = new Date("2026-07-31T00:00:00.000Z");
const signature = "data:image/png;base64,aGVsbG8=";
const phone = ["01000009001", "01000009002", "01000009003"] as const;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const header = {
    momName: "가나다", momBirth: "1990-01-01", babyBirth: "2026-07-14",
    babyWeight: "3.2", deliveryType: "자연분만",
};

describeE2E("caregiver case authority over the real public routes", () => {
    let app: INestApplication;
    let db: PrismaService;
    let tokens: ServiceRecordTokenService;
    let entry: ServiceRecordEntryService;
    let links: ServiceRecordLinkService;

    beforeAll(async () => {
        assertTarget();
        // Keep the rate limiter on its real PostgreSQL path even on a host
        // with a Valkey URL configured for a separate environment.
        const env = jest.replaceProperty(process, "env", {
            ...process.env, VALKEY_URL: "", AUTH_RATE_LIMIT_DISABLED: "false", DATABASE_CONNECTION_MODE: "shared",
        });
        try {
            const module = await Test.createTestingModule({
                imports: [TenantModule, HolidayModule],
                controllers: [ServiceRecordEntryController],
                providers: [ServiceRecordEntryService, ServiceRecordTokenService, ServiceRecordLifecycleService, RateLimitGuard, ServiceRecordGuard],
            }).compile();
            app = module.createNestApplication({ logger: false });
            const tenant = app.get(TenantAlsMiddleware);
            app.use(tenant.use.bind(tenant));
            app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
            app.useGlobalFilters(new PrismaExceptionFilter());
            await app.init();
            db = app.get(PrismaService);
            tokens = app.get(ServiceRecordTokenService);
            entry = app.get(ServiceRecordEntryService);
            links = new ServiceRecordLinkService(db, tokens, new ConfigService(),
                new SbMessageTriggerJobRepository(db), new SbMessageLogRepository(db),
                new SbMessageTriggerRuleBranchOverrideRepository(db));
        } finally {
            env.restore();
        }
    });

    afterAll(async () => { await app?.close(); });

    const http = () => request(app.getHttpServer());
    const verify = (linkToken: string, providedPhone: string) => http().post("/service-record/verify").send({ linkToken, phone: providedPhone });
    const status = (linkToken: string) => http().get(`/service-record/link/${encodeURIComponent(linkToken)}`);
    const context = (access: string) => http().get("/service-record/context").auth(access, { type: "bearer" });
    const setHeader = (access: string, babyName: string) => http().put("/service-record/header")
        .auth(access, { type: "bearer" }).send({ ...header, babyName });
    const saveDay = (access: string, notes: string) => http().put("/service-record/sessions/1")
        .auth(access, { type: "bearer" }).send({ serviceDate: "2026-07-20", notes });
    const submit = (access: string, notes: string, clientSignature = signature) => http().post("/service-record/sessions/1/submit")
        .auth(access, { type: "bearer" }).send({ serviceDate: "2026-07-20", notes, momApproval: "approved", clientSignature });
    const scoped = <T>(branchId: string, operation: () => Promise<T>) =>
        tenantContextStore.run({ origin: "http", branchId }, operation);

    async function authorize(link: string, providedPhone: string): Promise<string> {
        const response = await verify(link, providedPhone).expect(201);
        if (response.body.ok !== true || typeof response.body.accessToken !== "string") {
            throw new Error("The current scoped caregiver failed verification");
        }
        return response.body.accessToken;
    }

    async function fixture(singleton = false, split = false) {
        const branch = await db.branch.create({ data: { name: "QA-Baby access", slug: `qa-baby-access-${randomUUID()}` } });
        return scoped(branch.id, async () => {
            const employees = await Promise.all(phone.map((number, index) => db.employee.create({
                data: { branchId: branch.id, name: `QA-Caregiver ${index + 1}`, phone: number, grade: "스탠다드" },
            })));
            const [primary, assistant, next] = employees as [typeof employees[number], typeof employees[number], typeof employees[number]];
            const client = await db.client.create({
                data: { branchId: branch.id, name: "QA-Client", serviceStatus: "active", voucherClient: true,
                    bookingConfirmedAt: start, startDate: start, endDate: end },
            });
            const scope = { branchId: branch.id, clientId: client.id };
            const schedule = await db.employee_schedule.create({
                data: { ...scope, primaryEmployeeId: primary.id, secondaryEmployeeId: assistant.id,
                    workAddress: "", startDate: start, endDate: end },
            });
            const providers = [{ slot: 0 as const, employeeId: primary.id }, { slot: 1 as const, employeeId: assistant.id }];
            if (!singleton) {
                await db.$transaction(async tx => {
                    await lockClientForScheduleWrite(tx, branch.id, client.id);
                    await persistClientAllocation(tx, scope, {
                        fetalType: "TWINS", providers, retired: [], unchanged: false,
                        assignments: [
                            { babyId: null, ordinal: 1, providerSlot: 0 },
                            { babyId: null, ordinal: 3, providerSlot: split ? 1 : 0 },
                        ],
                    }, schedule.id, null);
                });
            }
            const babies = await db.client_baby.findMany({ where: scope, orderBy: { ordinal: "asc" } });
            const records = await Promise.all((singleton ? [null] : babies.map(({ id }) => id)).map(babyId =>
                db.service_record_case.create({
                    data: { ...scope, babyId, startDate: start, endDate: end, requiredSessionCount: 10 },
                }),
            ));
            const [first, second] = records as [typeof records[number], typeof records[number]];
            const params = (caseId: string | undefined, employeeId: number, scheduleId = schedule.id) => ({
                branchId: branch.id, scheduleId, serviceRecordCaseId: caseId, employeeId,
                expectedPhone: employees.find(employee => employee.id === employeeId)!.phone,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            });
            async function assignFirst(slot: 0 | 1, replace = false) {
                return scoped(branch.id, () => db.$transaction(async tx => {
                    await lockClientForScheduleWrite(tx, branch.id, client.id);
                    let scheduleId = schedule.id;
                    if (replace) {
                        await tx.employee_schedule.update({ where: { id: schedule.id, branchId: branch.id }, data: { replaced: true } });
                        scheduleId = (await tx.employee_schedule.create({
                            data: { ...scope, primaryEmployeeId: next.id, secondaryEmployeeId: assistant.id,
                                workAddress: "", startDate: start, endDate: end },
                        })).id;
                    }
                    await persistClientAllocation(tx, scope, {
                        fetalType: "TWINS", providers: replace ? [{ slot: 0, employeeId: next.id }, providers[1]!] : providers,
                        retired: [], unchanged: false,
                        assignments: babies.map(({ id, ordinal }, index) => ({
                            babyId: id, ordinal, providerSlot: index === 0 ? slot : split ? 1 : 0,
                        })),
                    }, scheduleId, schedule.id);
                    return scheduleId;
                }));
            }
            async function retireFirst() {
                const [firstBaby, secondBaby] = babies;
                return scoped(branch.id, () => db.$transaction(async tx => {
                    await lockClientForScheduleWrite(tx, branch.id, client.id);
                    await persistClientAllocation(tx, scope, {
                        providers, fetalType: "SINGLETON", unchanged: false, retired: [firstBaby!.id],
                        assignments: [{ babyId: secondBaby!.id, ordinal: secondBaby!.ordinal, providerSlot: 0 }],
                    }, schedule.id);
                }));
            }
            const issue = async (caseId: string | undefined, employeeId: number, scheduleId = schedule.id) =>
                (await scoped(branch.id, () => tokens.issueLink(params(caseId, employeeId, scheduleId)))).linkToken;
            const dayRows = () => db.$queryRaw<Array<{ id: string; case_id: string; session: number; author: number; name: string; notes: string; locked: boolean; signed: boolean }>>(Prisma.sql`
                SELECT id, service_record_case_id AS case_id, case_session_index AS session, employee_id AS author,
                    employee_name_snapshot AS name, notes, locked, client_signature IS NOT NULL AS signed
                FROM service_record_day WHERE branch_id = ${branch.id}::uuid ORDER BY service_record_case_id
            `);
            return { scope, branch, schedule, primary, assistant, next, first, second, babies, params, issue, assignFirst, retireFirst, dayRows };
        });
    }

    type AccessFixture = Awaited<ReturnType<typeof fixture>>;

    async function allocateSingleton(
        f: AccessFixture,
        babyId: string | null,
        providerSlot: 0 | 1,
        replacement?: { primaryEmployeeId: number; secondaryEmployeeId: number },
    ) {
        return scoped(f.branch.id, () => db.$transaction(async tx => {
            await lockClientForScheduleWrite(tx, f.branch.id, f.scope.clientId);
            const staffing = replacement ?? { primaryEmployeeId: f.primary.id, secondaryEmployeeId: f.assistant.id };
            let scheduleId = f.schedule.id;
            if (replacement) {
                await tx.employee_schedule.update({
                    where: { id: f.schedule.id, branchId: f.branch.id }, data: { replaced: true },
                });
                scheduleId = (await tx.employee_schedule.create({
                    data: { ...f.scope, ...replacement, workAddress: "", startDate: start, endDate: end },
                })).id;
            }
            await persistClientAllocation(tx, f.scope, {
                fetalType: "SINGLETON", retired: [], unchanged: false,
                providers: [
                    { slot: 0, employeeId: staffing.primaryEmployeeId },
                    { slot: 1, employeeId: staffing.secondaryEmployeeId },
                ],
                assignments: [{ babyId, ordinal: 1, providerSlot }],
            }, scheduleId, f.schedule.id);
            return scheduleId;
        }));
    }

    function seedHistoricalLink(
        f: AccessFixture,
        caseId: string | null,
        state: Partial<Pick<Prisma.service_record_tokenUncheckedCreateInput,
            "expectedPhoneHash" | "expiresAt" | "active" | "revokedAt" | "lockedAt" | "failedAttempts">> = {},
    ) {
        return scoped(f.branch.id, () => db.service_record_token.create({
            data: {
                branchId: f.branch.id, scheduleId: f.schedule.id, employeeId: f.primary.id,
                serviceRecordCaseId: caseId, linkTokenHash: `qa-legacy-${randomUUID()}`,
                expectedPhoneHash: digest(phone[0]), expiresAt: new Date(Date.now() + 86_400_000), ...state,
            },
        }));
    }

    function storedCredential(f: AccessFixture, id: string) {
        return scoped(f.branch.id, () => db.service_record_token.findUniqueOrThrow({ where: { branchId: f.branch.id, id } }));
    }

    async function expectUnavailable(link: string, access: string) {
        expect((await status(link).expect(200)).body).toEqual({ valid: false, reason: "unavailable" });
        await context(access).expect(401);
    }

    async function expectIssueAndPrepareDenied(f: AccessFixture, employeeId: number, scheduleId = f.schedule.id) {
        const error = { response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" } };
        for (const caseId of [undefined, f.first.id]) {
            const params = f.params(caseId, employeeId, scheduleId);
            await expect(scoped(f.branch.id, () => tokens.issueLink(params))).rejects.toMatchObject(error);
            await expect(scoped(f.branch.id, () => tokens.prepareLink(params))).rejects.toMatchObject(error);
        }
    }

    async function proveUnboundContinuation(preallocated: boolean) {
        for (const explicitCase of [false, true]) {
            const f = await fixture(true);
            if (preallocated) await allocateSingleton(f, null, 0);
            const initialOwners = await scoped(f.branch.id, () => db.service_record_baby_assignment.findMany({
                where: { ...f.scope, scheduleId: f.schedule.id },
            }));
            expect(initialOwners).toHaveLength(preallocated ? 1 : 0);
            const caseId = explicitCase ? f.first.id : null;
            const credential = await seedHistoricalLink(f, caseId);
            expect(credential.serviceRecordCaseId).toBe(caseId);
            const link = credential.linkTokenHash;
            expect((await status(link).expect(200)).body).toEqual({ valid: true });
            const access = await authorize(link, phone[0]);
            expect((await context(access).expect(200)).body).toMatchObject({
                babyId: null, employee: { id: f.primary.id },
            });
            await setHeader(access, "기존아기").expect(200);
            await submit(access, "QA-original unbound record").expect(201);
            const before = await storedCredential(f, credential.id);
            const dayScope = { branchId: f.branch.id, serviceRecordCaseId: f.first.id };
            const original = await scoped(f.branch.id, () => db.service_record_day.findMany({ where: dayScope }));
            expect(original).toMatchObject([{ employeeId: f.primary.id, locked: true, clientSignature: signature }]);

            const excluded = explicitCase ? [] : await Promise.all([
                seedHistoricalLink(f, null, { active: false, revokedAt: new Date() }),
                seedHistoricalLink(f, null, { expiresAt: new Date(0) }),
                seedHistoricalLink(f, null, { expectedPhoneHash: digest(phone[1]) }),
            ]);
            const locked = explicitCase ? null : await seedHistoricalLink(f, null, { lockedAt: new Date(), failedAttempts: 5 });
            const scheduleId = await allocateSingleton(f, initialOwners[0]?.babyId ?? null, 0, {
                primaryEmployeeId: f.primary.id, secondaryEmployeeId: f.next.id,
            });
            expect(scheduleId).not.toBe(f.schedule.id);
            expect((await status(link).expect(200)).body).toEqual({ valid: true });
            await context(access).expect(200);
            await scoped(f.branch.id, () => links.revoke(f.schedule.id));
            expect((await status(link).expect(200)).body).toEqual({ valid: true });
            expect(await tokens.resolveAccess(access)).toMatchObject({
                scheduleId, serviceRecordCaseId: f.first.id, babyId: null, employeeId: f.primary.id,
            });
            await context(access).expect(200);
            const after = await storedCredential(f, credential.id);
            expect(after).toMatchObject({
                scheduleId, serviceRecordCaseId: caseId, employeeId: f.primary.id, active: true, revokedAt: null,
                verifiedAt: before.verifiedAt, expiresAt: before.expiresAt,
            });
            expect(after.accessTokenHash === digest(access) && after.linkTokenHash === link
                && after.expectedPhoneHash === before.expectedPhoneHash).toBe(true);
            for (const row of excluded) {
                expect(await storedCredential(f, row.id)).toMatchObject({
                    scheduleId: f.schedule.id, active: false, revokedAt: expect.any(Date),
                });
                expect((await status(row.linkTokenHash).expect(200)).body.valid).toBe(false);
            }
            if (locked) {
                expect(await storedCredential(f, locked.id)).toMatchObject({
                    scheduleId, lockedAt: locked.lockedAt, failedAttempts: locked.failedAttempts, verifiedAt: null,
                });
                expect((await status(locked.linkTokenHash).expect(200)).body.valid).toBe(false);
            }
            await expectIssueAndPrepareDenied(f, f.next.id, scheduleId);
            expect(await scoped(f.branch.id, () => db.service_record_case.findMany({
                where: f.scope, select: { id: true, babyId: true },
            }))).toEqual([{ id: f.first.id, babyId: null }]);
            expect(await scoped(f.branch.id, () => db.service_record_day.findMany({ where: dayScope }))).toEqual(original);
        }
    }

    it("unchanged caregiver keeps an unbound singleton URL and session through assistant replacement", async () => {
        await proveUnboundContinuation(true);
    });

    it("first allocation preserves null and explicit case credentials through assistant-only handover", async () => {
        await proveUnboundContinuation(false);
    });

    it("never reactivates unbound credentials after a same-schedule A to B to A change", async () => {
        const f = await fixture(true);
        await allocateSingleton(f, null, 0);
        const baby = await scoped(f.branch.id, () => db.client_baby.findFirstOrThrow({ where: { ...f.scope, active: true } }));
        const old = await Promise.all([null, f.first.id].map(async caseId => {
            const row = await seedHistoricalLink(f, caseId);
            const link = row.linkTokenHash;
            return { id: row.id, link, access: await authorize(link, phone[0]) };
        }));
        await setHeader(old[0]!.access, "기존아기").expect(200);
        const original = await submit(old[0]!.access, "QA-submitted before reassignment").expect(201);

        const revokedGenerations = new Map<string, Date | null>();
        for (const slot of [1, 0, 1] as const) {
            await allocateSingleton(f, baby.id, slot);
            for (const { id, link, access } of old) {
                await expectUnavailable(link, access);
                expect((await verify(link, phone[0]).expect(201)).body.ok).toBe(false);
                const row = await storedCredential(f, id);
                expect(row).toMatchObject({ active: false, revokedAt: expect.any(Date), accessTokenHash: null, verifiedAt: null });
                if (revokedGenerations.has(id)) expect(row.revokedAt).toEqual(revokedGenerations.get(id));
                else revokedGenerations.set(id, row.revokedAt);
            }
            await expectIssueAndPrepareDenied(f, f.primary.id);
            await expectIssueAndPrepareDenied(f, f.assistant.id);
        }
        const originalCase = await scoped(f.branch.id, () => db.service_record_case.findFirstOrThrow({
            where: { ...f.scope, id: f.first.id }, select: { id: true, babyId: true },
        }));
        expect(originalCase).toEqual({ id: f.first.id, babyId: null });

        // Supply the committed result of explicit adoption, which is owned by Task 3.1.
        await scoped(f.branch.id, () => db.$transaction(async tx => {
            await lockClientForScheduleWrite(tx, f.branch.id, f.scope.clientId);
            await tx.service_record_case.update({
                where: { ...f.scope, id: originalCase.id }, data: { babyId: baby.id },
            });
        }));
        const fresh = await f.issue(originalCase.id, f.assistant.id);
        expect(old.some(({ link }) => fresh === link)).toBe(false);
        const access = await authorize(fresh, phone[1]);
        expect((await context(access).expect(200)).body).toMatchObject({
            babyId: baby.id, employee: { id: f.assistant.id },
            sessions: [{ id: original.body.id, notes: "QA-submitted before reassignment", employeeId: f.primary.id }],
        });
        for (const { link, access: previous } of old) await expectUnavailable(link, previous);
    });

    if (!legacyKeys) {
        it("ambiguous or reassigned unbound case never continues the former credential", async () => {
            for (const change of ["sibling", "primary", "owner", "finalized"] as const) {
                const f = await fixture(true);
                const legacy = await seedHistoricalLink(f, null);
                const explicit = await seedHistoricalLink(f, f.first.id);
                const sessions = await Promise.all([legacy, explicit].map(row => authorize(row.linkTokenHash, phone[0])));
                if (change === "sibling") {
                    const sibling = await scoped(f.branch.id, () => db.client_baby.create({ data: { ...f.scope, ordinal: 2, active: false } }));
                    await scoped(f.branch.id, () => db.service_record_case.create({
                        data: { ...f.scope, babyId: sibling.id, startDate: start, endDate: end },
                    }));
                }
                if (change === "finalized") {
                    await scoped(f.branch.id, () => db.service_record_case.update({
                        where: { ...f.scope, id: f.first.id }, data: { finalizedAt: new Date() },
                    }));
                }
                const scheduleId = await allocateSingleton(f, null, change === "owner" ? 1 : 0, {
                    primaryEmployeeId: change === "primary" ? f.assistant.id : f.primary.id,
                    secondaryEmployeeId: f.next.id,
                });
                await scoped(f.branch.id, () => links.revoke(f.schedule.id));
                for (const [index, row] of [legacy, explicit].entries()) {
                    await expectUnavailable(row.linkTokenHash, sessions[index]!);
                    expect(await storedCredential(f, row.id)).toMatchObject({
                        scheduleId: f.schedule.id, revokedAt: expect.any(Date), accessTokenHash: null, verifiedAt: null,
                    });
                }
                if (change !== "finalized") {
                    await expectIssueAndPrepareDenied(f, f.primary.id, scheduleId);
                    await expectIssueAndPrepareDenied(f, f.assistant.id, scheduleId);
                    await expectIssueAndPrepareDenied(f, f.next.id, scheduleId);
                }
                expect(await scoped(f.branch.id, () => db.service_record_case.findFirst({
                    where: { ...f.scope, id: f.first.id }, select: { babyId: true },
                }))).toEqual({ babyId: null });
            }
        });

        it("one employee verifies two different baby links", async () => {
            const f = await fixture();
            const a = await f.issue(f.first.id, f.primary.id);
            const paramsB = f.params(f.second.id, f.primary.id);
            const { linkToken: b } = await scoped(f.branch.id, () => tokens.prepareLink(paramsB));
            expect(a !== b).toBe(true);
            expect(f.first.id).not.toBe(f.second.id);
            expect(f.babies.map(baby => baby.ordinal)).toEqual([1, 3]);
            expect((await status(b).expect(200)).body.valid).toBe(false);
            expect(await scoped(f.branch.id, () => tokens.activatePreparedLink({ ...paramsB, linkToken: a }))).toBe(false);
            expect(await scoped(f.branch.id, () => tokens.activatePreparedLink({ ...paramsB, linkToken: b }))).toBe(true);
            for (const link of [a, b]) expect((await status(link).expect(200)).body).toEqual({ valid: true });
            expect((await context("unknown").expect(401)).body).not.toHaveProperty("babyId");
            const aAccess = await authorize(a, phone[0]);
            const bAccess = await authorize(b, phone[0]);
            for (const [access, baby, rank, caseId] of [
                [aAccess, f.babies[0]!.id, 1, f.first.id],
                [bAccess, f.babies[1]!.id, 2, f.second.id],
            ] as const) {
                const response = await context(access).expect(200);
                expect(response.body).toMatchObject({ babyId: baby, babyRank: rank, babyCount: 2, employee: { id: f.primary.id } });
                expect(await tokens.resolveAccess(access)).toMatchObject({ serviceRecordCaseId: caseId });
            }
            await expect(scoped(f.branch.id, () => tokens.issueLink(f.params(undefined, f.primary.id)))).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });
            await expect(scoped(f.branch.id, () => tokens.prepareLink(f.params(randomUUID(), f.primary.id)))).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });
            const foreign = await fixture(true);
            await expect(scoped(f.branch.id, () => tokens.prepareLink(f.params(foreign.first.id, f.primary.id)))).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });
            expect(await db.service_record_token.count({ where: { branchId: f.branch.id } })).toBe(2);

            await f.retireFirst();
            expect((await status(a).expect(200)).body).toEqual({ valid: false, reason: "unavailable" });
            await context(aAccess).expect(401);
            expect((await context(bAccess).expect(200)).body).toMatchObject({
                babyId: f.babies[1]!.id, babyRank: 1, babyCount: 1,
            });
        });

        it("a changed assignee loses only their retired case access", async () => {
            const f = await fixture();
            const a = await f.issue(f.first.id, f.primary.id);
            const b = await f.issue(f.second.id, f.primary.id);
            const [sessionA, sessionB] = await Promise.all([authorize(a, phone[0]), authorize(b, phone[0])]);
            await f.assignFirst(1);
            await context(sessionA).expect(401);
            await saveDay(sessionA, "denied").expect(401);
            expect((await status(a).expect(200)).body).toEqual({ valid: false, reason: "unavailable" });
            for (const number of [phone[0], phone[1]]) expect((await verify(a, number).expect(201)).body.ok).toBe(false);
            expect((await context(sessionB).expect(200)).body.babyId).toBe(f.babies[1]!.id);
            expect((await status(b).expect(200)).body.valid).toBe(true);
            const next = await f.issue(f.first.id, f.assistant.id);
            expect(next !== a && next !== b).toBe(true);
            expect((await context(await authorize(next, phone[1])).expect(200)).body.employee.id).toBe(f.assistant.id);

            // Finalization and tombstoning are authoritative even if no token writer runs.
            await scoped(f.branch.id, () => db.service_record_case.update({
                where: { id: f.first.id, branchId: f.branch.id }, data: { finalizedAt: new Date() },
            }));
            expect((await status(next).expect(200)).body.valid).toBe(false);
            await context(sessionB).expect(200);
            await scoped(f.branch.id, () => db.client.update({
                where: { id: f.scope.clientId, branchId: f.branch.id }, data: { deletedAt: new Date() },
            }));
            expect((await status(b).expect(200)).body.valid).toBe(false);
            await saveDay(sessionB, "denied").expect(401);
        });

        it("returning to a prior assignee cannot revive an old link", async () => {
            const f = await fixture();
            const first = await f.issue(f.first.id, f.primary.id);
            const access = await authorize(first, phone[0]);
            await f.assignFirst(1);
            await f.assignFirst(0);
            expect((await status(first).expect(200)).body.valid).toBe(false);
            expect((await verify(first, phone[0]).expect(201)).body.ok).toBe(false);
            await context(access).expect(401);
            const fresh = await f.issue(f.first.id, f.primary.id);
            expect(fresh !== first).toBe(true);
            expect((await status(fresh).expect(200)).body.valid).toBe(true);
            expect((await verify(first, phone[0]).expect(201)).body.ok).toBe(false);
            expect(await db.service_record_token.count({
                where: { branchId: f.branch.id, serviceRecordCaseId: f.first.id, revokedAt: { not: null } },
            })).toBe(1);
        });

        it("two cases keep independent same-index drafts and submitted author", async () => {
            const f = await fixture(false, true);
            const a = await authorize(await f.issue(f.first.id, f.primary.id), phone[0]);
            const b = await authorize(await f.issue(f.second.id, f.assistant.id), phone[1]);
            await setHeader(a, "첫아기").expect(200);
            await setHeader(b, "둘아기").expect(200);
            await setHeader(a, "첫째아기").expect(200);
            const headers = await db.$queryRaw<Array<{ case_id: string; name: string }>>(Prisma.sql`
                SELECT service_record_case_id AS case_id, baby_name AS name
                FROM service_record WHERE branch_id = ${f.branch.id}::uuid AND schedule_id = ${f.schedule.id}
            `);
            expect(headers).toHaveLength(2);
            expect(headers).toEqual(expect.arrayContaining([
                { case_id: f.first.id, name: "첫째아기" }, { case_id: f.second.id, name: "둘아기" },
            ]));
            await saveDay(a, "QA-first draft").expect(200);
            await saveDay(b, "QA-second draft").expect(200);
            const drafts = await f.dayRows();
            expect(drafts).toHaveLength(2);
            expect(new Set(drafts.map(row => row.id)).size).toBe(2);
            const idA = drafts.find(row => row.case_id === f.first.id)!.id;
            const idB = drafts.find(row => row.case_id === f.second.id)!.id;
            expect((await context(a).expect(200)).body.sessions).toMatchObject([{ id: idA, sessionIndex: 1, notes: "QA-first draft" }]);
            expect((await context(b).expect(200)).body.sessions).toMatchObject([{ id: idB, sessionIndex: 1, notes: "QA-second draft" }]);
            await submit(a, "QA-first submitted").expect(201);
            await f.assignFirst(1);
            const replacement = await authorize(await f.issue(f.first.id, f.assistant.id), phone[1]);
            await submit(replacement, "QA-first amended", "data:image/png;base64,d29ybGQ=").expect(201);
            const rows = await f.dayRows();
            expect(rows).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: idA, case_id: f.first.id, session: 1, author: f.primary.id,
                    name: f.primary.name, notes: "QA-first amended", locked: true, signed: true }),
                expect.objectContaining({ id: idB, case_id: f.second.id, session: 1, author: f.assistant.id,
                    notes: "QA-second draft", locked: false, signed: false }),
            ]));
            const original = await db.service_record_day.findFirst({ where: { id: idA, branchId: f.branch.id }, select: { clientSignature: true } });
            expect(original?.clientSignature === signature).toBe(true);
            expect(await db.service_record_day_edit_log.findFirst({
                where: { branchId: f.branch.id, serviceRecordCaseId: f.first.id },
                select: { employeeId: true, employeeNameSnapshot: true },
            })).toEqual({ employeeId: f.assistant.id, employeeNameSnapshot: f.assistant.name });
        });

        it("verified sibling isolation is rechecked inside writes", async () => {
            const f = await fixture();
            const a = await authorize(await f.issue(f.first.id, f.primary.id), phone[0]);
            const b = await authorize(await f.issue(f.second.id, f.primary.id), phone[0]);
            await http().put("/service-record/sessions/1").auth(a, { type: "bearer" })
                .send({ serviceDate: "2026-07-20", notes: "QA-wrong case", serviceRecordCaseId: f.second.id }).expect(400);

            let arrive!: () => void;
            let release!: () => void;
            const entered = new Promise<void>(resolve => { arrive = resolve; });
            const wait = new Promise<void>(resolve => { release = resolve; });
            const save = entry.upsertSession.bind(entry);
            const intercept = jest.spyOn(entry, "upsertSession").mockImplementationOnce(async (...args) => {
                // Suspend after the real guard has resolved the credential.
                arrive();
                await wait;
                return save(...args);
            });
            const inflight = saveDay(a, "QA-stale authorized write").then(response => response);
            try {
                await Promise.race([entered, inflight.then(() => { throw new Error("write did not reach the post-guard boundary"); })]);
                await f.assignFirst(1);
            } finally {
                release();
                intercept.mockRestore();
            }
            expect((await inflight).status).toBe(401);
            await saveDay(b, "QA-continued sibling").expect(200);
            expect(await f.dayRows()).toEqual([
                expect.objectContaining({ case_id: f.second.id, author: f.primary.id, notes: "QA-continued sibling" }),
            ]);
        });

        it("handover of one assignee keeps the sibling link", async () => {
            const f = await fixture(false, true);
            const a = await f.issue(f.first.id, f.primary.id);
            const b = await f.issue(f.second.id, f.assistant.id);
            const accessA = await authorize(a, phone[0]);
            const accessB = await authorize(b, phone[1]);
            await setHeader(accessA, "첫아기").expect(200);
            await submit(accessA, "QA-original primary").expect(201);
            const original = await f.dayRows();

            const scheduleId = await f.assignFirst(0, true);
            expect(scheduleId).not.toBe(f.schedule.id);
            await scoped(f.branch.id, () => links.revoke(f.schedule.id));
            await context(accessA).expect(401);
            expect((await status(a).expect(200)).body.valid).toBe(false);
            expect((await status(b).expect(200)).body.valid).toBe(true);
            expect((await context(accessB).expect(200)).body).toMatchObject({
                babyId: f.babies[1]!.id, employee: { id: f.assistant.id },
            });
            const retained = await db.service_record_token.findFirst({
                where: { branchId: f.branch.id, accessTokenHash: digest(accessB) },
                select: { scheduleId: true, serviceRecordCaseId: true, employeeId: true, revokedAt: true },
            });
            expect(retained).toEqual({ scheduleId, serviceRecordCaseId: f.second.id, employeeId: f.assistant.id, revokedAt: null });
            expect((await f.issue(f.second.id, f.assistant.id, scheduleId)) === b).toBe(true);
            const newlyIssued = await f.issue(f.first.id, f.next.id, scheduleId);
            expect(newlyIssued !== a).toBe(true);
            const newAccess = await authorize(newlyIssued, phone[2]);
            await saveDay(accessB, "QA-continued assistant").expect(200);
            const rows = await f.dayRows();
            expect(rows).toEqual(expect.arrayContaining(original));
            expect(rows).toContainEqual(expect.objectContaining({ case_id: f.second.id, author: f.assistant.id }));

            await scoped(f.branch.id, () => db.$transaction(async tx => {
                await lockClientForScheduleWrite(tx, f.branch.id, f.scope.clientId);
                await tx.employee_schedule.update({ where: { id: scheduleId, branchId: f.branch.id }, data: { terminatedAt: new Date() } });
                await closeScheduleAllocation(tx, f.scope, scheduleId);
            }));
            await context(accessB).expect(401);
            await context(newAccess).expect(401);
            expect((await status(b).expect(200)).body.valid).toBe(false);
            expect((await status(newlyIssued).expect(200)).body.valid).toBe(false);
            expect(await f.dayRows()).toEqual(rows);
        });
    }

    it("an unconfirmed singleton retains its established valid link", async () => {
        if (legacyKeys) {
            const keys = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
                SELECT count(*)::int AS count FROM pg_indexes
                WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE INDEX%'
                  AND indexname IN ('service_record_case_client_id_key', 'service_record_schedule_id_key',
                      'service_record_assignment_schedule_id_key', 'service_record_day_schedule_id_session_index_key')
            `);
            expect(keys).toEqual([{ count: 4 }]);
        }
        const f = await fixture(true);
        const existing = `qa-legacy-${randomUUID()}`;
        await scoped(f.branch.id, () => db.service_record_token.create({
            data: { branchId: f.branch.id, scheduleId: f.schedule.id, employeeId: f.primary.id,
                linkTokenHash: existing, expectedPhoneHash: digest(phone[0]), expiresAt: new Date(Date.now() + 86_400_000) },
        }));
        await scoped(f.branch.id, () => db.service_record.create({
            data: { branchId: f.branch.id, scheduleId: f.schedule.id, babyName: "기존아기" },
        }));
        expect((await f.issue(undefined, f.primary.id)) === existing).toBe(true);
        expect((await verify(existing, phone[1]).expect(201)).body.ok).toBe(false);
        const access = await authorize(existing, phone[0]);
        expect((await context(access).expect(200)).body).toMatchObject({ babyId: null, babyRank: null, babyCount: null });
        await setHeader(access, "기존아기").expect(200);
        await saveDay(access, "QA-legacy write").expect(200);
        expect(await f.dayRows()).toEqual([
            expect.objectContaining({ case_id: f.first.id, session: 1, author: f.primary.id, notes: "QA-legacy write" }),
        ]);
        expect(await db.service_record.count({
            where: { branchId: f.branch.id, scheduleId: f.schedule.id, serviceRecordCaseId: f.first.id },
        })).toBe(1);
    });
});
