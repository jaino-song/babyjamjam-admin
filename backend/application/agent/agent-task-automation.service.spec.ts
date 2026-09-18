import { z } from "zod";
import { AgentTaskAutomationService, type AgentTaskAutomationSource } from "./agent-task-automation.service";
import { createEmptyAgentTaskDraft } from "domain/entities/agent-task.entity";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

const principal = { userId: "user-a", branchId: "branch-a" } as VerifiedTenantPrincipal;
const effect: AgentAutomationEffect = { kind: "client-rule", ruleId: "rule-a", scheduleId: null, recipientType: "client",
    templateKey: "SERVICE_INFO", change: "create", recipientDigest: "a".repeat(64), sourceDigest: "b".repeat(64),
    templateDigest: "c".repeat(64), policyDigest: "d".repeat(64), recipeDigest: "e".repeat(64) };
function fixture() {
    const task: AgentTaskAutomationSource = { taskId: "task-a", sessionId: "session-a", ...principal,
        capabilityId: "clients.create", targetRef: null, targetVersion: null,
        draft: createEmptyAgentTaskDraft("10000000-0000-4000-8000-000000000001") };
    task.draft.confirmed = { name: "합성 고객", phone: "01011112222" };
    const capability = {
        inputSchema: z.object({ name: z.string(), phone: z.string(), address: z.string().nullable().optional(),
            id: z.number().optional(), targetVersion: z.string().optional(), actualPrice: z.string().optional() }),
        canonicalizeInput: jest.fn(async (_context, input) => ({ ...input, actualPrice: "10000" })),
        planAutomationImpact: jest.fn().mockResolvedValue({ availability: "available", complete: true, effects: [effect] }),
    };
    const registry = { get: jest.fn().mockReturnValue(capability) };
    return { task, capability, registry, service: new AgentTaskAutomationService(registry as never) };
}

describe("capability-owned task automation evaluation", () => {
    it("uses canonical input, explicit clears and only the protected target; preserves equivalent references", async () => {
        const { task, capability, service } = fixture();
        task.capabilityId = "clients.update";
        task.targetRef = "target-a";
        task.targetVersion = "version-a";
        task.draft.server.references.target = { targetRef: "target-a", clientId: 7 };
        task.draft.clearedFields = ["address"];
        task.draft.tentative = { startDate: "다음 주" };
        const state = await service.evaluate(task, principal);
        expect(capability.planAutomationImpact).toHaveBeenCalledWith(expect.objectContaining({ principal }),
            { ...task.draft.confirmed, address: null, id: 7, targetVersion: "version-a", actualPrice: "10000" }, task.taskId);
        task.draft.server.automation = state;
        expect(await service.evaluate(task, principal)).toEqual(state);
        expect(JSON.stringify(state)).not.toContain("01011112222");
        expect(JSON.stringify(state)).not.toContain("합성 고객");
    });

    it("does not discover client data for foreign ownership, incomplete input or unresolved targets", async () => {
        for (const variant of ["foreign", "missing", "target"] as const) {
            const { task, capability, service } = fixture();
            if (variant === "foreign") task.branchId = "other";
            if (variant === "missing") delete task.draft.confirmed.name;
            if (variant === "target") task.capabilityId = "clients.update";
            expect((await service.evaluate(task, principal)).question.availability).toBe("unavailable");
            expect(capability.planAutomationImpact).not.toHaveBeenCalled();
            expect(capability.canonicalizeInput).not.toHaveBeenCalled();
        }
    });

    it("fails closed on incomplete, malformed or throwing providers without copying exception text", async () => {
        const { task, capability, service } = fixture();
        for (const result of [
            { complete: false, availability: "none", effects: [] },
            { complete: false, availability: "available", effects: [effect] },
            { complete: true, availability: "none", effects: [effect] },
            { complete: true, availability: "available", effects: [{ ...effect, phone: "01011112222" }] },
        ]) {
            capability.planAutomationImpact.mockResolvedValueOnce(result);
            expect((await service.evaluate(task, principal)).question).toMatchObject({ availability: "unavailable", reason: "source-unavailable" });
        }
        capability.canonicalizeInput.mockRejectedValueOnce(new Error("private provider context"));
        expect(JSON.stringify(await service.evaluate(task, principal))).not.toContain("private provider context");
    });

    it("distinguishes no applicable effects from unavailable effects and preserves the finite reason", async () => {
        const { task, capability, service } = fixture();
        capability.planAutomationImpact.mockResolvedValueOnce({ complete: true, availability: "none", effects: [] });
        expect((await service.evaluate(task, principal)).question.availability).toBe("none");
        capability.planAutomationImpact.mockResolvedValueOnce({ complete: false, availability: "unavailable", reason: "missing-default-rules", effects: [] });
        expect((await service.evaluate(task, principal)).question).toMatchObject({ availability: "unavailable", reason: "missing-default-rules" });
    });
});
