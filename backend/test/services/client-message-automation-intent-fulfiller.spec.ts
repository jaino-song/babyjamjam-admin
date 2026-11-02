import { fulfillClientMessageAutomationIntent } from "application/services/client-message-automation-intent-fulfiller";
import { isEntityChangeHintsSuppressed } from "infrastructure/database/entity-change-suppression";

describe("fulfillClientMessageAutomationIntent realtime hints", () => {
    const setup = (approvals: string[] = ["approved", "approved"]) => {
        const observed: string[] = [];
        const branchStatuses = [...approvals];
        const prisma = {
            $queryRaw: jest.fn().mockImplementation(async () => {
                observed.push(`claim:${isEntityChangeHintsSuppressed()}`);
                return [{ id: "intent-1", scheduled_for: new Date("2026-08-20T01:02:03.000Z") }];
            }),
            branch: {
                findUnique: jest.fn().mockImplementation(async () => ({ smsSenderApprovalStatus: branchStatuses.shift() ?? "approved" })),
            },
            message_trigger_job: {
                updateMany: jest.fn().mockImplementation(async () => {
                    observed.push(`release:${isEntityChangeHintsSuppressed()}`);
                    return { count: 1 };
                }),
                deleteMany: jest.fn().mockImplementation(async () => {
                    observed.push(`delete:${isEntityChangeHintsSuppressed()}`);
                    return { count: 1 };
                }),
            },
        };
        const triggerService = {
            ensureDefaultRulesForBranch: jest.fn().mockImplementation(async () => {
                observed.push(`defaults:${isEntityChangeHintsSuppressed()}`);
            }),
            syncClientRulesForClient: jest.fn().mockImplementation(async () => {
                observed.push(`sync:${isEntityChangeHintsSuppressed()}`);
            }),
        };
        const run = () => fulfillClientMessageAutomationIntent({
            prisma: prisma as never,
            triggerService: triggerService as never,
            branchId: "branch-1",
            clientId: 7,
            includePast: false,
            suppressGreeting: false,
        });
        return { prisma, triggerService, observed, run };
    };

    it("suppresses the lease claim but announces the fulfilment's own writes and the delete", async () => {
        const { run, observed } = setup();
        await expect(run()).resolves.toBe(true);
        expect(observed).toEqual(["claim:true", "defaults:false", "sync:false", "delete:false"]);
    });

    it("suppresses the lease release when generation fails", async () => {
        const { run, observed, triggerService } = setup();
        triggerService.syncClientRulesForClient.mockImplementation(async () => {
            observed.push(`sync:${isEntityChangeHintsSuppressed()}`);
            throw new Error("generation failed");
        });
        await expect(run()).rejects.toThrow("generation failed");
        expect(observed).toEqual(["claim:true", "defaults:false", "sync:false", "release:true"]);
    });

    it("suppresses the release that resets the stable batch when the branch is no longer approved", async () => {
        const { run, observed, prisma } = setup(["pending"]);
        await expect(run()).resolves.toBe(false);
        expect(observed).toEqual(["claim:true", "release:true"]);
        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ attempts: 0 }),
        }));
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
    });
});
