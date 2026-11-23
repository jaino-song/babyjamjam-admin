import type { Prisma } from "@prisma/client";
import { RECEIPT_RECOVERY_REASONS } from "domain/constants/receipt-job-recovery";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CanceledAutomationRetryReason, CanceledAutomationRetryRoutine } from "@babyjamjam/shared/types/message";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    MANUAL_SMS_TEMPLATE_KEY,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
    isRetiredFixedEventTemplate,
} from "domain/constants/message-trigger-catalog";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { isManualMessageTriggerRule } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import { isRuleActiveForBranch } from "domain/utils/message-trigger-rule-activation";
import {
    CANCELED_AUTOMATION_RETRY_REPOSITORY,
    type CanceledRetryRule,
    type ICanceledAutomationRetryRepository,
} from "domain/repositories/canceled-automation-retry.repository.interface";

const groupRoutineIdPrefix = "group:";
function isRealRoutine(rule: CanceledRetryRule): boolean {
    if (rule.templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK || rule.id === SERVICE_RECORD_LINK_RULE_ID) {
        return rule.id === SERVICE_RECORD_LINK_RULE_ID && rule.branchId === null
            && rule.templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK;
    }
    return !isManualMessageTriggerRule(rule) && rule.id !== MESSAGE_AUTOMATION_INTENT_RULE_ID
        && rule.templateKey !== MANUAL_SMS_TEMPLATE_KEY && !isRetiredFixedEventTemplate(rule.templateKey);
}

function memberReasons(rule: CanceledRetryRule): readonly CanceledAutomationRetryReason[] {
    if (rule.id === SERVICE_RECORD_LINK_RULE_ID) return ["pre_booking"];
    return rule.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE
        && rule.recipientType === MessageTriggerRecipientType.CLIENT
        && (!rule.group || rule.group.recipientMode === MessageTriggerRecipientType.CLIENT)
        ? RECEIPT_RECOVERY_REASONS : [];
}

function activeMember(rule: CanceledRetryRule): boolean {
    return isRuleActiveForBranch(rule.isActive, rule.branchOverrides[0]?.isActive);
}

function projectRoutine(rule: CanceledRetryRule, members: CanceledRetryRule[], dispatchEnabled: boolean): CanceledAutomationRetryRoutine {
    const recoverableReasons = [...new Set(members.flatMap(memberReasons))];
    const override = rule.branchId === null ? rule.branchOverrides[0] : undefined;
    // A two-recipient group has no retry setting in this release.
    const epoch = rule.group?.recipientMode === "BOTH_EMPLOYEES"
        ? null
        : rule.branchId === null ? override?.canceledRetryEnabledAt : rule.canceledRetryEnabledAt;
    let unavailableReason: CanceledAutomationRetryRoutine["unavailableReason"] = null;
    if (!recoverableReasons.length) unavailableReason = "unsupported";
    else if (!dispatchEnabled) unavailableReason = "dispatch_disabled";
    else if (!members.some(member => activeMember(member) && memberReasons(member).length)) unavailableReason = "routine_disabled";
    return {
        id: rule.group ? `${groupRoutineIdPrefix}${rule.group.id}` : rule.id,
        label: rule.group?.name ?? rule.name,
        recoverableReasons,
        eligible: unavailableReason === null,
        unavailableReason,
        enabled: epoch != null,
        enabledAt: epoch?.toISOString() ?? null,
    };
}

@Injectable()
export class CanceledAutomationRetrySettingsService {
    constructor(
        @Inject(CANCELED_AUTOMATION_RETRY_REPOSITORY)
        private readonly repository: ICanceledAutomationRetryRepository,
        private readonly branchLock: MessageAutomationBranchLockService,
        private readonly activation: MessageAutomationActivationService,
    ) {}

    async list(branchId: string): Promise<CanceledAutomationRetryRoutine[]> {
        const [rules, dispatchEnabled] = await Promise.all([
            this.repository.list(branchId),
            this.activation.getTriggerDispatchEnabled(branchId),
        ]);
        const routines = new Map<string, CanceledRetryRule[]>();
        for (const rule of rules.filter(isRealRoutine)) {
            const id = rule.group ? groupRoutineIdPrefix + rule.group.id : rule.id;
            const members = routines.get(id) ?? [];
            members.push(rule);
            routines.set(id, members);
        }
        return [...routines.values()].map(members => projectRoutine(members[0]!, members, dispatchEnabled));
    }

    async readMemberEpoch(branchId: string, ruleId: string, reason: CanceledAutomationRetryReason,
        transaction: Prisma.TransactionClient): Promise<Date | null> {
        const rules = (await this.repository.list(branchId, transaction)).filter(isRealRoutine);
        const member = rules.find(rule => rule.id === ruleId);
        if (!member || !activeMember(member) || !memberReasons(member).includes(reason)) return null;
        const members = member.group ? rules.filter(rule => rule.group?.id === member.group?.id) : [member];
        const projection = projectRoutine(members[0]!, members,
            await this.activation.getTriggerDispatchEnabled(branchId, transaction));
        return projection.eligible && projection.enabledAt ? new Date(projection.enabledAt) : null;
    }

    async update(branchId: string, id: string, enabled: boolean): Promise<CanceledAutomationRetryRoutine> {
        return this.branchLock.runExclusive(branchId, async (transaction) => {
            const rules = id.startsWith(groupRoutineIdPrefix)
                ? await this.repository.lockGroupRules(branchId, id.slice(groupRoutineIdPrefix.length), transaction)
                : [await this.repository.lockRule(branchId, id, transaction)];
            const members = rules.filter((row): row is CanceledRetryRule => row !== null && isRealRoutine(row));
            const rule = members[0];
            if (!rule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

            const dispatchEnabled = await this.activation.getTriggerDispatchEnabled(branchId, transaction);
            const routine = projectRoutine(rule, members, dispatchEnabled);
            if (!routine.eligible) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            if (routine.enabled === enabled) return routine;

            const epoch = await this.repository.updateEpoch(transaction, branchId, rule, enabled);
            return { ...routine, enabled, enabledAt: epoch?.toISOString() ?? null };
        });
    }
}
