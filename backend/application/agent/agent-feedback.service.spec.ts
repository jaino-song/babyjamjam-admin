import { NotFoundException } from "@nestjs/common";

import type { AgentSessionOwner } from "domain/entities/agent-session.entity";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { AgentFeedbackService } from "./agent-feedback.service";

describe("AgentFeedbackService", () => {
    const owner: AgentSessionOwner = { userId: "user-a", branchId: "branch-a" };
    const input = { sessionId: "session-a", messageId: "message-a", type: "positive" as const };

    function createPrisma() {
        return {
            agent_message: {
                findFirst: jest.fn(),
            },
            agent_feedback: {
                upsert: jest.fn().mockResolvedValue({ id: "feedback-a", type: "positive", createdAt: new Date() }),
            },
        };
    }

    // The submit miss is a registered 404 problem body, not a raw English
    // string: the HTTP mapper replaces the text with catalog copy keyed on code.
    it("rejects a message outside the owned active session with a not-found problem body", async () => {
        const prisma = createPrisma();
        prisma.agent_message.findFirst.mockResolvedValue(null);
        const service = new AgentFeedbackService(prisma as unknown as PrismaService);

        const error: unknown = await service.submit(input, owner).then(
            () => { throw new Error("expected the service to reject"); },
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getStatus()).toBe(404);
        expect((error as NotFoundException).getResponse()).toMatchObject({ code: "RESOURCE_NOT_FOUND", outcome: "NOT_APPLIED" });
        expect(prisma.agent_feedback.upsert).not.toHaveBeenCalled();
    });

    it("upserts feedback bound to the resolved assistant message", async () => {
        const prisma = createPrisma();
        prisma.agent_message.findFirst.mockResolvedValue({ id: "message-a", traceId: "trace-a" });
        const service = new AgentFeedbackService(prisma as unknown as PrismaService);

        await expect(service.submit(input, owner)).resolves.toMatchObject({ id: "feedback-a" });
        expect(prisma.agent_feedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { messageId_userId: { messageId: "message-a", userId: owner.userId } },
            create: expect.objectContaining({ sessionId: "session-a", messageId: "message-a", traceId: "trace-a" }),
        }));
    });
});
