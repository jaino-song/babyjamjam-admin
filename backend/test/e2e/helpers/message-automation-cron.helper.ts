import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { json } from "express";
import request from "supertest";

import { ClientDueDateSchedulerService } from "application/services/client-due-date-scheduler.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { MessageTriggerSchedulerService } from "application/services/message-trigger-scheduler.service";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { ServiceRecordLinkReconciliationService } from "application/services/service-record-link-reconciliation.service";
import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import { ALIGO_SMS_API_PORT, type IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { E2eAligoApiStub } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { ClientModule } from "module/client.module";
import { MessageModule } from "module/message.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

/** Seed fixtures from backend/test/e2e-env/seed-e2e.ts: the approved-SMS-sender branch and its owner. */
export const MESSAGE_CRON_BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
export const MESSAGE_CRON_OWNER_USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";

export interface BootOptions {
    /** Overrides the ALIGO_SMS_API_PORT provider; defaults to a fresh E2eAligoApiStub. */
    aligo?: IAligoSmsApiPort;
    /** Compiles the module graph with SCHEDULERS_ENABLED=false so the lease service is standby. */
    standby?: boolean;
}

export interface MessageCronHarness {
    app: INestApplication;
    prisma: PrismaService;
    /** supertest against app.getHttpServer(). */
    http: () => ReturnType<typeof request>;
    /** Manual ticks of the six @Cron entry points (the decorated scheduler wrappers, not the inner services). */
    tick: {
        dispatch(): Promise<void>;
        retry(): Promise<void>;
        intents(now?: Date): Promise<unknown>;
        dueDate(): Promise<unknown>;
        linkRepair(): Promise<unknown>;
        carrier(): Promise<unknown>;
    };
    lease: SchedulerLeaseService;
    /** Direct prisma update of message_trigger_job.scheduledFor (and nextAttemptAt=null). */
    backdate(jobId: string, scheduledFor: Date): Promise<void>;
    /** Direct prisma update of message_log.nextRetryAt to the past. */
    forceRetryDue(logId: number): Promise<void>;
    close(): Promise<void>;
}

/**
 * Boots the real Nest module graph (Client + Message + Tenant + SchedulerLease) against the
 * seeded e2e database and exposes the six message-automation cron facades as manual ticks.
 * Scheduler mode follows the production resolution: non-production with no SCHEDULER_LEASE_MODE
 * override is "off" (holdsLease() always true), while standby:true forces SCHEDULERS_ENABLED=false
 * for the compile only (holdsLease() always false). Neither mode touches the lease table.
 */
export async function bootMessageCronHarness(options: BootOptions = {}): Promise<MessageCronHarness> {
    if (process.env["E2E_VENDOR_STUBS"] !== "1") {
        throw new Error(
            "bootMessageCronHarness requires E2E_VENDOR_STUBS=1: the harness boots the real vendor module graph "
            + "and must never fall through to live Aligo/eformsign calls. Run the spec through a gated e2e runner.",
        );
    }

    const aligo = options.aligo ?? new E2eAligoApiStub();
    const previousSchedulersEnabled = process.env["SCHEDULERS_ENABLED"];

    let moduleRef: TestingModule;
    try {
        if (options.standby) {
            // SchedulerLeaseService resolves its mode at construction (during compile), so the
            // env must be set before Test.createTestingModule compiles and restored afterwards.
            process.env["SCHEDULERS_ENABLED"] = "false";
        }
        moduleRef = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true }), ClientModule, MessageModule, TenantModule, SchedulerLeaseModule],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: ExecutionContext) => {
                    context.switchToHttp().getRequest().user = {
                        userId: MESSAGE_CRON_OWNER_USER_ID,
                        role: "owner",
                        branchId: MESSAGE_CRON_BRANCH_ID,
                        branchRole: "owner",
                    };
                    return true;
                },
            })
            .overrideProvider(ALIGO_SMS_API_PORT)
            .useValue(aligo)
            .compile();
    } finally {
        if (previousSchedulersEnabled === undefined) {
            delete process.env["SCHEDULERS_ENABLED"];
        } else {
            process.env["SCHEDULERS_ENABLED"] = previousSchedulersEnabled;
        }
    }

    const app = moduleRef.createNestApplication();
    try {
        app.use(json({ limit: "1mb" }));
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
    } catch (error) {
        await app.close();
        throw error;
    }

    const prisma = app.get(PrismaService);
    const triggerScheduler = app.get(MessageTriggerSchedulerService, { strict: false });
    const retryScheduler = app.get(MessageRetrySchedulerService, { strict: false });
    const intentService = app.get(MessageAutomationIntentService, { strict: false });
    const dueDateScheduler = app.get(ClientDueDateSchedulerService, { strict: false });
    const linkRepairService = app.get(ServiceRecordLinkReconciliationService, { strict: false });
    const carrierCheckService = app.get(SmsCarrierCheckService, { strict: false });
    const lease = app.get(SchedulerLeaseService, { strict: false });

    return {
        app,
        prisma,
        http: () => request(app.getHttpServer()),
        tick: {
            dispatch: () => triggerScheduler.dispatchDueJobs(),
            retry: () => retryScheduler.retryFailedMessages(),
            intents: (now?: Date) => intentService.reconcilePendingIntents(now),
            dueDate: () => dueDateScheduler.syncUpcomingDueDatesToStartDates(),
            linkRepair: () => linkRepairService.repairMissingJobs(),
            carrier: () => carrierCheckService.checkDueCarrierResults(),
        },
        lease,
        backdate: (jobId: string, scheduledFor: Date) =>
            prisma.message_trigger_job
                .update({ where: { id: jobId }, data: { scheduledFor, nextAttemptAt: null } })
                .then(() => undefined),
        forceRetryDue: (logId: number) =>
            prisma.message_log
                .update({ where: { id: logId }, data: { nextRetryAt: new Date(Date.now() - 60_000) } })
                .then(() => undefined),
        close: () => app.close(),
    };
}
