import { evaluateMessageQuietHours } from "domain/message-policy-evaluator";
import { ConflictException } from "@nestjs/common";
import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";
import { isEntityChangeHintsSuppressed } from "infrastructure/database/entity-change-suppression";

describe("SystemSettingService", () => {
    const createMockGetSettingUsecase = () => ({
        execute: jest.fn(),
        executeEntity: jest.fn(),
        executeWithDefault: jest.fn(),
    });

    const createMockUpdateSettingUsecase = () => ({
        execute: jest.fn(),
        executeIfVersion: jest.fn(),
    });

    let service: SystemSettingService;
    let getSettingUsecase: ReturnType<typeof createMockGetSettingUsecase>;
    let updateSettingUsecase: ReturnType<typeof createMockUpdateSettingUsecase>;

    beforeEach(() => {
        getSettingUsecase = createMockGetSettingUsecase();
        updateSettingUsecase = createMockUpdateSettingUsecase();
        service = new SystemSettingService(
            getSettingUsecase as unknown as GetSettingUsecase,
            updateSettingUsecase as unknown as UpdateSettingUsecase
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("message automation past trigger config", () => {
        it("should return the default config when no setting is stored", async () => {
            getSettingUsecase.execute.mockResolvedValue(null);

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(getSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:message_automation:past_trigger"
            );
            expect(result).toEqual({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            });
        });

        it("should parse and normalize the stored config", async () => {
            getSettingUsecase.execute.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify({
                sendIntervalMinutes: 3,
                ruleOrder: ["rule-2", "rule-1", "rule-2"],
            }));

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(result).toEqual({
                sendIntervalMinutes: 3,
                ruleOrder: ["rule-2", "rule-1"],
            });
        });

        it("should fail closed when stored JSON is invalid", async () => {
            getSettingUsecase.execute.mockResolvedValue("{");
            await expect(service.getMessageAutomationPastTriggerConfig("branch-1")).rejects.toMatchObject({ status: 503 });
        });

        it("should reject invalid input instead of persisting a clamped config", async () => {
            await expect(service.setMessageAutomationPastTriggerConfig("branch-1", {
                sendIntervalMinutes: 2000, ruleOrder: ["rule-1", "rule-2", "rule-1"],
            })).rejects.toMatchObject({ status: 400 });
            expect(updateSettingUsecase.execute).not.toHaveBeenCalled();
            expect(updateSettingUsecase.executeIfVersion).not.toHaveBeenCalled();
        });
    });

    describe("message settings policy activation", () => {
        it("should default each branch policy to enabled", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("true");

            const result = await service.getMessageSettingsPolicyEnabled(
                "branch-1",
                "trigger-dispatch",
            );

            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledWith(
                "branch:branch-1:message_policy:trigger-dispatch:enabled",
                "true",
            );
            expect(result).toBe(true);
        });

        it("should persist a disabled branch policy", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:message_policy:sms-retry:enabled",
                "false",
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const result = await service.setMessageSettingsPolicyEnabled(
                "branch-1",
                "sms-retry",
                false,
            );

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:message_policy:sms-retry:enabled",
                "false",
            );
            expect(result).toBe(entity);
        });

        it("should load every policy activation for the branch", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("true");

            const result = await service.getMessageSettingsPolicyActivations("branch-1");

            expect(result).toEqual({
                "trigger-dispatch": true,
                "trigger-job-retry": true,
                "sms-retry": true,
                "past-trigger": true,
                "duplicate-send-confirmation": true,
            });
            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledTimes(5);
        });
    });

    describe("contract auto-finalize config", () => {
        it("defaults missing or invalid values", async () => {
            getSettingUsecase.execute.mockResolvedValue("{invalid");
            await expect(service.getContractAutoFinalizeConfig("branch-1")).resolves.toEqual({
                enabled: true,
                graceDays: 7,
                maxAttempts: 3,
            });
        });

        it("clamps and persists the branch-scoped config", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:contract_automation:auto_finalize",
                JSON.stringify({ enabled: false, graceDays: 30, maxAttempts: 10 }),
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);
            await service.setContractAutoFinalizeConfig("branch-1", {
                enabled: false,
                graceDays: 99,
                maxAttempts: 0,
            });
            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:contract_automation:auto_finalize",
                JSON.stringify({ enabled: false, graceDays: 30, maxAttempts: 1 }),
            );
        });
    });

    describe("ribbon compare-and-set", () => {
        it("persists only when the approved ribbon version still matches", async () => {
            const entity = new SystemSettingEntity("ribbon_config", "{}", new Date());
            updateSettingUsecase.executeIfVersion.mockResolvedValue(entity);

            await expect(service.setRibbonConfigIfVersion("approved-version", {
                enabled: false,
                message: "",
                backgroundColor: "#004AAD",
                textColor: "#FFFFFF",
                linkText: "",
                linkHref: "",
                linkColor: "#FFB27B",
            })).resolves.toBe(entity);

            expect(updateSettingUsecase.executeIfVersion).toHaveBeenCalledWith(
                "ribbon_config",
                expect.any(String),
                "approved-version",
                expect.any(Function),
            );
        });

        it("rejects a stale ribbon version without invoking a second unconditional write", async () => {
            updateSettingUsecase.executeIfVersion.mockResolvedValue(null);

            const promise = service.setRibbonConfigIfVersion("stale-version", {
                enabled: true,
                message: "점검",
                backgroundColor: "#004AAD",
                textColor: "#FFFFFF",
                linkText: "",
                linkHref: "",
                linkColor: "#FFB27B",
            });
            await expect(promise).rejects.toBeInstanceOf(ConflictException);
            await expect(promise).rejects.toMatchObject({
                status: 409,
                response: expect.objectContaining({
                    code: "REQUEST_CONFLICT",
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });
            expect(updateSettingUsecase.execute).not.toHaveBeenCalled();
        });
    });

    describe("client auto-registration policy", () => {
        it("should default to enabled when no setting is stored", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("true");

            const result = await service.getClientAutoRegistrationEnabled("branch-1");

            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledWith(
                "branch:branch-1:client_auto_registration",
                "true",
            );
            expect(result).toBe(true);
        });

        it("should round-trip a stored value", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:client_auto_registration",
                "false",
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const setResult = await service.setClientAutoRegistrationEnabled("branch-1", false);

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:client_auto_registration",
                "false",
            );
            expect(setResult).toBe(entity);

            getSettingUsecase.executeWithDefault.mockResolvedValue("false");

            const getResult = await service.getClientAutoRegistrationEnabled("branch-1");

            expect(getResult).toBe(false);
        });
    });

    describe("greeting on auto-registration policy", () => {
        it("should default to disabled when no setting is stored", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("false");

            const result = await service.getGreetingOnAutoRegistrationEnabled("branch-1");

            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledWith(
                "branch:branch-1:greeting_on_auto_registration",
                "false",
            );
            expect(result).toBe(false);
        });

        it("should round-trip a stored value", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:greeting_on_auto_registration",
                "true",
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const setResult = await service.setGreetingOnAutoRegistrationEnabled("branch-1", true);

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:greeting_on_auto_registration",
                "true",
            );
            expect(setResult).toBe(entity);

            getSettingUsecase.executeWithDefault.mockResolvedValue("true");

            const getResult = await service.getGreetingOnAutoRegistrationEnabled("branch-1");

            expect(getResult).toBe(true);
        });
    });

    describe("PWA undelivered digest watermark", () => {
        it("should read a valid branch-scoped ISO timestamp", async () => {
            getSettingUsecase.execute.mockResolvedValue("2026-08-11T00:00:00.000Z");

            await expect(service.getPwaUndeliveredDigestWatermark("branch-1")).resolves.toEqual(
                new Date("2026-08-11T00:00:00.000Z"),
            );
            expect(getSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:pwa_undelivered_digest_watermark",
            );
        });

        it("should fail open to the initial window when the stored timestamp is invalid", async () => {
            getSettingUsecase.execute.mockResolvedValue("not-a-date");

            await expect(service.getPwaUndeliveredDigestWatermark("branch-1")).resolves.toBeNull();
        });

        it("should persist the watermark as an ISO timestamp", async () => {
            const watermark = new Date("2026-08-12T00:00:00.000Z");
            const entity = new SystemSettingEntity(
                "branch:branch-1:pwa_undelivered_digest_watermark",
                watermark.toISOString(),
                watermark,
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            await expect(
                service.setPwaUndeliveredDigestWatermark("branch-1", watermark),
            ).resolves.toBe(entity);
            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:pwa_undelivered_digest_watermark",
                watermark.toISOString(),
            );
        });
    });

    describe("PWA digest delivery claims", () => {
        const deliveryKey = "branch:branch-1:daily:2026-08-28";
        const settingKey = `pwa:daily_digest:${deliveryKey}`;
        const now = new Date("2026-08-28T00:00:00.000Z");

        it("should create a processing claim when no replica has claimed the delivery", async () => {
            const entity = new SystemSettingEntity(settingKey, "claimed", now);
            getSettingUsecase.executeEntity.mockResolvedValue(null);
            updateSettingUsecase.executeIfVersion.mockResolvedValue(entity);

            const token = await service.claimPwaDigestDelivery(deliveryKey, now);

            expect(token).toEqual(expect.any(String));
            const [key, rawState, expectedVersion, versionOf] = updateSettingUsecase.executeIfVersion.mock
                .calls[0] as [string, string, string, (value: string | null) => string];
            expect(key).toBe(settingKey);
            expect(expectedVersion).toBe("absent");
            expect(versionOf(null)).toBe("absent");
            expect(JSON.parse(rawState)).toEqual(expect.objectContaining({
                status: "processing",
                token,
                leaseExpiresAt: "2026-08-28T00:30:00.000Z",
            }));
        });

        it("should skip an active, sent, or uncertain claim", async () => {
            for (const state of [
                {
                    status: "processing",
                    token: "active",
                    leaseExpiresAt: "2026-08-28T00:10:00.000Z",
                },
                { status: "sent", token: "sent" },
                { status: "uncertain", token: "uncertain" },
            ]) {
                getSettingUsecase.executeEntity.mockResolvedValue(
                    new SystemSettingEntity(settingKey, JSON.stringify(state), now),
                );

                await expect(service.claimPwaDigestDelivery(deliveryKey, now)).resolves.toBeNull();
            }

            expect(updateSettingUsecase.executeIfVersion).not.toHaveBeenCalled();
        });

        it("should reclaim an expired processing claim or retryable delivery", async () => {
            const entity = new SystemSettingEntity(settingKey, "claimed", now);
            updateSettingUsecase.executeIfVersion.mockResolvedValue(entity);

            getSettingUsecase.executeEntity.mockResolvedValue(
                new SystemSettingEntity(settingKey, JSON.stringify({
                    status: "processing",
                    token: "expired",
                    leaseExpiresAt: "2026-08-27T23:59:59.000Z",
                }), now),
            );
            await expect(service.claimPwaDigestDelivery(deliveryKey, now)).resolves.toEqual(expect.any(String));

            updateSettingUsecase.executeIfVersion.mockClear();
            getSettingUsecase.executeEntity.mockResolvedValue(
                new SystemSettingEntity(settingKey, JSON.stringify({ status: "retryable", token: "failed" }), now),
            );
            await expect(service.claimPwaDigestDelivery(deliveryKey, now)).resolves.toEqual(expect.any(String));

            expect(updateSettingUsecase.executeIfVersion).toHaveBeenCalledTimes(1);
        });

        it("should complete only the claim that still owns the delivery", async () => {
            const processing = new SystemSettingEntity(settingKey, JSON.stringify({
                status: "processing",
                token: "claim-token",
                leaseExpiresAt: "2026-08-28T00:30:00.000Z",
            }), now);
            const completed = new SystemSettingEntity(settingKey, "sent", now);
            getSettingUsecase.executeEntity.mockResolvedValue(processing);
            updateSettingUsecase.executeIfVersion.mockResolvedValue(completed);

            await expect(
                service.completePwaDigestDelivery(deliveryKey, "claim-token", "sent"),
            ).resolves.toBe(true);
            expect(updateSettingUsecase.executeIfVersion).toHaveBeenCalledWith(
                settingKey,
                JSON.stringify({ status: "sent", token: "claim-token" }),
                expect.any(String),
                expect.any(Function),
            );

            updateSettingUsecase.executeIfVersion.mockClear();
            await expect(
                service.completePwaDigestDelivery(deliveryKey, "stale-token", "sent"),
            ).resolves.toBe(false);
            expect(updateSettingUsecase.executeIfVersion).not.toHaveBeenCalled();
        });
    });

    describe("realtime hint suppression for PWA digest bookkeeping", () => {
        const deliveryKey = "branch:branch-1:daily:2026-08-28";
        const now = new Date("2026-08-28T00:00:00.000Z");
        const entity = new SystemSettingEntity("any", "v", now);

        it("runs the digest claim write with hints suppressed", async () => {
            let suppressed: boolean | undefined;
            getSettingUsecase.executeEntity.mockResolvedValue(null);
            updateSettingUsecase.executeIfVersion.mockImplementation(async () => {
                suppressed = isEntityChangeHintsSuppressed();
                return entity;
            });

            await service.claimPwaDigestDelivery(deliveryKey, now);

            expect(suppressed).toBe(true);
        });

        it("runs the digest completion write with hints suppressed", async () => {
            let suppressed: boolean | undefined;
            getSettingUsecase.executeEntity.mockResolvedValue(new SystemSettingEntity(
                `pwa:daily_digest:${deliveryKey}`,
                JSON.stringify({ status: "processing", token: "t", leaseExpiresAt: "2026-08-28T00:30:00.000Z" }),
                now,
            ));
            updateSettingUsecase.executeIfVersion.mockImplementation(async () => {
                suppressed = isEntityChangeHintsSuppressed();
                return entity;
            });

            await expect(service.completePwaDigestDelivery(deliveryKey, "t", "sent")).resolves.toBe(true);

            expect(suppressed).toBe(true);
        });

        it("runs the undelivered-digest watermark write with hints suppressed", async () => {
            let suppressed: boolean | undefined;
            updateSettingUsecase.execute.mockImplementation(async () => {
                suppressed = isEntityChangeHintsSuppressed();
                return entity;
            });

            await service.setPwaUndeliveredDigestWatermark("branch-1", now);

            expect(suppressed).toBe(true);
        });

        it("keeps a user-visible setting write (email notification preference) announced", async () => {
            let suppressed: boolean | undefined;
            updateSettingUsecase.execute.mockImplementation(async () => {
                suppressed = isEntityChangeHintsSuppressed();
                return entity;
            });

            await service.setUserEmailNotificationsEnabled("user-1", false);

            expect(suppressed).toBe(false);
        });

        it("does not leave suppression active after the digest write settles", async () => {
            getSettingUsecase.executeEntity.mockResolvedValue(null);
            updateSettingUsecase.executeIfVersion.mockResolvedValue(entity);

            await service.claimPwaDigestDelivery(deliveryKey, now);

            expect(isEntityChangeHintsSuppressed()).toBe(false);
        });
    });
});

