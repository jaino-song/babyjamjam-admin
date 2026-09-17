import type {
    AgentTask,
    AgentTaskCapabilityId,
    AgentTaskState,
} from "@babyjamjam/shared";
import type { AgentTaskAutomationState } from "./agent-automation-consent";

/**
 * The task row owns identity, lifecycle, revision and retention timestamps.
 * Editable values live in `draft`; none of those canonical row fields are
 * duplicated there.
 */
export interface AgentTaskDraft {
    confirmed: AgentTask["confirmed"];
    tentative: AgentTask["tentative"];
    clearedFields: AgentTask["clearedFields"];
    provenance: AgentTask["provenance"];
    issues: AgentTask["issues"];
    constraints: AgentTask["constraints"];
    choiceSets: AgentTask["choiceSets"];
    orderedChoiceRefs: AgentTask["orderedChoiceRefs"];
    consent: AgentTask["consent"];
    currentSnapshotRef: AgentTask["currentSnapshotRef"];
    server: AgentTaskProtectedState;
}

/**
 * Server-only mappings keep protected business IDs behind UUID references.
 * They are never copied into a safe/model part. Numeric client IDs are kept
 * here because the existing `client.id` column is an integer.
 */
export interface AgentTaskClientReference {
    targetRef: string;
    clientId: number;
}

export interface AgentTaskChoiceClientReference {
    choiceSetRef: string;
    optionId: string;
    clientId: number;
}

export interface AgentTaskPhoneCandidateReference {
    candidateRef: string;
    normalizedPhone: string;
    clientId?: number;
}

export interface AgentTaskServerReferences {
    target: AgentTaskClientReference | null;
    choiceTargets: AgentTaskChoiceClientReference[];
    phoneCandidates: Record<string, AgentTaskPhoneCandidateReference[]>;
}

/**
 * Fields needed by later phases to resolve a server-issued reference or to
 * attach an action. These are protected adapter state, not public task data.
 */
export interface AgentTaskProtectedState {
    references: AgentTaskServerReferences;
    actionExpectedRevision?: string;
    actionProposalRevision?: number;
    automation?: AgentTaskAutomationState;
}

export interface AgentTaskOwner {
    userId: string;
    branchId: string;
}

export interface AgentTaskEntity extends AgentTaskOwner {
    taskId: string;
    sessionId: string;
    capabilityId: AgentTaskCapabilityId;
    schemaVersion: AgentTask["schemaVersion"];
    revision: number;
    status: AgentTaskState;
    activeSlot: number | null;
    draft: AgentTaskDraft;
    targetRef: string | null;
    targetVersion: string | null;
    activeActionId: string | null;
    lastAcceptedAt: Date;
    expiresAt: Date;
    terminalAt: Date | null;
    purgedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface AgentTaskTombstone extends AgentTaskOwner {
    taskId: string;
    sessionId: string;
    expiresAt: Date;
    purgedAt: Date | null;
}

export interface AgentTaskEventEntity extends AgentTaskOwner {
    id: string;
    sessionId: string;
    clientEventId: string;
    taskId: string;
    operation: string;
    requestHash: string;
    acceptedRevision: number;
    resultActionId: string | null;
    acceptedAt: Date;
}

export function createEmptyAgentTaskDraft(currentSnapshotRef: string): AgentTaskDraft {
    return {
        confirmed: {},
        tentative: {},
        clearedFields: [],
        provenance: { confirmed: {}, tentative: {} },
        issues: [],
        constraints: { noSend: false },
        choiceSets: [],
        orderedChoiceRefs: [],
        consent: { choice: "unanswered", binding: null },
        currentSnapshotRef,
        server: {
            references: {
                target: null,
                choiceTargets: [],
                phoneCandidates: {},
            },
        },
    };
}

/**
 * Build the shared contract explicitly so protected server references cannot
 * escape through object spreading or accidental JSON serialization.
 */
export function toAgentTaskContract(entity: AgentTaskEntity): AgentTask {
    const target = entity.targetRef && entity.targetVersion
        ? {
            targetRef: entity.targetRef,
            version: entity.targetVersion,
        }
        : null;

    const action = entity.activeActionId && entity.draft.server.actionExpectedRevision
        ? {
            actionId: entity.activeActionId,
            expectedRevision: entity.draft.server.actionExpectedRevision,
            ...(entity.draft.server.actionProposalRevision === undefined
                ? {}
                : { proposalRevision: entity.draft.server.actionProposalRevision }),
        }
        : null;

    return {
        schemaVersion: entity.schemaVersion,
        taskId: entity.taskId,
        sessionId: entity.sessionId,
        kind: entity.capabilityId,
        capabilityId: entity.capabilityId,
        revision: entity.revision,
        state: entity.status,
        confirmed: entity.draft.confirmed,
        tentative: entity.draft.tentative,
        clearedFields: entity.draft.clearedFields,
        provenance: entity.draft.provenance,
        issues: entity.draft.issues,
        constraints: entity.draft.constraints,
        choiceSets: entity.draft.choiceSets,
        orderedChoiceRefs: entity.draft.orderedChoiceRefs,
        target,
        consent: entity.draft.consent,
        ...(entity.draft.server.automation ? { automation: entity.draft.server.automation.question } : {}),
        action,
        times: {
            createdAt: entity.createdAt.toISOString(),
            updatedAt: entity.updatedAt.toISOString(),
            acceptedAt: entity.lastAcceptedAt.toISOString(),
            ...(entity.terminalAt === null ? {} : { terminatedAt: entity.terminalAt.toISOString() }),
            expiresAt: entity.expiresAt.toISOString(),
        },
        currentSnapshotRef: entity.draft.currentSnapshotRef,
    };
}
