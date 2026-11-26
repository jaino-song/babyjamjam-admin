import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";

import { HolidayReviewProcessorService } from "application/services/holiday-review-processor.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { getJwtSecret } from "infrastructure/auth/jwt-secret";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { PrismaService } from "infrastructure/database/prisma.service";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { E2eAligoApiStub } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { HolidayReviewModule } from "module/holiday-review.module";
import { MessageDeliveryModule } from "module/message-delivery.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

import { pinToday, unpinToday } from "../utils/pin-today";
import { issueAdminServiceRecordEditHttpToken } from "./helpers/admin-service-record-edit-http.helper";

const ORIGIN = "postgresql://bjj_revision_test@127.0.0.1:62295/";
const TARGETS = new Set([ORIGIN + "throwaway_baby_schema_work", ORIGIN + "throwaway_baby_schema_verify"]);
const ENABLED = process.env["E2E_VENDOR_STUBS"] === "1";
const describeReal = ENABLED ? describe : describe.skip;

function assertTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || !TARGETS.has(url) || process.env["DIRECT_URL"] !== url || process.env["NODE_ENV"] !== "test" || !ENABLED) {
        throw new Error("Schema-closure fixtures require both URLs to match an approved disposable loopback database");
    }
}

const START = "2026-11-02";
const END = "2026-11-06";
const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const signature = "data:image/png;base64,aGVsbG8=";
const header = {
    momName: "가나다", momBirth: "1990-01-01", babyBirth: "2026-10-21",
    babyWeight: "3.2", deliveryType: "자연분만",
};

type Provider = { id: number; phone: string };
type Baby = { babyId: string; ordinal: number };
type ClientRegistration = { id: number; babies: Baby[]; allocationVersion: string };

