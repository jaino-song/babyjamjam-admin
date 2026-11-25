import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import request from "supertest";

import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordLinkGroupService } from "application/services/service-record-link-group.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { MESSAGE_LOG_REPOSITORY, type IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { getJwtSecret } from "infrastructure/auth/jwt-secret";
import { PrismaService } from "infrastructure/database/prisma.service";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ClientModule } from "module/client.module";
import { EmployeeScheduleModule } from "module/employee-schedule.module";
import { MessageDeliveryModule } from "module/message-delivery.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

import { issueAdminServiceRecordEditHttpToken } from "./helpers/admin-service-record-edit-http.helper";
import { ScriptedAligoStub } from "./helpers/scripted-aligo.stub";

const allowed = new Set(["work", "verify"].map(name =>
    `postgresql://bjj_revision_test@127.0.0.1:62295/throwaway_baby_cutover_${name}`));
const target = process.env["DATABASE_URL"];
const describeRollout = process.env["E2E_VENDOR_STUBS"] === "1" || (target && allowed.has(target))
    ? describe : describe.skip;
const dateAt = (days: number) => new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
const settingKey = (branch: string) => `branch:${branch}:baby_service_records:enabled`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function setRollout(tx: Prisma.TransactionClient, branchId: string, value: string) {
    // The SQL in the operator guide. No service call or mock stands in for the operator.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('babyjamjam:message-automation-branch:' || ${branchId}::uuid::text, 0))`;
    await tx.$executeRaw`
        INSERT INTO system_setting (key, value, updated_at)
        VALUES ('branch:' || ${branchId}::uuid::text || ':baby_service_records:enabled', ${value}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `;
}

