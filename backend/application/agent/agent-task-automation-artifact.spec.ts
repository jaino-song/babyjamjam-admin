import { randomUUID } from "node:crypto";
import type { AgentCapabilityMeta } from "@babyjamjam/shared";
import type { AgentActionEntity } from "domain/entities/agent-action.entity";
import { createEmptyAgentTaskDraft, type AgentTaskEntity } from "domain/entities/agent-task.entity";
import type { ClientAutomationImpact } from "domain/ports/client-automation-impact.port";
import { agentBindingHash, agentLinkedProposalRevision } from "domain/repositories/agent-linked-action.types";
import { ActionCoordinatorService } from "./action-coordinator.service";
import { AgentActionController } from "interface/controllers/agent-action.controller";
import { answerAgentAutomationQuestion, createAgentAutomationQuestion } from "./agent-automation-question";
import { canonicalTaskAutomationImpact, parseTaskAutomationArtifact, prepareTaskAutomationArtifact,
    TASK_AUTOMATION_ARTIFACT_KEY, taskAutomationEffectiveMeta, taskAutomationFromAction, taskAutomationPublicSummary } from "./agent-task-automation-artifact";

const meta: AgentCapabilityMeta = { name: "clients.create", domain: "clients", version: "1.0.0", description: "Synthetic create",
    risk: "reversible-write", requiredRoles: ["manager"], renderer: "action-proposal", flagKey: "agent.capability.clients.create",
    sideEffect: true, approvalPolicy: "structured", idempotencyPolicy: "action-id" };

function fixture(choice: "yes" | "no" | "unanswered" = "yes", availability: "available" | "none" = "available") {
    const impact: ClientAutomationImpact = { availability, complete: true, clientIdentity: null, sourceGuard: "f".repeat(64), affectedJobs: [],
        effects: availability === "none" ? [] : [{ kind: "client-rule", ruleId: "synthetic-rule", scheduleId: null,
            recipientType: "client", templateKey: "SERVICE_INFO", change: "create", recipientDigest: "a".repeat(64),
            sourceDigest: "b".repeat(64), templateDigest: "c".repeat(64), policyDigest: "d".repeat(64), recipeDigest: "e".repeat(64) }] };
    const question = createAgentAutomationQuestion(impact);
    const answer = answerAgentAutomationQuestion({ choice, presented: question, current: question, noSend: false, clientEventId: randomUUID() });
    if (answer.status !== "accepted") throw new Error("Invalid fixture");
    const draft = createEmptyAgentTaskDraft(randomUUID());
    draft.confirmed = { name: "SYNTHETIC_PRIVATE_NAME", phone: "01012345678" };
    draft.server.automation = { version: 1, question, effects: impact.effects, noSendAtPresentation: false };
    draft.consent = answer.consent;
    const task = { taskId: randomUUID(), sessionId: randomUUID(), userId: randomUUID(), branchId: randomUUID(),
        capabilityId: "clients.create", revision: 3, targetRef: null, targetVersion: null, draft } as AgentTaskEntity;
    const artifact = prepareTaskAutomationArtifact(task, randomUUID(), draft.confirmed, impact);
    const effective = taskAutomationEffectiveMeta(meta, artifact);
    const action = { id: artifact.actionId, taskId: task.taskId, taskRevision: artifact.taskRevision, sessionId: task.sessionId,
        userId: task.userId, branchId: task.branchId, capability: task.capabilityId, capabilityVersion: meta.version,
        inputHash: artifact.inputHash, targetVersion: null, targetSnapshot: null, risk: effective.risk, status: "proposed",
        expiresAt: new Date(Date.now() + 60_000), authorizationContext: { approvalPolicy: effective.approvalPolicy },
        proposal: { input: draft.confirmed, [TASK_AUTOMATION_ARTIFACT_KEY]: artifact, automation: taskAutomationPublicSummary(artifact) },
    } as unknown as AgentActionEntity;
    action.proposalRevision = agentLinkedProposalRevision(task.taskId, artifact.taskRevision, action);
    return { task, impact, artifact, action };
}