describeReal("baby case schema closure across real HTTP routes and PostgreSQL", () => {
    let app: INestApplication;
    let db: PrismaService;
    let jwt: JwtService;
    let tokens: ServiceRecordTokenService;
    let priceRowIds: number[] = [];
    const sms = new E2eAligoApiStub();

    beforeAll(async () => {
        assertTarget();
        const env = jest.replaceProperty(process, "env", {
            ...process.env, VALKEY_URL: "", AUTH_RATE_LIMIT_DISABLED: "false", DATABASE_CONNECTION_MODE: "shared",
        });
        try {
            const module = await Test.createTestingModule({
                imports: [
                    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                    PassportModule.register({ defaultStrategy: "jwt" }),
                    JwtModule.register({ global: true, secret: getJwtSecret() }),
                    TenantModule, HolidayReviewModule, MessageDeliveryModule, SchedulerLeaseModule,
                ],
                providers: [JwtStrategy],
            }).overrideProvider(ALIGO_SMS_API_PORT).useValue(sms).compile();

            app = module.createNestApplication({ logger: false });
            const tenant = app.get(TenantAlsMiddleware);
            app.use(tenant.use.bind(tenant));
            app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
            app.useGlobalFilters(new PrismaExceptionFilter());
            await app.init();
            db = app.get(PrismaService);
            jwt = app.get(JwtService);
            tokens = app.get(ServiceRecordTokenService);
        } finally {
            env.restore();
        }

        const key = { year: 2026, type: "B가②형", duration: 31999 };
        if (!(await db.voucher_price_info.findFirst({ where: key }))) {
            const max = (await db.voucher_price_info.aggregate({ _max: { id: true } }))._max.id ?? 0;
            const row = await db.voucher_price_info.create({
                data: { ...key, id: max + 1, fullPrice: "1400000", grant: "1000000", actualPrice: "400000" },
            });
            priceRowIds = [row.id];
        }
    }, 45_000);

    beforeEach(() => pinToday("2026-11-01T15:05:00.000Z"));
    afterEach(unpinToday);

    afterAll(async () => {
        try {
            if (priceRowIds.length) await db.voucher_price_info.deleteMany({ where: { id: { in: priceRowIds } } });
        } finally {
            await app?.close();
        }
    });

    const http = () => request(app.getHttpServer());
    const adminRecord = (clientId: number) => `/admin/service-records/client/${clientId}`;
    const adoption = (clientId: number, caseId: string) => `${adminRecord(clientId)}/cases/${caseId}/adopt`;

    async function userInBranch(branchId: string, role: "admin" | "user" = "admin") {
        const user = await db.user.create({
            data: { name: "QA-Closure user", email: `${randomUUID()}@schema-closure.test`, role, approvalStatus: "approved" },
        });
        await db.user_branch.create({ data: { branchId, userId: user.id, role } });
        const session = await db.auth_session.create({
            data: { userId: user.id, selectedBranchId: branchId, expiresAt: new Date(Date.now() + 3_600_000) },
        });
        const authorization = await issueAdminServiceRecordEditHttpToken(jwt, {
            userId: user.id, sessionId: session.id, branchId, role, branchRole: role, tokenVersion: user.tokenVersion,
        });
        return { userId: user.id, authorization };
    }

    async function branchFixture() {
        const branch = await db.branch.create({
            data: { name: "QA-Schema closure", slug: `qa-schema-closure-${randomUUID()}` },
        });
        return { branchId: branch.id, ...await userInBranch(branch.id) };
    }

    async function caregiver(branchId: string, phone: string) {
        return db.employee.create({
            data: { branchId, name: `QA-Provider ${phone.slice(-1)}`, grade: "스탠다드", phone, openToNextWork: true },
        });
    }

    type Branch = Awaited<ReturnType<typeof branchFixture>>;

    function twins(primary: Provider, assistant: Provider) {
        return {
            type: "B-가-2형", voucherIssuanceYear: 2026, fetalType: "TWINS", babyCount: 2,
            providers: [{ slot: 0, employeeId: primary.id }, { slot: 1, employeeId: assistant.id }],
            babyAssignments: [{ ordinal: 1, providerSlot: 0 }, { ordinal: 2, providerSlot: 1 }],
        };
    }

    async function register(branch: Branch, options: object) {
        const { body }: { body: ClientRegistration } = await http().post("/clients")
            .auth(branch.authorization, { type: "bearer" }).send({
                name: "QA-Closure family", voucherClient: true, breastPump: false, serviceStatus: "pre_booking",
                startDate: START, endDate: END, duration: 5, applyMessageAutomation: false, ...options,
            }).expect(201);
        const scope = { branchId: branch.branchId, clientId: body.id };
        expect(await db.service_record_case.count({ where: scope })).toBe(0);
        await http().patch(`/clients/${body.id}/confirm-booking`).auth(branch.authorization, { type: "bearer" })
            .send({}).expect(200);
        return { ...scope, registration: body };
    }

    const ownedCases = (scope: { clientId: number; branchId: string }) =>
        db.service_record_case.findMany({ where: scope, orderBy: { id: "asc" } });

    async function issue(branchId: string, scheduleId: number, serviceRecordCaseId: string, employee: Provider) {
        const { linkToken } = await tokens.issueLink({
            branchId, scheduleId, serviceRecordCaseId, employeeId: employee.id, expectedPhone: employee.phone,
            expiresAt: new Date(Date.now() + 86_400_000),
        });
        return linkToken;
    }

    const verify = (linkToken: string, phone: string) => http().post("/service-record/verify").send({ linkToken, phone });
    const linkStatus = (linkToken: string) => http().get(`/service-record/link/${encodeURIComponent(linkToken)}`);
    const context = (access: string) => http().get("/service-record/context").auth(access, { type: "bearer" });

    async function authorize(linkToken: string, employee: Provider): Promise<string> {
        const { body } = await verify(linkToken, employee.phone).expect(201);
        expect(body.ok).toBe(true);
        if (typeof body.accessToken !== "string") throw new Error("Phone verification did not issue an access token");
        return body.accessToken;
    }

    async function submit(access: string, babyName: string, serviceDate = START) {
        await http().put("/service-record/header").auth(access, { type: "bearer" }).send({ ...header, babyName }).expect(200);
        await http().post("/service-record/sessions/1/submit").auth(access, { type: "bearer" })
            .send({ serviceDate, notes: babyName, momApproval: "approved", clientSignature: signature }).expect(201);
    }

    async function legacyFixture(branch: Branch, assistant?: Provider) {
        const primary = await caregiver(branch.branchId, "01000009301");
        const { clientId, branchId } = await register(branch, {
            type: "B가2형", primaryEmployeeId: primary.id, secondaryEmployeeId: assistant?.id,
        });
        const scope = { clientId, branchId };
        const cases = await ownedCases(scope);
        expect(cases).toEqual([expect.objectContaining({ babyId: null })]);
        const [record] = cases;
        if (!record) throw new Error("Expected the original legacy case");
        const schedules = await db.employee_schedule.findMany({ where: scope, orderBy: { id: "asc" } });
        expect(schedules).toHaveLength(1);
        const [schedule] = schedules;
        if (!schedule) throw new Error("Expected the legacy schedule");
        return { scope, record, schedule, primary };
    }

    async function signedLegacyFixture(branch: Branch, assistant?: Provider) {
        const fixture = await legacyFixture(branch, assistant);
        const { scope, record, schedule, primary } = fixture;
        const link = await issue(scope.branchId, schedule.id, record.id, primary);
        const access = await authorize(link, primary);
        await submit(access, "기존아기");
        const day = await db.service_record_day.findUniqueOrThrow({
            where: { serviceRecordCaseId_caseSessionIndex: { serviceRecordCaseId: record.id, caseSessionIndex: 1 } },
        });
        expect(day).toMatchObject({ locked: true, employeeId: primary.id, clientSignature: signature, serviceDate: date(START) });
        const revision = await db.service_record_revision.create({
            data: {
                branchId: scope.branchId, serviceRecordCaseId: record.id, revisionNumber: 1,
                confirmedByUserId: branch.userId, payload: { fixture: true }, plannedSessions: [],
                provenance: {}, formVersionAtConfirm: 1,
            },
        });
        await db.service_record_case.update({ where: { id: record.id }, data: { currentRevisionId: revision.id } });
        const document = await db.eformsign_doc.create({
            data: {
                ...scope, serviceRecordCaseId: record.id, employeeScheduleId: schedule.id, revisionId: revision.id,
                documentId: randomUUID(), documentKind: "service_record_snapshot",
                createdDate: date(START), updatedDate: date(START), expiredDate: date(END), statusType: "003",
                statusDetail: "", stepType: "", stepIndex: "", stepName: "", stepRecipientType: "",
                stepRecipientName: "", stepRecipientSms: "",
            },
        });
        const file = await db.eformsign_doc_file.create({
            data: {
                eformsignDocId: document.id, fileType: "document", content: Buffer.from("fixture"),
                byteSize: 7, contentType: "application/pdf", sha256: "f".repeat(64), sourceUpdatedDate: document.updatedDate,
            },
        });
        return { ...fixture, link, access, day, revision, document, file };
    }

    it("canonical keys allow siblings on the same schedule and session", async () => {
        const branch = await branchFixture();
        const primary = await caregiver(branch.branchId, "01000009301");
        const assistant = await caregiver(branch.branchId, "01000009302");
        const { registration, ...scope } = await register(branch, twins(primary, assistant));
        const cases = await ownedCases(scope);
        expect(cases).toHaveLength(2);
        expect(registration.babies).toHaveLength(2);
        const schedules = await db.employee_schedule.findMany({ where: scope, orderBy: { id: "asc" } });
        expect(schedules).toHaveLength(1);
        const [schedule] = schedules;
        if (!schedule) throw new Error("Expected both siblings to use the same schedule");

        const expected = [];
        for (const [index, employee] of [primary, assistant].entries()) {
            const baby = registration.babies[index];
            const record = cases.find(({ babyId }) => babyId === baby?.babyId);
            if (!baby || !record) throw new Error("Expected a case owned by the registered baby");
            const access = await authorize(await issue(scope.branchId, schedule.id, record.id, employee), employee);
            const babyName = index === 0 ? "첫째아기" : "둘째아기";
            await submit(access, babyName);
            const { body } = await context(access).expect(200);
            expect(body).toMatchObject({
                babyId: baby.babyId, babyRank: index + 1, babyCount: 2,
                employee: { id: employee.id }, header: { babyName },
                sessions: [{ sessionIndex: 1, serviceRecordCaseId: record.id, notes: babyName, locked: true }],
            });
            expected.push({ caseId: record.id, employeeId: employee.id, babyName });
        }

        const where = { branchId: scope.branchId, scheduleId: schedule.id };
        const [headers, days, assignments] = await Promise.all([
            db.service_record.findMany({ where, orderBy: { serviceRecordCaseId: "asc" } }),
            db.service_record_day.findMany({ where, orderBy: { serviceRecordCaseId: "asc" } }),
            db.service_record_assignment.findMany({ where, orderBy: { serviceRecordCaseId: "asc" } }),
        ]);
        const sorted = expected.sort((a, b) => a.caseId.localeCompare(b.caseId));
        expect(headers.map(({ serviceRecordCaseId, babyName }) => [serviceRecordCaseId, babyName]))
            .toEqual(sorted.map(({ caseId, babyName }) => [caseId, babyName]));
        expect(days.map(({ serviceRecordCaseId, sessionIndex, employeeId, clientSignature }) =>
            [serviceRecordCaseId, sessionIndex, employeeId, clientSignature]))
            .toEqual(sorted.map(({ caseId, employeeId }) => [caseId, 1, employeeId, signature]));
        expect(assignments.map(({ serviceRecordCaseId, employeeId }) => [serviceRecordCaseId, employeeId]))
            .toEqual(sorted.map(({ caseId, employeeId }) => [caseId, employeeId]));
        for (const rows of [headers, days, assignments]) expect(new Set(rows.map(({ id }) => id)).size).toBe(2);
    });

    it("an unknown historical case retains its original identity", async () => {
        const branch = await branchFixture();
        const { scope, record, day, document, access } = await signedLegacyFixture(branch);
        const { body } = await http().get(`${adminRecord(scope.clientId)}/editor`)
            .auth(branch.authorization, { type: "bearer" }).expect(200);
        expect(body).toMatchObject({
            cases: [{ caseId: record.id, babyId: null }],
            record: { id: record.id, sessions: [{ clientSignature: signature, employeeId: day.employeeId }] },
        });
        expect((await context(access).expect(200)).body).toMatchObject({
            babyId: null, sessions: [{ id: day.id, serviceRecordCaseId: record.id }],
        });
        expect(await db.client_baby.count({ where: scope })).toBe(0);
        expect(await ownedCases(scope)).toEqual([expect.objectContaining({ id: record.id, babyId: null })]);
        expect(await db.eformsign_doc.findUnique({ where: { id: document.id } })).toEqual(document);
    });

    it("the authenticated adoption route preserves a signed case", async () => {
        const branch = await branchFixture();
        const assistant = await caregiver(branch.branchId, "01000009302");
        const { scope, record, day, revision, document, file, link, access, primary, schedule } =
            await signedLegacyFixture(branch, assistant);
        const clientPath = `/clients/${scope.clientId}`;
        const { body: prior }: { body: ClientRegistration } = await http().get(clientPath)
            .auth(branch.authorization, { type: "bearer" }).expect(200);
        const { body }: { body: ClientRegistration } = await http().patch(clientPath)
            .auth(branch.authorization, { type: "bearer" })
            .send({ ...twins(primary, assistant), expectedAllocationVersion: prior.allocationVersion }).expect(200);
        expect(body.babies).toHaveLength(2);
        const babyId = body.babies[0]?.babyId;
        const siblingId = body.babies[1]?.babyId;
        if (!babyId || !siblingId) throw new Error("Expected the two registered baby IDs");
        expect(await ownedCases(scope)).toEqual([expect.objectContaining({ id: record.id, babyId: null })]);

        const before = await db.service_record_token.findUniqueOrThrow({ where: { linkTokenHash: link } });
        expect(before).toMatchObject({
            scheduleId: schedule.id, employeeId: primary.id, serviceRecordCaseId: record.id,
            active: false, revokedAt: expect.any(Date), accessTokenHash: null, verifiedAt: null,
        });
        expect((await linkStatus(link).expect(200)).body).toEqual({ valid: false, reason: "unavailable" });
        await context(access).expect(401);

        const response = await http().post(adoption(scope.clientId, record.id)).auth(branch.authorization, { type: "bearer" })
            .send({ babyId }).expect(200);
        expect(response.body).toEqual({ caseId: record.id, babyId });
        await http().post(adoption(scope.clientId, record.id)).auth(branch.authorization, { type: "bearer" })
            .send({ babyId: siblingId }).expect(409);
        const adoptedCases = await ownedCases(scope);
        expect(adoptedCases).toHaveLength(2);
        expect(adoptedCases).toEqual(expect.arrayContaining([expect.objectContaining({
            id: record.id, babyId, currentRevisionId: revision.id,
        })]));
        expect(await db.service_record_day.findUnique({ where: { id: day.id } })).toEqual(day);
        expect(await db.service_record_revision.findUnique({ where: { id: revision.id } })).toEqual(revision);
        expect(await db.eformsign_doc.findUnique({ where: { id: document.id } })).toEqual(document);
        expect(await db.eformsign_doc_file.findUnique({ where: { id: file.id } })).toEqual(file);
        const after = await db.service_record_token.findUniqueOrThrow({ where: { id: before.id } });
        expect(after).toEqual(before);
        expect((await linkStatus(link).expect(200)).body).toEqual({ valid: false, reason: "unavailable" });
        expect((await verify(link, primary.phone).expect(201)).body.ok).toBe(false);
        await context(access).expect(401);

        const freshLink = await issue(scope.branchId, schedule.id, record.id, primary);
        expect(freshLink === link).toBe(false);
        expect((await verify(freshLink, assistant.phone).expect(201)).body).toMatchObject({ ok: false });
        const reopened = await authorize(freshLink, primary);
        expect((await context(reopened).expect(200)).body).toMatchObject({
            babyId, babyRank: 1, employee: { id: primary.id },
            sessions: [{ id: day.id, serviceRecordCaseId: record.id, clientSignature: signature, employeeId: primary.id }],
        });
        expect((await linkStatus(link).expect(200)).body).toEqual({ valid: false, reason: "unavailable" });
        await context(access).expect(401);
        expect(await db.admin_audit_event.findMany({
            where: { branchId: scope.branchId, targetId: record.id, action: "service_record.legacy_case_adopt" },
            select: { actorUserId: true, outcome: true, afterPayload: true },
        })).toEqual([{ actorUserId: branch.userId, outcome: "success", afterPayload: { clientId: scope.clientId, babyId } }]);
    });

    it("foreign and unauthorized legacy adoption is rejected", async () => {
        const own = await branchFixture();
        const other = await branchFixture();
        const member = await userInBranch(own.branchId, "user");
        const { scope, record } = await legacyFixture(own);
        const foreign = await db.client.create({
            data: { branchId: other.branchId, name: "QA-Other mother", voucherClient: false },
        });
        const foreignBaby = await db.client_baby.create({
            data: { branchId: other.branchId, clientId: foreign.id, ordinal: 1 },
        });
        await db.client.update({
            where: { id: scope.clientId }, data: { fetalConfirmation: "CONFIRMED", fetalType: "SINGLETON" },
        });
        const baby = await db.client_baby.create({ data: { ...scope, ordinal: 1 } });
        const retired = await db.client_baby.create({ data: { ...scope, ordinal: 2, active: false } });
        const endpoint = adoption(scope.clientId, record.id);
        const adopt = (authorization: string, babyId: string) =>
            http().post(endpoint).auth(authorization, { type: "bearer" }).send({ babyId });

        await http().post(endpoint).send({ babyId: baby.id }).expect(401);
        await http().post(`${adminRecord(scope.clientId)}/cases/adopt`).auth(own.authorization, { type: "bearer" })
            .send({ babyId: baby.id }).expect(404);
        await adopt(member.authorization, baby.id).expect(403);
        await adopt(other.authorization, baby.id).expect(404);
        await adopt(own.authorization, foreignBaby.id).expect(404);
        await adopt(own.authorization, retired.id).expect(404);
        await http().post(endpoint).auth(own.authorization, { type: "bearer" }).send({}).expect(400);
        await http().post(endpoint).auth(own.authorization, { type: "bearer" }).query({ caseId: record.id })
            .send({ babyId: baby.id }).expect(400);
        expect(await ownedCases(scope)).toEqual([record]);
        expect(await db.admin_audit_event.count({ where: { targetId: record.id } })).toBe(0);
    });

    it("the second sibling blocks a household holiday change", async () => {
        const branch = await branchFixture();
        const primary = await caregiver(branch.branchId, "01000009301");
        const assistant = await caregiver(branch.branchId, "01000009302");
        const nextPrimary = await caregiver(branch.branchId, "01000009303");
        const nextAssistant = await caregiver(branch.branchId, "01000009304");
        const finalized = await register(branch, twins(primary, assistant));
        const pending = await register(branch, twins(nextPrimary, nextAssistant));

        async function secondCase(family: typeof finalized) {
            const babyId = family.registration.babies[1]?.babyId;
            if (!babyId) throw new Error("Expected the second registered baby");
            const { branchId, clientId } = family;
            const siblings = await ownedCases({ branchId, clientId });
            expect(siblings).toHaveLength(2);
            expect(siblings.every(({ status }) => status === "IN_PROGRESS" || status === "WAITING_FOR_DETAILS")).toBe(true);
            expect(await db.service_record_day.count({ where: { branchId, serviceRecordCaseId: { in: siblings.map(({ id }) => id) } } }))
                .toBe(0);
            return db.service_record_case.findUniqueOrThrow({
                where: { branchId_clientId_babyId: { branchId, clientId, babyId } },
            });
        }

        const done = await secondCase(finalized);
        const later = await secondCase(pending);
        await db.service_record_case.update({
            where: { id: done.id }, data: { status: "COMPLETED", finalizedAt: new Date() },
        });
        const root = `/branches/${branch.branchId}/holidays`;
        const { body: override } = await http().post(`${root}/overrides`).auth(branch.authorization, { type: "bearer" })
            .send({ date: "2026-11-04", kind: "add", name: "QA-Added holiday" }).expect(201);
        expect(override).toBeDefined();
        const event = await db.holiday_change_event.findFirstOrThrow({
            where: { branchId: branch.branchId, date: date("2026-11-04"), change: "added" },
        });
        await app.get(HolidayReviewProcessorService).processDueEvents(new Date(event.createdAt.getTime() + 180_000));
        const itemsPath = `${root}/review-events/${event.id}/items`;
        const { body: items } = await http().get(itemsPath).auth(branch.authorization, { type: "bearer" }).expect(200);
        expect(items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                clientId: String(finalized.clientId), category: "risk", reason: "finalized", recalculatedEnd: "2026-11-09",
            }),
            expect.objectContaining({ clientId: String(pending.clientId), category: "safe", recalculatedEnd: "2026-11-09" }),
        ]));
        expect(items).toHaveLength(2);

        const assignment = await db.service_record_assignment.findFirstOrThrow({
            where: { branchId: branch.branchId, serviceRecordCaseId: later.id, employeeId: nextAssistant.id },
            orderBy: { id: "asc" },
        });
        if (!assignment.scheduleId) throw new Error("Expected a current schedule for the second sibling");
        const access = await authorize(await issue(branch.branchId, assignment.scheduleId, later.id, nextAssistant), nextAssistant);
        await submit(access, "둘째아기", "2026-11-05");
        const day = await db.service_record_day.findUniqueOrThrow({
            where: { serviceRecordCaseId_caseSessionIndex: { serviceRecordCaseId: later.id, caseSessionIndex: 1 } },
        });
        const safe = items.find((item: { clientId: string }) => item.clientId === String(pending.clientId));
        const { body: result } = await http().post(`${root}/review-events/${event.id}/resolve`)
            .auth(branch.authorization, { type: "bearer" }).send({ action: "fix", itemIds: [safe.id] }).expect(200);
        expect(result).toEqual({ fixed: 0, kept: 0, skipped: [{ itemId: safe.id, code: "NO_LONGER_SAFE" }] });
        const refreshed = await http().get(itemsPath).auth(branch.authorization, { type: "bearer" }).expect(200);
        expect(refreshed.body).toContainEqual(expect.objectContaining({
            id: safe.id, category: "risk", reason: "session_on_or_after_date",
        }));
        expect(await db.client.findUnique({ where: { id: pending.clientId }, select: { endDate: true } })).toEqual({ endDate: date(END) });
        expect(await db.service_record_day.findUnique({ where: { id: day.id } })).toEqual(day);
    });
});