describeRollout("branch rollout over authenticated Nest routes and PostgreSQL", () => {
    jest.setTimeout(65_000);
    const carrier = new ScriptedAligoStub();
    let app: INestApplication;
    let db: PrismaService;
    let jwt: JwtService;
    let trigger: MessageTriggerService;
    let retries: SmsRetryService;
    let logs: IMessageLogRepository;
    let active: Awaited<ReturnType<typeof branch>>;
    let off: Awaited<ReturnType<typeof branch>>;
    let phoneBase = randomInt(10_000_000, 99_900_000);
    let priceIds: number[] = [];
    let restoreEnv: (() => void) | undefined;

    beforeAll(async () => {
        if (!target || !allowed.has(target) || process.env["DIRECT_URL"] !== target
            || process.env["E2E_VENDOR_STUBS"] !== "1" || process.env["NODE_ENV"] !== "test") {
            throw new Error("Rollout E2E requires vendor stubs and equal explicit URLs for its approved loopback clones");
        }
        const secret = randomBytes(32).toString("hex");
        const priorSecret = process.env["JWT_SECRET"];
        const priorValkey = process.env["VALKEY_URL"];
        process.env["JWT_SECRET"] = secret;
        process.env["VALKEY_URL"] = "";
        restoreEnv = () => {
            if (priorSecret === undefined) delete process.env["JWT_SECRET"];
            else process.env["JWT_SECRET"] = priorSecret;
            if (priorValkey === undefined) delete process.env["VALKEY_URL"];
            else process.env["VALKEY_URL"] = priorValkey;
        };
        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                PassportModule.register({ defaultStrategy: "jwt" }),
                JwtModule.register({ global: true, secret }),
                TenantModule, ClientModule, EmployeeScheduleModule, MessageDeliveryModule, SchedulerLeaseModule,
            ],
            providers: [JwtStrategy],
        }).overrideProvider(ALIGO_SMS_API_PORT).useValue(carrier).compile();
        app = module.createNestApplication({ logger: false });
        const middleware = app.get(TenantAlsMiddleware);
        app.use(middleware.use.bind(middleware));
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new PrismaExceptionFilter());
        await app.init();
        db = app.get(PrismaService);
        jwt = new JwtService({ secret: getJwtSecret() });
        trigger = app.get(MessageTriggerService);
        retries = app.get(SmsRetryService);
        logs = app.get(MESSAGE_LOG_REPOSITORY);
        const templateKey = SystemTemplateKey.SERVICE_RECORD_LINK;
        await db.system_template.upsert({
            where: { templateKey }, update: {},
            create: { templateKey, content: SYSTEM_TEMPLATE_REGISTRY[templateKey].defaultContent },
        });
        const year = 2026;
        const duration = 31999;
        const prices = ["A가②형", "B가②형", "C가②형", "D가②형"];
        const existing = await db.voucher_price_info.findMany({ where: { year, duration, type: { in: prices } } });
        const missing = prices.filter(type => !existing.some(row => row.type === type));
        const { _max } = await db.voucher_price_info.aggregate({ _max: { id: true } });
        if (missing.length) {
            priceIds = (await db.voucher_price_info.createManyAndReturn({
                data: missing.map((type, index) => ({
                    id: (_max.id ?? 0) + index + 1, year, duration, type,
                    fullPrice: "1400000", grant: "1000000", actualPrice: "400000",
                })),
                select: { id: true },
            })).map(({ id }) => id);
        }
    });

    afterAll(async () => {
        try {
            if (priceIds.length) await db.voucher_price_info.deleteMany({ where: { id: { in: priceIds } } });
        } finally {
            try { await app?.close(); } finally { restoreEnv?.(); }
        }
    });

    async function branch() {
        const unique = randomUUID();
        const { id } = await db.branch.create({
            data: { name: "QA-Rollout", slug: `qa-rollout-${unique}`, smsSenderApprovalStatus: "approved" },
        });
        const user = await db.user.create({
            data: { email: `${unique}@rollout.test`, name: "QA-Rollout admin", role: "admin", approvalStatus: "approved" },
        });
        await db.user_branch.create({ data: { branchId: id, userId: user.id, role: "admin" } });
        const session = await db.auth_session.create({
            data: { userId: user.id, selectedBranchId: id, expiresAt: new Date(Date.now() + 3_600_000) },
        });
        const auth = await issueAdminServiceRecordEditHttpToken(jwt, {
            userId: user.id, sessionId: session.id, branchId: id, role: "admin", branchRole: "admin", tokenVersion: user.tokenVersion,
        });
        const employees = await db.employee.createManyAndReturn({
            data: Array.from({ length: 5 }, (_, index) => ({
                branchId: id, name: `QA-Rollout caregiver ${index + 1}`, grade: "스탠다드", phone: `010${++phoneBase}`,
                openToNextWork: true, smsAutomationEnabled: true,
            })),
            select: { id: true, phone: true },
        });
        await trigger.ensureDefaultRulesForBranch(id);
        return { id, auth, userId: user.id, employees };
    }

    beforeEach(async () => {
        carrier.clearScripts();
        carrier.sendCalls.length = 0;
        active = await branch();
        off = await branch();
        await db.$transaction(tx => setRollout(tx, active.id, "true"));
    });

    const raw = () => request(app.getHttpServer());
    const http = (who = active) => ({
        get: (path: string) => raw().get(path).auth(who.auth, { type: "bearer" }),
        patch: (path: string) => raw().patch(path).auth(who.auth, { type: "bearer" }),
        post: (path: string) => raw().post(path).auth(who.auth, { type: "bearer" }),
    });
    const link = (id: number, verb: string, data: object, who = active) =>
        http(who).post(`/admin/service-records/schedules/${id}/${verb}-link`).send(data);
    const calls = () => carrier.sendCalls.filter(call => active.employees.some(employee => employee.phone === call.receiver)).length;
    const jobs = (clientId: number) => db.message_trigger_job.findMany({
        where: { branchId: active.id, clientId, ruleId: SERVICE_RECORD_LINK_RULE_ID },
        orderBy: { id: "asc" },
        include: { recordMembers: {
            orderBy: { serviceRecordCaseId: "asc" },
            select: { serviceRecordCaseId: true, employeeId: true, assignmentVersion: true },
        } },
    });
    const history = (jobId: string) => db.message_log.findMany({
        where: { branchId: active.id, triggerJobId: jobId },
        orderBy: { id: "asc" },
        select: { id: true, providerAcceptanceState: true, providerCallStartedAt: true, providerAcceptedAt: true },
    });
    const dispatch = (id: string, who = active) => trigger.dispatchPendingJobNow(id, { expectedBranchId: who.id });
    const set = (value: string) => db.$transaction(tx => setRollout(tx, active.id, value));
    const confirm = (id: number, who = active) => http(who).patch(`/clients/${id}/confirm-booking`).send({});
    const period = () => ({ startDate: dateAt(-1), endDate: dateAt(15), allowSaturdayService: true, allowSundayService: true, allowHolidayService: true });
    const draft = () => ({ name: "QA-Rollout client", serviceStatus: "pre_booking", breastPump: false, voucherClient: true,
        applyMessageAutomation: false, smsAutomationEnabled: false, ...period() });
    const configure = (slots: number[], who = active, type = "B-가-2형", fetalType = "TWINS") => ({
        ...draft(), type, voucherIssuanceYear: 2026, fetalType, babyCount: slots.length,
        providers: [...new Set(slots)].map(slot => ({ slot, employeeId: who.employees[slot]!.id })),
        babyAssignments: slots.map((providerSlot, index) => ({ ordinal: index + 1, providerSlot })),
    });

    async function register(slots: number[], who = active) {
        const { body } = await http(who).post("/clients").send(configure(slots, who)).expect(201);
        return body.id as number;
    }

    async function book(slots: number[], employeeIndexes?: number[]) {
        const who = employeeIndexes ? { ...active, employees: employeeIndexes.map(index => active.employees[index]!) } : active;
        const clientId = await register(slots, who);
        await confirm(clientId).expect(200);
        const scope = { branchId: active.id, clientId };
        const schedule = await db.employee_schedule.findFirstOrThrow({ where: { ...scope, replaced: false }, select: { id: true } });
        const cases = await db.service_record_case.findMany({
            where: scope, select: { id: true, babyId: true, baby: { select: { ordinal: true } } },
        });
        cases.sort((a, b) => a.baby!.ordinal - b.baby!.ordinal);
        expect(cases).toHaveLength(slots.length);
        return { clientId, scheduleId: schedule.id, cases };
    }

    async function verify(caseId: string, employeeIndex: number) {
        const phone = active.employees[employeeIndex]!.phone;
        const { linkTokenHash } = await db.service_record_token.findFirstOrThrow({
            where: { branchId: active.id, serviceRecordCaseId: caseId, active: true, revokedAt: null },
            select: { linkTokenHash: true },
        });
        const result = await raw().post("/service-record/verify").send({ linkToken: linkTokenHash, phone }).expect(201);
        if (result.body.ok !== true || typeof result.body.accessToken !== "string") throw new Error("Verification failed");
        return result.body.accessToken as string;
    }

    const context = (token: string) => raw().get("/service-record/context").auth(token, { type: "bearer" });
    const header = (token: string) => raw().put("/service-record/header").auth(token, { type: "bearer" }).send({
        momName: "가나다", momBirth: "1990-01-01", babyName: "가나", babyBirth: dateAt(-15), babyWeight: "3.2", deliveryType: "자연분만",
    });
    const submit = (token: string, day: number) => raw().post(`/service-record/sessions/${day}/submit`)
        .auth(token, { type: "bearer" }).send({
            serviceDate: dateAt(day - 2), notes: "QA-Signed", momApproval: "approved",
            clientSignature: "data:image/png;base64,aGVsbG8=",
        });

    it("scopes the trusted capability and registration by branch", async () => {
        const path = "/clients/baby-record-capability";
        await raw().get(path).expect(401);
        await http().get(path).expect(200, { enabled: true }).expect("Cache-Control", "private, no-store");
        await http(off).get(path).query({ branchId: active.id, key: settingKey(active.id) }).expect(200, { enabled: false });
        await http().get(path).query({ branchId: off.id }).expect(200, { enabled: true });
        for (const [type, fetalType, slots] of [
            ["A가2형", "SINGLETON", [0]],
            ["B-가-2형", "TWINS", [0, 0]],
            ["C가2형", "TRIPLETS", [0, 0, 0]],
            ["D가2형", "QUADRUPLETS_PLUS", [0, 0, 0, 0]],
        ] as const) {
            await http(off).post("/clients").send(configure([...slots], off, type, fetalType)).expect(409);
        }
        expect(await db.client.count({ where: { branchId: off.id } })).toBe(0);
        expect(await db.employee_schedule.count({ where: { branchId: off.id } })).toBe(0);
        for (const invalid of ["TRUE", " true", "false"]) {
            await db.$transaction(tx => setRollout(tx, off.id, invalid));
            await http(off).get(path).expect(200, { enabled: false });
            await http(off).post("/clients").send(configure([0, 0], off)).expect(409);
        }
        const awaiting = await register([0, 0]);
        await set("false");
        await confirm(awaiting).expect(409);
        await http().post("/employee-schedules").send({
            clientId: awaiting, primaryEmployeeId: active.employees[2]!.id,
            workAddress: "QA-Schedule", startDate: dateAt(1), endDate: dateAt(15),
        }).expect(409);
        const scope = { branchId: active.id, clientId: awaiting };
        expect(await db.client.findFirstOrThrow({ where: { id: awaiting, branchId: active.id }, select: { bookingConfirmedAt: true } }))
            .toEqual({ bookingConfirmedAt: null });
        expect(await db.service_record_case.count({ where: scope })).toBe(0);
        expect(await db.service_record_job_member.count({ where: scope })).toBe(0);
        await app.get(ServiceRecordLifecycleService).ensureAllForClient(awaiting);
        expect(await db.service_record_case.count({ where: scope })).toBe(0);
        await set("true");
        await confirm(awaiting).expect(200);
        expect(await db.service_record_case.count({ where: scope })).toBe(2);
        const [job] = await jobs(awaiting);
        expect(job?.recordMembers).toHaveLength(2);

        const { body: singleton } = await http().post("/clients").send({
            ...configure([0], { ...active, employees: [active.employees[1]!] }, "A가2형", "SINGLETON"),
        }).expect(201);
        await confirm(singleton.id).expect(200);
        expect((await jobs(singleton.id)).map(row => row.recordMembers.length)).toEqual([1]);
    });

    it("keeps signed cases usable and revokes a departed assignee during pause", async () => {
        const family = await book([0, 1]);
        const [first, second] = family.cases;
        for (const { id: serviceRecordCaseId } of family.cases) {
            const now = new Date();
            await db.eformsign_doc.create({ data: {
                branchId: active.id, clientId: family.clientId, employeeScheduleId: family.scheduleId,
                serviceRecordCaseId, documentId: randomUUID(), documentKind: "service_record_snapshot",
                createdDate: now, updatedDate: now, expiredDate: now, statusType: "003", statusDetail: "003",
                stepType: "06", stepIndex: "3", stepName: "QA-Complete", stepRecipientType: "group",
                stepRecipientName: "QA-Recipient", stepRecipientSms: "", snapshotVersion: 1, snapshotChunkIndex: 1,
            } });
        }
        const firstAccess = await verify(first!.id, 0);
        const secondAccess = await verify(second!.id, 1);
        await header(firstAccess).expect(200);
        await header(secondAccess).expect(200);
        await submit(firstAccess, 1).expect(201);
        await submit(secondAccess, 1).expect(201);
        const signedFacts = async () => {
            const ids = family.cases.map(({ id }) => id);
            const [days, docs] = await Promise.all([
                db.service_record_day.findMany({
                    where: { branchId: active.id, serviceRecordCaseId: { in: ids }, caseSessionIndex: 1 },
                    orderBy: { serviceRecordCaseId: "asc" },
                    select: { serviceRecordCaseId: true, employeeId: true, clientSignature: true, locked: true, submittedAt: true },
                }),
                db.eformsign_doc.findMany({
                    where: { branchId: active.id, serviceRecordCaseId: { in: ids } },
                    orderBy: { id: "asc" }, select: { id: true, serviceRecordCaseId: true },
                }),
            ]);
            return { docs, days: days.map(({ clientSignature, ...facts }) => ({ ...facts, signatureDigest: digest(clientSignature ?? "") })) };
        };
        const before = await signedFacts();
        expect(before.days).toHaveLength(2);
        expect(before.docs.map(doc => doc.serviceRecordCaseId).sort()).toEqual([first!.id, second!.id].sort());
        expect(before.days.every(day => day.locked && day.submittedAt && day.signatureDigest !== digest(""))).toBe(true);
        await set("false");
        await context(firstAccess).expect(200);
        await context(secondAccess).expect(200);
        await submit(firstAccess, 2).expect(201);
        await http(off).patch(`/clients/${family.clientId}`).send({ breastPump: true }).expect(404);
        await link(family.scheduleId, "prepare", { employeeId: active.employees[0]!.id, caseIds: [first!.id] }, off).expect(404);
        await http().patch(`/clients/${family.clientId}`).send({ breastPump: true }).expect(200);
        await http().patch(`/clients/${family.clientId}/request-replacement`).send({
            newPrimaryEmployeeId: active.employees[2]!.id, newSecondaryEmployeeId: active.employees[3]!.id,
        }).expect(409);
        await context(firstAccess).expect(200);
        await context(secondAccess).expect(200);
        await http(off).patch(`/clients/${family.clientId}/terminate`).send({}).expect(404);
        await http().patch(`/clients/${family.clientId}/terminate`).send({ reason: "QA-Safety closure" }).expect(200);
        await context(firstAccess).expect(401);
        await context(secondAccess).expect(401);
        const revoked = await db.service_record_token.findFirstOrThrow({
            where: { branchId: active.id, serviceRecordCaseId: second!.id },
            select: { active: true, revokedAt: true, accessTokenHash: true },
        });
        expect({ active: revoked.active, revoked: Boolean(revoked.revokedAt), sessionCleared: !revoked.accessTokenHash })
            .toEqual({ active: false, revoked: true, sessionCleared: true });
        expect(await signedFacts()).toEqual(before);
        await set("true");
        await context(secondAccess).expect(401);
        expect(await signedFacts()).toEqual(before);
    });

    it("fences queued manual and automatic delivery without replaying accepted or unknown recipients on resume", async () => {
        const family = await book([0, 1]);
        const outstanding = await book([0, 0], [2]);
        const rejected = await book([0, 1], [3, 4]);
        const automatic = await jobs(family.clientId);
        const acceptedJob = automatic.find(job => job.recipientEmployeeId === active.employees[0]!.id)!;
        const unknownJob = automatic.find(job => job.recipientEmployeeId === active.employees[1]!.id)!;
        const rejectedJobs = await jobs(rejected.clientId);
        const failedJob = rejectedJobs.find(job => job.recipientEmployeeId === active.employees[3]!.id)!;
        const siblingJob = rejectedJobs.find(job => job.recipientEmployeeId === active.employees[4]!.id)!;
        const manualInput = { employeeId: active.employees[2]!.id, caseIds: outstanding.cases.map(row => row.id) };
        const { body: prepared } = await link(outstanding.scheduleId, "prepare", manualInput).expect(201);
        const sendSelection = { employeeId: manualInput.employeeId, members: prepared.members.map(
            ({ caseId, assignmentVersion, preparedLinkToken }: { caseId: string; assignmentVersion: number; preparedLinkToken: string }) =>
                ({ caseId, assignmentVersion, preparedLinkToken }),
        ) };
        const manualJob = await app.get(ServiceRecordLinkGroupService)
            .send(active.id, outstanding.scheduleId, sendSelection, active.userId);
        await dispatch(acceptedJob.id);
        carrier.script(active.employees[1]!.phone!, "throw");
        await dispatch(unknownJob.id);
        carrier.script(active.employees[3]!.phone!, "transientReject");
        await dispatch(failedJob.id);
        await dispatch(siblingJob.id);
        const accepted = await history(acceptedJob.id);
        const unknown = await history(unknownJob.id);
        const [failed] = await history(failedJob.id);
        expect(accepted.map(row => row.providerAcceptanceState)).toEqual(["accepted"]);
        expect(unknown.map(row => row.providerAcceptanceState)).toEqual(["uncertain"]);
        expect(failed?.providerAcceptanceState).toBe("rejected");
        const before = calls();
        await set("false");
        await link(outstanding.scheduleId, "prepare", manualInput).expect(409);
        await link(outstanding.scheduleId, "send", sendSelection).expect(409);
        const resetSelection = {
            employeeId: sendSelection.employeeId,
            members: sendSelection.members.map(({ caseId, assignmentVersion }: { caseId: string; assignmentVersion: number }) => ({ caseId, assignmentVersion })),
        };
        await link(outstanding.scheduleId, "reset", resetSelection).expect(409);
        await expect(retries.retryById(active.id, failed!.id)).rejects.toMatchObject({ status: 409 });
        const source = await logs.findByIdInBranch(active.id, failed!.id);
        await retries.retry(source!, "automatic");
        expect(await history(failedJob.id)).toEqual([failed]);
        await dispatch(manualJob.jobId);
        await trigger.dispatchDueJobs();
        expect((await jobs(outstanding.clientId)).find(job => job.id === manualJob.jobId)?.status).toBe("pending");
        expect(await history(manualJob.jobId)).toEqual([]);
        expect(calls()).toBe(before);

        carrier.clearScripts();
        await set("true");
        await dispatch(manualJob.jobId);
        await expect(retries.retryById(active.id, unknown[0]!.id)).rejects.toMatchObject({ status: 409 });
        await retries.retryById(active.id, failed!.id);
        expect((await history(failedJob.id)).map(row => row.providerAcceptanceState)).toEqual(["rejected", "accepted"]);
        await app.get(ServiceRecordLinkService).scheduleForServiceStart(family.scheduleId);
        for (const id of [acceptedJob.id, unknownJob.id, manualJob.jobId]) await dispatch(id);
        expect(await history(acceptedJob.id)).toEqual(accepted);
        expect(await history(unknownJob.id)).toEqual(unknown);
        expect((await history(manualJob.jobId)).map(row => row.providerAcceptanceState)).toEqual(["accepted"]);
        expect(calls()).toBe(before + 2);
    });

    it("serializes branch pause with admission and resumes only outstanding eligible work", async () => {
        const family = await book([0, 1]);
        const current = await jobs(family.clientId);
        const first = current.find(job => job.recipientEmployeeId === active.employees[0]!.id)!;
        const second = current.find(job => job.recipientEmployeeId === active.employees[1]!.id)!;
        const settings = app.get(SystemSettingService);
        const branchPolicy = await settings.getMessageAutomationPolicyConfig(active.id);
        const actor = { userId: active.userId, globalRole: "admin", branchRole: "admin" };
        const kstMinute = (time: number) =>
            new Date(time + 9 * 3_600_000).toISOString().slice(11, 16);
        const now = Date.now();
        const release = Math.floor(now / 60_000) * 60_000 + 120_000;
        const quiet = await settings.setMessageAutomationPolicyConfig(active.id, branchPolicy.version, {
            ...branchPolicy.configuration,
            quietHours: {
                ...branchPolicy.configuration.quietHours,
                enabled: true, action: "DEFER", recipientGroups: ["CAREGIVER"],
                start: kstMinute(now - 60 * 60_000), end: kstMinute(release),
            },
        }, actor);
        await dispatch(second.id);
        const prepared = await history(second.id);
        expect(prepared.map(row => [row.providerAcceptanceState, row.providerCallStartedAt])).toEqual([["prepared", null]]);
        const held = (await jobs(family.clientId)).find(job => job.id === second.id);
        expect(held?.nextAttemptAt).toEqual(new Date(release));
        await settings.setMessageAutomationPolicyConfig(active.id, quiet.version, branchPolicy.configuration, actor);
        let freeCarrier!: () => void;
        let enteredCarrier!: () => void;
        const inCarrier = new Promise<void>(resolve => { enteredCarrier = resolve; });
        const drain = new Promise<void>(resolve => { freeCarrier = resolve; });
        const realSend = carrier.sendSms.bind(carrier);
        const heldCarrier = jest.spyOn(carrier, "sendSms").mockImplementationOnce(async input => {
            enteredCarrier();
            await drain;
            return realSend(input);
        });
        const admitted = dispatch(first.id);
        try {
            await Promise.race([inCarrier, admitted.then(() => { throw new Error("Admission never reached the stub"); })]);
            expect((await history(first.id)).map(row => row.providerAcceptanceState)).toEqual(["started"]);
            const competing = db.$transaction(async tx => {
                await setRollout(tx, active.id, "false");
                // Wait for the live dispatcher connection to block on the
                // operator's lock before allowing the setting to commit.
                const attempt = dispatch(second.id);
                const deadline = Date.now() + 4_000;
                for (;;) {
                    const [waiter] = await tx.$queryRaw<Array<{ blocked: boolean }>>`
                        SELECT EXISTS (SELECT 1 FROM pg_locks
                            WHERE locktype = 'advisory' AND NOT granted
                              AND pg_backend_pid() = ANY(pg_blocking_pids(pid))) AS blocked
                    `;
                    if (waiter?.blocked) break;
                    if (Date.now() >= deadline) throw new Error("No dispatcher acquired a competing admission connection");
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                return { dispatch: attempt };
            });
            const { dispatch: denied } = await competing;
            await denied;
            expect(calls()).toBe(0);
            expect(await history(second.id)).toEqual(prepared);
            const pending = (await jobs(family.clientId)).find(job => job.id === second.id);
            expect({ status: pending?.status, due: pending?.nextAttemptAt }).toEqual({ status: "pending", due: new Date(release) });
        } finally {
            freeCarrier();
            await admitted;
            heldCarrier.mockRestore();
        }
        expect(calls()).toBe(1);
        const accepted = await history(first.id);
        expect(accepted.map(row => row.providerAcceptanceState)).toEqual(["accepted"]);
        const before = (await jobs(family.clientId)).map(job => ({ id: job.id, members: job.recordMembers }));
        await expect(dispatch(second.id, off)).rejects.toMatchObject({ status: 404 });
        await set("true");
        // Let the actual preexisting quiet hold become due under the real clock.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, release - Date.now()) + 50));
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await set("true");
            await dispatch(second.id);
            await dispatch(first.id);
        }
        expect(calls()).toBe(2);
        expect(await history(first.id)).toEqual(accepted);
        expect((await history(second.id)).map(row => [row.id, row.providerAcceptanceState])).toEqual([[prepared[0]!.id, "accepted"]]);
        expect((await jobs(family.clientId)).map(job => ({ id: job.id, members: job.recordMembers }))).toEqual(before);
    }, 150_000);

    it("keeps legacy draft and booking flows usable without synthesizing babies", async () => {
        const scope = { branchId: off.id };
        for (const voucherClient of [false, true]) {
            const { body } = await http(off).post("/clients").send({
                ...draft(), voucherClient, ...(voucherClient ? { type: "B-가-2형" } : {}),
                primaryEmployeeId: off.employees[voucherClient ? 1 : 0]!.id,
            }).expect(201);
            await http(off).patch(`/clients/${body.id}`).send({ breastPump: true }).expect(200);
            await confirm(body.id, off).expect(200);
            expect(await db.service_record_case.count({ where: { ...scope, clientId: body.id, babyId: null } })).toBe(1);
            const scalar = await db.message_trigger_job.findMany({
                where: { ...scope, clientId: body.id, ruleId: SERVICE_RECORD_LINK_RULE_ID },
                select: { id: true, recipientEmployeeId: true },
            });
            expect(scalar).toHaveLength(1);
            expect(scalar[0]!.recipientEmployeeId).toBeNull();
            const schedule = await db.employee_schedule.findFirstOrThrow({
                where: { ...scope, clientId: body.id, replaced: false }, select: { id: true },
            });
            const { body: prepared } = await link(schedule.id, "prepare", {}, off).expect(201);
            const { body: sent } = await link(schedule.id, "send", { preparedLinkToken: prepared.preparedLinkToken }, off).expect(201);
            expect(sent.status).toBe("sent");
            expect(await db.message_log.count({ where: { ...scope, triggerJobId: sent.jobId, providerAcceptanceState: "accepted" } })).toBe(1);
        }
        expect(await db.client_baby.count({ where: scope })).toBe(0);
        expect(await db.service_record_job_member.count({ where: scope })).toBe(0);
    });
});
