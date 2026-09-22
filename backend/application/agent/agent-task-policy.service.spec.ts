import { ForbiddenException } from "@nestjs/common";

import { AgentTaskPolicyService, agentTaskRoleMatchesCapability } from "./agent-task-policy.service";

const principal = {
    userId: "user-1",
    branchId: "branch-1",
    globalRole: "admin",
    branchRole: "manager",
};
const capability = {
    name: "clients.create",
    domain: "clients",
    version: "1.0.0",
    description: "Create",
    risk: "reversible-write" as const,
    requiredRoles: ["owner", "admin", "manager"],
    renderer: "action-proposal" as const,
    flagKey: "agent.capability.clients.create",
    sideEffect: true,
    approvalPolicy: "structured" as const,
    idempotencyPolicy: "action-id" as const,
};

function policyWith(snapshot: Record<string, unknown>, enabled = true) {
    const flags = {
        getSnapshot: jest.fn().mockResolvedValue({
            config: {
                enabled,
                rolloutStage: "development",
                domains: {},
                capabilities: { "conversation.tasks": true },
                risks: {},
                branchAllowlist: [],
                userAllowlist: [],
                ...snapshot,
            },
            emergencyDisabled: false,
        }),
        isCapabilityEnabledFromSnapshot: jest.fn().mockReturnValue(enabled),
    };
    const registry = { get: jest.fn().mockReturnValue({ meta: capability }) };
    return { service: new AgentTaskPolicyService(flags as never, registry as never), flags, registry };
}

describe("AgentTaskPolicyService", () => {
    it("requires the explicit conversation.tasks flag in addition to the capability gate", async () => {
        const { service } = policyWith({ capabilities: {} });

        await expect(service.assertCanCreate(principal, "clients.create")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("keeps emergency and rollout/operational gates on create", async () => {
        const disabled = policyWith({}, false);
        await expect(disabled.service.assertCanCreate(principal, "clients.create")).rejects.toBeInstanceOf(ForbiddenException);

        const emergency = policyWith({});
        emergency.flags.getSnapshot.mockResolvedValueOnce({
            config: {
                enabled: true,
                rolloutStage: "development",
                domains: {},
                capabilities: { "conversation.tasks": true },
                risks: {},
                branchAllowlist: [],
                userAllowlist: [],
            },
            emergencyDisabled: true,
        });
        emergency.flags.isCapabilityEnabledFromSnapshot.mockReturnValueOnce(false);
        await expect(emergency.service.assertCanCreate(principal, "clients.create")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows owned draft patches when operational flags are rolled back", () => {
        const { service } = policyWith({});
        expect(service.assertCanPatch(principal, "clients.create")).toEqual(capability);
    });

    it("rejects a patch when the current branch role is not required", () => {
        const { service } = policyWith({});
        expect(() => service.assertCanPatch({ ...principal, branchRole: "user" }, "clients.create"))
            .toThrow(ForbiddenException);
    });

    it("uses the exact owner-or-branch-role rule", () => {
        expect(agentTaskRoleMatchesCapability({ requiredRoles: ["owner"] }, { globalRole: "owner", branchRole: "user" })).toBe(true);
        expect(agentTaskRoleMatchesCapability({ requiredRoles: ["owner"] }, { globalRole: "admin", branchRole: "manager" })).toBe(false);
        expect(agentTaskRoleMatchesCapability({ requiredRoles: ["manager"] }, { globalRole: "owner", branchRole: "manager" })).toBe(false);
    });
});
