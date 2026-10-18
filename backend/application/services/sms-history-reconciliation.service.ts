import { Inject, Injectable, Logger } from "@nestjs/common";
import { ALIGO_SMS_API_PORT, IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";
import { IMessageLogRepository, MESSAGE_LOG_REPOSITORY } from "domain/repositories/message-log.repository.interface";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { SystemSettingService } from "./system-setting.service";
import { ALIGO_HISTORY_ABSENT_AUTO_RESEND, decideAligoHistoryOutcome, isAligoHistoryEligible, lookupAligoHistory } from "./sms-history-reconciliation.lookup";

export { ALIGO_HISTORY_ABSENT_AUTO_RESEND } from "./sms-history-reconciliation.lookup";
export const ALIGO_HISTORY_BATCH_SIZE = 10;
export const ALIGO_HISTORY_TICK_BUDGET_MS = 120_000;
export const ALIGO_HISTORY_ACTOR = "system:aligo-history";

@Injectable()
export class SmsHistoryReconciliationService {
    private readonly logger = new Logger(SmsHistoryReconciliationService.name);

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY) private readonly logRepository: IMessageLogRepository,
        @Inject(ALIGO_SMS_API_PORT) private readonly api: IAligoSmsApiPort,
        private readonly systemSettingService: SystemSettingService,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    async reconcile(): Promise<void> {
        const deadline = Date.now() + ALIGO_HISTORY_TICK_BUDGET_MS;
        try {
            const rows = await this.logRepository.findAligoHistoryCandidatesSystemScope(new Date(), ALIGO_HISTORY_BATCH_SIZE);
            for (const log of rows) {
                if (Date.now() >= deadline || !this.schedulerLease.holdsLease()) break;
                const now = new Date();
                if (!isAligoHistoryEligible(log, now)) continue;
                try {
                    const expectedState = log.providerAcceptanceState;
                    const expectedUpdatedAt = log.updatedAt;
                    if (expectedState === "started") {
                        log.markStaleStartedAsUncertain(now);
                        log.variables = { ...log.variables, historyLookup: "checking" };
                        log.updatedAt = new Date(Math.max(now.getTime(), expectedUpdatedAt.getTime() + 1));
                        await this.logRepository.claimAligoHistoryBookkeeping(log, "started", expectedUpdatedAt);
                        continue;
                    }
                    // Claim the lookup before crossing the network, fencing other ticks for five minutes.
                    log.variables = { ...log.variables, historyLookup: "checking", historyLookupAt: now.toISOString() };
                    log.updatedAt = new Date(Math.max(now.getTime(), expectedUpdatedAt.getTime() + 1));
                    const claimed = await this.logRepository.claimAligoHistoryBookkeeping(log, "uncertain", expectedUpdatedAt);
                    if (!claimed) continue;
                    const result = await lookupAligoHistory(claimed, this.api,
                        mids => this.logRepository.findAligoMidsStoredOnOtherLogs(mids, claimed.id));
                    const policy = ALIGO_HISTORY_ABSENT_AUTO_RESEND && result.kind === "ABSENT" && claimed.branchId !== null
                        ? await this.systemSettingService.getMessageSettingsPolicyEnabled(claimed.branchId, "sms-retry") : false;
                    const decision = decideAligoHistoryOutcome(claimed, result, now, policy);
                    if (decision.outcome) {
                        await this.logRepository.reconcileProviderAttempt(claimed, decision.outcome, ALIGO_HISTORY_ACTOR,
                            decision.reason, decision.mid, { retry: decision.retry, expectedUpdatedAt: claimed.updatedAt, variables: decision.variables });
                    } else {
                        const revision = claimed.updatedAt;
                        claimed.variables = decision.variables;
                        claimed.updatedAt = new Date(Math.max(Date.now(), revision.getTime() + 1));
                        await this.logRepository.claimAligoHistoryBookkeeping(claimed, "uncertain", revision);
                    }
                } catch {
                    // Do not expose provider responses, receiver values, or credentials in logs.
                    this.logger.warn(`Aligo history reconciliation failed for log ${log.id}`);
                }
            }
        } catch {
            this.logger.warn("Aligo history reconciliation tick failed");
        }
    }
}
