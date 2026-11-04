import type { Prisma } from "@prisma/client";
import { BadRequestException, ConflictException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { AdminAuditActor, AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { currentAdminAuditActor } from "application/services/admin-audit-context";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { withoutEntityChangeHints } from "infrastructure/database/entity-change-suppression";
import {
    SystemSettingEntity,
    MessageAutomationPolicyConfiguration,
    MessagePolicyWarning,
    defaultMessageAutomationPolicy,
    RibbonConfig,
    DEFAULT_RIBBON_CONFIG,
    MessageAutomationPastTriggerConfig,
    DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
    ContractAutoFinalizeConfig,
    DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG,
    normalizeContractAutoFinalizeConfig,
} from "domain/entities/system-setting.entity";
import { SystemSettingAuditContext } from "domain/repositories/system-setting.repository.interface";
import {
    DEFAULT_MESSAGE_SETTINGS_POLICY_ENABLED,
    STORED_MESSAGE_SETTINGS_POLICY_IDS,
    StoredMessageSettingsPolicyId,
} from "domain/constants/message-settings-policy";

import { validateMessageAutomationPolicy, evaluateMessageQuietHours } from "domain/message-policy-evaluator";
import { isConfigurableSmsTriggerTemplate } from "domain/constants/message-trigger-catalog";
import { IMessageTriggerRuleRepository, MESSAGE_TRIGGER_RULE_REPOSITORY } from "domain/repositories/message-trigger-rule.repository.interface";
import { IMessageTriggerJobRepository, MESSAGE_TRIGGER_JOB_REPOSITORY } from "domain/repositories/message-trigger-job.repository.interface";
import { IMessageLogRepository, MESSAGE_LOG_REPOSITORY } from "domain/repositories/message-log.repository.interface";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";

export type PwaDigestDeliveryStatus = "sent" | "retryable" | "uncertain";

interface PwaDigestDeliveryState {
    status: "processing" | PwaDigestDeliveryStatus;
    token: string;
    leaseExpiresAt?: string;
}

export interface EformsignTemplateBranchMapping {
    branchId: string;
    effectiveFrom: Date;
}

const PWA_DIGEST_DELIVERY_PREFIX = "pwa:daily_digest:";
const PWA_DIGEST_DELIVERY_ABSENT_VERSION = "absent";
const PWA_DIGEST_DELIVERY_LEASE_MS = 30 * 60 * 1000;

@Injectable()
export class SystemSettingService {
    constructor(
        private readonly getSettingUsecase: GetSettingUsecase,
        private readonly updateSettingUsecase: UpdateSettingUsecase,
        private readonly auditWriter?: AdminAuditEventWriter,
        @Optional()
        private readonly messageAutomationActivationService?: MessageAutomationActivationService,
        @Optional() @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly policyRules?: IMessageTriggerRuleRepository,
        @Optional() @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly policyJobs?: IMessageTriggerJobRepository,
        @Optional() @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly policyLogs?: IMessageLogRepository,
        @Optional()
        private readonly policyBranchLock?: MessageAutomationBranchLockService,
    ) {}

    private getUserEmailNotificationPreferenceKey(userId: string): string {
        return `user:${userId}:email_notifications_enabled`;
    }

    private getMessageAutomationPastTriggerConfigKey(branchId: string): string {
        return `branch:${branchId}:message_automation:past_trigger`;
    }

    private getMessageSettingsPolicyEnabledKey(
        branchId: string,
        policyId: StoredMessageSettingsPolicyId,
    ): string {
        return `branch:${branchId}:message_policy:${policyId}:enabled`;
    }

    private getContractAutoFinalizeConfigKey(branchId: string): string {
        return `branch:${branchId}:contract_automation:auto_finalize`;
    }

    private getClientAutoRegistrationKey(branchId: string): string {
        return `branch:${branchId}:client_auto_registration`;
    }

    private getGreetingOnAutoRegistrationKey(branchId: string): string {
        return `branch:${branchId}:greeting_on_auto_registration`;
    }

    private getPwaUndeliveredDigestWatermarkKey(branchId: string): string {
        return `branch:${branchId}:pwa_undelivered_digest_watermark`;
    }

    // Template-scoped, not branch-scoped: the lookup runs from a document that has no
    // branch yet, so the template id is the only key it can ask with.
    private getEformsignTemplateBranchKey(templateId: string): string {
        return `eformsign:template_branch:${templateId}`;
    }

    async getUserEmailNotificationsEnabled(userId: string): Promise<boolean> {
        const value = await this.getSettingUsecase.executeWithDefault(
            this.getUserEmailNotificationPreferenceKey(userId),
            "true"
        );

        return value === "true";
    }

    async setUserEmailNotificationsEnabled(
        userId: string,
        enabled: boolean,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        const key = this.getUserEmailNotificationPreferenceKey(userId);
        const value = enabled ? "true" : "false";
        const auditContext = this.auditContext(actor, "system_setting.notification_preferences.updated");
        return auditContext
            ? this.updateSettingUsecase.execute(key, value, auditContext)
            : this.updateSettingUsecase.execute(key, value);
    }

    async getRibbonConfig(): Promise<RibbonConfig> {
        const value = await this.getSettingUsecase.execute(
            SystemSettingEntity.RIBBON_CONFIG_KEY
        );
        if (!value) return DEFAULT_RIBBON_CONFIG;
        try {
            return { ...DEFAULT_RIBBON_CONFIG, ...JSON.parse(value) };
        } catch {
            return DEFAULT_RIBBON_CONFIG;
        }
    }

    async setRibbonConfig(config: RibbonConfig, actor?: AdminAuditActor): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        const args = [
            SystemSettingEntity.RIBBON_CONFIG_KEY,
            JSON.stringify(config),
        ] as const;
        const auditContext = this.auditContext(actor, "system_setting.ribbon.updated");
        return auditContext
            ? this.updateSettingUsecase.execute(...args, auditContext)
            : this.updateSettingUsecase.execute(...args);
    }

    async setRibbonConfigIfVersion(
        expectedTargetVersion: string,
        config: RibbonConfig,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        const normalized = { ...DEFAULT_RIBBON_CONFIG, ...config };
        const auditContext = this.auditContext(actor, "system_setting.ribbon.updated");
        const updated = auditContext
            ? await this.updateSettingUsecase.executeIfVersion(
                SystemSettingEntity.RIBBON_CONFIG_KEY,
                JSON.stringify(normalized),
                expectedTargetVersion,
                (rawValue) => this.ribbonTargetVersion(rawValue),
                auditContext!,
            )
            : await this.updateSettingUsecase.executeIfVersion(
                SystemSettingEntity.RIBBON_CONFIG_KEY,
                JSON.stringify(normalized),
                expectedTargetVersion,
                (rawValue) => this.ribbonTargetVersion(rawValue),
            );
        // 승인 버전과 현재 버전이 어긋난 낙관 동시성 거절은 공개 충돌 계약으로 변환해요.
        if (!updated) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        return updated;
    }

    private messagePolicyKey(branchId: string): string {
        if (!branchId.trim()) throw new BadRequestException("Branch is required");
        return `branch:${branchId}:message_automation:policy`;
    }

    private policyVersion(raw: string | null): string {
        return raw === null ? "absent" : createHash("sha256").update(raw).digest("hex");
    }

    private async readMessagePolicy(
        branchId: string,
        transaction?: Prisma.TransactionClient,
        readValue?: (key: string) => Promise<string | null>,
    ): Promise<{ version: string | null; configuration: MessageAutomationPolicyConfiguration }> {
        try {
            const read = readValue ?? ((key: string) => transaction
                ? this.getSettingUsecase.execute(key, transaction) : this.getSettingUsecase.execute(key));
            const raw = await read(this.messagePolicyKey(branchId));
            if (raw != null) return {
                version: this.policyVersion(raw),
                configuration: validateMessageAutomationPolicy(JSON.parse(raw)),
            };
            const legacy = this.parseMessageAutomationPastTriggerConfig(
                await read(this.getMessageAutomationPastTriggerConfigKey(branchId)),
            );
            return {
                version: null,
                configuration: { ...defaultMessageAutomationPolicy(), pastSendIntervalMinutes: legacy.sendIntervalMinutes, pastRuleOrder: legacy.ruleOrder },
            };
        } catch {
            throw new ServiceUnavailableException("Message automation policy is unavailable");
        }
    }

    private async effectivePolicyOrder(
        branchId: string,
        configuration: MessageAutomationPolicyConfiguration,
        storedOrder: readonly string[],
        isWrite: boolean,
        transaction?: Prisma.TransactionClient,
    ): Promise<{ configuration: MessageAutomationPolicyConfiguration; warnings: MessagePolicyWarning[] }> {
        const warnings: MessagePolicyWarning[] = [];
        if (!configuration.pastRuleOrder.length) return { configuration, warnings };
        if (!this.policyRules) throw new ServiceUnavailableException("Message policy rules are unavailable");
        let rules;
        try { rules = await this.policyRules.findAll(branchId, transaction); }
        catch { throw new ServiceUnavailableException("Message policy rules are unavailable"); }
        const active = new Set(rules.filter(rule => rule.branchId === branchId && rule.isActive
            && isConfigurableSmsTriggerTemplate(rule.templateKey)).map(rule => rule.id));
        const ruleOrder: string[] = [];
        for (const id of configuration.pastRuleOrder) {
            if (active.has(id)) ruleOrder.push(id);
            else if (isWrite && !storedOrder.includes(id)) throw new BadRequestException("pastRuleOrder must contain active SMS rules from this branch");
            else warnings.push({ code: "ORDER_ENTRY_PRUNED", ruleId: id });
        }
        return { configuration: { ...configuration, pastRuleOrder: ruleOrder }, warnings };
    }

    async getMessageAutomationPolicyConfig(branchId: string) {
        const stored = await this.readMessagePolicy(branchId);
        return { version: stored.version, ...await this.effectivePolicyOrder(branchId, stored.configuration, stored.configuration.pastRuleOrder, false) };
    }

    private validatePolicyDraft(expectedVersion: unknown, configuration: unknown): MessageAutomationPolicyConfiguration {
        if (expectedVersion !== null && (typeof expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(expectedVersion))) {
            throw new BadRequestException("expectedVersion must be null or a policy version");
        }
        try { return validateMessageAutomationPolicy(configuration); }
        catch { throw new BadRequestException("Invalid message automation policy configuration"); }
    }

    private async saveMessagePolicy(
        branchId: string,
        expectedVersion: string | null,
        configuration: MessageAutomationPolicyConfiguration,
        actor: AdminAuditActor | undefined,
        transaction: Prisma.TransactionClient,
    ) {
        const stored = await this.readMessagePolicy(branchId, transaction);
        if (stored.version !== expectedVersion) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        const effective = await this.effectivePolicyOrder(branchId, configuration, stored.configuration.pastRuleOrder, true, transaction);
        if (configuration.quietHours.enabled) {
            if (!this.policyLogs) throw new ServiceUnavailableException("Message policy logs are unavailable");
            let reservations: number;
            try { reservations = await this.policyLogs.countFutureProviderReservations(branchId, new Date(), transaction); }
            catch { throw new ServiceUnavailableException("Provider reservation state is unavailable"); }
            if (reservations > 0) throw new ConflictException({ code: "FUTURE_PROVIDER_RESERVATIONS", count: reservations });
        }
        const raw = JSON.stringify(effective.configuration);
        const audit = this.auditContext(actor ?? currentAdminAuditActor(), "system_setting.message_automation.updated", branchId);
        const entity = await this.updateSettingUsecase.executeIfVersion(
            this.messagePolicyKey(branchId), raw, expectedVersion ?? "absent", value => this.policyVersion(value), audit, transaction,
        );
        if (!entity) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        return { version: this.policyVersion(entity.value), ...effective, entity };
    }

    async setMessageAutomationPolicyConfig(
        branchId: string, expectedVersion: string | null, configuration: unknown, actor?: AdminAuditActor,
    ) {
        const validated = this.validatePolicyDraft(expectedVersion, configuration);
        if (!this.policyBranchLock) throw new ServiceUnavailableException("Message policy lock is unavailable");
        // Database errors (including first-create P2002) leave the caller transaction
        // before they become a public conflict. No query runs on an aborted transaction.
        try {
            const result = await this.policyBranchLock.runExclusive(branchId,
                transaction => this.saveMessagePolicy(branchId, expectedVersion, validated, actor, transaction));
            return { version: result.version, configuration: result.configuration, warnings: result.warnings };
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "P2002") throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            throw error;
        }
    }

    async previewMessageAutomationPolicyConfig(branchId: string, expectedVersion: string | null, configuration: unknown, now = new Date()) {
        const validated = this.validatePolicyDraft(expectedVersion, configuration);
        const stored = await this.readMessagePolicy(branchId);
        if (stored.version !== expectedVersion) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        const effective = await this.effectivePolicyOrder(branchId, validated, stored.configuration.pastRuleOrder, true);
        if (!this.policyJobs || !this.policyLogs) throw new ServiceUnavailableException("Message policy preview is unavailable");
        try {
            const [jobs, retries, reservations] = await Promise.all([
                this.policyJobs.findPolicyPreviewCandidates(branchId),
                this.policyLogs.findPolicyPreviewCandidates(branchId),
                this.policyLogs.countFutureProviderReservations(branchId, now),
            ]);
            const candidates = await this.policyLogs.resolvePolicyRecipientGroups(branchId, [...jobs, ...retries]);
            let deferredCount = 0;
            let canceledCount = 0;
            let reevaluateAt: Date | null = null;
            for (const candidate of candidates) {
                const at = new Date(Math.max(now.getTime(), candidate.dueAt.getTime()));
                const decision = evaluateMessageQuietHours(effective.configuration.quietHours, candidate.recipientGroups, at);
                if (decision.action === "CANCEL") canceledCount++;
                if (decision.action === "DEFER") {
                    deferredCount++;
                    if (!reevaluateAt || decision.reevaluateAt < reevaluateAt) reevaluateAt = decision.reevaluateAt;
                }
            }
            return { version: stored.version, deferredCount, canceledCount, reevaluateAt: reevaluateAt?.toISOString() ?? null,
                futureProviderReservations: reservations, canEnableQuietHours: reservations === 0, warnings: effective.warnings };
        } catch {
            throw new ServiceUnavailableException("Message policy preview is unavailable");
        }
    }

    async getMessageAutomationPastTriggerConfig(
        branchId: string,
        readValue?: (key: string) => Promise<string | null>,
    ): Promise<MessageAutomationPastTriggerConfig> {
        const { configuration } = await this.readMessagePolicy(branchId, undefined, readValue);
        return { sendIntervalMinutes: configuration.pastSendIntervalMinutes, ruleOrder: configuration.pastRuleOrder };
    }

    async setMessageAutomationPastTriggerConfig(
        branchId: string, config: MessageAutomationPastTriggerConfig, actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        if (!Number.isInteger(config.sendIntervalMinutes) || config.sendIntervalMinutes < 1 || config.sendIntervalMinutes > 1440
            || !Array.isArray(config.ruleOrder) || config.ruleOrder.some(id => typeof id !== "string" || !id.trim())) {
            throw new BadRequestException("Invalid past trigger configuration");
        }
        if (!this.policyBranchLock) throw new ServiceUnavailableException("Message policy lock is unavailable");
        try {
            return await this.policyBranchLock.runExclusive(branchId, async transaction => {
                const stored = await this.readMessagePolicy(branchId, transaction);
                const result = await this.saveMessagePolicy(branchId, stored.version, {
                    ...stored.configuration, pastSendIntervalMinutes: config.sendIntervalMinutes, pastRuleOrder: [...new Set(config.ruleOrder)],
                }, actor, transaction);
                return result.entity;
            });
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "P2002") throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            throw error;
        }
    }

    async getMessageSettingsPolicyEnabled(
        branchId: string,
        policyId: StoredMessageSettingsPolicyId,
        readValue?: (key: string) => Promise<string | null>,
    ): Promise<boolean> {
        const value = readValue ? (await readValue(this.getMessageSettingsPolicyEnabledKey(branchId, policyId)))
            ?? String(DEFAULT_MESSAGE_SETTINGS_POLICY_ENABLED) : await this.getSettingUsecase.executeWithDefault(
            this.getMessageSettingsPolicyEnabledKey(branchId, policyId),
            String(DEFAULT_MESSAGE_SETTINGS_POLICY_ENABLED),
        );

        return value === "true";
    }

    async getMessageSettingsPolicyActivations(
        branchId: string,
    ): Promise<Record<StoredMessageSettingsPolicyId, boolean>> {
        const entries = await Promise.all(
            STORED_MESSAGE_SETTINGS_POLICY_IDS.map(async (policyId) => [
                policyId,
                await this.getMessageSettingsPolicyEnabled(branchId, policyId),
            ] as const),
        );

        return Object.fromEntries(entries) as Record<StoredMessageSettingsPolicyId, boolean>;
    }

    async setMessageSettingsPolicyEnabled(
        branchId: string,
        policyId: StoredMessageSettingsPolicyId,
        enabled: boolean,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        if (policyId === "trigger-dispatch") {
            if (!this.messageAutomationActivationService) {
                throw new ServiceUnavailableException("Message automation activation is not configured");
            }
            return this.messageAutomationActivationService.setTriggerDispatchEnabled(branchId, enabled, actor);
        }
        const key = this.getMessageSettingsPolicyEnabledKey(branchId, policyId);
        const value = String(enabled);
        const auditContext = this.auditContext(
            actor,
            "system_setting.message_policy_activation.updated",
            branchId,
        );
        return auditContext
            ? this.updateSettingUsecase.execute(key, value, auditContext)
            : this.updateSettingUsecase.execute(key, value);
    }

    async getContractAutoFinalizeConfig(branchId: string): Promise<ContractAutoFinalizeConfig> {
        const value = await this.getSettingUsecase.execute(this.getContractAutoFinalizeConfigKey(branchId));
        return this.parseContractAutoFinalizeConfig(value);
    }

    async setContractAutoFinalizeConfig(
        branchId: string,
        config: ContractAutoFinalizeConfig,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        const normalized = normalizeContractAutoFinalizeConfig(config);
        const key = this.getContractAutoFinalizeConfigKey(branchId);
        const value = JSON.stringify(normalized);
        const auditContext = this.auditContext(actor, "system_setting.contract_automation.updated", branchId);
        return auditContext
            ? this.updateSettingUsecase.execute(key, value, auditContext)
            : this.updateSettingUsecase.execute(key, value);
    }

    async getClientAutoRegistrationEnabled(branchId: string): Promise<boolean> {
        const value = await this.getSettingUsecase.executeWithDefault(
            this.getClientAutoRegistrationKey(branchId),
            "true"
        );

        return value === "true";
    }

    async setClientAutoRegistrationEnabled(
        branchId: string,
        enabled: boolean,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        const key = this.getClientAutoRegistrationKey(branchId);
        const value = enabled ? "true" : "false";
        const auditContext = this.auditContext(actor, "system_setting.client_registration.updated", branchId);
        return auditContext
            ? this.updateSettingUsecase.execute(key, value, auditContext)
            : this.updateSettingUsecase.execute(key, value);
    }

    async getGreetingOnAutoRegistrationEnabled(branchId: string): Promise<boolean> {
        const value = await this.getSettingUsecase.executeWithDefault(
            this.getGreetingOnAutoRegistrationKey(branchId),
            "false"
        );

        return value === "true";
    }

    async setGreetingOnAutoRegistrationEnabled(
        branchId: string,
        enabled: boolean,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        const key = this.getGreetingOnAutoRegistrationKey(branchId);
        const value = enabled ? "true" : "false";
        const auditContext = this.auditContext(actor, "system_setting.greeting_registration.updated", branchId);
        return auditContext
            ? this.updateSettingUsecase.execute(key, value, auditContext)
            : this.updateSettingUsecase.execute(key, value);
    }

    async getEformsignTemplateBranch(
        templateId: string,
    ): Promise<EformsignTemplateBranchMapping | null> {
        const value = await this.getSettingUsecase.execute(
            this.getEformsignTemplateBranchKey(templateId),
        );
        if (!value) return null;
        try {
            return this.parseEformsignTemplateBranch(JSON.parse(value));
        } catch {
            return null;
        }
    }

    // effectiveFrom is required, and a malformed one drops the whole mapping. The
    // reconcile sweep re-reads every active document on each pass, so a mapping without a
    // usable cutoff would hand the entire archive to auto-registration the first time it
    // ran. Failing closed keeps that from being one typo away.
    private parseEformsignTemplateBranch(
        config: unknown,
    ): EformsignTemplateBranchMapping | null {
        if (typeof config !== "object" || config === null) return null;
        const candidate = config as Partial<Record<
            keyof EformsignTemplateBranchMapping,
            unknown
        >>;
        const branchId = typeof candidate.branchId === "string"
            ? candidate.branchId.trim()
            : "";
        if (branchId === "") return null;
        if (typeof candidate.effectiveFrom !== "string") return null;
        const effectiveFrom = new Date(candidate.effectiveFrom);
        if (Number.isNaN(effectiveFrom.getTime())) return null;
        return { branchId, effectiveFrom };
    }

    async getPwaUndeliveredDigestWatermark(branchId: string): Promise<Date | null> {
        const value = await this.getSettingUsecase.execute(
            this.getPwaUndeliveredDigestWatermarkKey(branchId),
        );
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    async setPwaUndeliveredDigestWatermark(
        branchId: string,
        watermark: Date,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        actor = actor ?? currentAdminAuditActor();
        const key = this.getPwaUndeliveredDigestWatermarkKey(branchId);
        const value = watermark.toISOString();
        const auditContext = this.auditContext(
            actor,
            "system_setting.pwa_digest_watermark.updated",
            branchId,
            true,
            "scheduler",
        );
        // Scheduler bookkeeping (a watermark nobody renders): no realtime `settings` hint, or every
        // digest run would make all clients refetch settings.
        return withoutEntityChangeHints(() => auditContext
            ? this.updateSettingUsecase.execute(key, value, auditContext)
            : this.updateSettingUsecase.execute(key, value));
    }

    private auditContext(
        actor: AdminAuditActor | undefined,
        action: string,
        branchId?: string,
        allowSystemActor = false,
        source = "backend",
    ): SystemSettingAuditContext | undefined {
        // 내부 조립 불변성(감사 writer 누락·인증 컨텍스트 없는 감사)은 사용자 입력으로
        // 도달하지 않아요. 공개 문제 계약이 아니라 내부 결함 신호로 남기 위해 Error를 유지해요.
        if (!this.auditWriter && !actor) return undefined;
        if (!this.auditWriter) {
            throw new Error("Admin audit writer is required for audited setting mutations");
        }
        if (!allowSystemActor && !actor?.userId) {
            throw new Error("Authenticated actor is required for audited setting mutations");
        }
        return { actor: actor ?? null, branchId, action, source };
    }

    /**
     * Acquire a durable claim for one logical PWA digest delivery.
     *
     * System settings already provide a row-locked compare-and-set primitive. Reusing it
     * keeps the claim durable without adding a second table or a process-local singleton,
     * so two scheduler replicas converge on one owner even when their cron ticks overlap.
     * A processing claim expires so a crashed owner can be recovered; an uncertain claim is
     * deliberately fail-closed because an external provider may already have accepted it.
     */
    async claimPwaDigestDelivery(
        deliveryKey: string,
        now = new Date(),
    ): Promise<string | null> {
        const key = this.getPwaDigestDeliveryKey(deliveryKey);
        const current = await this.getSettingUsecase.executeEntity(key);
        const state = this.parsePwaDigestDeliveryState(current?.value);

        if (state?.status === "sent" || state?.status === "uncertain") {
            return null;
        }

        if (
            state?.status === "processing"
            && state.leaseExpiresAt
            && new Date(state.leaseExpiresAt).getTime() > now.getTime()
        ) {
            return null;
        }

        const token = randomUUID();
        const nextState: PwaDigestDeliveryState = {
            status: "processing",
            token,
            leaseExpiresAt: new Date(now.getTime() + PWA_DIGEST_DELIVERY_LEASE_MS).toISOString(),
        };
        const expectedVersion = current
            ? this.pwaDigestDeliveryVersion(current.value)
            : PWA_DIGEST_DELIVERY_ABSENT_VERSION;
        // The claim row is internal bookkeeping no screen reads: suppress its realtime hint. Only this
        // write is wrapped; the notification rows a digest send creates stay announced.
        const updated = await withoutEntityChangeHints(() => this.updateSettingUsecase.executeIfVersion(
            key,
            JSON.stringify(nextState),
            expectedVersion,
            (value) => this.pwaDigestDeliveryVersion(value),
        ));

        return updated ? token : null;
    }

    /**
     * Resolve a previously claimed delivery. Only the current owner may advance its state;
     * a stale worker finishing after lease recovery cannot overwrite the newer claim.
     */
    async completePwaDigestDelivery(
        deliveryKey: string,
        token: string,
        status: PwaDigestDeliveryStatus,
    ): Promise<boolean> {
        const key = this.getPwaDigestDeliveryKey(deliveryKey);
        const current = await this.getSettingUsecase.executeEntity(key);
        const state = this.parsePwaDigestDeliveryState(current?.value);
        if (!current || !state || state.status !== "processing" || state.token !== token) {
            return false;
        }

        const nextState: PwaDigestDeliveryState = {
            status,
            token,
        };
        // Same internal claim row as claimPwaDigestDelivery: no realtime hint for its completion.
        const updated = await withoutEntityChangeHints(() => this.updateSettingUsecase.executeIfVersion(
            key,
            JSON.stringify(nextState),
            this.pwaDigestDeliveryVersion(current.value),
            (value) => this.pwaDigestDeliveryVersion(value),
        ));

        return Boolean(updated);
    }

    private parseMessageAutomationPastTriggerConfig(
        value: string | null,
    ): MessageAutomationPastTriggerConfig {
        if (value === null) return { ...DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG, ruleOrder: [] };

        try {
            return this.normalizeMessageAutomationPastTriggerConfig(JSON.parse(value));
        } catch {
            throw new ServiceUnavailableException("Legacy message automation policy is unavailable");
        }
    }

    private normalizeMessageAutomationPastTriggerConfig(config: unknown): MessageAutomationPastTriggerConfig {
        if (typeof config !== "object" || config === null || Array.isArray(config)) {
            throw new Error("Invalid legacy message policy");
        }
        const candidate = config as Partial<MessageAutomationPastTriggerConfig>;
        if (typeof candidate.sendIntervalMinutes !== "number" || !Number.isInteger(candidate.sendIntervalMinutes)
            || candidate.sendIntervalMinutes < 1 || candidate.sendIntervalMinutes > 1440
            || !Array.isArray(candidate.ruleOrder) || candidate.ruleOrder.some(id => typeof id !== "string" || !id.trim())) {
            throw new Error("Invalid legacy message policy");
        }
        return { sendIntervalMinutes: candidate.sendIntervalMinutes, ruleOrder: [...new Set(candidate.ruleOrder)] };
    }

    private parseContractAutoFinalizeConfig(value: string | null): ContractAutoFinalizeConfig {
        if (!value) return DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG;
        try {
            return normalizeContractAutoFinalizeConfig(JSON.parse(value));
        } catch {
            return DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG;
        }
    }

    private getPwaDigestDeliveryKey(deliveryKey: string): string {
        return `${PWA_DIGEST_DELIVERY_PREFIX}${deliveryKey}`;
    }

    private parsePwaDigestDeliveryState(value: string | null | undefined): PwaDigestDeliveryState | null {
        if (!value) return null;

        try {
            const candidate: unknown = JSON.parse(value);
            if (typeof candidate !== "object" || candidate === null) return null;

            const state = candidate as Partial<PwaDigestDeliveryState>;
            if (
                (state.status !== "processing"
                    && state.status !== "sent"
                    && state.status !== "retryable"
                    && state.status !== "uncertain")
                || typeof state.token !== "string"
                || state.token.length === 0
            ) {
                return null;
            }

            return {
                status: state.status,
                token: state.token,
                ...(typeof state.leaseExpiresAt === "string"
                    ? { leaseExpiresAt: state.leaseExpiresAt }
                    : {}),
            };
        } catch {
            return null;
        }
    }

    private pwaDigestDeliveryVersion(value: string | null): string {
        if (value === null) return PWA_DIGEST_DELIVERY_ABSENT_VERSION;
        return createHash("sha256").update(value).digest("hex");
    }

    private ribbonTargetVersion(rawValue: string | null): string {
        let current = DEFAULT_RIBBON_CONFIG;
        if (rawValue) {
            try {
                current = { ...DEFAULT_RIBBON_CONFIG, ...JSON.parse(rawValue) };
            } catch {
                current = DEFAULT_RIBBON_CONFIG;
            }
        }
        return createHash("sha256").update(JSON.stringify(current)).digest("hex");
    }
}
