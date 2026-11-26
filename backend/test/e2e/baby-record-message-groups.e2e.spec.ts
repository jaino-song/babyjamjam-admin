import { createHash, randomInt, randomUUID } from "node:crypto";

import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { babyRecordRolloutKey } from "application/policies/baby-record-rollout.policy";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkGroupService } from "application/services/service-record-link-group.service";
import { RECORD_LINK_GROUP_CHANGED } from "application/services/service-record-link-group-source";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { SERVICE_RECORD_LINK_RULE_ID, getServiceRecordLinkScheduledFor, getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { MESSAGE_LOG_REPOSITORY, type IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ClientModule } from "module/client.module";
import { EmployeeModule } from "module/employee.module";
import { EmployeeScheduleModule } from "module/employee-schedule.module";
import { MessageDeliveryModule } from "module/message-delivery.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

import { ScriptedAligoStub } from "./helpers/scripted-aligo.stub";

function assertTestTarget() {
    const urls = ["throwaway_baby_send_work", "throwaway_baby_send_verify"]
        .map(name => `postgresql://bjj_revision_test@127.0.0.1:62295/${name}`);
    const url = process.env["DATABASE_URL"];
    if (!url || !urls.includes(url) || process.env["DIRECT_URL"] !== url
        || process.env["NODE_ENV"] !== "test" || process.env["E2E_VENDOR_STUBS"] !== "1") {
        throw new Error("Message-group fixtures require equal URLs for the approved loopback PostgreSQL work or verify clone and vendor stubs");
    }
}

function dateAt(days: number) {
    return new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

const key = SystemTemplateKey.SERVICE_RECORD_LINK;
const defaultTemplate = SYSTEM_TEMPLATE_REGISTRY[key].defaultContent;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const rawLinks = (message: string): string[] => message.match(/https?:\/\/[^\s]+\/service-record\/efl_[A-Za-z0-9_-]+/g) ?? [];

interface Member {
    caseId: string;
    babyId: string;
    assignmentVersion: number;
    activeRank: number;
    preparedLinkToken: string;
    serviceRecordUrl: string;
}

describe("baby record message groups over real Nest and PostgreSQL", () => {
    jest.setTimeout(45_000);
    const stub = new ScriptedAligoStub();
    let app: INestApplication;
    let db: PrismaService;
    let branchId: string;
    let ownerId: string;
    let staff: number[];
    let trigger: MessageTriggerService;
    let linkService: ServiceRecordLinkService;
    let logs: IMessageLogRepository;
    let priorTemplate: string | undefined;
    let householdIndex = 500;
    let priceIds: number[] = [];
    let phoneBase = randomInt(10_000_000, 99_990_000);
    const phone = (index: number) => `010${phoneBase + index + 1}`;
    const formattedPhone = (index: number) => phone(index).replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
    const calls = () => stub.sendCalls.filter(call => staff.some((_employeeId, index) => call.receiver === phone(index)));

    beforeAll(async () => {
        assertTestTarget();
        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                TenantModule, ClientModule, EmployeeModule, EmployeeScheduleModule, MessageDeliveryModule, SchedulerLeaseModule,
            ],
        }).overrideGuard(JwtGuard).useValue({
            canActivate(context: ExecutionContext) {
                const req = context.switchToHttp().getRequest();
                req.user = { branchId: req.headers["x-test-branch"] ?? branchId, userId: ownerId, role: "owner" };
                return true;
            },
        }).overrideProvider(ALIGO_SMS_API_PORT).useValue(stub).compile();
        app = module.createNestApplication({ logger: false });
        const tenantMiddleware = app.get(TenantAlsMiddleware);
        app.use(tenantMiddleware.use.bind(tenantMiddleware));
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new PrismaExceptionFilter());
        await app.init();
        db = app.get(PrismaService);
        trigger = app.get(MessageTriggerService);
        linkService = app.get(ServiceRecordLinkService);
        logs = app.get(MESSAGE_LOG_REPOSITORY);
        const requiredPrices = ["B가②형", "D가②형"];
        const existing = await db.voucher_price_info.findMany({
            where: { year: 2026, duration: 31999, type: { in: requiredPrices } }, select: { type: true },
        });
        const missing = requiredPrices.filter(type => !existing.some(row => row.type === type));
        const { _max } = await db.voucher_price_info.aggregate({ _max: { id: true } });
        if (missing.length) priceIds = (await db.voucher_price_info.createManyAndReturn({
            data: missing.map((type, index) => ({
                id: (_max.id ?? 0) + index + 1, year: 2026, type, duration: 31999,
                fullPrice: "1400000", grant: "1000000", actualPrice: "400000",
            })), select: { id: true },
        })).map(row => row.id);
        ownerId = (await db.user.create({ data: { role: "owner", name: "QA-Group operator" } })).id;
        priorTemplate = (await db.system_template.findUnique({ where: { templateKey: key } }))?.content;
        await db.system_template.upsert({ where: { templateKey: key }, update: { content: defaultTemplate }, create: { templateKey: key, content: defaultTemplate } });
    });

    beforeEach(async () => {
        stub.clearScripts();
        stub.sendCalls.length = 0;
        phoneBase += 10;
        branchId = (await db.branch.create({
            data: { name: "QA-Baby group messages", slug: `qa-send-${randomUUID()}`, smsSenderApprovalStatus: "approved" },
        })).id;
        await db.system_setting.create({
            data: { key: babyRecordRolloutKey(branchId), value: "true" },
        });
        staff = [];
        for (let index = 0; index < 4; index++) {
            staff.push((await db.employee.create({
                data: { branchId, name: `QA-Caregiver ${index + 1}`, phone: phone(index),
                    grade: "스탠다드", openToNextWork: true, smsAutomationEnabled: true },
            })).id);
        }
        await trigger.ensureDefaultRulesForBranch(branchId);
    });

    afterAll(async () => {
        if (db && priceIds.length) await db.voucher_price_info.deleteMany({ where: { id: { in: priceIds } } });
        if (db && priorTemplate !== undefined) {
            await db.system_template.update({ where: { templateKey: key }, data: { content: priorTemplate } });
        }
        await app?.close();
    });

    const http = () => request(app.getHttpServer());
    const postLink = (scheduleId: number, operation: string, body: object) =>
        http().post(`/admin/service-records/schedules/${scheduleId}/${operation}-link`).send(body);
    const getJobs = (clientId: number) => db.message_trigger_job.findMany({
        where: { branchId, clientId, ruleId: SERVICE_RECORD_LINK_RULE_ID }, include: { recordMembers: true },
        orderBy: [{ recipientEmployeeId: "asc" }, { createdAt: "asc" }],
    });
    const getLogs = (jobId: string) => db.message_log.findMany({ where: { branchId, triggerJobId: jobId }, orderBy: { id: "asc" } });
    const dispatch = (id: string) => trigger.dispatchPendingJobNow(id, { expectedBranchId: branchId });

    async function book(slots: (number | null)[], options: { householdSms?: boolean; staffCount?: number; auto?: boolean; startDays?: number } = {}) {
        const staffCount = options.staffCount ?? Math.max(1, ...slots.map(slot => slot === null ? 0 : slot + 1));
        const providers = staff.slice(0, staffCount).map((employeeId, slot) => ({ employeeId, slot }));
        const { body: client } = await http().post("/clients").send({
            name: "QA-Household", voucherClient: true, breastPump: false, serviceStatus: "pre_booking",
            startDate: dateAt(options.startDays ?? 0), endDate: dateAt(16), phone: `01000000${householdIndex++}`, voucherIssuanceYear: 2026,
            type: slots.length > 2 ? "D가2형" : "B-가-2형",
            fetalType: slots.length === 1 ? "SEVERE_SINGLETON" : slots.length === 2 ? "TWINS" : "QUADRUPLETS_PLUS",
            babyCount: slots.length, providers, babyAssignments: slots.map((providerSlot, index) => ({ providerSlot, ordinal: index + 1 })),
            applyMessageAutomation: false, smsAutomationEnabled: options.householdSms ?? false,
        }).expect(201);
        expect(await getJobs(client.id)).toHaveLength(0);
        await http().patch(`/clients/${client.id}/confirm-booking`).send({}).expect(200);
        const schedule = await db.employee_schedule.findFirstOrThrow({ where: { branchId, clientId: client.id, replaced: false } });
        if (options.auto === false) expect(await getJobs(client.id)).toHaveLength(0);
        const cases = await db.service_record_case.findMany({ where: { branchId, clientId: client.id }, include: { baby: true } });
        cases.sort((a, b) => (a.baby?.ordinal ?? 0) - (b.baby?.ordinal ?? 0));
        return { clientId: client.id as number, schedule, cases };
    }

    async function prepare(scheduleId: number, employeeId: number, caseIds: string[]) {
        const { body } = await postLink(scheduleId, "prepare", { employeeId, caseIds }).expect(201);
        expect(body.kind).toBe("group");
        const members = body.members as Member[];
        return { content: body.previewContent as string, members,
            input: { employeeId, members: members.map(({ caseId, assignmentVersion, preparedLinkToken }) => ({ caseId, assignmentVersion, preparedLinkToken })) } };
    }

    async function verify(url: string, recipient: string, babyId: string, employeeId: number) {
        const linkToken = new URL(url).pathname.split("/").at(-1);
        const { body: challenge } = await http().post("/service-record/verify").send({ linkToken, phone: recipient }).expect(201);
        expect(challenge.ok).toBe(true);
        const { body: context } = await http().get("/service-record/context").auth(challenge.accessToken, { type: "bearer" }).expect(200);
        expect({ babyId: context.babyId, employeeId: context.employee.id }).toEqual({ babyId, employeeId });
        return challenge.accessToken as string;
    }

    async function assertCarrier(job: Awaited<ReturnType<typeof getJobs>>[number], expectedName: string) {
        const landed = (await getLogs(job.id)).find(log => log.providerAcceptanceState === "accepted");
        expect(landed?.status).toBe("sent");
        const call = stub.sendCalls.find(item => item.receiver === job.recipientPhone && digest(item.message) === digest(landed!.messageBody));
        expect(Boolean(call)).toBe(true);
        const urls = rawLinks(call!.message);
        expect(new Set(urls).size).toBe(job.recordMembers.length);
        for (const item of job.recordMembers) {
            const owner = await db.service_record_baby_assignment.findFirstOrThrow({
                where: { branchId, scheduleId: item.scheduleId, babyId: item.babyId, activeOwner: true },
            });
            expect([item.employeeId, item.assignmentVersion]).toEqual([owner.employeeId, owner.version]);
            const token = await db.service_record_token.findFirstOrThrow({
                where: { branchId, scheduleId: item.scheduleId, serviceRecordCaseId: item.serviceRecordCaseId, employeeId: item.employeeId, active: true, revokedAt: null },
            });
            const expected = urls.find(url => new URL(url).pathname.endsWith(`/${token.linkTokenHash}`));
            expect(Boolean(expected)).toBe(true);
            await verify(expected!, call!.receiver, item.babyId, item.employeeId);
        }
        expect(call!.message.includes(expectedName)).toBe(true);
        return urls;
    }

    it("same caregiver receives two independently usable baby links in one send", async () => {
        const family = await book([0, 0]);
        const [job, ...others] = await getJobs(family.clientId);
        expect(others).toHaveLength(0);
        expect(job?.recordMembers).toHaveLength(2);
        expect(job?.scheduledFor).toEqual(getServiceRecordLinkScheduledFor(family.schedule.startDate));
        await trigger.dispatchDueJobs();
        expect(calls().length).toBe(1);
        await assertCarrier(job!, "첫째와 둘째의 기록지를 각각 작성해 주세요.");
    });

    it("different caregivers sharing a phone receive only their own case", async () => {
        await db.employee.update({ where: { id: staff[1] }, data: { phone: formattedPhone(0) } });
        const family = await book([0, 1]);
        const jobs = await getJobs(family.clientId);
        expect(jobs.map(job => job.recipientEmployeeId)).toEqual(staff.slice(0, 2));
        for (const job of jobs) await dispatch(job.id);
        expect(calls().length).toBe(2);
        const first = await assertCarrier(jobs[0]!, "첫째 아기 제공기록지");
        const second = await assertCarrier(jobs[1]!, "둘째 아기 제공기록지");
        expect(first.every(url => !second.includes(url))).toBe(true);
    });

    it("assistant owns the severe singleton and four caregivers own five babies", async () => {
        const one = await book([1]);
        const single = await getJobs(one.clientId);
        expect(single.map(job => job.recipientEmployeeId)).toEqual([staff[1]]);
        await dispatch(single[0]!.id);
        await assertCarrier(single[0]!, "제공기록지 링크\n");
        const five = await book([0, 1, 2, 3, 0]);
        const jobs = await getJobs(five.clientId);
        expect(jobs.map(job => job.recordMembers.length)).toEqual([2, 1, 1, 1]);
        for (const job of jobs) await dispatch(job.id);
        expect(calls().length).toBe(5);
        const labels = ["다섯째", "둘째", "셋째", "넷째"];
        for (const [index, job] of jobs.entries()) await assertCarrier(job, `${labels[index]} 아기 제공기록지`);
    });

    it("replayed scheduling and manual admission do not duplicate an accepted group", async () => {
        const family = await book([0, 0]);
        const [automatic] = await getJobs(family.clientId);
        const ready = await prepare(family.schedule.id, staff[0]!, family.cases.map(row => row.id));
        const results = await Promise.all([
            postLink(family.schedule.id, "send", ready.input).expect(201),
            dispatch(automatic!.id),
        ]);
        await linkService.scheduleForServiceStart(family.schedule.id);
        const replay = await postLink(family.schedule.id, "send", ready.input).expect(201);
        expect(replay.body.jobId).toBe(results[0].body.jobId);
        expect(calls().length).toBe(1);
        expect((await getJobs(family.clientId)).filter(job => job.status === "sent")).toHaveLength(1);

        for (const memberCount of [2, 1]) {
            const canceledFamily = await book([0, 0]);
            const [canceledJob] = await getJobs(canceledFamily.clientId);
            const callCount = calls().length;
            await http().post(`/message-trigger-jobs/${canceledJob!.id}/cancel`).expect(201);
            await linkService.scheduleForServiceStart(canceledFamily.schedule.id);
            expect((await getJobs(canceledFamily.clientId)).map(job => [job.id, job.status, job.canceledByUser]))
                .toEqual([[canceledJob!.id, "canceled", true]]);
            expect(calls()).toHaveLength(callCount);

            const caseIds = canceledFamily.cases.slice(0, memberCount).map(row => row.id);
            const prepared = await prepare(canceledFamily.schedule.id, staff[0]!, caseIds);
            const sent = await postLink(canceledFamily.schedule.id, "send", prepared.input).expect(201);
            expect(sent.body.status).toBe("sent");
            expect(sent.body.jobId).not.toBe(canceledJob!.id);
            expect(calls()).toHaveLength(callCount + 1);

            await linkService.scheduleForServiceStart(canceledFamily.schedule.id);
            const repeated = await postLink(canceledFamily.schedule.id, "send", prepared.input).expect(201);
            expect(repeated.body.jobId).toBe(sent.body.jobId);
            const jobs = await getJobs(canceledFamily.clientId);
            expect(jobs).toHaveLength(2);
            expect(jobs.find(job => job.id === canceledJob!.id)).toMatchObject({ status: "canceled", canceledByUser: true });
            expect(jobs.find(job => job.id === sent.body.jobId)?.recordMembers.map(member => member.serviceRecordCaseId).sort())
                .toEqual([...caseIds].sort());
            const submitted = calls().slice(callCount).map(call => [call.receiver, digest(call.message)]);
            expect(submitted).toEqual([[phone(0), digest(prepared.content)]]);
        }
    });

    it.each([2, 1])("explicitly sends %i members once after canceling an unsent manual group", async memberCount => {
        const family = await book([0, 0]);
        const scheduleId = family.schedule.id;
        const caseIds = family.cases.map(row => row.id);
        const original = await prepare(scheduleId, staff[0]!, caseIds);
        // Admit the manual request without invoking the immediate dispatcher.
        const admission = await app.get(ServiceRecordLinkGroupService).send(branchId, scheduleId, original.input, ownerId);
        const readOriginal = () => db.message_trigger_job.findUniqueOrThrow({
            where: { id: admission.jobId },
            include: { recordMembers: { orderBy: { serviceRecordCaseId: "asc" } } },
        });
        const jobStatuses = async () => (await getJobs(family.clientId))
            .map(({ id, status }) => ({ id, status })).sort((a, b) => a.id.localeCompare(b.id));
        expect(admission.created).toBe(true);
        expect(await readOriginal()).toMatchObject({ status: "pending", payload: { sentByUserId: ownerId } });
        expect(stub.sendCalls).toHaveLength(0);

        await http().post(`/message-trigger-jobs/${admission.jobId}/cancel`).expect(201);
        const canceled = await readOriginal();
        expect(canceled).toMatchObject({ status: "canceled", canceledByUser: true });
        expect(canceled.recordMembers.map(member => member.serviceRecordCaseId)).toEqual([...caseIds].sort());
        expect(await getLogs(admission.jobId)).toHaveLength(0);
        const postCancel = await jobStatuses();
        expect(postCancel.every(job => job.status === "canceled")).toBe(true);
        await linkService.scheduleForServiceStart(scheduleId);
        expect(await jobStatuses()).toEqual(postCancel);
        expect(stub.sendCalls).toHaveLength(0);

        const selected = caseIds.slice(0, memberCount);
        const prepared = await prepare(scheduleId, staff[0]!, selected);
        const { body: sent } = await postLink(scheduleId, "send", prepared.input).expect(201);
        expect(sent.status).toBe("sent");
        expect(sent.jobId).not.toBe(admission.jobId);
        const jobs = await getJobs(family.clientId);
        const replacement = jobs.find(job => job.id === sent.jobId);
        expect(replacement).toMatchObject({ status: "sent", payload: { sentByUserId: ownerId } });
        expect(replacement?.recordMembers.map(member => member.serviceRecordCaseId).sort()).toEqual([...selected].sort());
        const receipt = await getLogs(sent.jobId);
        expect(receipt).toHaveLength(1);
        expect(receipt[0]).toMatchObject({ status: "sent", providerAcceptanceState: "accepted", receiver: phone(0) });
        const previewHash = digest(prepared.content);
        expect(digest(receipt[0]!.messageBody)).toBe(previewHash);
        expect(stub.sendCalls.map(call => [call.receiver, digest(call.message)])).toEqual([[phone(0), previewHash]]);
        expect(await readOriginal()).toStrictEqual(canceled);

        const { body: replay } = await postLink(scheduleId, "send", prepared.input).expect(201);
        expect(replay).toMatchObject({ jobId: sent.jobId, status: "sent" });
        expect(await readOriginal()).toStrictEqual(canceled);
        const postReplay = await jobStatuses();
        expect(postReplay).toHaveLength(postCancel.length + 1);
        expect(postReplay).toEqual(expect.arrayContaining([...postCancel, { id: sent.jobId, status: "sent" }]));
        await linkService.scheduleForServiceStart(scheduleId);
        expect(await jobStatuses()).toEqual(postReplay);
        expect(await readOriginal()).toStrictEqual(canceled);
        expect(await getLogs(admission.jobId)).toHaveLength(0);
        expect(await getLogs(sent.jobId)).toStrictEqual(receipt);
        expect(stub.sendCalls).toHaveLength(1);
    });

    it.each([0, 4])("keeps only the unselected sibling at its original automatic time (start offset %i)", async startDays => {
        const family = await book([0, 0], { startDays });
        const [original] = await getJobs(family.clientId);
        const [selected, sibling] = family.cases;
        const prepared = await prepare(family.schedule.id, staff[0]!, [selected!.id]);

        const { body: sent } = await postLink(family.schedule.id, "send", prepared.input).expect(201);
        expect(sent.status).toBe("sent");
        expect(calls()).toHaveLength(1);
        await verify(rawLinks(calls()[0]!.message)[0]!, phone(0), selected!.babyId!, staff[0]!);
        const [residual] = (await getJobs(family.clientId)).filter(job => job.status === "pending");
        expect(residual).toMatchObject({ scheduledFor: original!.scheduledFor, recordMembers: [{ serviceRecordCaseId: sibling!.id }] });
        expect(residual!.payload).not.toHaveProperty("sentByUserId");

        await linkService.scheduleForServiceStart(family.schedule.id);
        const { body: replay } = await postLink(family.schedule.id, "send", prepared.input).expect(201);
        expect(replay.jobId).toBe(sent.jobId);
        expect((await getJobs(family.clientId)).filter(job => job.status === "pending").map(job => job.id)).toEqual([residual!.id]);
        expect(calls()).toHaveLength(1);

        await dispatch(residual!.id);
        if (startDays > 0) {
            expect(calls()).toHaveLength(1);
            expect(await getLogs(residual!.id)).toHaveLength(0);
        } else {
            expect(calls()).toHaveLength(2);
            await verify(rawLinks(calls()[1]!.message)[0]!, phone(0), sibling!.babyId!, staff[0]!);
        }
    });

    it.each(["manual", "automatic"] as const)("cancels only the %s reservation after partial manual admission", async canceledKind => {
        const family = await book([0, 0]);
        const [original] = await getJobs(family.clientId);
        const [selected, sibling] = family.cases;
        const { input } = await prepare(family.schedule.id, staff[0]!, [selected!.id]);
        const manual = await app.get(ServiceRecordLinkGroupService).send(branchId, family.schedule.id, input, ownerId);
        const [residual] = (await getJobs(family.clientId)).filter(job => job.status === "pending" && job.id !== manual.jobId);
        expect(residual).toMatchObject({ scheduledFor: original!.scheduledFor, recordMembers: [{ serviceRecordCaseId: sibling!.id }] });

        const [canceledId, remainingId] = canceledKind === "manual" ? [manual.jobId, residual!.id] : [residual!.id, manual.jobId];
        await http().post(`/message-trigger-jobs/${canceledId}/cancel`).expect(201);
        await linkService.scheduleForServiceStart(family.schedule.id);
        const jobs = await getJobs(family.clientId);
        expect(jobs.find(job => job.id === canceledId)).toMatchObject({ status: "canceled", canceledByUser: true });
        expect(jobs.filter(job => job.status === "pending").map(job => job.id)).toEqual([remainingId]);
        expect(jobs.find(job => job.id === residual!.id)?.scheduledFor).toEqual(original!.scheduledFor);
        expect(calls()).toHaveLength(0);

        await dispatch(remainingId);
        expect(calls()).toHaveLength(1);
        const delivered = canceledKind === "manual" ? sibling : selected;
        await verify(rawLinks(calls()[0]!.message)[0]!, phone(0), delivered!.babyId!, staff[0]!);
        await linkService.scheduleForServiceStart(family.schedule.id);
        expect((await getJobs(family.clientId)).filter(job => job.status === "pending")).toHaveLength(0);
        expect(await getLogs(canceledId)).toHaveLength(0);
    });

    it("sends each twin once when a partial manual admission races automatic dispatch", async () => {
        const family = await book([0, 0]);
        const [original] = await getJobs(family.clientId);
        const { input } = await prepare(family.schedule.id, staff[0]!, [family.cases[0]!.id]);

        const [manual] = await Promise.all([postLink(family.schedule.id, "send", input), dispatch(original!.id)]);
        expect([201, 409]).toContain(manual.status);
        await linkService.scheduleForServiceStart(family.schedule.id);
        for (const job of (await getJobs(family.clientId)).filter(job => job.status === "pending")) await dispatch(job.id);

        const sent = (await getJobs(family.clientId)).filter(job => job.status === "sent");
        const delivered = sent.flatMap(job => job.recordMembers.map(member => member.serviceRecordCaseId)).sort();
        expect(delivered).toEqual(family.cases.map(record => record.id).sort());
        const links = calls().flatMap(call => rawLinks(call.message));
        expect(links).toHaveLength(2);
        expect(new Set(links).size).toBe(2);
        for (const job of sent) await assertCarrier(job, "QA-Household");
    });

    it("rolls back manual admission when reserving the automatic sibling fails", async () => {
        const family = await book([0, 0]);
        const original = await getJobs(family.clientId);
        const { input } = await prepare(family.schedule.id, staff[0]!, [family.cases[0]!.id]);
        const tokenService = app.get(ServiceRecordTokenService);
        const readTokens = () => db.service_record_token.findMany({
            where: { branchId, scheduleId: family.schedule.id }, orderBy: { id: "asc" },
        });
        const tokensBeforeSend = await readTokens();
        const failure = jest.spyOn(tokenService, "reuseActiveLink").mockRejectedValueOnce(new Error("QA residual reservation failure"));
        try {
            await expect(app.get(ServiceRecordLinkGroupService).send(branchId, family.schedule.id, input, ownerId))
                .rejects.toThrow("QA residual reservation failure");
        } finally {
            failure.mockRestore();
        }
        expect(await getJobs(family.clientId)).toEqual(original);
        expect(await readTokens()).toEqual(tokensBeforeSend);
        expect(calls()).toHaveLength(0);

        await dispatch(original[0]!.id);
        expect(calls()).toHaveLength(1);
        expect(await assertCarrier(original[0]!, "QA-Household")).toHaveLength(2);
    });

    it("partial carrier failure cannot repeat a previously accepted recipient", async () => {
        stub.script(phone(1), "carrierFail");
        const family = await book([0, 1]);
        const jobs = await getJobs(family.clientId);
        for (const job of jobs) await dispatch(job.id);
        const ids = [];
        for (const job of jobs) {
            const [landed] = await getLogs(job.id);
            expect(landed?.providerAcceptanceState).toBe("accepted");
            ids.push(landed!.id);
        }
        await db.message_log.updateMany({ where: { branchId, id: { in: ids } },
            data: { carrierCheckDueAt: new Date(Date.now() - 60_000) } });
        await app.get(SmsCarrierCheckService).checkDueCarrierResults();
        expect((await getLogs(jobs[0]!.id))[0]?.carrierResultState).toBe("delivered");
        expect((await getLogs(jobs[1]!.id))[0]?.carrierResultState).toBe("failed");
        await linkService.scheduleForServiceStart(family.schedule.id);
        await trigger.dispatchDueJobs();
        expect(calls().length).toBe(2);
    });

    it("stale preparation or reassignment cannot activate or send a sibling", async () => {
        await db.employee.update({ where: { id: staff[1] }, data: { smsAutomationEnabled: false } });
        const family = await book([0, 1], { startDays: 4 });
        const ready = await prepare(family.schedule.id, staff[1]!, [family.cases[1]!.id]);
        const [member] = ready.input.members;
        const stale = { ...ready.input, members: [{ ...member, assignmentVersion: member!.assignmentVersion + 1 }] };
        await postLink(family.schedule.id, "send", stale).expect(409);
        await postLink(family.schedule.id, "send", { ...ready.input, employeeId: staff[0] }).expect(409);
        await postLink(family.schedule.id, "prepare", { employeeId: staff[0], caseIds: family.cases.map(row => row.id) }).expect(409);
        const prepared = () => db.service_record_token.findUniqueOrThrow({
            where: { linkTokenHash: member!.preparedLinkToken },
            select: { active: true, revokedAt: true },
        });
        expect(await prepared()).toEqual({ active: false, revokedAt: null });
        const reassign = async (slots: number[]) => {
            const { body } = await http().get(`/clients/${family.clientId}`).expect(200);
            const response = await http().patch(`/clients/${family.clientId}`).send({
                type: "B-가-2형", voucherIssuanceYear: 2026, fetalType: "TWINS", babyCount: 2, expectedAllocationVersion: body.allocationVersion,
                providers: staff.slice(0, 2).map((employeeId, slot) => ({ employeeId, slot })),
                babyAssignments: family.cases.map(({ babyId }, index) => ({ babyId, providerSlot: slots[index] })),
            });
            expect({ status: response.status, code: response.body.code, fields: response.body.errors?.map((error: { pointer: string; code: string }) => [error.pointer, error.code]) })
                .toEqual({ status: 200, code: undefined, fields: undefined });
        };
        await reassign([0, 0]);
        await reassign([0, 1]);
        const owner = await db.service_record_baby_assignment.findFirstOrThrow({
            where: { branchId, clientId: family.clientId, babyId: family.cases[1]!.babyId!, activeOwner: true },
        });
        expect(owner.version).toBeGreaterThan(member!.assignmentVersion);
        expect((await prepared()).revokedAt).not.toBeNull();
        await postLink(owner.scheduleId, "send", ready.input).expect(409);
        await postLink(owner.scheduleId, "send", { ...ready.input, members: [{ ...member, assignmentVersion: owner.version }] }).expect(409);
        expect(calls().length).toBe(0);
    });

    it("custom template preview matches the adapter and oversized messages are held", async () => {
        const templates = app.get(SystemTemplateService);
        const intro = "QA {{employeeName}} {{clientName}} {{serviceStartDate}}";
        const update = (content: string) => templates.updateForBranch(branchId, key, `${intro}\n${content}`, ownerId);
        for (const variables of ["{{serviceRecordLinks}}", "{{serviceRecordUrl}}", "{{serviceRecordUrl}}\n{{serviceRecordLinks}}"]) {
            await update(variables);
            const family = await book([0, 0]);
            const ready = await prepare(family.schedule.id, staff[0]!, family.cases.map(row => row.id));
            const { body } = await postLink(family.schedule.id, "send", ready.input).expect(201);
            expect(body.status).toBe("sent");
            const captured = calls().at(-1)!;
            expect(digest(captured.message)).toBe(digest(ready.content));
            expect(rawLinks(captured.message).map(digest)).toEqual(ready.members.map(member => digest(member.serviceRecordUrl)));
        }
        for (const [content, reason] of [
            [`${"가".repeat(1001)}{{serviceRecordLinks}}`, "message_too_large"],
            ["no link placeholder", "missing_link_placeholder"],
        ] as const) {
            await update(content);
            const other = await book([0, 0]);
            const { body } = await postLink(other.schedule.id, "prepare", { employeeId: staff[0], caseIds: other.cases.map(row => row.id) }).expect(400);
            expect(body.code).toBe("VALIDATION_FAILED");
            const [job] = await getJobs(other.clientId);
            const held = await dispatch(job!.id);
            expect({ status: held.status, reason: held.cancelReason?.includes(reason) }).toEqual({ status: "failed", reason: true });
        }
        expect(calls().length).toBe(3);
    });

    it("a task without grouped consent cannot dispatch through ordinary authority", async () => {
        const family = await book([0, 0]);
        const [job] = await getJobs(family.clientId);
        await db.message_trigger_job.update({ where: { id: job!.id }, data: { payload: { ...(job!.payload as object), taskAutomationReference: { version: 1 } } } });
        await dispatch(job!.id);
        expect(calls().length).toBe(0);
        expect(await getLogs(job!.id)).toHaveLength(0);
    });

    it("a household without eligible caregivers makes no carrier call", async () => {
        await db.employee.updateMany({ where: { branchId }, data: { smsAutomationEnabled: false } });
        const family = await book([0, 1], { auto: false, householdSms: true });
        expect((await db.client.findUniqueOrThrow({ where: { id: family.clientId }, select: { smsAutomationEnabled: true } })).smsAutomationEnabled).toBe(true);
        await trigger.dispatchDueJobs();
        expect(calls().length).toBe(0);
    });

    it("employee consent is independent of household opt-out", async () => {
        await db.employee.update({ where: { id: staff[0] }, data: { smsAutomationEnabled: false } });
        const family = await book([0, 1], { householdSms: false });
        const jobs = await getJobs(family.clientId);
        expect(jobs.map(job => job.recipientEmployeeId)).toEqual([staff[1]]);
        await dispatch(jobs[0]!.id);
        expect(calls().length).toBe(1);
        await assertCarrier(jobs[0]!, "둘째 아기 제공기록지");
    });

    it("v1 single pending job can finish while ambiguous legacy is held", async () => {
        const one = await book([0]);
        const two = await book([0, 0]);
        for (const family of [one, two]) {
            const [prior] = await getJobs(family.clientId);
            const token = await db.service_record_token.findFirstOrThrow({ where: { branchId, serviceRecordCaseId: family.cases[0]!.id } });
            const url = `https://example.test/service-record/${token.linkTokenHash}`;
            await db.message_trigger_job.update({ where: { id: prior!.id }, data: { status: "canceled" } });
            const legacy = await db.message_trigger_job.create({ data: {
                branchId, ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduledFor: prior!.scheduledFor,
                clientId: family.clientId, employeeScheduleId: family.schedule.id, recipientPhone: phone(0),
                recipientType: "PRIMARY_EMPLOYEE", templateKey: key,
                dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${family.schedule.id}:primary`,
                payload: { employeeId: staff[0], recipientName: "QA-Caregiver 1", recipientPhone: phone(0),
                    memberId: `employee:${staff[0]}`, buttonUrl: url, templateVariables: {
                        employeeName: "QA-Caregiver 1", clientName: "QA-Household", serviceStartDate: dateAt(0), serviceRecordUrl: url,
                    } },
            } });
            expect((await dispatch(legacy.id)).status).toBe(family === one ? "sent" : "canceled");
        }
        expect(calls().length).toBe(1);
    });

    async function reserveScalarSingleton() {
        const employee = { id: staff[0]!, branchId };
        await db.employee.update({ where: employee, data: { smsAutomationEnabled: false } });
        const family = await book([0], { auto: false });
        await db.employee.update({ where: employee, data: { smsAutomationEnabled: true } });
        const { linkToken } = await app.get(ServiceRecordTokenService).issueLink({
            branchId, scheduleId: family.schedule.id, serviceRecordCaseId: family.cases[0]!.id,
            employeeId: staff[0]!, expectedPhone: phone(0), expiresAt: getServiceRecordTokenExpiresAt(family.schedule.endDate),
        });
        const url = `https://example.test/service-record/${linkToken}`;
        const job = await db.message_trigger_job.create({ data: {
            branchId, clientId: family.clientId, employeeScheduleId: family.schedule.id, ruleId: SERVICE_RECORD_LINK_RULE_ID,
            scheduledFor: getServiceRecordLinkScheduledFor(family.schedule.startDate), recipientType: "PRIMARY_EMPLOYEE",
            recipientPhone: phone(0), templateKey: key,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${family.schedule.id}:primary`,
            payload: { employeeId: staff[0]!, recipientName: "QA-Caregiver 1", recipientPhone: phone(0),
                memberId: `employee:${staff[0]}`, buttonUrl: url, templateVariables: {
                    employeeName: "QA-Caregiver 1", clientName: "QA-Household", serviceStartDate: dateAt(0), serviceRecordUrl: url,
                } },
        } });
        return { family, job, linkToken, url };
    }

    it("removes a refused v1 automatic retry from the due scan after grouped admission", async () => {
        const { family, job } = await reserveScalarSingleton();
        stub.script(phone(0), "transientReject");
        await dispatch(job.id);
        stub.clearScripts();
        const [rejected] = await getLogs(job.id);
        expect(rejected).toMatchObject({ status: "failed", providerAcceptanceState: "rejected" });
        expect(rejected!.nextRetryAt).toBeInstanceOf(Date);
        const due = await db.message_log.update({
            where: { id: rejected!.id }, data: { nextRetryAt: new Date(0) },
        });
        expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(true);
        expect(await getLogs(job.id)).toEqual([due]);

        const source = (await logs.findPendingRetriesSystemScope()).find(log => log.id === due.id);
        expect(source).toBeDefined();
        expect(await app.get(SmsRetryService).retry(source!, "automatic")).toBeNull();

        const [retired] = await getLogs(job.id);
        expect(retired).toEqual({ ...due, nextRetryAt: null, updatedAt: retired?.updatedAt });
        expect((await logs.findPendingRetriesSystemScope()).map(log => log.id)).not.toContain(due.id);
        expect(calls()).toHaveLength(1);

        const [group] = (await getJobs(family.clientId)).filter(candidate => candidate.status === "pending");
        await dispatch(group!.id);
        expect(calls()).toHaveLength(2);
        expect(await assertCarrier(group!, "QA-Household")).toHaveLength(1);
    });

    it.each(["delivered", "not-delivered"] as const)("blocks ambiguous v1 admission until explicit reconciliation reports %s", async outcome => {
        const { family, job, linkToken, url } = await reserveScalarSingleton();
        stub.script(phone(0), "throw");
        await dispatch(job.id);
        stub.clearScripts();
        const [unknown] = await getLogs(job.id);
        expect(unknown?.providerAcceptanceState).toBe("uncertain");
        const readLink = () => db.service_record_token.findUniqueOrThrow({ where: { linkTokenHash: linkToken } });
        expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(false);
        expect(await getJobs(family.clientId)).toHaveLength(1);
        expect((await readLink()).active).toBe(true);
        expect(calls()).toHaveLength(1);

        await app.get(SmsProviderAcceptanceService).reconcile({
            branchId, logId: unknown!.id, actor: ownerId, reason: "QA reconciled carrier history", outcome,
        });
        const reconciled = await getLogs(job.id);
        expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(outcome === "not-delivered");
        if (outcome === "delivered") {
            expect(await getJobs(family.clientId)).toHaveLength(1);
            expect(calls()).toHaveLength(1);
            await verify(url, phone(0), family.cases[0]!.babyId!, staff[0]!);
        } else {
            const groups = (await getJobs(family.clientId)).filter(group => group.status === "pending" && group.recordMembers.length);
            expect(groups).toHaveLength(1);
            expect((await readLink()).active).toBe(false);
            const source = await logs.findByIdInBranch(branchId, unknown!.id);
            expect(await app.get(SmsRetryService).retry(source!, "manual")).toBeNull();
            await dispatch(groups[0]!.id);
            expect(calls()).toHaveLength(2);
            expect(await assertCarrier(groups[0]!, "QA-Household")).toHaveLength(1);
            expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(false);
        }
        expect(await getLogs(job.id)).toEqual(reconciled);
    });

    it("keeps the v1 credential when a retry descendant is accepted before grouped admission", async () => {
        const { family, job, url } = await reserveScalarSingleton();
        stub.script(phone(0), "reject");
        await dispatch(job.id);
        stub.clearScripts();
        const [rejected] = await getLogs(job.id);
        expect(rejected?.providerAcceptanceState).toBe("rejected");
        const source = await logs.findByIdInBranch(branchId, rejected!.id);
        expect((await app.get(SmsRetryService).retry(source!, "manual"))?.status).toBe("sent");
        expect(digest(rawLinks(calls()[1]!.message)[0]!)).toBe(digest(url));
        expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(false);
        expect(await getJobs(family.clientId)).toHaveLength(1);
        expect(calls()).toHaveLength(2);
        await verify(url, phone(0), family.cases[0]!.babyId!, staff[0]!);
    });

    it.each(["legacy", "grouped"] as const)("releases a %s successor after reconciling an ambiguous v1 retry descendant", async successor => {
        const { family, job, url } = await reserveScalarSingleton();
        stub.script(phone(0), "reject");
        await dispatch(job.id);
        const [original] = await getLogs(job.id);
        stub.script(phone(0), "throw");
        const retry = await app.get(SmsRetryService).retryById(branchId, original!.id);
        expect(retry.providerAcceptanceState).toBe("uncertain");
        stub.clearScripts();
        expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(false);
        expect((await getJobs(family.clientId)).map(row => row.id)).toEqual([job.id]);
        expect(calls()).toHaveLength(2);

        await app.get(SmsProviderAcceptanceService).reconcile({
            branchId, logId: retry.id, actor: ownerId, reason: "QA confirmed no retry delivery", outcome: "not-delivered",
        });
        const history = await getLogs(job.id);
        if (successor === "legacy") {
            expect((await app.get(SmsRetryService).retryById(branchId, retry.id)).status).toBe("sent");
            expect(digest(rawLinks(calls()[2]!.message)[0]!)).toBe(digest(url));
            await verify(url, phone(0), family.cases[0]!.babyId!, staff[0]!);
        } else {
            expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(true);
            const [group] = (await getJobs(family.clientId)).filter(candidate => candidate.status === "pending");
            await dispatch(group!.id);
            expect(await assertCarrier(group!, "QA-Household")).toHaveLength(1);
            expect(await getLogs(job.id)).toEqual(history);
        }
        expect(calls()).toHaveLength(3);
        expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(false);
    });

    it("admits one successor when v1 retry and grouped scheduling race", async () => {
        const { family, job, url } = await reserveScalarSingleton();
        stub.script(phone(0), "reject");
        await dispatch(job.id);
        stub.clearScripts();
        const [rejected] = await getLogs(job.id);
        expect(rejected?.providerAcceptanceState).toBe("rejected");

        const [admitted, retried] = await Promise.all([
            linkService.scheduleForServiceStart(family.schedule.id),
            app.get(SmsRetryService).retryById(branchId, rejected!.id).catch(error => {
                if (error?.status !== 409) throw error;
                return null;
            }),
        ]);
        if (admitted) {
            expect(retried).toBeNull();
            const [group] = (await getJobs(family.clientId)).filter(candidate => candidate.status === "pending");
            await dispatch(group!.id);
            expect(await assertCarrier(group!, "QA-Household")).toHaveLength(1);
        } else {
            expect(retried?.status).toBe("sent");
            expect(digest(rawLinks(calls()[1]!.message)[0]!)).toBe(digest(url));
            await verify(url, phone(0), family.cases[0]!.babyId!, staff[0]!);
        }
        expect(calls()).toHaveLength(2);
        expect(await linkService.scheduleForServiceStart(family.schedule.id)).toBe(false);
        expect((await getJobs(family.clientId)).filter(candidate => candidate.status === "pending")).toHaveLength(0);
    });

    it("reschedules a pending v1 singleton in place when its start date changes", async () => {
        const employee = { id: staff[0], branchId };
        await db.employee.update({ where: employee, data: { smsAutomationEnabled: false } });
        const family = await book([0], { auto: false });
        await db.employee.update({ where: employee, data: { smsAutomationEnabled: true } });
        const token = await app.get(ServiceRecordTokenService).issueLink({ branchId, scheduleId: family.schedule.id,
            serviceRecordCaseId: family.cases[0]!.id, employeeId: staff[0]!, expectedPhone: phone(0),
            expiresAt: getServiceRecordTokenExpiresAt(family.schedule.endDate) });
        const url = `https://example.test/service-record/${token.linkToken}`;
        const legacy = await db.message_trigger_job.create({ data: {
            branchId, ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduledFor: getServiceRecordLinkScheduledFor(family.schedule.startDate),
            clientId: family.clientId, employeeScheduleId: family.schedule.id, recipientPhone: phone(0),
            recipientType: "PRIMARY_EMPLOYEE", templateKey: key,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${family.schedule.id}:primary`,
            payload: { employeeId: staff[0], recipientName: "QA-Caregiver 1", recipientPhone: phone(0),
                memberId: `employee:${staff[0]}`, buttonUrl: url, templateVariables: {
                    employeeName: "QA-Caregiver 1", clientName: "QA-Household", serviceStartDate: dateAt(0), serviceRecordUrl: url,
                } },
        } });
        const newStart = dateAt(4);
        await db.employee_schedule.update({ where: { id: family.schedule.id, branchId }, data: { startDate: new Date(newStart) } });
        expect(await linkService.scheduleForServiceStart(family.schedule.id, { rescheduleAutomatic: true, branchId })).toBe(true);
        const jobs = await getJobs(family.clientId);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({ id: legacy.id, status: "pending", scheduledFor: getServiceRecordLinkScheduledFor(new Date(newStart)),
            recipientEmployeeId: null, recordMembers: [], payload: { templateVariables: { serviceStartDate: newStart } } });
        expect((await dispatch(legacy.id)).status).toBe("pending");
        expect(await getLogs(legacy.id)).toHaveLength(0);
        expect(stub.sendCalls).toHaveLength(0);
    });

    it("recomputes an automatic group after a source change at the provider boundary", async () => {
        const family = await book([0, 0]);
        const [job] = await getJobs(family.clientId);
        const ledger = app.get(SmsProviderAcceptanceService);
        const prepare = ledger.prepare.bind(ledger);
        const renamed = "QA-Caregiver after preview";
        const moved = jest.spyOn(ledger, "prepare").mockImplementationOnce(async (...args) => {
            const log = await prepare(...args);
            await db.employee.update({ where: { id: staff[0], branchId }, data: { name: renamed } });
            return log;
        });
        try {
            expect((await dispatch(job!.id)).cancelReason).toBe(RECORD_LINK_GROUP_CHANGED);
        } finally {
            moved.mockRestore();
        }
        expect(stub.sendCalls).toHaveLength(0);
        expect(await getLogs(job!.id)).toMatchObject([{ status: "failed", providerAcceptanceState: "prepared", providerCallStartedAt: null }]);
        const pending = (await getJobs(family.clientId)).filter(item => item.status === "pending");
        expect(pending).toHaveLength(1);
        expect(pending[0]!.id).not.toBe(job!.id);
        expect((await dispatch(pending[0]!.id)).status).toBe("sent");
        await assertCarrier(pending[0]!, renamed);
        expect(stub.sendCalls).toHaveLength(1);
    });

    it("refreshes the edited caregiver's group without replacing another caregiver's job", async () => {
        const family = await book([0, 1, 2, 3, 0]);
        const before = await getJobs(family.clientId);
        const original = before.find(job => job.recipientEmployeeId === staff[2]);
        const renamed = "QA-Renamed third caregiver";
        const newPhone = phone(5);
        await http().patch(`/employees?id=${staff[2]}`).send({ name: renamed, phone: newPhone }).expect(200);
        const jobs = await getJobs(family.clientId);
        expect(jobs).toHaveLength(5);
        for (const unaffected of before.filter(job => job.id !== original!.id)) {
            expect(jobs.find(job => job.id === unaffected.id)).toMatchObject({ status: "pending", updatedAt: unaffected.updatedAt });
        }
        expect(jobs.find(job => job.id === original!.id)).toMatchObject({ status: "canceled" });
        const pending = jobs.find(job => job.recipientEmployeeId === staff[2] && job.status === "pending");
        expect(pending).toMatchObject({ recipientPhone: newPhone, recordMembers: [{ serviceRecordCaseId: family.cases[2]!.id }] });
        expect((await dispatch(pending!.id)).status).toBe("sent");
        await assertCarrier(pending!, renamed);
        expect(stub.sendCalls.map(call => call.receiver)).toEqual([newPhone]);
    });

    it("failure before a message log creates no duplicate recipient", async () => {
        const family = await book([0, 0]);
        const [job] = await getJobs(family.clientId);
        const ledger = app.get(SmsProviderAcceptanceService);
        const beforeLog = jest.spyOn(ledger, "prepare").mockRejectedValueOnce(new Error("synthetic pre-log failure"));
        try { await dispatch(job!.id); } finally { beforeLog.mockRestore(); }
        expect(await getLogs(job!.id)).toHaveLength(0);
        expect(calls().length).toBe(0);
        await linkService.scheduleForServiceStart(family.schedule.id);
        for (const pending of (await getJobs(family.clientId)).filter(item => item.status === "pending")) await dispatch(pending.id);
        expect(calls().length).toBe(1);
    });

    it("a rejection after a message log respects the retry policy", async () => {
        stub.script(phone(0), "transientReject");
        const where = { id: SERVICE_RECORD_LINK_RULE_ID };
        const original = await db.message_trigger_rule.findUniqueOrThrow({ where, select: { retryOnFailure: true } });
        try {
            await db.message_trigger_rule.update({ where, data: { retryOnFailure: false } });
            const blocked = await book([0, 0]);
            const [blockedJob] = await getJobs(blocked.clientId);
            await dispatch(blockedJob!.id);
            const [noRetry] = await getLogs(blockedJob!.id);
            expect(noRetry?.providerAcceptanceState).toBe("rejected");
            expect(noRetry?.nextRetryAt).toBeNull();

            await db.message_trigger_rule.update({ where, data: { retryOnFailure: true } });
            const family = await book([0, 0]);
            const [job] = await getJobs(family.clientId);
            await dispatch(job!.id);
            const [failed] = await getLogs(job!.id);
            expect(failed?.providerAcceptanceState).toBe("rejected");
            expect(calls().length).toBe(2);
            expect(failed?.nextRetryAt).not.toBeNull();
            await db.message_log.update({ where: { id: failed!.id }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
            stub.clearScripts();
            const entry = await logs.findByIdInBranch(branchId, failed!.id);
            await app.get(SmsRetryService).retry(entry!, "automatic");
            expect(calls().length).toBe(3);
            expect(digest(calls()[1]!.message)).toBe(digest(calls()[2]!.message));
        } finally {
            await db.message_trigger_rule.update({ where, data: original });
        }
    });

    it("an unknown carrier outcome is reconciled before a new submission", async () => {
        stub.script(phone(0), "throw");
        const family = await book([0, 0]);
        const [job] = await getJobs(family.clientId);
        await dispatch(job!.id);
        const [unknown] = await getLogs(job!.id);
        expect(unknown?.providerAcceptanceState).toBe("uncertain");
        stub.clearScripts();
        await linkService.scheduleForServiceStart(family.schedule.id);
        const source = await logs.findByIdInBranch(branchId, unknown!.id);
        await app.get(SmsRetryService).retry(source!, "automatic");
        expect(calls().length).toBe(1);
        const reconciled = await app.get(SmsProviderAcceptanceService).reconcile({
            branchId, logId: unknown!.id, actor: ownerId, reason: "QA transport trace confirmed no delivery", outcome: "not-delivered",
        });
        expect(reconciled.providerAcceptanceState).toBe("reconciled_not_delivered");
        await app.get(SmsRetryService).retry(reconciled, "manual");
        expect(calls().length).toBe(2);
    });

    it("reset one prepared case leaves its sibling session usable", async () => {
        const family = await book([0, 0]);
        const ready = await prepare(family.schedule.id, staff[0]!, family.cases.map(row => row.id));
        const [first, sibling] = ready.members;
        const session = await verify(sibling!.serviceRecordUrl, phone(0), sibling!.babyId, staff[0]!);
        const { body: reset } = await postLink(family.schedule.id, "reset", {
            employeeId: staff[0], members: [{ caseId: first!.caseId, assignmentVersion: first!.assignmentVersion }],
        }).expect(201);
        expect(reset.members.map((member: Member) => member.caseId)).toEqual([first!.caseId]);
        expect(digest(reset.members[0].serviceRecordUrl)).toBe(digest(first!.serviceRecordUrl));
        await http().get("/service-record/context").auth(session, { type: "bearer" }).expect(200);
        expect(calls().length).toBe(0);
    });

    it("record link routes use only the assigned employee phone", async () => {
        const family = await book([0]);
        const prepareInput = { employeeId: staff[0], caseIds: [family.cases[0]!.id] };
        await postLink(family.schedule.id, "prepare", { ...prepareInput, recipientPhone: phone(1) }).expect(409);
        await postLink(family.schedule.id, "prepare", { recipientPhone: phone(1) }).expect(409);
        await postLink(family.schedule.id, "prepare", { ...prepareInput, caseId: family.cases[0]!.id }).expect(400);
        const { body: targets } = await http().get(`/admin/service-records/schedules/${family.schedule.id}/link-targets`).expect(200);
        expect(targets.targets.map((target: { recipientPhone: string }) => target.recipientPhone)).toEqual([phone(0)]);
        const ready = await prepare(family.schedule.id, staff[0]!, prepareInput.caseIds);
        await postLink(family.schedule.id, "send", { ...ready.input, recipientPhone: phone(1) }).expect(409);
        await postLink(family.schedule.id, "send", { ...ready.input, recipientPhone: formattedPhone(0) }).expect(201);
        expect(calls().map(call => call.receiver)).toEqual([phone(0)]);
        const sent = (await getJobs(family.clientId)).find(job => job.status === "sent");
        expect((sent?.payload as { sentByUserId?: string })?.sentByUserId).toBe(ownerId);
    });
});
