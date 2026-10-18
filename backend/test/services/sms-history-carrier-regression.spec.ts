import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import { SmsHistoryReconciliationService } from "application/services/sms-history-reconciliation.service";
import type { SystemSettingService } from "application/services/system-setting.service";
import { CARRIER_CHECK_DELAY_MS, MessageLogEntity } from "domain/entities/message-log.entity";
import type { IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

type Row = Record<string, unknown> & { id: number };

/** Minimal in-memory stand-in for the message_log table: only the Prisma shapes the services use. */
function createInMemoryPrisma(rows: Map<number, Row>) {
    const matches = (candidate: Row, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, expected]) => {
        if (key === "OR") return (expected as Array<Record<string, unknown>>).some((clause) => matches(candidate, clause));
        const actual = candidate[key];
        if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
        if (expected && typeof expected === "object") {
            const condition = expected as { not?: unknown; lte?: Date; in?: unknown[] };
            if ("not" in condition && actual === condition.not) return false;
            if ("not" in condition && condition.not === null && actual === undefined) return false;
            if (condition.lte && !(actual instanceof Date && actual.getTime() <= condition.lte.getTime())) return false;
            if (condition.in && !condition.in.includes(actual)) return false;
            return true;
        }
        return actual === expected;
    });
    const apply = (target: Row, data: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(data)) target[key] = value === Prisma.DbNull ? null : value;
    };
    const message_log = {
        findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
            const found = [...rows.values()].find((candidate) => matches(candidate, where));
            return found ? { ...found } : null;
        }),
        findMany: jest.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
            [...rows.values()].filter((candidate) => matches(candidate, where)).slice(0, take).map((found) => ({ ...found }))),
        updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const hits = [...rows.values()].filter((candidate) => matches(candidate, where));
            hits.forEach((hit) => apply(hit, data));
            return { count: hits.length };
        }),
    };
    const client = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
    const prisma = {
        message_log,
        client,
        $queryRaw: jest.fn(async () => [...rows.values()]
            .filter((candidate) => candidate["providerAcceptanceState"] === "uncertain" || candidate["providerAcceptanceState"] === "started")
            .map((candidate) => ({ id: candidate.id }))),
        $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
            callback({ message_log, client, $queryRaw: jest.fn() })),
    };
    return prisma;
}

