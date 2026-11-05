import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { evaluateMessageQuietHours, validateMessageAutomationPolicy, type MessageQuietHoursDecision } from "domain/message-policy-evaluator";
import { MESSAGE_LOG_REPOSITORY, type IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import type { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageAutomationBranchLockService } from "./message-automation-branch-lock.service";
import { SystemSettingService } from "./system-setting.service";

export const QUIET_HOURS_CANCEL_REASON = "message_quiet_hours:CANCEL";
export const QUIET_HOURS_DEFER_REASON = "message_quiet_hours:DEFER";

export class MessageQuietHoursUnavailableError extends ServiceUnavailableException {
    constructor() { super(codeOnlyProblemBody("MESSAGE_SEND_NOT_STARTED")); }
}

export function isQuietHoursCanceled(log: MessageLogEntity): boolean {
    return log.variables["quietHoursDisposition"] === "CANCEL";
}

/** Task8 refuses DEFER without claiming a durable queue or release time (Task9). */
export function recordQuietHoursRefusal(log: MessageLogEntity, decision: Exclude<MessageQuietHoursDecision, { action: "ALLOW" }>): void {
    log.markRetrySuperseded(decision.action === "CANCEL" ? QUIET_HOURS_CANCEL_REASON : QUIET_HOURS_DEFER_REASON);
    log.variables = { ...log.variables, quietHoursDisposition: decision.action };
}

type AdmissionWork<T> = (decision: MessageQuietHoursDecision, transaction?: Prisma.TransactionClient) => Promise<T>;

/** Fresh policy and provider-start CAS share the policy writer's branch lock. */
@Injectable()
export class MessageQuietHoursService {
    constructor(
        private readonly settings: SystemSettingService,
        @Inject(MESSAGE_LOG_REPOSITORY) private readonly logs: IMessageLogRepository,
        private readonly branchLock: MessageAutomationBranchLockService,
    ) {}

    async runAdmission<T>(branchId: string, receiver: string, work: AdmissionWork<T>, transaction?: Prisma.TransactionClient): Promise<T> {
        return this.branchLock.runExclusive(branchId, async tx => {
            let decision: MessageQuietHoursDecision;
            try {
                const { configuration } = await this.settings.getMessageAutomationPolicyConfig(branchId, tx);
                const policy = validateMessageAutomationPolicy(configuration);
                const phones = [...new Set(receiver.split(",").map(phone => phone.trim()).filter(Boolean))];
                if (!phones.length) throw new MessageQuietHoursUnavailableError();
                const candidates = policy.quietHours.enabled
                    ? await this.logs.resolvePolicyRecipientGroups(branchId, phones.map(recipientPhone => ({ recipientPhone, recipientGroups: [], dueAt: new Date(0) })), tx)
                    : [];
                if (policy.quietHours.enabled && (candidates.length !== phones.length
                    || candidates.some((candidate, index) => candidate.recipientPhone !== phones[index]))) {
                    throw new MessageQuietHoursUnavailableError();
                }
                // Sample after lock acquisition and all reads, never from a reservation or preview.
                const now = new Date(Date.now());
                decision = { action: "ALLOW", reevaluateAt: null };
                for (const candidate of candidates) {
                    const evaluated = evaluateMessageQuietHours(policy.quietHours, candidate.recipientGroups, now);
                    if (evaluated.action !== "ALLOW") {
                        decision = evaluated;
                        break;
                    }
                }
            } catch { throw new MessageQuietHoursUnavailableError(); }
            return work(decision, tx);
        }, transaction);
    }
}

/** Old direct builders may proceed only with an explicitly schema-validated OFF policy. Nest requires the service. */
export async function runSmsQuietHoursAdmission<T>(service: MessageQuietHoursService | undefined,
    settings: SystemSettingService | undefined, branchId: string | null, receiver: string,
    work: AdmissionWork<T>, transaction?: Prisma.TransactionClient): Promise<T> {
    if (!branchId) throw new MessageQuietHoursUnavailableError();
    if (service) return service.runAdmission(branchId, receiver, work, transaction);
    try {
        if (!settings) throw new MessageQuietHoursUnavailableError();
        const { configuration } = await settings.getMessageAutomationPolicyConfig(branchId, transaction);
        if (validateMessageAutomationPolicy(configuration).quietHours.enabled) throw new MessageQuietHoursUnavailableError();
    } catch { throw new MessageQuietHoursUnavailableError(); }
    return work({ action: "ALLOW", reevaluateAt: null }, transaction);
}
