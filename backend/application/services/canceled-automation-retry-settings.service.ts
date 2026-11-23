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
const targetStatus = ["target_client_status_not_met"] as const;
const clientTemplateReasons = new Map<string, readonly CanceledAutomationRetryReason[]>([
    // MessageTriggerService.cancelJobOutsideRuleTargetClientStatus emits
    // TARGET_CLIENT_STATUS_MISMATCH_REASON.
    [MessageTriggerTemplateKey.CLIENT_GREETING, targetStatus],
    [MessageTriggerTemplateKey.PRICE_INFO, targetStatus],
    [MessageTriggerTemplateKey.SERVICE_INFO, targetStatus],
    [MessageTriggerTemplateKey.REMINDER, targetStatus],
    [MessageTriggerTemplateKey.THANKS, targetStatus],
    [MessageTriggerTemplateKey.SURVEY, targetStatus],
    [MessageTriggerTemplateKey.INFO, targetStatus],
    [MessageTriggerTemplateKey.CAREGIVER_SERVICE_START_NOTICE, []],
    [MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE, []],
    [MessageTriggerTemplateKey.SERVICE_END_NOTICE, [
        ...targetStatus,
        // ReceiptLinkIssueService preflight: contract_not_signed (verified live unsigned),
        // missing_birthday, no_contract_document (existing client), and
        // pdf_unavailable (positively pending current PDF).
        "live_unsigned_contract",
        "missing_birthday",
        "missing_current_contract",
        "current_contract_pdf_pending",
    ]],
]);

function isRealRoutine(rule: CanceledRetryRule): boolean {
    if (rule.templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK || rule.id === SERVICE_RECORD_LINK_RULE_ID) {
        return rule.id === SERVICE_RECORD_LINK_RULE_ID && rule.branchId === null
            && rule.templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK;
    }
    return !isManualMessageTriggerRule(rule) && rule.id !== MESSAGE_AUTOMATION_INTENT_RULE_ID
        && rule.templateKey !== MANUAL_SMS_TEMPLATE_KEY && !isRetiredFixedEventTemplate(rule.templateKey);
}

function projectRoutine(rule: CanceledRetryRule, dispatchEnabled: boolean): CanceledAutomationRetryRoutine {
    // MessageTriggerService uses SERVICE_RECORD_LINK_PRE_BOOKING_REASON on the scheduled attempt.
    const isClientRoutine = rule.recipientType === MessageTriggerRecipientType.CLIENT
        && (!rule.group || rule.group.recipientMode === MessageTriggerRecipientType.CLIENT);
    const recoverableReasons: readonly CanceledAutomationRetryReason[] = rule.id === SERVICE_RECORD_LINK_RULE_ID
        ? ["pre_booking"]
        : isClientRoutine
            ? clientTemplateReasons.get(rule.templateKey) ?? []
            : [];
    const override = rule.branchId === null ? rule.branchOverrides[0] : undefined;
    // A two-recipient group has no retry setting in this release.
    const epoch = rule.group?.recipientMode === "BOTH_EMPLOYEES"
        ? null
        : rule.branchId === null ? override?.canceledRetryEnabledAt : rule.canceledRetryEnabledAt;
    let unavailableReason: CanceledAutomationRetryRoutine["unavailableReason"] = null;
    if (!recoverableReasons.length) unavailableReason = "unsupported";
    else if (!dispatchEnabled) unavailableReason = "dispatch_disabled";
    else if (!isRuleActiveForBranch(rule.isActive, override?.isActive)) unavailableReason = "routine_disabled";
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
        const routines = new Map<string, CanceledAutomationRetryRoutine>();
        for (const rule of rules.filter(isRealRoutine)) {
            const routine = projectRoutine(rule, dispatchEnabled);
            if (!routines.has(routine.id)) routines.set(routine.id, routine);
        }
        return [...routines.values()];
    }

    async update(branchId: string, id: string, enabled: boolean): Promise<CanceledAutomationRetryRoutine> {
        return this.branchLock.runExclusive(branchId, async (transaction) => {
            const rules = id.startsWith(groupRoutineIdPrefix)
                ? await this.repository.lockGroupRules(branchId, id.slice(groupRoutineIdPrefix.length), transaction)
                : [await this.repository.lockRule(branchId, id, transaction)];
            const rule = rules.find((row): row is CanceledRetryRule => row !== null && isRealRoutine(row));
            if (!rule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

            const dispatchEnabled = await this.activation.getTriggerDispatchEnabled(branchId, transaction);
            const routine = projectRoutine(rule, dispatchEnabled);
            if (!routine.eligible) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            if (routine.enabled === enabled) return routine;

            const epoch = await this.repository.updateEpoch(transaction, branchId, rule, enabled);
            return { ...routine, enabled, enabledAt: epoch?.toISOString() ?? null };
        });
    }
}
