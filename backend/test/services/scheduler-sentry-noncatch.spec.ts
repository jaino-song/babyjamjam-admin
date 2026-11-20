import { Logger } from "@nestjs/common";
import { ContractAutoFinalizeSchedulerService } from "application/services/contract-auto-finalize-scheduler.service";
import { HolidaySyncService } from "application/services/holiday-sync.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import {
    MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";
import type { MessageLogEntity } from "domain/entities/message-log.entity";
import { captureBackendError } from "infrastructure/observability/service-record-sentry";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

jest.mock("infrastructure/observability/service-record-sentry", () => ({
    captureBackendError: jest.fn(),
}));

const captureMock = jest.mocked(captureBackendError);

function expectSafeCapture(operation: string, description: string, forbidden: string[]): void {
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith(expect.any(Error), { handled: true, operation });
    const error = captureMock.mock.calls[0]?.[0] as Error;
    expect(error.message).toBe(description);
    for (const value of forbidden) {
        expect(error.message).not.toContain(value);
    }
}

describe.each([
    { reporting: "succeeds", throws: false },
    { reporting: "throws", throws: true },
])("logged scheduler failures when reporting $reporting", ({ throws: reportingThrows }) => {
    beforeEach(() => {
        captureMock.mockReset();
        if (reportingThrows) {
            captureMock.mockImplementation(() => { throw new Error("reporter unavailable"); });
        }
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        captureMock.mockReset();
    });

    it("reports an unsuccessful carrier result and still saves lookup_error", async () => {
        const log = { id: 731942, receiver: "qa-recipient", aligoMid: "qa-private-mid" } as MessageLogEntity;
        const resultCode = -91237;
        const repository = {
            findCarrierChecksDueSystemScope: jest.fn().mockResolvedValue([log]),
            saveCarrierCheckResult: jest.fn().mockResolvedValue("saved"),
            postponeCarrierCheck: jest.fn(),
        };
        const port = {
            getSmsDeliveryDetails: jest.fn().mockResolvedValue({
                resultCode,
                message: "qa-private-provider-text",
                rows: [],
            }),
        };
        const service = new SmsCarrierCheckService(repository as never, port as never, createSchedulerLeaseMock());

        await expect(service.checkDueCarrierResults()).resolves.toBeUndefined();

        expect(repository.saveCarrierCheckResult).toHaveBeenCalledTimes(1);
        expect(repository.saveCarrierCheckResult).toHaveBeenCalledWith({
            id: log.id,
            expectedMid: log.aligoMid,
            state: "lookup_error",
            results: [],
            checkedAt: expect.any(Date),
            failureMessage: null,
        });
        expect(repository.postponeCarrierCheck).not.toHaveBeenCalled();
        const logText = `[CarrierCheck] Carrier lookup returned result code ${resultCode} for log ${log.id} (mid ${log.aligoMid})`;
        expect(Logger.prototype.warn).toHaveBeenCalledWith(logText);
        expectSafeCapture("sms-carrier-check:result-code", "Sms carrier check returned an unsuccessful result", [
            String(log.id), String(resultCode), String(log.aligoMid), log.receiver, "qa-private-provider-text", logText,
        ]);
    });

    it.each([undefined, "qa-private-invalid-date"])("reports invalid activation date %s and still skips work", async (sinceDate) => {
        const config: Record<string, string | undefined> = {
            CONTRACT_AUTO_FINALIZE_ENABLED: "true",
            EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED: "true",
            CONTRACT_AUTO_FINALIZE_SINCE: sinceDate,
        };
        const repository = { findReviewStageContracts: jest.fn() };
        const jobs = { enqueueFinalizeDocument: jest.fn() };
        const service = new ContractAutoFinalizeSchedulerService(
            { get: (key: string) => config[key] } as never,
            repository as never,
            jobs as never,
            {} as never,
            createSchedulerLeaseMock(),
        );

        await expect(service.autoFinalizeDueContracts()).resolves.toBeUndefined();

        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();
        expect(jobs.enqueueFinalizeDocument).not.toHaveBeenCalled();
        const logText = "[Contract Auto Finalize] CONTRACT_AUTO_FINALIZE_SINCE is missing or not YYYY-MM-DD; refusing to run";
        expect(Logger.prototype.error).toHaveBeenCalledWith(logText);
        expectSafeCapture("contract-auto-finalize:config", "Contract auto finalize activation date is invalid", [
            "qa-private-invalid-date", "CONTRACT_AUTO_FINALIZE_SINCE", logText,
        ]);
    });

    it("reports missing holiday anchors and still preserves existing data", async () => {
        const year = 2041;
        const client = {
            fetchYear: jest.fn().mockResolvedValue({
                year,
                rawCount: 1,
                items: [{ date: `${year}-01-01`, name: "qa-private-holiday" }],
            }),
        };
        const repository = { applyYearSync: jest.fn() };
        const service = new HolidaySyncService(client as never, repository as never, createSchedulerLeaseMock());

        await expect(service.syncYears([year], "cron")).resolves.toEqual([
            { year, status: "failed", added: 0, removed: 0, error: "anchors_missing" },
        ]);

        expect(repository.applyYearSync).not.toHaveBeenCalled();
        const logText = `[Holiday Sync] ${year}: anchors missing (03-01,05-05,06-06,08-15,10-03,10-09,12-25); keeping previous data (cron)`;
        expect(Logger.prototype.warn).toHaveBeenCalledWith(logText);
        expectSafeCapture("holiday-sync:anchors-missing", "Holiday sync response is missing required dates", [
            String(year), "anchors_missing", "03-01", "qa-private-holiday", logText,
        ]);
    });

    it("reports a malformed intent and still quarantines it without counting it as fulfilled", async () => {
        const candidate = {
            id: "qa-private-intent-id",
            branchId: "qa-private-branch-id",
            clientId: 731943,
            employeeScheduleId: null,
            scheduledFor: new Date("2026-08-20T01:02:03.000Z"),
            updatedAt: new Date("2026-08-20T01:02:04.000Z"),
            payload: { templateVariables: { intentKind: "qa-private-unknown-kind" } },
        };
        const prisma = {
            message_trigger_job: {
                findMany: jest.fn().mockResolvedValue([candidate]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                deleteMany: jest.fn(),
            },
        };
        const service = new MessageAutomationIntentService(
            prisma as never, {} as never, {} as never, createSchedulerLeaseMock(),
        );

        await expect(service.reconcilePendingIntents()).resolves.toBe(0);

        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith({
            where: {
                id: candidate.id,
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
                scheduledFor: candidate.scheduledFor,
                updatedAt: candidate.updatedAt,
            },
            data: { cancelReason: MESSAGE_AUTOMATION_INTENT_INVALID_REASON, nextAttemptAt: null },
        });
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
        const logText = `[Message Automation Intent] Quarantined malformed intent ${candidate.id}`;
        expect(Logger.prototype.error).toHaveBeenCalledWith(logText);
        expect(Logger.prototype.warn).not.toHaveBeenCalled();
        expectSafeCapture("message-automation-intent:quarantine", "Message automation intent payload is invalid", [
            candidate.id, candidate.branchId, String(candidate.clientId), "qa-private-unknown-kind",
            MESSAGE_AUTOMATION_INTENT_INVALID_REASON, logText,
        ]);
    });
});
