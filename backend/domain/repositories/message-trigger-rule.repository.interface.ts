import type { MessageTriggerRuleGroupEntity } from "domain/entities/message-trigger-rule-group.entity";
import { MessageTriggerEventType } from "domain/constants/message-trigger-catalog";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import type { Prisma } from "@prisma/client";

export interface IMessageTriggerRuleRepository {
    findGroupDuplicateCandidates(branchId: string, transaction: Prisma.TransactionClient): Promise<MessageTriggerRuleEntity[]>;
    findGroups(branchId: string, transaction?: Prisma.TransactionClient): Promise<MessageTriggerRuleGroupEntity[]>;
    findGroup(branchId: string, id: string, transaction?: Prisma.TransactionClient): Promise<MessageTriggerRuleGroupEntity | null>;
    lockGroup(branchId: string, id: string, transaction: Prisma.TransactionClient): Promise<MessageTriggerRuleGroupEntity | null>;
    findGroupRules(branchId: string, groupId: string, transaction?: Prisma.TransactionClient, includeDeleted?: boolean): Promise<MessageTriggerRuleEntity[]>;
    lockGroupRules(branchId: string, groupId: string, transaction: Prisma.TransactionClient): Promise<void>;
    createGroup(branchId: string, name: string, recipientMode: MessageTriggerRuleGroupEntity["recipientMode"], transaction: Prisma.TransactionClient): Promise<MessageTriggerRuleGroupEntity>;
    updateGroupCAS(branchId: string, group: MessageTriggerRuleGroupEntity, expectedVersion: number, transaction: Prisma.TransactionClient): Promise<boolean>;
    softDeleteGroup(branchId: string, id: string, transaction: Prisma.TransactionClient): Promise<void>;
    /** Reuse a removed role's original child identity; never deletes its job history. */
    restoreGroupRule(branchId: string, groupId: string, rule: MessageTriggerRuleEntity, transaction: Prisma.TransactionClient): Promise<MessageTriggerRuleEntity | null>;

    findAll(branchId: string, transaction?: Prisma.TransactionClient): Promise<MessageTriggerRuleEntity[]>;
    findById(
        branchId: string,
        id: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity | null>;
    /**
     * Dispatch-time read: the rule owned by the branch OR a branchless GLOBAL
     * rule. `findById` is branch-scoped and returns null for global rules.
     */
    findByIdIncludingGlobal(
        branchId: string,
        id: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity | null>;
    findActiveByEventTypes(
        branchId: string,
        eventTypes: MessageTriggerEventType[],
    ): Promise<MessageTriggerRuleEntity[]>;
    /**
     * Read active rules that use one of the supplied templates. Without a
     * branch scope this preserves the global-template guard semantics; when a
     * branch is supplied, that branch and applicable branchless global rules
     * are considered while unrelated branch rules are excluded.
     */
    findActiveTemplateKeys(
        templateKeys: MessageTriggerTemplateKey[],
        branchIdOrTransaction?: string | Prisma.TransactionClient,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerTemplateKey[]>;
    findInactiveDefaultRules(limit?: number): Promise<MessageTriggerRuleEntity[]>;
    findStaleRules(limit?: number): Promise<MessageTriggerRuleEntity[]>;
    create(branchId: string, rule: MessageTriggerRuleEntity, transaction?: Prisma.TransactionClient): Promise<MessageTriggerRuleEntity>;
    update(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity>;
    /**
     * Compare the complete branch-scoped rule snapshot and update it in one
     * conditional mutation. A null result means the approved target drifted.
     */
    updateIfTargetMatches(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        next: MessageTriggerRuleEntity,
    ): Promise<MessageTriggerRuleEntity | null>;
    /**
     * Lock the branch-scoped rule, compare the approved snapshot, fence all
     * active dispatch jobs, and commit the rule mutation as one transaction.
     * A null result means the target drifted or a dispatch already won.
     */
    updateIfTargetMatchesAndFenceJobs(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        next: MessageTriggerRuleEntity,
        reason: string,
        fenceStartedAt?: Date,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity | null>;
    markJobsStale(branchId: string, ruleId: string, transaction?: Prisma.TransactionClient): Promise<void>;
    /** Idempotent upsert of a branch-less system rule row (branchId null); update is a no-op. */
    ensureSystemRule(rule: MessageTriggerRuleEntity, transaction?: Prisma.TransactionClient): Promise<void>;
    clearJobsStaleIfUnchanged(
        ruleId: string,
        updatedAtAtReadTime: Date,
        transaction?: Prisma.TransactionClient,
    ): Promise<boolean>;
    delete(branchId: string, id: string, transaction?: Prisma.TransactionClient): Promise<void>;
    /** Delete only when the full branch-scoped approved snapshot still matches. */
    deleteIfTargetMatches(branchId: string, expected: MessageTriggerRuleEntity): Promise<boolean>;
    /** Delete only after the branch-scoped rule lock fences active dispatch jobs. */
    deleteIfTargetMatchesAndFenceJobs(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        reason: string,
        fenceStartedAt?: Date,
        transaction?: Prisma.TransactionClient,
    ): Promise<boolean>;
}

export const MESSAGE_TRIGGER_RULE_REPOSITORY = "MESSAGE_TRIGGER_RULE_REPOSITORY";
