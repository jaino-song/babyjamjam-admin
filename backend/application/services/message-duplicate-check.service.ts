import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { MessageDeliverySmsDuplicateCheckResponse, MessageDeliverySmsDuplicateDecision } from "@babyjamjam/shared/types/message";
import { IMessageLogRepository, MESSAGE_LOG_REPOSITORY } from "domain/repositories/message-log.repository.interface";
import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase } from "application/usecases/system-setting";
import { normalizePhone } from "application/utils/normalize-phone";

@Injectable()
export class MessageDuplicateCheckService {
    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY) private readonly history: IMessageLogRepository,
        private readonly settings: SystemSettingService,
        private readonly getSetting: GetSettingUsecase,
    ) {}

    private async enabled(branchId: string): Promise<boolean> {
        return this.settings.getMessageSettingsPolicyEnabled(branchId, "duplicate-send-confirmation", async key => {
            const raw = await this.getSetting.execute(key);
            if (raw !== null && raw !== "true" && raw !== "false") throw new Error("Invalid duplicate activation");
            return raw;
        });
    }

    async check(branchId: string, receiver: string, message: string, payloadHash: string): Promise<MessageDeliverySmsDuplicateCheckResponse> {
        return (await this.evaluate(branchId, receiver, message, payloadHash)).result;
    }

    private async evaluate(branchId: string, receiver: string, message: string, payloadHash: string): Promise<{ enabled: boolean; result: MessageDeliverySmsDuplicateCheckResponse }> {
        try {
            const now = new Date(Date.now());
            const result: MessageDeliverySmsDuplicateCheckResponse = { checkedAt: now.toISOString(), matchIds: [], latestSentAt: null, payloadHash };
            if (!await this.enabled(branchId)) return { enabled: false, result };
            const { configuration } = await this.settings.getMessageAutomationPolicyConfig(branchId);
            const hours = configuration.duplicateWindowHours;
            if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error("Invalid duplicate window");
            const matches = await this.history.findSmsDuplicateMatches({ branchId,
                receivers: [...new Set(receiver.split(",").map(phone => normalizePhone(phone)).filter((phone): phone is string => Boolean(phone)))],
                messageBody: message.replace(/\r\n/g, "\n").trim(), from: new Date(now.getTime() - hours * 3600000), to: now });
            result.matchIds = [...new Set(matches.map(match => match.id))].sort((a, b) => a - b);
            if (matches.length) result.latestSentAt = new Date(matches.reduce((latest, match) => Math.max(latest, match.sentAt.getTime()), Number.NEGATIVE_INFINITY)).toISOString();
            return { enabled: true, result };
        } catch (cause) {
            throw new ServiceUnavailableException(codeOnlyProblemBody("DEPENDENCY_UNAVAILABLE"), { cause });
        }
    }

    async assertCanSend(branchId: string, receiver: string, message: string, payloadHash: string, decision?: MessageDeliverySmsDuplicateDecision): Promise<void> {
        const { enabled, result: current } = await this.evaluate(branchId, receiver, message, payloadHash);
        if (!enabled) return;
        const valid = decision?.confirmed === true && decision.payloadHash === payloadHash
            && Array.isArray(decision.matchIds) && decision.matchIds.length === current.matchIds.length
            && decision.matchIds.every((id, index) => id === current.matchIds[index]);
        if ((decision !== undefined || current.matchIds.length > 0) && !valid) {
            throw new ConflictException({ ...codeOnlyProblemBody("REQUEST_CONFLICT"), ...current });
        }
    }
}
