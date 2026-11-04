import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MessageDuplicateCheckService } from "application/services/message-duplicate-check.service";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";
import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { createBranch, createClient } from "../helpers/factories";
import { RowTracker } from "../helpers/tracker";

/** Fixed synthetic identities and independent literal SQL expectations; no provider transport. */
describeReal("SMS duplicate confirmation full-history SQL (real PostgreSQL)", () => {
    const branchId = "00000000-0000-4000-8000-000000004201";
    const otherBranchId = "00000000-0000-4000-8000-000000004202";
    const now = new Date("2026-11-03T12:00:00.000Z");
    const from = new Date("2026-10-30T12:00:00.000Z");
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let repository: SbMessageLogRepository;
    let service: MessageDuplicateCheckService;
    let policyOwned = false;
    let branchOwned = false;
    const policyKey = `branch:${branchId}:message_automation:policy`;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        // Refuse occupied fixture identities; never adopt or delete another suite's rows.
        expect(await handle.raw.branch.count({ where: { id: { in: [branchId, otherBranchId] } } })).toBe(0);
        expect(await handle.raw.message_log.count({ where: { id: { gte: 1420000000, lte: 1420002100 } } })).toBe(0);
        await createBranch(handle.raw, tracker, { id: branchId, slug: "throwaway-duplicate-4201" });
        branchOwned = true;
        await createBranch(handle.raw, tracker, { id: otherBranchId, slug: "throwaway-duplicate-4202" });
        await createClient(handle.raw, tracker, { id: 1420000041, branchId, name: "합성 고객 A", phone: "01000004201", phoneNormalized: "01000004201" });
        await createClient(handle.raw, tracker, { id: 1420000042, branchId, name: "합성 고객 C", phone: "01000004203", phoneNormalized: "01000004203" });
        await handle.raw.system_setting.create({ data: { key: policyKey, value: JSON.stringify({ ...defaultMessageAutomationPolicy(), duplicateWindowHours: 96 }) } });
        policyOwned = true;
        repository = new SbMessageLogRepository(handle.service);
        const settingsRepository = new SbSystemSettingRepository(handle.service);
        const get = new GetSettingUsecase(settingsRepository);
        service = new MessageDuplicateCheckService(repository, new SystemSettingService(get, new UpdateSettingUsecase(settingsRepository)), get);
    });
    beforeEach(() => { jest.spyOn(Date, "now").mockReturnValue(now.getTime()); });
    afterEach(async () => {
        jest.restoreAllMocks();
        if (branchOwned) {
            // Include rows the real controller admitted, even if a test failed
            // before its next assertion. This branch was created by this suite.
            const rows = await handle.raw.message_log.findMany({ where: { branchId }, select: { id: true } });
            for (const row of rows) tracker.track("message_log", row.id);
        }
    });
    afterAll(async () => {
        if (handle) {
            // Only rows belonging to the branches successfully registered by this suite.
            if (tracker) await tracker.cleanup(handle.raw);
            if (policyOwned) await handle.raw.system_setting.deleteMany({ where: { key: policyKey } });
            await closeIntegrityPrisma(handle);
        }
    });

    async function seed(id: number, messageBody: string, data: Partial<Prisma.message_logUncheckedCreateInput> = {}) {
        const row = await handle.raw.message_log.create({ data: {
            id, branchId, provider: "aligo_sms", templateKey: "manual_sms", receiver: "01000004201", messageBody,
            status: "sent", createdAt: now, ...data,
        } });
        tracker.track("message_log", row.id);
    }
    function query(messageBody: string, receivers = ["01000004201"]) {
        return repository.findSmsDuplicateMatches({ branchId, receivers, messageBody, from, to: now });
    }

    it("includes both 96h endpoints, excludes 1ms outside, prioritizes provider clock and uses legacy fallback", async () => {
        await seed(1420000001, "clock", { createdAt: from });
        await seed(1420000002, "clock", { createdAt: new Date("2026-10-30T11:59:59.999Z") });
        await seed(1420000003, "clock", { createdAt: new Date("2026-10-01T00:00:00.000Z"), providerCallStartedAt: from });
        await seed(1420000004, "clock", { createdAt: now, providerCallStartedAt: new Date("2026-10-30T11:59:59.999Z") });
        await seed(1420000005, "clock", { providerCallStartedAt: now });
        await seed(1420000006, "clock", { providerCallStartedAt: new Date("2026-11-03T12:00:00.001Z") });
        await seed(1420000007, "clock", { createdAt: new Date("2026-11-03T12:00:00.001Z") });
        expect(await query("clock")).toEqual([
            { id: 1420000001, sentAt: new Date("2026-10-30T12:00:00.000Z") },
            { id: 1420000003, sentAt: new Date("2026-10-30T12:00:00.000Z") },
            { id: 1420000005, sentAt: new Date("2026-11-03T12:00:00.000Z") },
        ]);
    });

    it("pairs sent/carrier pending positives with branch/provider/failed/reserved/phone/body exclusions", async () => {
        await seed(1420000011, "scope", { providerAcceptanceState: "accepted", carrierCheckDueAt: new Date("2026-11-03T12:30:00.000Z"), carrierResultState: null });
        await seed(1420000012, "scope", { branchId: otherBranchId });
        await seed(1420000013, "scope", { provider: "aligo_alimtalk" });
        await seed(1420000014, "scope", { status: "failed", providerAcceptanceState: "accepted", carrierResultState: "failed" });
        await seed(1420000015, "scope", { status: "pending", providerAcceptanceState: "accepted" });
        await seed(1420000016, "scope", { receiver: "01000004203" });
        await seed(1420000017, "other-body");
        await seed(1420000018, "scope", { providerAcceptanceState: "legacy" });
        expect((await query("scope")).map(row => row.id)).toEqual([1420000011, 1420000018]);
        expect((await query("scope", ["01000004203"])).map(row => row.id)).toEqual([1420000016]);
        expect((await query("other-body")).map(row => row.id)).toEqual([1420000017]);
    });

    it("matches normalized individual phones in historical comma rows once, ignoring association identity", async () => {
        await seed(1420000021, "\ufeff\u00a0 \tbatch\r\nbody \n\u00a0", { receiver: "010-0000-4201,82 10-0000-4202", recipientPhone: "010-0000-4201,82 10-0000-4202", clientId: 1420000042, variables: { employeeId: 1420000999 }, providerCallStartedAt: new Date("2026-11-03T11:00:00.000Z") });
        await seed(1420000022, "batch\nbody", { recipientPhone: "82 10 0000 4201", clientId: null });
        expect((await query("batch\nbody")).map(row => row.id)).toEqual([1420000021, 1420000022]);
        expect(await query("batch\nbody", ["01000004203"])).toEqual([]);
        expect((await query("batch\nbody", ["01000004201", "01000004203"])).map(row => row.id)).toEqual([1420000021, 1420000022]);
        expect((await query("batch\nbody", ["01000004202"])).map(row => row.id)).toEqual([1420000021]);
        expect(await service.check(branchId, "01000004201,01000004203", " batch\r\nbody ", "literal-opaque-hash")).toEqual({ checkedAt: "2026-11-03T12:00:00.000Z", matchIds: [1420000021, 1420000022], latestSentAt: "2026-11-03T12:00:00.000Z", payloadHash: "literal-opaque-hash" });
    });

    it("finds a known late ID beyond 1000 unrelated recent rows without a history page limit", async () => {
        const rows = Array.from({ length: 1001 }, (_, index) => ({ id: 1420001000 + index, branchId, provider: "aligo_sms", templateKey: "manual_sms", receiver: "01000004203", messageBody: "bulk-other", status: "sent", createdAt: now }));
        await handle.raw.message_log.createMany({ data: rows });
        for (const row of rows) tracker.track("message_log", row.id);
        await seed(1420002001, "bulk-target", { createdAt: from });
        expect(await query("bulk-target")).toEqual([{ id: 1420002001, sentAt: new Date("2026-10-30T12:00:00.000Z") }]);
        expect(await handle.raw.message_log.count({ where: { branchId, messageBody: "bulk-other" } })).toBe(1001);
    });

    it("uses actual SQL in readonly preflight and refusal/allowance paths with literal provider counts", async () => {
        await seed(1420000032, "controller");
        const sendSms = jest.fn().mockResolvedValue({ request: { receiver: "01000004201", senderPhone: "0200004201", msgType: "SMS", testModeYn: "N" }, response: { result_code: 1, message: "accepted", msg_id: 4201, success_cnt: 1, error_cnt: 0, msg_type: "SMS" } });
        const approval = { ensureApproved: jest.fn().mockResolvedValue(undefined) };
        const controller = new MessageDeliveryController({ sendSms } as unknown as AligoService, approval as unknown as MessageSenderApprovalService, handle.service, service);
        const request = { receiver: "01000004201", message: "controller", clientId: 1420000041, idempotencyKey: "duplicate-sql-controller-4201" };
        const before = await handle.raw.message_log.count({ where: { branchId } });
        const check = await controller.checkSmsDuplicates({ branchId }, request);
        expect(check.matchIds).toEqual([1420000032]);
        expect(check.payloadHash).toBe("476627c942b4939c2178fee838de0377d00c0823aaf1af4e79c9afe9bff6a02d");
        expect(check.latestSentAt).toBe("2026-11-03T12:00:00.000Z");
        expect(await handle.raw.message_log.count({ where: { branchId } })).toBe(before);
        expect(approval.ensureApproved).toHaveBeenCalledTimes(0);
        expect(sendSms).toHaveBeenCalledTimes(0);
        await expect(controller.sendSms({ branchId }, request)).rejects.toThrow(ConflictException);
        expect(await handle.raw.message_log.count({ where: { branchId } })).toBe(before);
        expect(sendSms).toHaveBeenCalledTimes(0);
        await controller.sendSms({ branchId }, { ...request, duplicateDecision: { confirmed: true, ...check } });
        expect(sendSms).toHaveBeenCalledTimes(1);
        await controller.sendSms({ branchId }, { ...request, message: "changed body", idempotencyKey: "duplicate-sql-changed-body-4201" });
        expect(sendSms).toHaveBeenCalledTimes(2);
        await controller.sendSms({ branchId }, { ...request, receiver: "01000004203", clientId: 1420000042, idempotencyKey: "duplicate-sql-changed-recipient-4203" });
        expect(sendSms).toHaveBeenCalledTimes(3);
    });
});
