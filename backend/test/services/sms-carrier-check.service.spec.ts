import { Logger } from "@nestjs/common";

import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import type { MessageLogEntity } from "domain/entities/message-log.entity";
import type { IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";
import type { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

describe("SmsCarrierCheckService", () => {
    const createLog = (
        id: number,
        receiver: string,
        aligoMid: string | null = `mid-${id}`,
    ): MessageLogEntity => ({ id, receiver, aligoMid }) as unknown as MessageLogEntity;

    const okResult = (rows: Array<{ receiver: string; smsState: string }>) => ({
        resultCode: 1,
        message: "success",
        rows: rows.map((row) => ({ mdid: null, sendDate: "2026-10-14 09:00:00", ...row })),
    });

    let logRepository: {
        findCarrierChecksDueSystemScope: jest.Mock;
        saveCarrierCheckResult: jest.Mock;
        postponeCarrierCheck: jest.Mock;
    };
    let port: { sendSms: jest.Mock; getSmsDeliveryDetails?: jest.Mock; getDefaultSenderPolicy?: jest.Mock };
    let lease: ReturnType<typeof createSchedulerLeaseMock>;
    let warnSpy: jest.SpyInstance;
    let service: SmsCarrierCheckService;

    const build = () => {
        service = new SmsCarrierCheckService(
            logRepository as unknown as IMessageLogRepository,
            port as unknown as IAligoSmsApiPort,
            lease,
        );
    };

    beforeEach(() => {
        logRepository = {
            findCarrierChecksDueSystemScope: jest.fn().mockResolvedValue([]),
            saveCarrierCheckResult: jest.fn().mockResolvedValue("saved"),
            postponeCarrierCheck: jest.fn().mockResolvedValue(true),
        };
        port = {
            sendSms: jest.fn(),
            getSmsDeliveryDetails: jest.fn(),
            getDefaultSenderPolicy: jest.fn().mockReturnValue({ availability: "available" }),
        };
        lease = createSchedulerLeaseMock(true);
        warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        build();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("does not query without the scheduler lease", async () => {
        lease = createSchedulerLeaseMock(false);
        build();

        await service.checkDueCarrierResults();

        expect(logRepository.findCarrierChecksDueSystemScope).not.toHaveBeenCalled();
    });

    it("does not query when the port has no getSmsDeliveryDetails", async () => {
        delete port.getSmsDeliveryDetails;

        await service.checkDueCarrierResults();

        expect(logRepository.findCarrierChecksDueSystemScope).not.toHaveBeenCalled();
    });

    it("does not query when the default sender policy is unavailable", async () => {
        port.getDefaultSenderPolicy = jest.fn().mockReturnValue({ availability: "unavailable" });

        await service.checkDueCarrierResults();

        expect(logRepository.findCarrierChecksDueSystemScope).not.toHaveBeenCalled();
    });

    it("saves delivered when every recipient succeeded", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([createLog(1, "010-1234-5678")]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([{ receiver: "01012345678", smsState: "발송완료" }]));

        await service.checkDueCarrierResults();

        expect(port.getSmsDeliveryDetails).toHaveBeenCalledWith("mid-1");
        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledWith({
            id: 1,
            expectedMid: "mid-1",
            state: "delivered",
            results: [
                { receiver: "01012345678", smsState: "발송완료", sendDate: "2026-10-14 09:00:00", verdict: "success" },
            ],
            checkedAt: expect.any(Date),
            failureMessage: null,
        });
    });

    it("saves failed with the formatted failure message", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([createLog(2, "01012341234,01056785678")]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([
            { receiver: "01012341234", smsState: "가입자없음" },
            { receiver: "01056785678", smsState: "발송완료" },
        ]));

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledWith(expect.objectContaining({
            id: 2,
            expectedMid: "mid-2",
            state: "failed",
            failureMessage: "통신사 전달 실패: 1234 가입자없음",
        }));
    });

    it("saves unconfirmed when the lookup returns no rows", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([createLog(3, "01012345678")]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([]));

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledWith(expect.objectContaining({
            id: 3,
            state: "unconfirmed",
            failureMessage: null,
            results: [expect.objectContaining({ receiver: "01012345678", verdict: "missing" })],
        }));
    });

    it("saves unconfirmed without a lookup when the log has no receivers", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([createLog(4, " , ")]);

        await service.checkDueCarrierResults();

        expect(port.getSmsDeliveryDetails).not.toHaveBeenCalled();
        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledWith(expect.objectContaining({
            id: 4,
            expectedMid: "mid-4",
            state: "unconfirmed",
            results: [],
            failureMessage: null,
        }));
    });

    it("records lookup_error when the port throws and still processes the next log", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(5, "01011111111"),
            createLog(6, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!
            .mockRejectedValueOnce(new Error("network down 01011111111"))
            .mockResolvedValueOnce(okResult([{ receiver: "01022222222", smsState: "발송완료" }]));

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
            id: 5,
            state: "lookup_error",
            results: [],
            failureMessage: null,
        }));
        expect(logRepository.saveCarrierCheckResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
            id: 6,
            state: "delivered",
        }));
        const warnings = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(warnings).toContain("log 5");
        expect(warnings).not.toContain("01011111111");
    });

    it("records lookup_error for a non-1 result code", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([createLog(7, "01012345678")]);
        port.getSmsDeliveryDetails!.mockResolvedValue({ resultCode: -101, message: "auth", rows: [] });

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledWith(expect.objectContaining({
            id: 7,
            state: "lookup_error",
            results: [],
            failureMessage: null,
        }));
    });

    it("tolerates a stale save result and keeps going", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(8, "01011111111"),
            createLog(9, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([
            { receiver: "01011111111", smsState: "발송완료" },
            { receiver: "01022222222", smsState: "발송완료" },
        ]));
        logRepository.saveCarrierCheckResult.mockResolvedValueOnce("stale").mockResolvedValueOnce("saved");

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(2);
    });

    it("continues after a save error", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(10, "01011111111"),
            createLog(11, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([
            { receiver: "01011111111", smsState: "발송완료" },
            { receiver: "01022222222", smsState: "발송완료" },
        ]));
        logRepository.saveCarrierCheckResult
            .mockRejectedValueOnce(new Error("write failed"))
            .mockResolvedValueOnce("saved");

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(2);
    });

    it("postpones a row that throws unexpectedly by 30 minutes and keeps going", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(20, "01011111111"),
            createLog(21, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([
            { receiver: "01011111111", smsState: "발송완료" },
            { receiver: "01022222222", smsState: "발송완료" },
        ]));
        logRepository.saveCarrierCheckResult
            .mockRejectedValueOnce(new Error("write failed"))
            .mockResolvedValueOnce("saved");
        const before = Date.now();

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(2);
        expect(logRepository.postponeCarrierCheck).toHaveBeenCalledTimes(1);
        const [id, mid, until] = logRepository.postponeCarrierCheck.mock.calls[0] as [number, string, Date];
        expect(id).toBe(20);
        expect(mid).toBe("mid-20");
        expect(until.getTime() - before).toBeGreaterThanOrEqual(30 * 60 * 1000);
        expect(until.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    });

    describe("a row that keeps throwing for more than 24 hours", () => {
        const HOUR = 60 * 60 * 1000;
        const oldLog = (id: number, overrides: Partial<MessageLogEntity> = {}) => ({
            ...createLog(id, "01011111111"),
            createdAt: new Date(Date.now() - 30 * HOUR),
            providerAcceptedAt: null,
            ...overrides,
        }) as MessageLogEntity;

        it("is closed as lookup_error instead of being postponed", async () => {
            logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([oldLog(30)]);
            port.getSmsDeliveryDetails!.mockResolvedValue(okResult([{ receiver: "01011111111", smsState: "발송완료" }]));
            logRepository.saveCarrierCheckResult
                .mockRejectedValueOnce(new Error("write failed"))
                .mockResolvedValueOnce("saved");

            await service.checkDueCarrierResults();

            expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(2);
            expect(logRepository.saveCarrierCheckResult).toHaveBeenLastCalledWith(expect.objectContaining({
                id: 30,
                expectedMid: "mid-30",
                state: "lookup_error",
                results: [],
                failureMessage: null,
            }));
            expect(logRepository.postponeCarrierCheck).not.toHaveBeenCalled();
        });

        it("measures age from providerAcceptedAt when it is set", async () => {
            // Created long ago but accepted 1h ago: still within the 24h window, so postpone.
            logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
                oldLog(31, { providerAcceptedAt: new Date(Date.now() - HOUR) }),
            ]);
            port.getSmsDeliveryDetails!.mockResolvedValue(okResult([{ receiver: "01011111111", smsState: "발송완료" }]));
            logRepository.saveCarrierCheckResult.mockRejectedValueOnce(new Error("write failed"));

            await service.checkDueCarrierResults();

            expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(1);
            expect(logRepository.postponeCarrierCheck).toHaveBeenCalledTimes(1);
        });

        it("falls back to postponing when the lookup_error save also throws", async () => {
            logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([oldLog(32)]);
            port.getSmsDeliveryDetails!.mockResolvedValue(okResult([{ receiver: "01011111111", smsState: "발송완료" }]));
            logRepository.saveCarrierCheckResult.mockRejectedValue(new Error("write failed"));

            await service.checkDueCarrierResults();

            expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(2);
            expect(logRepository.postponeCarrierCheck).toHaveBeenCalledTimes(1);
            expect((logRepository.postponeCarrierCheck.mock.calls[0] as [number])[0]).toBe(32);
        });
    });

    it("does not postpone rows that are handled (lookup_error, stale) or saved", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(22, "01011111111"),
            createLog(23, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!
            .mockRejectedValueOnce(new Error("timeout"))
            .mockResolvedValueOnce(okResult([{ receiver: "01022222222", smsState: "발송완료" }]));
        logRepository.saveCarrierCheckResult.mockResolvedValueOnce("saved").mockResolvedValueOnce("stale");

        await service.checkDueCarrierResults();

        expect(logRepository.postponeCarrierCheck).not.toHaveBeenCalled();
    });

    it("swallows a postpone failure and still processes the next row", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(24, "01011111111"),
            createLog(25, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([
            { receiver: "01011111111", smsState: "발송완료" },
            { receiver: "01022222222", smsState: "발송완료" },
        ]));
        logRepository.saveCarrierCheckResult
            .mockRejectedValueOnce(new Error("write failed"))
            .mockResolvedValueOnce("saved");
        logRepository.postponeCarrierCheck.mockRejectedValue(new Error("postpone failed"));

        await expect(service.checkDueCarrierResults()).resolves.toBeUndefined();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls.map((call) => String(call[0])).join("\n")).toContain("Could not postpone log 24");
    });

    it("stops starting new rows once the run time budget is spent", async () => {
        let now = Date.parse("2026-10-14T00:00:00.000Z");
        jest.spyOn(Date, "now").mockImplementation(() => now);
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(30, "01011111111"),
            createLog(31, "01022222222"),
            createLog(32, "01033333333"),
        ]);
        port.getSmsDeliveryDetails!.mockImplementation(async () => {
            now += 11 * 60 * 1000; // a single slow lookup burns the whole budget
            return okResult([{ receiver: "01011111111", smsState: "발송완료" }]);
        });

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(1);
        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledWith(expect.objectContaining({ id: 30 }));
        const warnings = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(warnings).toContain("time budget exhausted");
        expect(warnings).toContain("processed 1 of 3");
    });

    it("processes every row when the run stays within the time budget", async () => {
        let now = Date.parse("2026-10-14T00:00:00.000Z");
        jest.spyOn(Date, "now").mockImplementation(() => now);
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(33, "01011111111"),
            createLog(34, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!.mockImplementation(async () => {
            now += 60 * 1000;
            return okResult([
                { receiver: "01011111111", smsState: "발송완료" },
                { receiver: "01022222222", smsState: "발송완료" },
            ]);
        });

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(2);
    });

    it("stops when the lease is lost mid-run", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(12, "01011111111"),
            createLog(13, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!.mockResolvedValue(okResult([{ receiver: "01011111111", smsState: "발송완료" }]));
        lease.holdsLease
            .mockReturnValueOnce(true) // tick entry
            .mockReturnValueOnce(true) // before first item
            .mockReturnValue(false);   // before second item

        await service.checkDueCarrierResults();

        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledTimes(1);
        expect(logRepository.saveCarrierCheckResult).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
    });

    it("logs each unrecognized carrier state once per tick", async () => {
        logRepository.findCarrierChecksDueSystemScope.mockResolvedValue([
            createLog(14, "01011111111"),
            createLog(15, "01022222222"),
        ]);
        port.getSmsDeliveryDetails!
            .mockResolvedValueOnce(okResult([{ receiver: "01011111111", smsState: "미지의상태" }]))
            .mockResolvedValueOnce(okResult([{ receiver: "01022222222", smsState: "미지의상태" }]));

        await service.checkDueCarrierResults();

        const unrecognized = warnSpy.mock.calls
            .map((call) => String(call[0]))
            .filter((message) => message.includes("Unrecognized carrier state"));
        expect(unrecognized).toHaveLength(1);
        expect(unrecognized[0]).toContain("미지의상태");
        expect(unrecognized[0]).not.toContain("0101");
    });
});