describe("Aligo history reconciliation followed by the carrier check", () => {
    const started = new Date("2026-10-12T01:00:00.000Z");
    const receiver = "01012345678";
    let rows: Map<number, Row>;
    let repository: SbMessageLogRepository;
    let aligo: { listHistory: jest.Mock; listSmsHistory: jest.Mock; getSmsDeliveryDetails: jest.Mock; sendSms: jest.Mock };
    let reconciliation: SmsHistoryReconciliationService;
    let carrier: SmsCarrierCheckService;

    const seedUncertainTimeout = (overrides: Partial<Row> = {}): void => {
        const entity = MessageLogEntity.create({
            provider: "aligo_sms", templateKey: "test", receiver, messageBody: "안녕하세요",
            variables: { retrySafety: "uncertain" }, branchId: "branch", triggerJobId: "job",
        });
        entity.providerAcceptanceState = "uncertain";
        entity.providerCallStartedAt = started;
        entity.attempts = 1;
        entity.status = "failed";
        entity.errorMessage = "응답 시간 초과";
        rows.set(1, { ...MessageLogMapper.toPrismaCreate(entity), id: 1, createdAt: started, updatedAt: started, ...overrides });
    };

    const row = (): Row => rows.get(1)!;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        rows = new Map();
        repository = new SbMessageLogRepository(createInMemoryPrisma(rows) as unknown as PrismaService);
        aligo = {
            sendSms: jest.fn(),
            listHistory: jest.fn().mockResolvedValue({
                result_code: 1, message: "ok", next_yn: "N",
                list: [{ mid: "ours", msg: "안녕하세요", reg_date: "2026-10-12 10:01:00" }],
            }),
            listSmsHistory: jest.fn().mockResolvedValue({
                result_code: 1, message: "ok", next_yn: "N",
                list: [{ receiver: "010-1234-5678", sms_state: "발송완료" }],
            }),
            getSmsDeliveryDetails: jest.fn(),
        };
        const lease = createSchedulerLeaseMock(true);
        reconciliation = new SmsHistoryReconciliationService(
            repository, aligo as unknown as IAligoSmsApiPort, {} as SystemSettingService, lease,
        );
        carrier = new SmsCarrierCheckService(repository, aligo as unknown as IAligoSmsApiPort, lease);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("schedules the carrier check from the reconciliation time and lets a later 가입자없음 fail the log", async () => {
        seedUncertainTimeout();
        const reconciledAt = new Date(started.getTime() + 10 * 60_000);
        jest.setSystemTime(reconciledAt);

        await reconciliation.reconcile();

        expect(row()).toMatchObject({
            status: "sent", providerAcceptanceState: "reconciled_delivered", aligoMid: "ours", nextRetryAt: null,
        });
        expect(row()["carrierCheckDueAt"]).toEqual(new Date(reconciledAt.getTime() + CARRIER_CHECK_DELAY_MS));

        aligo.getSmsDeliveryDetails.mockResolvedValue({
            resultCode: 1, message: "ok",
            rows: [{ mdid: "ours", receiver, smsState: "가입자없음", sendDate: "2026-10-12 10:11:00" }],
        });
        jest.setSystemTime(new Date(reconciledAt.getTime() + CARRIER_CHECK_DELAY_MS + 5 * 60_000));

        await carrier.checkDueCarrierResults();

        expect(aligo.getSmsDeliveryDetails).toHaveBeenCalledWith("ours");
        expect(row()).toMatchObject({
            status: "failed", carrierResultState: "failed", carrierCheckDueAt: null, nextRetryAt: null,
        });
        expect(row()["errorMessage"]).toContain("통신사 전달 실패");
        expect(row()["errorMessage"]).toContain("가입자없음");
        expect(row()["providerAcceptanceState"]).toBe("reconciled_delivered");
        expect(aligo.sendSms).not.toHaveBeenCalled();
    });

    it("does not schedule a carrier check when history proves no delivery", async () => {
        seedUncertainTimeout();
        aligo.listSmsHistory.mockResolvedValue({
            result_code: 1, message: "ok", next_yn: "N",
            list: [{ receiver: "010-1234-5678", sms_state: "가입자없음" }],
        });
        jest.setSystemTime(new Date(started.getTime() + 10 * 60_000));

        await reconciliation.reconcile();

        expect(row()).toMatchObject({ status: "failed", aligoMid: "ours", nextRetryAt: null });
        expect(row()["carrierCheckDueAt"] ?? null).toBeNull();
    });

    it("does not reschedule a log whose carrier check is already scheduled", async () => {
        const scheduledFor = new Date("2026-10-12T02:00:00.000Z");
        seedUncertainTimeout({ carrierCheckDueAt: scheduledFor });
        jest.setSystemTime(new Date(started.getTime() + 10 * 60_000));

        await reconciliation.reconcile();

        expect(row()["providerAcceptanceState"]).toBe("reconciled_delivered");
        expect(row()["carrierCheckDueAt"]).toEqual(scheduledFor);
    });

    it("does not reschedule a log whose carrier check already completed", async () => {
        const checkedAt = new Date("2026-10-12T01:05:00.000Z");
        seedUncertainTimeout({ carrierCheckedAt: checkedAt, carrierResultState: "delivered", carrierResults: [{ receiver }] });
        jest.setSystemTime(new Date(started.getTime() + 10 * 60_000));

        await reconciliation.reconcile();

        expect(row()["providerAcceptanceState"]).toBe("reconciled_delivered");
        expect(row()["carrierCheckDueAt"] ?? null).toBeNull();
        expect(row()["carrierCheckedAt"]).toEqual(checkedAt);
        expect(row()["carrierResultState"]).toBe("delivered");
    });
});