// POL-1 expectations are literals independent from production default constants.
describe("POL-1 versioned message policy", () => {
    const draft = () => ({
        schemaVersion: 1 as const, dispatchCheckIntervalMinutes: 1, defaultRuleSendTime: "09:00",
        triggerRetryIntervalMinutes: 5, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 5,
        pastExpiryHours: 24, pastSendIntervalMinutes: 1, pastRuleOrder: [] as string[], duplicateWindowHours: 72,
        quietHours: { enabled: false, start: "22:00", end: "08:00", recipientGroups: ["CLIENT", "CAREGIVER", "STAFF"] as ("CLIENT" | "CAREGIVER" | "STAFF")[], action: "DEFER" as "DEFER" | "CANCEL", timezone: "Asia/Seoul" as const },
    });
    let rows: Map<string, string>;
    let service: SystemSettingService;
    let get: { execute: jest.Mock };
    let update: { executeIfVersion: jest.Mock; execute: jest.Mock };
    let rules: { findAll: jest.Mock };
    let jobs: { findPolicyPreviewCandidates: jest.Mock };
    let logs: { findPolicyPreviewCandidates: jest.Mock; countFutureProviderReservations: jest.Mock; resolvePolicyRecipientGroups: jest.Mock };
    const tx = { marker: "single branch transaction" };
    let lock: { runExclusive: jest.Mock };
    const key = "branch:A:message_automation:policy";
    beforeEach(() => {
        rows = new Map();
        get = { execute: jest.fn(async (key: string) => rows.get(key) ?? null) };
        update = {
            execute: jest.fn(),
            executeIfVersion: jest.fn(async (key: string, value: string, expected: string, versionOf: (raw: string | null) => string) => {
                if (versionOf(rows.get(key) ?? null) !== expected) return null;
                rows.set(key, value);
                return SystemSettingEntity.create(key, value);
            }),
        };
        rules = { findAll: jest.fn().mockResolvedValue([
            { id: "sms-A", branchId: "A", isActive: true, templateKey: "INFO" },
            { id: "inactive", branchId: "A", isActive: false, templateKey: "INFO" },
            { id: "sms-B", branchId: "B", isActive: true, templateKey: "INFO" },
            { id: "alimtalk", branchId: "A", isActive: true, templateKey: "CLIENT_WELCOME" },
        ]) };
        jobs = { findPolicyPreviewCandidates: jest.fn().mockResolvedValue([]) };
        logs = { findPolicyPreviewCandidates: jest.fn().mockResolvedValue([]), countFutureProviderReservations: jest.fn().mockResolvedValue(0),
            resolvePolicyRecipientGroups: jest.fn(async (_branch: string, candidates: unknown[]) => candidates) };
        lock = { runExclusive: jest.fn(async (_branch: string, callback: (tx: unknown) => Promise<unknown>) => callback(tx)) };
        service = new SystemSettingService(get as any, update as any, undefined, undefined, rules as any, jobs as any, logs as any, lock as any);
    });
    it("returns exact missing defaults/null version and legacy precedence without writes", async () => {
        expect(await service.getMessageAutomationPolicyConfig("A")).toEqual({ version: null, configuration: draft(), warnings: [] });
        rows.set("branch:A:message_automation:past_trigger", JSON.stringify({ sendIntervalMinutes: 7, ruleOrder: ["sms-A"] }));
        expect(await service.getMessageAutomationPolicyConfig("A")).toEqual({ version: null, configuration: { ...draft(), pastSendIntervalMinutes: 7, pastRuleOrder: ["sms-A"] }, warnings: [] });
        expect(update.executeIfVersion).not.toHaveBeenCalled();
    });
    it("saves/reloads stable canonical JSON and rejects stale/null writes without changes", async () => {
        const config = { ...draft(), dispatchCheckIntervalMinutes: 7, defaultRuleSendTime: "11:30", pastRuleOrder: ["sms-A"] };
        const saved = await service.setMessageAutomationPolicyConfig("A", null, config);
        expect(saved.version).toMatch(/^[a-f0-9]{64}$/);
        expect(await service.getMessageAutomationPolicyConfig("A")).toEqual(saved);
        const before = rows.get(key);
        await expect(service.setMessageAutomationPolicyConfig("A", null, draft())).rejects.toMatchObject({ status: 409 });
        await expect(service.setMessageAutomationPolicyConfig("A", "a".repeat(64), draft())).rejects.toMatchObject({ status: 409 });
        expect(rows.get(key)).toBe(before);
        expect(update.executeIfVersion).toHaveBeenCalledTimes(1);
        expect(get.execute).toHaveBeenCalledWith(key, tx);
        expect(rules.findAll).toHaveBeenCalledWith("A", tx);
        expect(update.executeIfVersion.mock.calls[0]?.[5]).toBe(tx);
    });
    it.each(["sms-B", "inactive", "unknown", "alimtalk"])("rejects newly introduced invalid order entry %s", async id => {
        await expect(service.setMessageAutomationPolicyConfig("A", null, { ...draft(), pastRuleOrder: [id] })).rejects.toMatchObject({ status: 400 });
        expect(rows.size).toBe(0);
    });
    it("prunes stored inactive entries with warning and retains raw version until a successful save", async () => {
        rows.set(key, JSON.stringify({ ...draft(), pastRuleOrder: ["inactive", "sms-A"] }));
        const current = await service.getMessageAutomationPolicyConfig("A");
        expect(current.configuration.pastRuleOrder).toEqual(["sms-A"]);
        expect(current.warnings).toEqual([{ code: "ORDER_ENTRY_PRUNED", ruleId: "inactive" }]);
        const saved = await service.setMessageAutomationPolicyConfig("A", current.version, { ...draft(), pastRuleOrder: ["inactive", "sms-A"] });
        expect(saved.configuration.pastRuleOrder).toEqual(["sms-A"]);
        expect(saved.warnings).toEqual([{ code: "ORDER_ENTRY_PRUNED", ruleId: "inactive" }]);
        expect(saved.version).not.toBe(current.version);
    });
    it.each([
        ["dispatchCheckIntervalMinutes", 0], ["defaultRuleSendTime", "24:00"], ["triggerRetryIntervalMinutes", 1441],
        ["processingReclaimMinutes", 9], ["smsRetryIntervalMinutes", 1.5], ["pastExpiryHours", 721],
        ["pastSendIntervalMinutes", "1"], ["duplicateWindowHours", 0],
    ])("rejects invalid timing %s", async (field, value) => {
        await expect(service.setMessageAutomationPolicyConfig("A", null, { ...draft(), [field]: value })).rejects.toMatchObject({ status: 400 });
        expect(update.executeIfVersion).not.toHaveBeenCalled();
    });
    it("rejects quiet ON with no target, equal bounds, invalid timezone or duplicate groups", async () => {
        for (const quiet of [{ enabled: true, recipientGroups: [] }, { start: "08:00" }, { timezone: "UTC" }, { recipientGroups: ["CLIENT", "CLIENT"] }]) {
            await expect(service.setMessageAutomationPolicyConfig("A", null, { ...draft(), quietHours: { ...draft().quietHours, ...quiet } })).rejects.toMatchObject({ status: 400 });
        }
        expect(rows.size).toBe(0);
    });
    it("rejects one future provider reservation, then enables with zero using the SAME transaction", async () => {
        const config = { ...draft(), quietHours: { ...draft().quietHours, enabled: true } };
        logs.countFutureProviderReservations.mockResolvedValueOnce(1);
        await expect(service.setMessageAutomationPolicyConfig("A", null, config)).rejects.toMatchObject({ status: 409 });
        expect(rows.size).toBe(0);
        const saved = await service.setMessageAutomationPolicyConfig("A", null, config);
        expect(saved.configuration.quietHours.enabled).toBe(true);
        expect(logs.countFutureProviderReservations).toHaveBeenLastCalledWith("A", expect.any(Date), tx);
    });
    it.each(["{", "null", JSON.stringify({ ...draft(), schemaVersion: 2 }), ""])("fails closed on corrupt policy %s", async raw => {
        rows.set(key, raw);
        await expect(service.getMessageAutomationPolicyConfig("A")).rejects.toMatchObject({ status: 503 });
        await expect(service.setMessageAutomationPolicyConfig("A", null, draft())).rejects.toMatchObject({ status: 503 });
        expect(update.executeIfVersion).not.toHaveBeenCalled();
        expect(logs.countFutureProviderReservations).not.toHaveBeenCalled();
    });
    it("converts a caller-TX create conflict only after the lock exits, with no queries after failure", async () => {
        let lockExited = false;
        lock.runExclusive.mockImplementation(async (_branch: string, work: (transaction: unknown) => Promise<unknown>) => {
            try { return await work(tx); } finally { lockExited = true; }
        });
        update.executeIfVersion.mockRejectedValueOnce(Object.assign(new Error("first-create collision"), { code: "P2002" }));
        await expect(service.setMessageAutomationPolicyConfig("A", null, draft())).rejects.toMatchObject({ status: 409 });
        expect(lockExited).toBe(true);
        expect(get.execute).toHaveBeenCalledTimes(2);
        expect(update.executeIfVersion).toHaveBeenCalledTimes(1);
        expect(rows.size).toBe(0);
    });
    it("legacy adapter writes only the canonical key, preserving unrelated fields and safe stale conflict", async () => {
        const saved = await service.setMessageAutomationPolicyConfig("A", null, { ...draft(), smsRetryIntervalMinutes: 12 });
        await service.setMessageAutomationPastTriggerConfig("A", { sendIntervalMinutes: 7, ruleOrder: ["sms-A"] });
        expect(JSON.parse(rows.get(key)!)).toEqual({ ...saved.configuration, pastSendIntervalMinutes: 7, pastRuleOrder: ["sms-A"] });
        expect(rows.has("branch:A:message_automation:past_trigger")).toBe(false);
        expect(update.execute).not.toHaveBeenCalled();
        update.executeIfVersion.mockResolvedValueOnce(null);
        await expect(service.setMessageAutomationPastTriggerConfig("A", { sendIntervalMinutes: 8, ruleOrder: [] })).rejects.toMatchObject({ status: 409 });
    });
    it("counts all jobs/retries by due time and group with zero writes, including >200 jobs", async () => {
        const now = new Date("2026-11-04T13:00:00Z"); // 22:00 KST inclusive
        jobs.findPolicyPreviewCandidates.mockResolvedValue([
            ...Array.from({ length: 205 }, () => ({ dueAt: now, recipientGroups: ["CLIENT"], recipientPhone: null })),
            { dueAt: new Date("2026-11-04T23:00:00Z"), recipientGroups: ["CLIENT"], recipientPhone: null }, // 08:00 exclusive
            { dueAt: now, recipientGroups: ["CAREGIVER"], recipientPhone: null },
        ]);
        logs.findPolicyPreviewCandidates.mockResolvedValue([{ dueAt: now, recipientGroups: ["CLIENT", "STAFF"], recipientPhone: null }]);
        const config = { ...draft(), quietHours: { ...draft().quietHours, enabled: true, recipientGroups: ["CLIENT"] as "CLIENT"[] } };
        logs.countFutureProviderReservations.mockResolvedValue(1);
        expect(await service.previewMessageAutomationPolicyConfig("A", null, config, now)).toEqual({
            version: null, deferredCount: 206, canceledCount: 0, reevaluateAt: "2026-11-04T23:00:00.000Z", futureProviderReservations: 1, canEnableQuietHours: false, warnings: [],
        });
        config.quietHours.action = "CANCEL";
        expect(await service.previewMessageAutomationPolicyConfig("A", null, config, now)).toMatchObject({ deferredCount: 0, canceledCount: 206, reevaluateAt: null });
        expect(update.executeIfVersion).not.toHaveBeenCalled();
        expect(update.execute).not.toHaveBeenCalled();
        expect(lock.runExclusive).not.toHaveBeenCalled();
    });
});

