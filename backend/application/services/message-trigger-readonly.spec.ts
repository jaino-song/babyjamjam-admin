import { ClientAutomationSourceReader } from "./client-automation-source.reader";
import { MessageTriggerService } from "./message-trigger.service";
import { MessageExternalAgentCapabilitiesProvider } from "application/usecases/message/message-external-agent-capabilities.provider";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";

const branchId = "branch-readonly";
const context = { principal: { userId: "user-readonly", branchId, globalRole: "admin", branchRole: "admin" },
    sessionId: "session-readonly", traceId: "trace-readonly", locale: "ko" };

function rule(id: string, branch: string | null, active = true) {
    const now = new Date("2026-09-17T00:00:00.000Z");
    return MessageTriggerRuleEntity.reconstitute(id, branch, "합성 규칙", active,
        MessageTriggerEventType.SERVICE_START, MessageTriggerOffsetType.BEFORE_DAYS, 7,
        MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.SERVICE_INFO, now, now);
}

function setup(rules: MessageTriggerRuleEntity[], parentEnabled = true, schemaPresent = true) {
    const forbiddenWrite = jest.fn(() => { throw new Error("read capability attempted a write"); });
    const ruleRepository = { findAll: jest.fn().mockResolvedValue(rules), create: forbiddenWrite, update: forbiddenWrite };
    const prisma = { $transaction: forbiddenWrite, $executeRaw: forbiddenWrite,
        message_trigger_job: { create: forbiddenWrite, upsert: forbiddenWrite },
        message_trigger_rule: { create: forbiddenWrite, upsert: forbiddenWrite },
        message_log: { create: forbiddenWrite } };
    const jobRepository = { save: forbiddenWrite, upsertPending: forbiddenWrite };
    const senderApproval = { isApproved: jest.fn().mockResolvedValue(true),
        getApprovedBranches: jest.fn().mockResolvedValue(new Map([[branchId, new Date("2026-09-01T00:00:00Z")]])) };
    const overrides = { findAllByBranch: jest.fn().mockResolvedValue([{ ruleId: "global-disabled-in-branch", isActive: false }]) };
    const activation = { getTriggerDispatchEnabled: jest.fn().mockResolvedValue(parentEnabled) };
    const sources = new ClientAutomationSourceReader(prisma as never, ruleRepository as never, overrides as never, senderApproval as never,
        undefined, activation as never);
    jest.spyOn(sources, "hasTriggerSchema").mockResolvedValue(schemaPresent);
    const trigger = new MessageTriggerService(prisma as never, {} as never, senderApproval as never,
        ruleRepository as never, jobRepository as never, {} as never, {} as never, {} as never,
        undefined, overrides as never, activation as never, undefined, sources);
    const provider = new MessageExternalAgentCapabilitiesProvider(prisma as never, trigger,
        jobRepository as never, {} as never, senderApproval as never);
    const capability = provider.getCapabilities().find(({ meta }) => meta.name === "automation.list")!;
    return { capability, trigger, ruleRepository, forbiddenWrite, senderApproval, overrides };
}

describe("automation.list side-effect-free rule resolution", () => {
    it("preserves the legacy empty result when the trigger schema is unavailable", async () => {
        const { capability, ruleRepository, forbiddenWrite, senderApproval } = setup([], true, false);
        expect(await capability.execute(context, {})).toEqual({ rules: [] });
        expect(ruleRepository.findAll).not.toHaveBeenCalled();
        expect(forbiddenWrite).not.toHaveBeenCalled();
        expect(senderApproval.isApproved).not.toHaveBeenCalled();
    });

    it("returns an uninitialized branch without provisioning defaults or delivery jobs", async () => {
        const { capability, forbiddenWrite, ruleRepository, senderApproval } = setup([]);
        expect(await capability.execute(context, {})).toEqual({ rules: [] });
        expect(ruleRepository.findAll).toHaveBeenCalledWith(branchId);
        expect(forbiddenWrite).not.toHaveBeenCalled();
        expect(senderApproval.isApproved).not.toHaveBeenCalled();
    });

    it("retains persisted branch rules and applies effective global overrides", async () => {
        const { capability, forbiddenWrite, overrides } = setup([
            rule("branch-active", branchId), rule("branch-off", branchId, false),
            rule("global-disabled-in-branch", null), rule("global-off", null, false), rule("global-active", null),
        ]);
        const result = await capability.execute(context, {}) as { rules: Array<{ id: string; isActive: boolean }> };
        expect(result.rules.map(({ id, isActive }) => [id, isActive])).toEqual([
            ["branch-active", true], ["branch-off", false], ["global-disabled-in-branch", false],
            ["global-off", false], ["global-active", true],
        ]);
        expect(overrides.findAllByBranch).toHaveBeenCalledWith(branchId);
        expect(forbiddenWrite).not.toHaveBeenCalled();
    });

    it("reports every rule inactive while the parent policy is disabled", async () => {
        const { capability, forbiddenWrite } = setup([rule("branch-active", branchId), rule("global-active", null)], false);
        const result = await capability.execute(context, {}) as { rules: Array<{ isActive: boolean }> };
        expect(result.rules.map(({ isActive }) => isActive)).toEqual([false, false]);
        expect(forbiddenWrite).not.toHaveBeenCalled();
    });

    it("reports missing branch defaults without mistaking global bookkeeping for a provisioned rule", async () => {
        const global = rule("system:message_automation_intent", null);
        global.templateKey = MessageTriggerTemplateKey.CLIENT_GREETING;
        const { trigger, forbiddenWrite } = setup([rule("local-info", branchId), global]);
        expect(await trigger.readClientAutomationSettings(branchId)).toMatchObject({ status: "available",
            defaultsPresent: false, dispatchEnabled: true, senderApproved: true, senderApprovedAt: new Date("2026-09-01T00:00:00Z") });
        expect(forbiddenWrite).not.toHaveBeenCalled();
    });

    it("uses the same template-only default matching as ordinary provisioning, respecting inactive edited defaults", async () => {
        const greeting = rule("local-greeting", branchId, false);
        greeting.templateKey = MessageTriggerTemplateKey.CLIENT_GREETING;
        const { trigger, forbiddenWrite, senderApproval } = setup([rule("local-info", branchId), greeting], false);
        senderApproval.getApprovedBranches.mockResolvedValue(new Map());
        expect(await trigger.readClientAutomationSettings(branchId)).toMatchObject({ status: "available",
            defaultsPresent: true, dispatchEnabled: false, senderApproved: false, senderApprovedAt: null });
        expect(forbiddenWrite).not.toHaveBeenCalled();
    });

    it("distinguishes unavailable storage from an intentionally inactive empty ruleset", async () => {
        const { trigger, forbiddenWrite, ruleRepository, senderApproval } = setup([], true, false);
        expect(await trigger.readClientAutomationSettings(branchId)).toEqual({ status: "unavailable" });
        expect(ruleRepository.findAll).not.toHaveBeenCalled();
        expect(senderApproval.getApprovedBranches).not.toHaveBeenCalled();
        expect(forbiddenWrite).not.toHaveBeenCalled();
    });
});
