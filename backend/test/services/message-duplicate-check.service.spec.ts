import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { MessageDuplicateCheckService } from "application/services/message-duplicate-check.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { ISystemSettingRepository } from "domain/repositories/system-setting.repository.interface";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("MessageDuplicateCheckService", () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    let service: MessageDuplicateCheckService;
    let find: jest.Mock;
    let enabled: jest.Mock;
    let config: jest.Mock;
    beforeEach(() => {
        jest.spyOn(Date, "now").mockReturnValue(now.getTime());
        find = jest.fn().mockResolvedValue([{ id: 1001, sentAt: new Date("2026-10-30T12:00:00.000Z") }]);
        enabled = jest.fn().mockResolvedValue(true);
        config = jest.fn().mockResolvedValue({ configuration: { duplicateWindowHours: 96 } });
        service = new MessageDuplicateCheckService(
            { findSmsDuplicateMatches: find } as unknown as IMessageLogRepository,
            { getMessageSettingsPolicyEnabled: enabled, getMessageAutomationPolicyConfig: config } as unknown as SystemSettingService,
            { execute: jest.fn().mockResolvedValue(null) } as unknown as GetSettingUsecase,
        );
    });
    afterEach(() => jest.restoreAllMocks());
    it("queries the entire 96-hour window with server time and returns readonly binding", async () => {
        expect(await service.check("branch-a", "01012345678,01099998888", " body\r\nline ", "actual-hash")).toEqual({
            checkedAt: "2026-11-03T12:00:00.000Z", matchIds: [1001], latestSentAt: "2026-10-30T12:00:00.000Z", payloadHash: "actual-hash",
        });
        expect(find).toHaveBeenCalledWith({ branchId: "branch-a", receivers: ["01012345678", "01099998888"], messageBody: "body\nline", from: new Date("2026-10-30T12:00:00.000Z"), to: now });
    });
    it("refuses absent confirmation and permits an exact current decision", async () => {
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash")).rejects.toThrow(ConflictException);
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash", { confirmed: true, checkedAt: "ignored", matchIds: [1001], payloadHash: "actual-hash" })).resolves.toBeUndefined();
    });
    it.each([undefined, "old-hash"])("rejects missing/wrong hash %s with unchanged IDs", async payloadHash => {
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash", { confirmed: true, checkedAt: "ignored", matchIds: [1001], payloadHash })).rejects.toThrow(ConflictException);
    });
    it("rejects changed fresh history and supplied stale metadata with empty history", async () => {
        find.mockResolvedValueOnce([{ id: 1002, sentAt: now }]).mockResolvedValueOnce([]);
        const decision = { confirmed: true as const, checkedAt: "ignored", matchIds: [1001], payloadHash: "actual-hash" };
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash", decision)).rejects.toThrow(ConflictException);
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash", decision)).rejects.toThrow(ConflictException);
    });
    it("permits no duplicate without a decision", async () => {
        find.mockResolvedValue([]);
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash")).resolves.toBeUndefined();
    });
    it("OFF bypasses stale metadata and history only", async () => {
        enabled.mockResolvedValue(false);
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash", { confirmed: true, checkedAt: "ignored", matchIds: [5], payloadHash: "stale" })).resolves.toBeUndefined();
        expect(find).not.toHaveBeenCalled();
    });
    it.each(["history", "policy", "activation"])("fails closed when %s is unavailable", async source => {
        ({ history: find, policy: config, activation: enabled })[source]!.mockRejectedValue(new Error("unavailable"));
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "actual-hash")).rejects.toThrow(ServiceUnavailableException);
    });
    it("fails closed on corrupt activation through the existing getter reader", async () => {
        enabled.mockImplementation(async (_branch, _id, read) => { await read("activation-key"); return false; });
        service = new MessageDuplicateCheckService({ findSmsDuplicateMatches: find } as unknown as IMessageLogRepository,
            { getMessageSettingsPolicyEnabled: enabled } as unknown as SystemSettingService,
            { execute: jest.fn().mockResolvedValue("corrupt") } as unknown as GetSettingUsecase);
        await expect(service.assertCanSend("branch-a", "01012345678", "body", "hash")).rejects.toThrow(ServiceUnavailableException);
    });
    it("uses the real validated settings getter and default72 when policy and activation are absent", async () => {
        const get = new GetSettingUsecase({ findByKey: jest.fn().mockResolvedValue(null) } as unknown as ISystemSettingRepository);
        const settings = new SystemSettingService(get, {} as UpdateSettingUsecase);
        const actual = new MessageDuplicateCheckService({ findSmsDuplicateMatches: find } as unknown as IMessageLogRepository, settings, get);
        await actual.check("branch-a", "01012345678", "body", "hash");
        expect(find).toHaveBeenCalledWith(expect.objectContaining({ from: new Date("2026-10-31T12:00:00.000Z"), to: now }));
    });
    it.each([0, 721, 96.5, Number.NaN])("fails closed on corrupt window %s without querying history", async duplicateWindowHours => {
        config.mockResolvedValue({ configuration: { duplicateWindowHours } });
        await expect(service.check("branch-a", "01012345678", "body", "hash")).rejects.toThrow(ServiceUnavailableException);
        expect(find).not.toHaveBeenCalled();
    });
    it("sorts and deduplicates the batch union with the latest provider time", async () => {
        find.mockResolvedValue([{ id: 7, sentAt: new Date("2026-11-03T11:00:00.000Z") }, { id: 3, sentAt: now }, { id: 7, sentAt: now }]);
        expect(await service.check("branch-a", "01012345678,01012345678", "body", "hash")).toEqual({ checkedAt: "2026-11-03T12:00:00.000Z", matchIds: [3, 7], latestSentAt: "2026-11-03T12:00:00.000Z", payloadHash: "hash" });
    });

});
