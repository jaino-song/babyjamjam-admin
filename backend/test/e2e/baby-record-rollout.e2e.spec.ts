import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import request from "supertest";

import { readBackfilledScalarHousehold } from "application/policies/baby-record-provenance.policy";
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

import { serviceRecordResetTarget } from "../../../packages/shared/src/utils/service-record-link-selection";
import { pinToday, unpinToday } from "../utils/pin-today";
import { issueAdminServiceRecordEditHttpToken } from "./helpers/admin-service-record-edit-http.helper";
import { ScriptedAligoStub } from "./helpers/scripted-aligo.stub";

const oldKeyTarget = "postgresql://bjj_revision_test@127.0.0.1:62295/throwaway_baby_cutover_old_keys";
const allowed = new Set(["work", "verify", "old_keys"].map(name =>
    `postgresql://bjj_revision_test@127.0.0.1:62295/throwaway_baby_cutover_${name}`));
const target = process.env["DATABASE_URL"];
const describeRollout = process.env["E2E_VENDOR_STUBS"] === "1" || (target && allowed.has(target))
    ? describe : describe.skip;
const dateAt = (days: number) => new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
const settingKey = (branch: string) => `branch:${branch}:baby_service_records:enabled`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function setRollout(tx: Prisma.TransactionClient, branchId: string, value: string) {
    const key = settingKey(branchId);
    await tx.system_setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

describeRollout("default baby records over authenticated Nest routes and PostgreSQL", () => {
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

    if (target === oldKeyTarget) {
        it.each(["missing", "false", "true"])("preserves the draft with the original unique keys and a %s setting", async setting => {
            const [keys] = await db.$queryRaw<Array<{ count: bigint }>>`
                SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
                    'service_record_case_client_id_key', 'service_record_schedule_id_key',
                    'service_record_assignment_schedule_id_key', 'service_record_day_schedule_id_session_index_key'
                )
            `;
            expect(keys?.count).toBe(4n);
            if (setting !== "missing") await db.$transaction(tx => setRollout(tx, off.id, setting));
            await http(off).get("/clients/baby-record-capability").expect(200, { enabled: true });
            const who = { ...off, employees: [off.employees[1]!] };
            const singleton = await http(who).post("/clients").send(configure([0], who, "A가2형", "SINGLETON")).expect(201);
            await confirm(singleton.body.id, off).expect(200);

            const clientId = await register([0, 0], off);
            const scope = { branchId: off.id, clientId };
            const owner = () => db.service_record_baby_assignment.findMany({ where: { ...scope, activeOwner: true }, orderBy: { id: "asc" } });
            const before = await owner();
            expect(before.map(row => row.employeeId)).toEqual([off.employees[0]!.id, off.employees[0]!.id]);
            const response = await confirm(clientId, off).expect(409);
            expect(response.body).toMatchObject({ code: "REQUEST_CONFLICT", reason: "SERVICE_RECORD_CASE_KEYS_NOT_STAGED", outcome: "NOT_APPLIED" });
            expect(await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { bookingConfirmedAt: true, serviceStatus: true } }))
                .toEqual({ bookingConfirmedAt: null, serviceStatus: "pre_booking" });
            expect(await owner()).toEqual(before);
            expect(await db.client_baby.count({ where: { ...scope, active: true } })).toBe(2);
            expect(await db.service_record_case.count({ where: scope })).toBe(0);
            expect(await db.message_trigger_job.count({ where: scope })).toBe(0);
            expect(await db.service_record_job_member.count({ where: scope })).toBe(0);
            expect(await db.service_record_token.count({ where: { branchId: off.id, schedule: scope } })).toBe(0);

            const direct = { ...off, employees: [off.employees[2]!] };
            const name = "QA-Atomic booked registration";
            const countJobs = () => db.message_trigger_job.count({ where: { branchId: off.id } });
            const jobsBefore = await countJobs();
            const immediate = await http(direct).post("/clients").send({
                ...configure([0, 0], direct), name, serviceStatus: "active",
            }).expect(409);
            expect(immediate.body).toMatchObject({ code: "REQUEST_CONFLICT", reason: "SERVICE_RECORD_CASE_KEYS_NOT_STAGED" });
            expect(await db.client.count({ where: { branchId: off.id, name } })).toBe(0);
            expect(await countJobs()).toBe(jobsBefore);
            expect(carrier.sendCalls).toHaveLength(0);
        });
        return;
    }

    it("scopes the trusted capability and registration by authenticated membership", async () => {
        const path = "/clients/baby-record-capability";
        await raw().get(path).expect(401);
        await http().get(path).expect(200, { enabled: true }).expect("Cache-Control", "private, no-store");
        await http(off).get(path).query({ branchId: active.id, key: settingKey(active.id) }).expect(200, { enabled: true });
        await http(off).post("/clients").send(configure([0, 0], active)).expect(400);
        expect(await db.client.count({ where: { branchId: off.id } })).toBe(0);
        const clientId = await register([0, 0], off);
        await confirm(clientId, active).expect(404);
        const clientPath = `/clients/${clientId}`;
        const own = await http(off).get(clientPath).expect(200);
        expect(own.body.id).toBe(clientId);
        await http().get(clientPath).expect(200, "");
        await db.user_branch.deleteMany({ where: { branchId: off.id, userId: off.userId } });
        await http(off).get(path).query({ branchId: active.id }).expect(403);
    });

    it.each(["missing", "false", "true"])("registers and books per-baby cases with a %s setting", async setting => {
        if (setting !== "missing") await db.$transaction(tx => setRollout(tx, off.id, setting));
        await http(off).get("/clients/baby-record-capability").expect(200, { enabled: true });
        const shapes = [
            ["A가2형", "SINGLETON", 1],
            ["B-가-2형", "TWINS", 2],
            ["C가2형", "TRIPLETS", 3],
            ["D가2형", "QUADRUPLETS_PLUS", 4],
        ] as const;
        for (const [employeeIndex, [type, fetalType, count]] of shapes.entries()) {
            const who = { ...off, employees: [off.employees[employeeIndex]!] };
            const { body } = await http(who).post("/clients")
                .send(configure(Array(count).fill(0), who, type, fetalType)).expect(201);
            const scope = { branchId: off.id, clientId: body.id as number };
            const babies = await db.client_baby.findMany({ where: { ...scope, active: true }, orderBy: { ordinal: "asc" } });
            expect(babies.map(row => row.ordinal)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
            await app.get(ServiceRecordLifecycleService).ensureAllForClient(scope.clientId);
            expect(await db.service_record_case.count({ where: scope })).toBe(0);
            expect(await db.service_record_job_member.count({ where: scope })).toBe(0);
            await confirm(scope.clientId, off).expect(200);
            const records = await db.service_record_case.findMany({ where: scope });
            expect(records.map(row => row.babyId).sort()).toEqual(babies.map(row => row.id).sort());
            const owners = await db.service_record_baby_assignment.findMany({ where: { ...scope, activeOwner: true } });
            expect(owners.map(row => row.employeeId)).toEqual(Array(count).fill(who.employees[0]!.id));
            expect(await db.service_record_job_member.count({ where: scope })).toBe(count);
        }
        expect(carrier.sendCalls).toHaveLength(0);
    });

    it("keeps signed cases usable and revokes a departed assignee with a false setting", async () => {
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
        await http(off).patch(`/clients/${family.clientId}/terminate`).send({}).expect(404);
        await http().patch(`/clients/${family.clientId}/request-replacement`).send({
            newPrimaryEmployeeId: active.employees[2]!.id, newSecondaryEmployeeId: active.employees[3]!.id,
        }).expect(200);
        const nextOwners = await db.service_record_baby_assignment.findMany({
            where: { branchId: active.id, clientId: family.clientId, activeOwner: true },
            select: { scheduleId: true, employeeId: true },
            orderBy: { employeeId: "asc" },
        });
        expect(nextOwners.map(row => row.employeeId)).toEqual([active.employees[2]!.id, active.employees[3]!.id]);
        expect(nextOwners.every(row => row.scheduleId !== family.scheduleId)).toBe(true);
        await context(firstAccess).expect(401);
        await context(secondAccess).expect(401);
        const revoked = await db.service_record_token.findFirstOrThrow({
            where: { branchId: active.id, serviceRecordCaseId: second!.id, scheduleId: family.scheduleId },
            select: { active: true, revokedAt: true, accessTokenHash: true },
        });
        expect({ active: revoked.active, revoked: Boolean(revoked.revokedAt), sessionCleared: !revoked.accessTokenHash })
            .toEqual({ active: false, revoked: true, sessionCleared: true });
        expect(await signedFacts()).toEqual(before);
        await set("true");
        await context(secondAccess).expect(401);
        expect(await signedFacts()).toEqual(before);
    });

    it("dispatches eligible queued work and retries without replaying accepted or unknown deliveries", async () => {
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
        const accepted = await history(acceptedJob.id);
        const unknown = await history(unknownJob.id);
        const [failed] = await history(failedJob.id);
        expect(accepted.map(row => row.providerAcceptanceState)).toEqual(["accepted"]);
        expect(unknown.map(row => row.providerAcceptanceState)).toEqual(["uncertain"]);
        expect(failed?.providerAcceptanceState).toBe("rejected");
        const before = calls();
        await set("false");
        carrier.clearScripts();
        await link(outstanding.scheduleId, "prepare", manualInput).expect(201);
        await dispatch(manualJob.jobId);
        await db.message_trigger_job.update({
            where: { id: siblingJob.id }, data: { scheduledFor: new Date(Date.now() - 1_000), nextAttemptAt: null },
        });
        await trigger.dispatchDueJobs();
        expect((await history(siblingJob.id)).map(row => row.providerAcceptanceState)).toEqual(["accepted"]);
        await db.message_log.update({ where: { id: failed!.id }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
        expect((await logs.findPendingRetriesSystemScope()).map(log => log.id)).toContain(failed!.id);
        await expect(retries.retryById(active.id, unknown[0]!.id)).rejects.toMatchObject({ status: 409 });
        await retries.retryById(active.id, failed!.id);
        expect((await history(failedJob.id)).map(row => row.providerAcceptanceState)).toEqual(["rejected", "accepted"]);
        await app.get(ServiceRecordLinkService).scheduleForServiceStart(family.scheduleId);
        for (const id of [acceptedJob.id, unknownJob.id, manualJob.jobId]) await dispatch(id);
        expect(await history(acceptedJob.id)).toEqual(accepted);
        expect(await history(unknownJob.id)).toEqual(unknown);
        expect((await history(manualJob.jobId)).map(row => row.providerAcceptanceState)).toEqual(["accepted"]);
        expect(calls()).toBe(before + 3);
    });

    it("honors the quiet hold and dispatches the same prepared attempt after release", async () => {
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
            await set("false");
            await trigger.dispatchDueJobs();
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
        // Advance the application clock to the recorded release without changing
        // the real PostgreSQL transactions or the prepared acceptance row.
        pinToday(new Date(release + 50).toISOString());
        try {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                await dispatch(second.id);
                await dispatch(first.id);
            }
        } finally {
            unpinToday();
        }
        expect(calls()).toBe(2);
        expect(await history(first.id)).toEqual(accepted);
        expect((await history(second.id)).map(row => [row.id, row.providerAcceptanceState])).toEqual([[prepared[0]!.id, "accepted"]]);
        expect((await jobs(family.clientId)).map(job => ({ id: job.id, members: job.recordMembers }))).toEqual(before);
    });

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

    async function backfillHistoricBooking(startDate = dateAt(-1), phone?: string) {
        const { body } = await http(off).post("/clients").send({
            ...draft(), startDate, phone, type: "A가2형", applyMessageAutomation: true, smsAutomationEnabled: true,
            primaryEmployeeId: off.employees[0]!.id,
        }).expect(201);
        const scope = { branchId: off.id, clientId: body.id as number };
        await confirm(scope.clientId, off).expect(200);
        const schedule = await db.employee_schedule.findFirstOrThrow({ where: { ...scope, replaced: false } });
        const original = await db.service_record_case.findFirstOrThrow({ where: scope });
        expect(original.babyId).toBeNull();
        if (startDate === dateAt(-1)) {
            const { body: sent } = await link(schedule.id, "send", {}, off).expect(201);
            expect(sent.status).toBe("sent");
            const { linkTokenHash } = await db.service_record_token.findFirstOrThrow({
                where: { branchId: off.id, scheduleId: schedule.id, active: true, revokedAt: null },
            });
            const { body: verified } = await raw().post("/service-record/verify")
                .send({ linkToken: linkTokenHash, phone: off.employees[0]!.phone }).expect(201);
            await header(verified.accessToken).expect(200);
            await submit(verified.accessToken, 1).expect(201);
        }
        const days = () => db.service_record_day.findMany({
            where: { branchId: off.id, serviceRecordCaseId: original.id }, orderBy: { id: "asc" },
        });
        const originalDays = await days();
        // beforeAll requires the exact throwaway loopback clone and vendor
        // stubs. The original operator SQL runs only on that clone.
        execFileSync("psql", [
            "-X", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-d", target!,
            "-f", resolve(__dirname, "../../prisma/scripts/backfill-baby-record-foundation.sql"),
        ], { stdio: ["ignore", "ignore", "pipe"] });
        const baby = await db.client_baby.findFirstOrThrow({ where: scope });
        expect(baby).toMatchObject({ active: true, legacyBackfilled: true, ordinal: 1 });
        expect(await db.service_record_case.findFirstOrThrow({ where: scope })).toMatchObject({ id: original.id, babyId: baby.id });
        expect(await db.service_record_baby_assignment.count({
            where: { ...scope, babyId: baby.id, scheduleId: schedule.id, legacyBackfilled: true, activeOwner: true },
        })).toBe(1);
        return { scope, schedule, original, baby, days, originalDays };
    }

    it.each(["reset", "send"] as const)("switches a backfilled v1 credential to the group on %s", async action => {
        const { scope, schedule, original, days, originalDays } = await backfillHistoricBooking();
        const employeeId = off.employees[0]!.id;
        const tokenScope = { branchId: off.id, scheduleId: schedule.id, employeeId };
        const legacy = await db.service_record_token.findFirstOrThrow({ where: { ...tokenScope, active: true, revokedAt: null }, select: { id: true } });
        const scalarJobs = () => db.message_trigger_job.findMany({
            where: { ...scope, employeeScheduleId: schedule.id, ruleId: SERVICE_RECORD_LINK_RULE_ID, recipientEmployeeId: null, status: "sent" },
            select: { id: true, dedupeKey: true, recipientPhone: true, logs: { select: { id: true, providerAcceptanceState: true } } },
        });
        const accepted = await scalarJobs();
        expect(accepted).toEqual([expect.objectContaining({ logs: [expect.objectContaining({ providerAcceptanceState: "accepted" })] })]);
        const groupSelection = { employeeId, caseIds: [original.id] };
        if (action === "reset") {
            await db.service_record_token.update({
                where: { id: legacy.id }, data: { lockedAt: new Date(), failedAttempts: 5 },
            });
        }
        await db.$transaction(tx => setRollout(tx, off.id, "true"));
        const { body: prepared } = await link(schedule.id, "prepare", groupSelection, off).expect(201);
        const { caseId, assignmentVersion, preparedLinkToken } = prepared.members[0];
        const members = [{ caseId, assignmentVersion, preparedLinkToken }];
        expect(prepared).toMatchObject({ kind: "group", employeeId });
        expect(caseId).toBe(original.id);
        expect(await db.service_record_token.findMany({ where: { ...tokenScope, active: true, revokedAt: null }, select: { id: true } }))
            .toEqual([{ id: legacy.id }]);
        await link(schedule.id, "send", { preparedLinkToken }, off).expect(409);
        if (action === "reset") {
            await link(schedule.id, "send", { employeeId, members }, off).expect(409);
            await link(schedule.id, "reset", { employeeId, members: [{ caseId, assignmentVersion }] }, off).expect(201);
            const { body: afterReset } = await link(schedule.id, "prepare", groupSelection, off).expect(201);
            expect(afterReset.members[0].preparedLinkToken === preparedLinkToken).toBe(true);
        }
        const { body: sent } = await link(schedule.id, "send", { employeeId, members }, off).expect(201);
        expect(sent.status).toBe("sent");
        expect(await db.message_log.count({ where: { ...scope, triggerJobId: sent.jobId, providerAcceptanceState: "accepted" } })).toBe(1);
        expect(await db.service_record_job_member.count({ where: { ...scope, jobId: sent.jobId, serviceRecordCaseId: original.id } })).toBe(1);
        expect(await db.service_record_token.findMany({
            where: { ...tokenScope, active: true, revokedAt: null }, select: { serviceRecordCaseId: true, failedAttempts: true, lockedAt: true },
        })).toEqual([{ serviceRecordCaseId: original.id, failedAttempts: 0, lockedAt: null }]);
        const retired = await db.service_record_token.findUniqueOrThrow({
            where: { id: legacy.id }, select: { active: true, revokedAt: true, accessTokenHash: true, verifiedAt: true },
        });
        expect({ ...retired, accessTokenHash: retired.accessTokenHash === null }).toEqual({
            active: false, revokedAt: expect.any(Date), accessTokenHash: true, verifiedAt: null,
        });
        await db.$transaction(tx => setRollout(tx, off.id, "false"));
        await link(schedule.id, "send", { preparedLinkToken }, off).expect(409);
        expect(await scalarJobs()).toEqual(accepted);
        expect(await days()).toEqual(originalDays);
        expect(carrier.sendCalls.filter(call => call.receiver === off.employees[0]!.phone)).toHaveLength(2);
    });

    it.each(["handover", "reuse", "replacement"] as const)("preserves allocation provenance after %s with a false setting", async operation => {
        const historicalPhone = `010${++phoneBase}`;
        const explicitPhone = `010${++phoneBase}`;
        const { scope, schedule, original, baby, days, originalDays } = await backfillHistoricBooking(dateAt(-1), historicalPhone);
        const { body: explicit } = await http().post("/clients").send({
            ...configure([0], active, "A가2형", "SINGLETON"), phone: explicitPhone,
        }).expect(201);
        await confirm(explicit.id).expect(200);
        await set("false");
        await db.$transaction(tx => setRollout(tx, off.id, "false"));

        const change = (who: typeof off, clientId: number, phone: string) => {
            const employeeId = who.employees[1]!.id;
            if (operation === "replacement") {
                return http(who).patch(`/clients/${clientId}/request-replacement`).send({ newPrimaryEmployeeId: employeeId });
            }
            if (operation === "reuse") {
                return http(who).post("/clients").send({
                    name: "QA-Rollout client", phone, reuseExistingClient: true, voucherClient: true, breastPump: false,
                    primaryEmployeeId: employeeId, applyMessageAutomation: false,
                });
            }
            return http(who).patch(`/clients/${clientId}`).send({ primaryEmployeeId: employeeId });
        };
        const explicitScope = { branchId: active.id, clientId: explicit.id as number };
        const explicitOriginal = await db.service_record_case.findFirstOrThrow({ where: explicitScope });
        await change(active, explicit.id, explicitPhone).expect(operation === "reuse" ? 201 : 200);
        const explicitSuccessor = await db.employee_schedule.findFirstOrThrow({ where: { ...explicitScope, replaced: false } });
        expect(await db.service_record_baby_assignment.findMany({ where: { ...explicitScope, activeOwner: true } }))
            .toEqual([expect.objectContaining({
                babyId: explicitOriginal.babyId, scheduleId: explicitSuccessor.id,
                employeeId: active.employees[1]!.id, legacyBackfilled: false,
            })]);
        const explicitCases = await db.service_record_case.findMany({ where: explicitScope, select: { id: true, babyId: true } });
        expect(explicitCases).toEqual([{ id: explicitOriginal.id, babyId: explicitOriginal.babyId }]);

        await change(off, scope.clientId, historicalPhone).expect(operation === "reuse" ? 201 : 200);
        const successor = await db.employee_schedule.findFirstOrThrow({ where: { ...scope, replaced: false } });
        const employeeId = off.employees[1]!.id;
        expect(successor.id).not.toBe(schedule.id);
        expect(successor.primaryEmployeeId).toBe(employeeId);
        expect(await db.service_record_baby_assignment.findMany({ where: { ...scope, activeOwner: true } }))
            .toEqual([expect.objectContaining({ babyId: baby.id, scheduleId: successor.id, employeeId, legacyBackfilled: true })]);
        expect(await db.service_record_case.findMany({ where: scope, select: { id: true, babyId: true } }))
            .toEqual([{ id: original.id, babyId: baby.id }]);
        expect(await days()).toEqual(originalDays);
        expect(await db.service_record_token.count({ where: { branchId: off.id, scheduleId: schedule.id, revokedAt: null } })).toBe(0);
        expect(await db.service_record_job_member.count({ where: scope })).toBe(0);
    });

    it.each(["missing", "false", "true"])("keeps signed backfilled singleton writes scalar with a %s setting", async setting => {
        const { scope, schedule, original, baby, days, originalDays } = await backfillHistoricBooking();
        expect(originalDays).toHaveLength(1);
        expect(originalDays[0]).toMatchObject({ locked: true });
        if (setting !== "missing") await db.$transaction(tx => setRollout(tx, off.id, setting));
        // Exercise booking with the backfilled case and allocation already in place.
        await db.client.update({ where: { id: scope.clientId }, data: { bookingConfirmedAt: null, serviceStatus: "pre_booking" } });
        await confirm(scope.clientId, off).expect(200);
        expect((await db.client.findUniqueOrThrow({ where: { id: scope.clientId } })).bookingConfirmedAt).not.toBeNull();
        const editor = "/admin/service-records/client/" + scope.clientId + "/editor?caseId=" + original.id;
        const { body: overview } = await http(off).get(editor).expect(200);
        const target = serviceRecordResetTarget(overview, original.id);
        expect(target).toEqual({ scheduleId: schedule.id, request: {} });
        const issued = await db.service_record_token.findFirstOrThrow({
            where: { branchId: off.id, scheduleId: schedule.id, active: true, revokedAt: null },
            select: { linkTokenHash: true },
        });
        const { body: prepared } = await link(schedule.id, "prepare", { caseId: original.id }, off).expect(201);
        expect(prepared.kind).toBe("legacy");
        expect(prepared.preparedLinkToken === issued.linkTokenHash).toBe(true);
        const { body: sent } = await link(schedule.id, "send", { preparedLinkToken: prepared.preparedLinkToken }, off).expect(201);
        expect(sent.status).toBe("sent");
        expect(await db.message_log.count({ where: { branchId: off.id, triggerJobId: sent.jobId, providerAcceptanceState: "accepted" } })).toBe(1);
        expect(carrier.sendCalls.filter(call => call.receiver === off.employees[0]!.phone)).toHaveLength(2);
        const { body: reset } = await link(schedule.id, "reset", target!.request, off).expect(201);
        expect(reset).toMatchObject({ kind: "legacy", serviceRecordUrl: prepared.serviceRecordUrl });
        expect(await db.service_record_job_member.count({ where: scope })).toBe(0);
        expect(await db.service_record_case.findMany({ where: scope, select: { id: true, babyId: true } }))
            .toEqual([{ id: original.id, babyId: baby.id }]);
        expect(await days()).toEqual(originalDays);
    });

    it("reserves a fresh scalar automatic job and keeps a later schedule on the original case", async () => {
        const { scope, schedule, original, baby } = await backfillHistoricBooking(dateAt(4));
        const where = { ...scope, ruleId: SERVICE_RECORD_LINK_RULE_ID };
        const before = await db.message_trigger_job.findMany({ where, include: { logs: true } });
        expect(before).toHaveLength(1);
        expect(before[0]).toMatchObject({ recipientEmployeeId: null, canceledByUser: false, logs: [] });
        expect(["pending", "canceled"]).toContain(before[0]!.status);
        if (before[0]!.status === "canceled") expect(before[0]!.cancelReason).toContain("예약 전");
        await db.message_trigger_job.delete({ where: { id: before[0]!.id } });
        await expect(app.get(ServiceRecordLinkService).scheduleForServiceStart(schedule.id)).resolves.toBe(true);
        expect(await db.message_trigger_job.findMany({ where, include: { recordMembers: true } }))
            .toEqual([expect.objectContaining({ status: "pending", recipientEmployeeId: null, recordMembers: [] })]);
        const { body: successor } = await http(off).post("/employee-schedules").send({
            clientId: scope.clientId, primaryEmployeeId: off.employees[0]!.id, workAddress: "QA-Rollout schedule",
            startDate: dateAt(20), endDate: dateAt(25),
        }).expect(201);
        expect(await db.service_record_baby_assignment.count({ where: {
            ...scope, babyId: baby.id, scheduleId: successor.id, activeOwner: true, legacyBackfilled: true,
        } })).toBe(1);
        expect(await db.service_record_assignment.count({
            where: { branchId: off.id, serviceRecordCaseId: original.id, scheduleId: successor.id },
        })).toBe(1);
        expect(await db.service_record_case.count({ where: scope })).toBe(1);
    });

    it.each(["adopted", "mixed", "group prepared", "no current owner", "retired baby"])(
        "uses persisted provenance for a %s historical household", async mode => {
        const { scope, schedule, original, baby } = await backfillHistoricBooking(dateAt(4));
        await db.$transaction(tx => setRollout(tx, off.id, "true"));
        const employeeId = off.employees[0]!.id;
        const selection = { employeeId, caseIds: [original.id] };
        let preparedGroup: { caseId: string; assignmentVersion: number; preparedLinkToken: string } | undefined;
        if (mode === "adopted") {
            const clientPath = "/clients/" + scope.clientId;
            const { body: client } = await http(off).get(clientPath).expect(200);
            await http(off).patch(clientPath).send({
                type: "A가2형", voucherIssuanceYear: 2026, fetalType: "SINGLETON", babyCount: 1,
                expectedAllocationVersion: client.allocationVersion,
                providers: [{ slot: 0, employeeId }], babyAssignments: [{ babyId: baby.id, providerSlot: 0 }],
            }).expect(200);
            expect(await db.service_record_baby_assignment.count({ where: {
                ...scope, scheduleId: schedule.id, babyId: baby.id, activeOwner: true, legacyBackfilled: false,
            } })).toBe(1);
        } else if (mode === "mixed") {
            await db.service_record_team_slot.create({ data: {
                ...scope, scheduleId: schedule.id, slot: 1, employeeId: off.employees[1]!.id,
            } });
        } else if (mode === "group prepared") {
            const { body } = await link(schedule.id, "prepare", selection, off).expect(201);
            expect(body.kind).toBe("group");
            const { caseId, assignmentVersion, preparedLinkToken } = body.members[0];
            preparedGroup = { caseId, assignmentVersion, preparedLinkToken };
            await link(schedule.id, "send", { preparedLinkToken }, off).expect(409);
        } else {
            await db.service_record_baby_assignment.updateMany({
                where: { ...scope, scheduleId: schedule.id, babyId: baby.id, activeOwner: true },
                data: { activeOwner: null, endedAt: new Date() },
            });
            if (mode === "retired baby") await db.client_baby.update({ where: { id: baby.id }, data: { active: false } });
        }
        await db.$transaction(tx => setRollout(tx, off.id, "false"));
        expect(await readBackfilledScalarHousehold(db, scope)).toBeNull();
        if (mode === "no current owner" || mode === "retired baby") {
            await link(schedule.id, "prepare", {}, off).expect(409);
            await link(schedule.id, "prepare", selection, off).expect(409);
            await link(schedule.id, "reset", {}, off).expect(409);
        } else {
            const { body } = await link(schedule.id, "prepare", selection, off).expect(201);
            expect(body.members).toEqual([expect.objectContaining({ caseId: original.id })]);
            if (preparedGroup) {
                await link(schedule.id, "prepare", {}, off).expect(409);
                await link(schedule.id, "send", { preparedLinkToken: preparedGroup.preparedLinkToken }, off).expect(409);
                expect(body.members[0].preparedLinkToken).toBe(preparedGroup.preparedLinkToken);
            }
        }
        expect(await db.service_record_case.findFirstOrThrow({ where: scope })).toMatchObject({ id: original.id, babyId: baby.id });
        expect(carrier.sendCalls).toHaveLength(0);
    });

    it.each([[1, "A가2형", "SINGLETON"], [2, "B-가-2형", "TWINS"]] as const)(
        "allows scoped link preparation for a configured %i-baby household with a false setting",
        async (count, type, fetalType) => {
            const { body } = await http().post("/clients").send(configure(Array(count).fill(0), active, type, fetalType)).expect(201);
            await confirm(body.id).expect(200);
            const scope = { branchId: active.id, clientId: body.id as number };
            const schedule = await db.employee_schedule.findFirstOrThrow({ where: { ...scope, replaced: false } });
            const cases = await db.service_record_case.findMany({ where: scope });
            await set("false");
            const groupSelection = { employeeId: active.employees[0]!.id, caseIds: cases.map(record => record.id) };
            if (count > 1) await link(schedule.id, "prepare", {}, active).expect(409);
            await link(schedule.id, "prepare", groupSelection, off).expect(404);
            const { body: prepared } = await link(schedule.id, "prepare", groupSelection, active).expect(201);
            expect(prepared.members).toHaveLength(count);
            expect(await db.service_record_case.count({ where: scope })).toBe(count);
            expect(calls()).toBe(0);
        },
    );
});