describe("private task automation review artifact", () => {
    it("binds the whole question and normalized input to one owned action/revision and strengthens positive approval", () => {
        const { artifact, action } = fixture();
        expect(taskAutomationFromAction(action, meta)).toEqual(artifact);
        expect(taskAutomationEffectiveMeta(meta, artifact)).toMatchObject({ risk: "external-side-effect", approvalPolicy: "strong" });
        expect(meta).toMatchObject({ risk: "reversible-write", approvalPolicy: "structured" });
        expect(JSON.stringify(artifact)).not.toMatch(/SYNTHETIC_PRIVATE_NAME|01012345678/);
    });

    it("retains write policy for no/noSend/no-effect without reviving a yes", () => {
        const denied = fixture("no");
        expect(taskAutomationEffectiveMeta(meta, denied.artifact)).toEqual(meta);
        const empty = fixture("unanswered", "none");
        expect(taskAutomationEffectiveMeta(meta, empty.artifact)).toEqual(meta);
        const suppressed = fixture();
        suppressed.task.draft.constraints.noSend = true;
        suppressed.task.draft.server.automation!.noSendAtPresentation = true;
        const artifact = prepareTaskAutomationArtifact(suppressed.task, randomUUID(), suppressed.task.draft.confirmed, suppressed.impact);
        expect(artifact.consent).toEqual({ choice: "no", binding: null });
        expect(taskAutomationEffectiveMeta(meta, artifact)).toEqual(meta);
    });

    it("refuses stale effects, missing/incomplete question and a non-empty unanswered review", () => {
        const { task, impact } = fixture();
        const prepare = (value: ClientAutomationImpact) => prepareTaskAutomationArtifact(task, randomUUID(), task.draft.confirmed, value);
        expect(() => prepare({ ...impact, complete: false })).toThrow();
        expect(() => prepare({ ...impact, effects: [{ ...impact.effects[0]!, policyDigest: "9".repeat(64) }] })).toThrow();
        task.draft.consent = { choice: "unanswered", binding: null };
        expect(() => prepare(impact)).toThrow();
        delete task.draft.server.automation;
        expect(() => prepare(impact)).toThrow();
    });

    it.each(["owner", "action", "revision", "input", "risk", "policy", "summary", "unknown"])("refuses changed %s binding", (changed) => {
        const { action } = fixture();
        if (changed === "owner") action.userId = randomUUID();
        if (changed === "action") action.id = randomUUID();
        if (changed === "revision") action.taskRevision!++;
        if (changed === "input") action.proposal["input"] = { name: "replacement" };
        if (changed === "risk") action.risk = "reversible-write";
        if (changed === "policy") action.authorizationContext["approvalPolicy"] = "structured";
        if (changed === "summary") action.proposal["automation"] = { choice: "no" };
        if (changed === "unknown") (action.proposal[TASK_AUTOMATION_ARTIFACT_KEY] as Record<string, unknown>)["extra"] = true;
        action.proposalRevision = agentLinkedProposalRevision(action.taskId!, action.taskRevision!, action);
        expect(taskAutomationFromAction(action, meta)).toBeNull();
    });

    it("canonicalizes affected job order but rejects duplicate IDs and malformed private records", () => {
        const { artifact, impact } = fixture();
        const jobs = [{ id: randomUUID(), version: "1".repeat(64) }, { id: randomUUID(), version: "2".repeat(64) }];
        expect(agentBindingHash(canonicalTaskAutomationImpact({ ...impact, affectedJobs: jobs })))
            .toBe(agentBindingHash(canonicalTaskAutomationImpact({ ...impact, affectedJobs: [...jobs].reverse() })));
        expect(() => canonicalTaskAutomationImpact({ ...impact, affectedJobs: [jobs[0], jobs[0]] })).toThrow();
        expect(parseTaskAutomationArtifact({ ...artifact, impact: { ...impact, sourceGuard: "invalid" } })).toBeNull();
        expect(parseTaskAutomationArtifact({ ...artifact, consent: { choice: "yes", binding: null } })).toBeNull();
    });

    it("projects every action HTTP response without private recipes or committed receipt metadata", async () => {
        const { action } = fixture();
        action.authorizationContext["effectReceipt"] = { metadata: { automation: { authorities: ["PRIVATE_AUTHORITY"] } } };
        const coordinator = new ActionCoordinatorService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
        const controller = new AgentActionController({ publicAction: coordinator.publicAction.bind(coordinator),
            list: async () => [action], get: async () => action, approve: async () => ({ action, result: { status: "saved" } }),
            reject: async () => action, reconcile: async () => action } as never);
        const request = { tenant: { userId: action.userId, branchId: action.branchId } } as never;
        const results = [await controller.list(request), await controller.get(action.id, request),
            await controller.approve(action.id, { expectedRevision: action.proposalRevision }, request),
            await controller.reject(action.id, {}, request), await controller.reconcile(action.id, request)];
        for (const result of results) expect(JSON.stringify(result)).not.toMatch(/_taskAutomation|effectReceipt|sourceGuard|affectedJobs|consentEventId|clientIdentity|PRIVATE_AUTHORITY/);
        expect(coordinator.publicAction(action).acknowledgementToken).toHaveLength(64);
        expect(coordinator.publicAction(action).proposal["automation"]).toEqual(action.proposal["automation"]);
    });
});
