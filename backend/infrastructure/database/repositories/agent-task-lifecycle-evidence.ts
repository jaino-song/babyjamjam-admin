export interface AgentTaskLifecycleTaskEvidence {
    id: string;
    sessionId: string;
    userId: string;
    branchId: string;
    activeActionId: string | null;
}

export interface AgentTaskLifecycleActionEvidence {
    id: string;
    taskId: string | null;
    sessionId: string;
    userId: string;
    branchId: string;
    status: string;
    expiresAt: Date;
    resultPartPersistedAt: Date | null;
}

const TERMINAL_ACTION_STATUSES = new Set(["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"]);

/**
 * Retention must fail closed for an action whose lifecycle is still capable
 * of producing work or whose terminal result has not reached the transcript.
 * Unknown states are retained until a later adapter understands them.
 */
export function lifecycleActionBlocks(action: AgentTaskLifecycleActionEvidence | null, now: Date): boolean {
    if (action === null) return true;
    if (action.status === "executing" || action.status === "uncertain") return true;
    if (action.status === "proposed" || action.status === "approved") return action.expiresAt > now;
    if (TERMINAL_ACTION_STATUSES.has(action.status)) return action.resultPartPersistedAt === null;
    return true;
}

function sameOwnerAndSession(task: AgentTaskLifecycleTaskEvidence, action: AgentTaskLifecycleActionEvidence): boolean {
    return action.sessionId === task.sessionId
        && action.userId === task.userId
        && action.branchId === task.branchId;
}

/**
 * Validate both directions of the task/action relationship before destructive
 * lifecycle operations. A current forward link must be present and point back
 * to the same task and scope. Historical reverse links may remain when they
 * are already expired proposals or persisted, non-uncertain terminal results;
 * every other reverse link is retained conservatively.
 */
export function lifecycleTaskActionEvidenceBlocks(
    task: AgentTaskLifecycleTaskEvidence,
    actions: readonly AgentTaskLifecycleActionEvidence[],
    now: Date,
): boolean {
    const forward = task.activeActionId;
    if (forward !== null) {
        const current = actions.find((action) => action.id === forward);
        if (!current || !sameOwnerAndSession(task, current) || current.taskId !== task.id) return true;
        if (lifecycleActionBlocks(current, now)) return true;
    }

    for (const action of actions) {
        if (action.taskId !== task.id) continue;
        if (!sameOwnerAndSession(task, action)) return true;
        if (action.id === forward) continue;
        if (lifecycleActionBlocks(action, now)) return true;
    }
    return false;
}
