import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { agentAutomationConcreteJobDigest } from "./agent-automation-job-binding";
import { parseAgentAutomationJobSeal } from "application/agent/agent-automation-storage.schema";

/** Digest-only fields copied into SMS log variables for automatic retry fencing. */
export const AUTOMATION_RETRY_SEAL_VARIABLES = {
    authorityId: "automationAuthorityId",
    authorityDigest: "automationAuthorityDigest",
    sealDigest: "automationSealDigest",
    concreteJobDigest: "automationConcreteJobDigest",
    scopeDigest: "automationScopeDigest",
    reviewedEffectDigest: "automationReviewedEffectDigest",
    snapshotHash: "automationSnapshotHash",
} as const;

const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AutomationRetrySealState =
    | { kind: "legacy" }
    | { kind: "invalid"; reason: string }
    | { kind: "valid"; authorityId: string; authorityDigest: string; sealDigest: string;
        concreteJobDigest: string; scopeDigest: string; reviewedEffectDigest: string; snapshotHash: string };

/**
 * Build an opaque retry association from the already persisted job seal.
 * Raw recipients, message bodies and template variables are deliberately
 * excluded from the returned log fields.
 */
export function buildAutomationRetrySealVariables(
    job: MessageTriggerJobEntity,
    snapshotHash: string,
): Record<string, string> {
    const rawSeal = (job.payload as unknown as Record<string, unknown>)[AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY];
    const seal = parseAgentAutomationJobSeal(rawSeal);
    if (!seal || agentAutomationConcreteJobDigest(job) !== seal.concreteJobDigest || !DIGEST.test(snapshotHash)) return {};
    return {
        [AUTOMATION_RETRY_SEAL_VARIABLES.authorityId]: seal.authorityId,
        [AUTOMATION_RETRY_SEAL_VARIABLES.authorityDigest]: seal.authorityDigest,
        [AUTOMATION_RETRY_SEAL_VARIABLES.sealDigest]: agentBindingHash(seal),
        [AUTOMATION_RETRY_SEAL_VARIABLES.concreteJobDigest]: seal.concreteJobDigest,
        [AUTOMATION_RETRY_SEAL_VARIABLES.scopeDigest]: agentBindingHash(seal.scope),
        [AUTOMATION_RETRY_SEAL_VARIABLES.reviewedEffectDigest]: seal.reviewedEffectDigest,
        [AUTOMATION_RETRY_SEAL_VARIABLES.snapshotHash]: snapshotHash,
    };
}

/**
 * Validate the digest-only association copied to a log. A job without a seal
 * remains a legacy retry; a partially copied or malformed seal fails closed.
 */
export function readAutomationRetrySeal(
    job: MessageTriggerJobEntity,
    variables: Record<string, string>,
): AutomationRetrySealState {
    const rawSeal = (job.payload as unknown as Record<string, unknown>)[AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY];
    if (rawSeal === undefined) {
        const hasResidualAssociation = Object.values(AUTOMATION_RETRY_SEAL_VARIABLES)
            .some((key) => variables[key] !== undefined);
        return hasResidualAssociation
            ? { kind: "invalid", reason: "retry job seal is missing from durable source" }
            : { kind: "legacy" };
    }
    const expectedSnapshotHash = variables[AUTOMATION_RETRY_SEAL_VARIABLES.snapshotHash];
    let expected: Record<string, string>;
    try {
        expected = buildAutomationRetrySealVariables(job, expectedSnapshotHash ?? "");
    } catch {
        return { kind: "invalid", reason: "retry source job identity is malformed" };
    }
    const keys = Object.values(AUTOMATION_RETRY_SEAL_VARIABLES);
    if (!expectedSnapshotHash || !keys.every((key) => typeof variables[key] === "string" && variables[key]!.length > 0)) {
        return { kind: "invalid", reason: "retry seal is missing from durable log" };
    }
    if (!Object.keys(expected).length || keys.some((key) => variables[key] !== expected[key])) {
        return { kind: "invalid", reason: "retry seal does not match the persisted job" };
    }
    const authorityId = variables[AUTOMATION_RETRY_SEAL_VARIABLES.authorityId]!;
    const authorityDigest = variables[AUTOMATION_RETRY_SEAL_VARIABLES.authorityDigest]!;
    const sealDigest = variables[AUTOMATION_RETRY_SEAL_VARIABLES.sealDigest]!;
    const concreteJobDigest = variables[AUTOMATION_RETRY_SEAL_VARIABLES.concreteJobDigest]!;
    const scopeDigest = variables[AUTOMATION_RETRY_SEAL_VARIABLES.scopeDigest]!;
    const reviewedEffectDigest = variables[AUTOMATION_RETRY_SEAL_VARIABLES.reviewedEffectDigest]!;
    if (!UUID.test(authorityId) || ![authorityDigest, sealDigest, concreteJobDigest, scopeDigest,
        reviewedEffectDigest, expectedSnapshotHash].every((value) => DIGEST.test(value))) {
        return { kind: "invalid", reason: "retry seal has an invalid digest" };
    }
    return { kind: "valid", authorityId, authorityDigest, sealDigest, concreteJobDigest,
        scopeDigest, reviewedEffectDigest, snapshotHash: expectedSnapshotHash };
}
