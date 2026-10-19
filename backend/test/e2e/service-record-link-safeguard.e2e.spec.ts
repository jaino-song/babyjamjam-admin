import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { json } from "express";
import request from "supertest";

import { ClientModule } from "module/client.module";
import { MessageModule } from "module/message.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";

/**
 * Real-DB reproduction of the preview incident (2026-10-19): an employee whose
 * '자동 문자 발송' is off still received the automatic service-record link SMS
 * after a client was registered with them as primary caregiver and the booking
 * was confirmed.
 */
const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
const OWNER_USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";
const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;
const RUN = `${Date.now()}`.slice(-7);

function kstDate(offsetDays: number): string {
    const now = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000);
    return now.toISOString().slice(0, 10);
}

describeE2E("service-record link SMS obeys the employee SMS automation flag (real DB)", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let triggers: MessageTriggerService;

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true }), ClientModule, MessageModule, TenantModule, SchedulerLeaseModule],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: ExecutionContext) => {
                    context.switchToHttp().getRequest().user = { userId: OWNER_USER_ID, role: "owner", branchId: BRANCH_ID, branchRole: "owner" };
                    return true;
                },
            })
            .compile();
        app = moduleRef.createNestApplication();
        app.use(json({ limit: "1mb" }));
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);
        triggers = app.get(MessageTriggerService);
        await prisma.branch.update({ where: { id: BRANCH_ID }, data: { smsSenderApprovalStatus: "approved" } });
        // The e2e seed stores no link template. Without a stored row the
        // template version is stamped with the read time, so the prepared and
        // the dispatch-time render never match and the gate refuses the send.
        // Production has a stored row (a fixed version), so store one here too.
        const key = SystemTemplateKey.SERVICE_RECORD_LINK;
        await prisma.system_template.upsert({
            where: { templateKey: key },
            update: {},
            create: { id: "tpl-service-record-link", templateKey: key, content: SYSTEM_TEMPLATE_REGISTRY[key].defaultContent },
        });
    });

    afterAll(async () => {
        await app?.close();
    });

    // Starting today puts the link's send time (noon KST the day before start)
    // in the past, so one dispatcher pass always handles it.
    async function registerConfirmedClient(smsAutomationEnabled: boolean, tag: string) {
        const employee = await prisma.employee.create({
            data: {
                branchId: BRANCH_ID, name: `안전장치관리사${tag}${RUN}`, phone: `010-7${tag}${RUN.slice(1, 3)}-${RUN.slice(3, 7)}`,
                grade: "스탠다드", smsAutomationEnabled,
            },
        });
        const created = await request(app.getHttpServer()).post("/clients").send({
            name: `안전장치산모${tag}${RUN}`, phone: `010-8${tag}${RUN.slice(1, 3)}-${RUN.slice(3, 7)}`, primaryEmployeeId: employee.id,
            voucherClient: false, duration: 10, fullPrice: "1,000,000원", startDate: kstDate(0), endDate: kstDate(16),
            breastPump: false, careCenter: false, serviceStatus: "active", applyMessageAutomation: false, suppressGreetingSms: true,
        });
        expect(created.status).toBe(201);
        const confirmed = await request(app.getHttpServer()).patch(`/clients/${created.body.id}/confirm-booking`).send({});
        expect(confirmed.status).toBe(200);
        return created.body.id as number;
    }

    async function linkOutcome(clientId: number) {
        await triggers.dispatchDueJobs();
        const jobs = await prisma.message_trigger_job.findMany({
            where: { clientId, ruleId: SERVICE_RECORD_LINK_RULE_ID },
            select: { status: true, cancelReason: true },
        });
        const sentLogs = await prisma.message_log.count({ where: { clientId, status: "sent" } });
        return { jobs, sentLogs };
    }

    // Rows are not cleaned up: names are unique per run and the runner drops
    // the disposable database afterwards.
    it("cancels the link SMS for a primary employee whose flag is off, and sends nothing", async () => {
        const { jobs, sentLogs } = await linkOutcome(await registerConfirmedClient(false, "1"));

        expect(jobs).toEqual([{ status: "canceled", cancelReason: "sms_automation_safeguard:recipient" }]);
        expect(sentLogs).toBe(0);
    });

    it("sends the same link SMS when the employee flag is on (the setup reaches the provider)", async () => {
        const { jobs, sentLogs } = await linkOutcome(await registerConfirmedClient(true, "2"));

        expect(jobs).toEqual([{ status: "sent", cancelReason: null }]);
        expect(sentLogs).toBe(1);
    });
});