describe("message quiet-hours pure evaluation", () => {
    const quiet = { enabled: true, start: "22:00", end: "08:00", recipientGroups: ["STAFF"] as "STAFF"[], action: "DEFER" as const, timezone: "Asia/Seoul" as const };
    it("unions overlapping recipient groups with inclusive start and exclusive end", () => {
        expect(evaluateMessageQuietHours(quiet, ["CLIENT", "STAFF"], new Date("2026-11-04T13:00:00Z"))).toEqual({ action: "DEFER", reevaluateAt: new Date("2026-11-04T23:00:00Z") });
        expect(evaluateMessageQuietHours(quiet, ["STAFF"], new Date("2026-11-04T22:59:59Z"))).toEqual({ action: "DEFER", reevaluateAt: new Date("2026-11-04T23:00:00Z") });
        expect(evaluateMessageQuietHours(quiet, ["STAFF"], new Date("2026-11-04T23:00:00Z"))).toEqual({ action: "ALLOW", reevaluateAt: null });
        expect(evaluateMessageQuietHours(quiet, ["CLIENT"], new Date("2026-11-04T13:00:00Z"))).toEqual({ action: "ALLOW", reevaluateAt: null });
        expect(evaluateMessageQuietHours({ ...quiet, enabled: false }, ["STAFF"], new Date("2026-11-04T13:00:00Z"))).toEqual({ action: "ALLOW", reevaluateAt: null });
    });
    it("handles same-day windows and CANCEL without inventing retry times", () => {
        expect(evaluateMessageQuietHours({ ...quiet, start: "09:00", end: "12:00" }, ["STAFF"], new Date("2026-11-04T00:00:00Z"))).toEqual({ action: "DEFER", reevaluateAt: new Date("2026-11-04T03:00:00Z") });
        expect(evaluateMessageQuietHours({ ...quiet, action: "CANCEL" }, ["STAFF"], new Date("2026-11-04T13:00:00Z"))).toEqual({ action: "CANCEL", reevaluateAt: null });
    });
});
