import { AgentTraceService } from "./agent-trace.service";
import { DECISION_KINDS, DECISION_MODES, DECISION_STATUSES, type DecisionTraceEventV1 } from "./decision/decision-contracts";

function makeDecisionEvent(overrides: Partial<DecisionTraceEventV1> = {}): DecisionTraceEventV1 {
    return {
        kind: "semantic-decision-v1",
        decisionKind: DECISION_KINDS.routeDomains,
        mode: DECISION_MODES.shadow,
        model: "jev-1.13.0",
        profileVersion: "profile-v1",
        questionVersion: "v1",
        labels: ["clients"],
        scores: [0.9],
        latencyMs: 42,
        outcome: DECISION_STATUSES.accepted,
        reason: null,
        disagreement: null,
        usage: { inputTokens: 10, outputTokens: 5 },
        missing: false,
        droppedReason: null,
        ...overrides,
    };
}

describe("AgentTraceService", () => {
    it("keeps trace completion scoped to the originating user and branch", async () => {
        const prisma = {
            agent_trace: {
                create: jest.fn().mockResolvedValue(undefined),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new AgentTraceService(prisma as never);
        const trace = await service.start("session-a", {
            userId: "user-a",
            branchId: "branch-a",
            globalRole: "admin",
            branchRole: "admin",
        }, "gemini-3.5-flash-lite", "release-a.1", ["clients"]);

        await service.finish(trace, "succeeded");

        expect(prisma.agent_trace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: trace.id, userId: "user-a", branchId: "branch-a" },
        }));
    });

    it("persists the legacy finish data shape unchanged when no decision events are given", async () => {
        const prisma = {
            agent_trace: {
                create: jest.fn().mockResolvedValue(undefined),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new AgentTraceService(prisma as never);
        const trace = await service.start("session-a", {
            userId: "user-a",
            branchId: "branch-a",
            globalRole: "admin",
            branchRole: "admin",
        }, "gemini-3.5-flash-lite", "release-a.1", ["clients"]);

        const stepMetadata = [{ capability: "clients.search", version: "1.0.0", risk: "read" }];
        await service.finish(trace, "failed", { totalTokens: 120 }, "provider", stepMetadata);

        expect(prisma.agent_trace.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.agent_trace.updateMany).toHaveBeenCalledWith({
            where: { id: trace.id, userId: "user-a", branchId: "branch-a" },
            data: {
                outcome: "failed",
                usage: { totalTokens: 120 },
                errorCategory: "provider",
                stepMetadata,
                latencyMs: expect.any(Number),
                finishedAt: expect.any(Date),
            },
        });
    });

    it("merges decision events into stepMetadata while keeping the owner-scoped where", async () => {
        const prisma = {
            agent_trace: {
                create: jest.fn().mockResolvedValue(undefined),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new AgentTraceService(prisma as never);
        const trace = await service.start("session-a", {
            userId: "user-a",
            branchId: "branch-a",
            globalRole: "admin",
            branchRole: "admin",
        }, "gemini-3.5-flash-lite", "release-a.1", ["clients"]);

        const stepMetadata = [{ capability: "clients.search", version: "1.0.0", risk: "read" }];
        const decisionEvents = [
            makeDecisionEvent(),
            makeDecisionEvent({ decisionKind: DECISION_KINDS.classifyClientIntent, labels: ["create", "read"], scores: [0.8, 0.1] }),
        ];
        await service.finish(trace, "succeeded", { totalTokens: 120 }, undefined, stepMetadata, decisionEvents);

        expect(prisma.agent_trace.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.agent_trace.updateMany).toHaveBeenCalledWith({
            where: { id: trace.id, userId: "user-a", branchId: "branch-a" },
            data: {
                outcome: "succeeded",
                usage: { totalTokens: 120 },
                errorCategory: undefined,
                stepMetadata: [...stepMetadata, ...decisionEvents],
                latencyMs: expect.any(Number),
                finishedAt: expect.any(Date),
            },
        });
    });

    it("drops invalid decision events instead of persisting them", async () => {
        const prisma = {
            agent_trace: {
                create: jest.fn().mockResolvedValue(undefined),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new AgentTraceService(prisma as never);
        const trace = await service.start("session-a", {
            userId: "user-a",
            branchId: "branch-a",
            globalRole: "admin",
            branchRole: "admin",
        }, "gemini-3.5-flash-lite", "release-a.1", ["clients"]);

        const stepMetadata = [{ capability: "clients.search", version: "1.0.0", risk: "read" }];
        const invalid = { ...makeDecisionEvent(), scores: [Number.NaN] } as unknown as DecisionTraceEventV1;
        await service.finish(trace, "succeeded", undefined, undefined, stepMetadata, [invalid, makeDecisionEvent()]);

        expect(prisma.agent_trace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: trace.id, userId: "user-a", branchId: "branch-a" },
            data: expect.objectContaining({
                stepMetadata: [...stepMetadata, makeDecisionEvent()],
            }),
        }));
    });
});
