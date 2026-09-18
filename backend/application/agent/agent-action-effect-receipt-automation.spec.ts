import { recordAgentActionEffect, readAgentActionEffect } from "./agent-action-effect-receipt";

const id = (n: number) => `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = "a".repeat(64);
const context = { actionId: id(1), principal: { userId: id(2), branchId: id(3), globalRole: "admin", branchRole: "admin" },
    sessionId: id(4), traceId: "receipt-test", locale: "ko" };
const metadata = { automation: { version: 1 as const, taskId: id(5), taskRevision: 2, questionRef: id(6),
    reviewedEffectDigest: digest, reviewedPolicyDigest: digest,
    authorities: [{ id: id(7), recordDigest: digest, scopeDigest: digest }] } };

function store() {
    let receipt: unknown;
    const updateMany = jest.fn(async ({ data }: { data: { effectReceipt: unknown } }) => {
        receipt = data.effectReceipt;
        return { count: 1 };
    });
    const findFirst = jest.fn(async () => ({ effectReceipt: receipt }));
    return { prisma: { agent_action: { updateMany, findFirst } }, updateMany, findFirst };
}

describe("private task automation effect receipt", () => {
    it("keeps the legacy receipt compatible and private references outside the public result", async () => {
        const { prisma, updateMany } = store();
        const legacy = await recordAgentActionEffect(prisma as never, context, "clients.create", "client", 11, { id: 11 });
        expect(legacy).not.toHaveProperty("metadata");
        const receipt = await recordAgentActionEffect(prisma as never, context, "clients.create", "client", 11, { id: 11 }, metadata);
        expect(receipt.result).toEqual({ id: 11 });
        expect(receipt.metadata).toEqual(metadata);
        expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({
            id: context.actionId, userId: context.principal.userId, branchId: context.principal.branchId,
            status: "executing", capability: "clients.create", taskId: id(5), taskRevision: 2,
        }) }));
        expect(await readAgentActionEffect(prisma as never, context, "clients.create")).toEqual(receipt);
    });

    it("rejects malformed or injected private references before a write", async () => {
        const { prisma, updateMany } = store();
        for (const changed of [
            { ...metadata, approved: true },
            { automation: { ...metadata.automation, phone: "01000000000" } },
            { automation: { ...metadata.automation, authorities: [] } },
            { automation: { ...metadata.automation, authorities: [...metadata.automation.authorities, ...metadata.automation.authorities] } },
        ]) {
            await expect(recordAgentActionEffect(prisma as never, context, "clients.create", "client", 11, { id: 11 }, changed)).rejects.toThrow();
        }
        expect(updateMany).not.toHaveBeenCalled();
    });

    it("refuses a private receipt if the executing action and reviewed task do not match", async () => {
        const { prisma, updateMany } = store();
        updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(recordAgentActionEffect(prisma as never, context, "clients.create", "client", 11, { id: 11 }, metadata))
            .rejects.toThrow("could not be persisted");
    });
});
