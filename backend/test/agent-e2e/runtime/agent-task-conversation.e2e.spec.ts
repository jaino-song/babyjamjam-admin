import { randomUUID } from "node:crypto";

import { AgentTaskCommandRequestSchema } from "@babyjamjam/shared";
import { ConversationTaskOrchestratorService } from "application/agent/conversation-task-orchestrator.service";
import { AgentTaskService } from "application/agent/agent-task.service";

/**
 * Parent-owned database/HTTP proof.  The worker must compile this contract
 * but never run it against a database.  The guarded invocation is intentionally
 * opt-in so ordinary agent-e2e runs cannot turn a compile-only fixture into a
 * product claim:
 *
 *   AGENT_E2E=1 AGENT_CONVERSATION_E2E=1 pnpm --filter ./backend run test:agent-e2e -- agent-task-conversation.e2e.spec.ts
 *
 * The parent supplies the approved DATABASE_URL and real Google runtime driver
 * before enabling that gate.  Missing product observations remain
 * `not_evaluated`; this file does not synthesize them.
 */
const describeConversationE2E = process.env["AGENT_E2E"] === "1" && process.env["AGENT_CONVERSATION_E2E"] === "1"
    ? describe
    : describe.skip;

describeConversationE2E("conversation task runtime against the guarded local database", () => {
    it("keeps the start-update command boundary strict for the parent harness", () => {
        const command = {
            clientEventId: randomUUID(),
            expectedRevision: 1,
            command: "start-update",
            targetRef: randomUUID(),
            expectedTargetVersion: "a".repeat(64),
        };
        expect(AgentTaskCommandRequestSchema.parse(command)).toEqual(command);
        // Type imports above are deliberate compile-time ownership checks for
        // the runtime seam; the guarded parent harness constructs the services
        // with its real repository and transport.
        expect(ConversationTaskOrchestratorService).toBeDefined();
        expect(AgentTaskService).toBeDefined();
    });
});
