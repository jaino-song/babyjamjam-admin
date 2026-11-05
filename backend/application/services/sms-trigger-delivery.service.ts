import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";
import { normalizePhone } from "application/utils/normalize-phone";
import { MANUAL_SMS_TEMPLATE_KEY, MANUAL_SMS_RULE_PREFIX, type MessageTriggerJobTemplateKey } from "domain/constants/message-trigger-catalog";
import { publicMessageVariables, messageQuietHoldVariables, parseMessageQuietHold, type MessageQuietHold } from "domain/message-policy-evaluator";
import { MESSAGE_TRIGGER_JOB_REPOSITORY, type IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import { agentAutomationConcreteJobDigest } from "./agent-automation-job-binding";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { MessageQuietHoursService, isQuietHoursCanceled, recordQuietHoursRefusal, runSmsQuietHoursAdmission, QUIET_HOURS_CANCEL_REASON } from "./message-quiet-hours.service";
import { MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import { isCaregiverTriggerTemplate } from "domain/constants/message-trigger-catalog";
import { CaregiverTemplateResolverService } from "./caregiver-template-resolver.service";
import { isCaregiverSystemTemplateKey } from "domain/constants/system-template-registry";
import type { Prisma } from "@prisma/client";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { SystemSettingService } from "./system-setting.service";
import { AligoService } from "application/services/aligo.service";
import { SystemTemplateService } from "application/services/system-template.service";
import {
    resolveAligoSmsMessageType,
    type AligoSmsMessageType,
} from "application/dto/aligo/send-sms.dto";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import {
    SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
    SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
} from "domain/constants/service-record-link-message";
import {
    SERVICE_END_NOTICE_SMS_AUTOMATION_KEY,
    SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY,
    SERVICE_END_NOTICE_SMS_TITLE,
    SERVICE_END_NOTICE_SMS_TRIGGER_TYPE,
} from "domain/constants/service-end-notice-message";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { BranchSystemTemplateSnapshotError } from "domain/entities/branch-system-template-snapshot";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "domain/constants/sms-delivery-snapshot";
import { isReservedAutomationJob } from "domain/constants/agent-automation-storage";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { AgentAutomationDispatchUncertainError } from "domain/errors/agent-automation-dispatch-uncertain.error";
import { AgentAutomationDeliveryGateService } from "./agent-automation-delivery-gate.service";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import {
    MESSAGE_TRIGGER_RULE_REPOSITORY,
    IMessageTriggerRuleRepository,
} from "domain/repositories/message-trigger-rule.repository.interface";
import { resolveRuleRetryPermission } from "application/services/message-automation-activation.service";
import {
    MessageLogEntity,
    MessageLogStatus,
} from "domain/entities/message-log.entity";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { isTransientPrismaConnectivityError } from "infrastructure/database/prisma-error.utils";
import {
    buildSmsProviderAcceptanceFingerprint,
    buildSmsProviderAcceptanceKey,
    SmsProviderAcceptanceService,
} from "./sms-provider-acceptance.service";
import { SmsTriggerDeliverySkipError, SmsTriggerPayloadEnricherRegistry } from "./sms-trigger-payload-enricher.registry";
import { buildAutomationRetrySealVariables } from "./automation-retry-seal";
import { classifySmsProviderOutcome, classifySmsProviderRejection, countSmsRecipients } from "./sms-provider-outcome.service";

export interface SmsTemplateDeliveryConfig {
    smsLogTemplateKey: string;
    automationKey: string;
    triggerType: string;
    title: string;
    systemTemplateKey?: SystemTemplateKey;
    usePayloadMessage?: boolean;
}

/**
 * Bump this whenever the catalog-to-provider mapping changes. The value is
 * included in the approval fingerprint so an approved retry cannot silently
 * adopt a different title, template key, or provider routing rule.
 */
export const SMS_DELIVERY_CONFIG_VERSION = "sms-template-delivery-v1";
export { SMS_DELIVERY_SNAPSHOT_VARIABLE };

export interface SmsTriggerDeliverySnapshot {
    readonly templateKey: MessageTriggerJobTemplateKey;
    /** The exact receiver value passed to AligoService (before provider normalization). */
    readonly receiver: string;
    readonly maskedReceiver: string;
    readonly recipientName: string;
    readonly message: string;
    readonly title: string;
    readonly requestedDeliveryType: "AUTO" | AligoSmsMessageType;
    readonly deliveryType: AligoSmsMessageType;
    readonly estimatedCost: string;
    readonly templateVersion: string;
    readonly templateHash: string;
    readonly configVersion: string;
    readonly configHash: string;
    readonly snapshotHash: string;
    readonly systemTemplateKey?: SystemTemplateKey;
}

/**
 * The provider-bound values prepared before the dispatch authorization fence.
 * `serializedSnapshot` is persisted on the trigger job before the common
 * client/source lock is acquired so authorization can prove that the worker
 * will send exactly the values that were prepared.
 */
export interface SmsTriggerDeliveryPreparation {
    readonly snapshot: Readonly<SmsTriggerDeliverySnapshot>;
    readonly serializedSnapshot: string;
}

interface ResolvedSmsTemplate {
    content: string;
    version: string;
    hash: string;
    requiredVariableKeys: string[];
}

class MissingSmsTemplateVariablesError extends Error {
    constructor(readonly variableKeys: string[]) {
        super(`SMS template is missing required values: ${variableKeys.join(", ")}`);
        this.name = "MissingSmsTemplateVariablesError";
    }
}

/**
 * `title` here is NOT the in-app template label. It is sent to Aligo and shown
 * to the recipient as the LMS subject line, so it is outgoing message content.
 *
 * Ten of these match the in-app label; THANKS ("예약 완료" vs "예약 완료(입금 확인)")
 * and INFO ("정보 안내" vs "정보 요청") deliberately do not. They were reviewed and
 * left alone on 2026-08-12: "정보 요청" in a recipient's inbox reads as a request
 * *for* their information, which is not what the message does. Do not "fix" these
 * to match the label map — the divergence is the decision.
 *
 * Editing any title also invalidates every persisted approval snapshot (the value
 * feeds configHash and snapshotHash), so a change needs SMS_DELIVERY_CONFIG_VERSION
 * bumped and every pending approval re-approved.
 */
export const SMS_TEMPLATE_DELIVERY: Partial<Record<MessageTriggerTemplateKey, SmsTemplateDeliveryConfig>> = {
    [MessageTriggerTemplateKey.CAREGIVER_SERVICE_START_NOTICE]: {
        smsLogTemplateKey: "caregiver_service_start_notice_sms", automationKey: "CAREGIVER_SERVICE_START_NOTICE_SMS",
        triggerType: "caregiver_service_start", title: "제공인력 서비스 시작 안내", systemTemplateKey: SystemTemplateKey.CAREGIVER_SERVICE_START_NOTICE,
    },
    [MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE]: {
        smsLogTemplateKey: "caregiver_service_end_notice_sms", automationKey: "CAREGIVER_SERVICE_END_NOTICE_SMS",
        triggerType: "caregiver_service_end", title: "제공인력 서비스 종료 안내", systemTemplateKey: SystemTemplateKey.CAREGIVER_SERVICE_END_NOTICE,
    },
    [MessageTriggerTemplateKey.SERVICE_INFO]: {
        smsLogTemplateKey: "service_info_sms",
        automationKey: "SERVICE_INFO_SMS",
        triggerType: "service_start_before_7_days",
        title: "서비스 안내",
        systemTemplateKey: SystemTemplateKey.SERVICE_INFO,
    },
    [MessageTriggerTemplateKey.CLIENT_GREETING]: {
        smsLogTemplateKey: "client_greeting_sms",
        automationKey: "CLIENT_GREETING_SMS",
        triggerType: "client_created",
        title: "인사 메시지",
        systemTemplateKey: SystemTemplateKey.GREETING,
    },
    [MessageTriggerTemplateKey.PRICE_INFO]: {
        smsLogTemplateKey: "price_info_sms",
        automationKey: "PRICE_INFO_SMS",
        triggerType: "price_info",
        title: "비용 안내",
        systemTemplateKey: SystemTemplateKey.PRICE_INFO,
    },
    [MessageTriggerTemplateKey.REMINDER]: {
        smsLogTemplateKey: "reminder_sms",
        automationKey: "REMINDER_SMS",
        triggerType: "reminder",
        title: "리마인드",
        systemTemplateKey: SystemTemplateKey.REMINDER,
    },
    [MessageTriggerTemplateKey.THANKS]: {
        smsLogTemplateKey: "thanks_sms",
        automationKey: "THANKS_SMS",
        triggerType: "thanks",
        title: "예약 완료",
        systemTemplateKey: SystemTemplateKey.THANKS,
    },
    [MessageTriggerTemplateKey.SURVEY]: {
        smsLogTemplateKey: "survey_sms",
        automationKey: "SURVEY_SMS",
        triggerType: "survey",
        title: "모니터링 설문",
        systemTemplateKey: SystemTemplateKey.SURVEY,
    },
    [MessageTriggerTemplateKey.INFO]: {
        smsLogTemplateKey: "info_sms",
        automationKey: "INFO_SMS",
        triggerType: "info",
        title: "정보 안내",
        systemTemplateKey: SystemTemplateKey.INFO,
    },
    [MessageTriggerTemplateKey.SERVICE_RECORD_LINK]: {
        smsLogTemplateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
        automationKey: SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
        triggerType: SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
        title: SERVICE_RECORD_LINK_SMS_TITLE,
        systemTemplateKey: SystemTemplateKey.SERVICE_RECORD_LINK,
    },
    [MessageTriggerTemplateKey.SERVICE_END_NOTICE]: {
        smsLogTemplateKey: SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY,
        automationKey: SERVICE_END_NOTICE_SMS_AUTOMATION_KEY,
        triggerType: SERVICE_END_NOTICE_SMS_TRIGGER_TYPE,
        title: SERVICE_END_NOTICE_SMS_TITLE,
        systemTemplateKey: SystemTemplateKey.SERVICE_END_NOTICE,
    },
};

@Injectable()
export class SmsTriggerDeliveryService {
    private readonly logger = new Logger(SmsTriggerDeliveryService.name);

    constructor(
        private readonly aligoService: AligoService,
        private readonly systemTemplateService: SystemTemplateService,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        @Optional()
        private readonly acceptanceService?: SmsProviderAcceptanceService,
        @Optional()
        private readonly enricherRegistry?: SmsTriggerPayloadEnricherRegistry,
        @Optional()
        private readonly automationDeliveryGate?: AgentAutomationDeliveryGateService,
        @Optional()
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly ruleRepository?: IMessageTriggerRuleRepository,
        // Mandatory Nest dependency; timing never falls back after a failed read.
        private readonly systemSettingService?: SystemSettingService,
        private readonly caregiverTemplates?: CaregiverTemplateResolverService,
        // Required Nest provider; direct legacy builders must prove validated quiet-OFF.
        private readonly quietHours?: MessageQuietHoursService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY) private readonly jobRepository?: IMessageTriggerJobRepository,
        private readonly defaultSender?: AligoDefaultSenderPolicyService,
    ) {}

    /**
     * 규칙 메시지-04: the rule's CURRENT 실패 시 재전송, read BEFORE any provider
     * bookkeeping starts. The rule being off means a rejection is final; a
     * missing rule row (or no repository) means on. A failed read is neither:
     * nothing has been sent yet, so the job is deferred as a transient
     * infrastructure failure instead of guessing a permission.
     *
     * Manual-owned jobs (agent-approved retries and scheduled sends, manual
     * service-record-link and service-end sends) are not governed by the
     * automatic rule retry policy: the read is skipped, so an unreadable policy
     * can neither defer nor fail them.
     */
    private async readRuleRetryOnFailureOrDefer(job: MessageTriggerJobEntity): Promise<boolean> {
        if (job.ruleId.startsWith(MANUAL_SMS_RULE_PREFIX)) return false;
        if (isManualMessageTriggerJob(job)) return true;
        if (!this.ruleRepository || !job.branchId) return true;
        try {
            const rule = await this.ruleRepository.findByIdIncludingGlobal(job.branchId, job.ruleId);
            return resolveRuleRetryPermission(rule) !== "off";
        } catch (error) {
            this.logger.warn(
                `Failed to read retryOnFailure for rule ${job.ruleId}; deferring job ${job.id}: ${this.formatErrorMessage(error)}`,
            );
            throw new TriggerJobDeferredError("transient", "Rule retry policy could not be read");
        }
    }

    /**
     * Same read for a job whose dispatch is already committed (the prepared
     * path): deferring would re-queue a `dispatching` job for a second send, so a
     * failed read here is final instead - the provider is still called once, but
     * a rejection schedules nothing.
     */
    private async readRuleRetryOnFailureForDispatchedJob(job: MessageTriggerJobEntity): Promise<boolean> {
        try {
            return await this.readRuleRetryOnFailureOrDefer(job);
        } catch (error) {
            if (error instanceof TriggerJobDeferredError) return false;
            throw error;
        }
    }

    canHandle(templateKey: MessageTriggerJobTemplateKey): boolean {
        return templateKey === MANUAL_SMS_TEMPLATE_KEY || Boolean(SMS_TEMPLATE_DELIVERY[templateKey]);
    }

    /**
     * Resolve the exact provider-bound values without mutating the job or
     * calling Aligo. Agent approval, revalidation, and retry execution all use
     * this resolver so they share one immutable snapshot contract.
     */
    async resolveDeliverySnapshot(job: MessageTriggerJobEntity): Promise<Readonly<SmsTriggerDeliverySnapshot>> {
        this.assertDeliveryJob(job);
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }

        const config = job.templateKey === MANUAL_SMS_TEMPLATE_KEY
            ? { smsLogTemplateKey: "manual_sms", automationKey: "ADMIN_DIRECT", triggerType: "manual", title: job.payload.templateVariables["title"] ?? "", usePayloadMessage: true }
            : SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            throw new Error(`SMS trigger template ${job.templateKey} is not supported`);
        }

        const canonical = await this.resolveCanonicalSnapshot(job, config);
        const staged = this.readStagedSnapshot(job, canonical);
        if (staged) {
            if (staged.snapshotHash !== canonical.snapshotHash) {
                throw new Error("SMS delivery template or provider configuration changed after staging");
            }
            return staged;
        }

        return canonical;
    }

    /** Resolve the current provider-bound target without trusting staged data. */
    async resolveCanonicalDeliverySnapshot(job: MessageTriggerJobEntity, transaction?: Prisma.TransactionClient): Promise<Readonly<SmsTriggerDeliverySnapshot>> {
        this.assertDeliveryJob(job);
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }
        const config = job.templateKey === MANUAL_SMS_TEMPLATE_KEY
            ? { smsLogTemplateKey: "manual_sms", automationKey: "ADMIN_DIRECT", triggerType: "manual", title: job.payload.templateVariables["title"] ?? "", usePayloadMessage: true }
            : SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            throw new Error(`SMS trigger template ${job.templateKey} is not supported`);
        }
        return this.resolveCanonicalSnapshot(job, config, transaction);
    }

    /**
     * Validate the exact target that was shown to the approver and rebuild it
     * with the current receiver identity. The durable target never contains a
     * raw phone number.
     */
    approvedSnapshotForExecution(
        job: MessageTriggerJobEntity,
        targetSnapshot: Record<string, unknown>,
        canonical: SmsTriggerDeliverySnapshot,
    ): Readonly<SmsTriggerDeliverySnapshot> {
        const readString = (key: string): string => {
            const value = targetSnapshot[key];
            if (typeof value !== "string") throw new Error(`approved SMS snapshot field ${key} is invalid`);
            return value;
        };
        if (readString("templateKey") !== job.templateKey) throw new Error("approved SMS template key changed");
        if (readString("receiver") !== canonical.maskedReceiver) throw new Error("approved SMS recipient changed");
        if (targetSnapshot["requestedDeliveryType"] !== "AUTO") throw new Error("approved SMS requested delivery type changed");
        const deliveryType = readString("deliveryType") as AligoSmsMessageType;
        if (deliveryType !== "SMS" && deliveryType !== "LMS") throw new Error("approved SMS delivery type is invalid");

        const candidateWithoutHash: Omit<SmsTriggerDeliverySnapshot, "snapshotHash"> = {
            templateKey: job.templateKey,
            receiver: canonical.receiver,
            maskedReceiver: canonical.maskedReceiver,
            recipientName: canonical.recipientName,
            message: readString("messageBody"),
            title: readString("title"),
            requestedDeliveryType: "AUTO",
            deliveryType,
            estimatedCost: readString("estimatedCost"),
            templateVersion: readString("templateVersion"),
            templateHash: readString("templateHash"),
            configVersion: readString("configVersion"),
            configHash: readString("configHash"),
            ...(typeof targetSnapshot["systemTemplateKey"] === "string"
                ? { systemTemplateKey: targetSnapshot["systemTemplateKey"] as SystemTemplateKey }
                : {}),
        };
        const snapshotHash = readString("snapshotHash");
        if (this.hashSnapshot(candidateWithoutHash) !== snapshotHash || snapshotHash !== canonical.snapshotHash) {
            throw new Error("approved SMS snapshot does not match the current provider-bound target");
        }

        return Object.freeze({ ...candidateWithoutHash, snapshotHash });
    }

    /** Return only fields safe to persist in an approval target snapshot. */
    snapshotForApproval(snapshot: SmsTriggerDeliverySnapshot): Record<string, unknown> {
        return {
            templateKey: snapshot.templateKey,
            receiver: snapshot.maskedReceiver,
            messageBody: snapshot.message,
            title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType,
            estimatedCost: snapshot.estimatedCost,
            templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            snapshotHash: snapshot.snapshotHash,
            ...(snapshot.systemTemplateKey ? { systemTemplateKey: snapshot.systemTemplateKey } : {}),
        };
    }

    /**
     * Stage exact rendered values on an agent retry job. The serialized form
     * intentionally omits the raw receiver so persisted approval/log payloads
     * cannot disclose it.
     */
    serializeSnapshot(snapshot: SmsTriggerDeliverySnapshot): string {
        return JSON.stringify({
            templateKey: snapshot.templateKey,
            maskedReceiver: snapshot.maskedReceiver,
            recipientName: snapshot.recipientName,
            message: snapshot.message,
            title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType,
            estimatedCost: snapshot.estimatedCost,
            templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            snapshotHash: snapshot.snapshotHash,
            ...(snapshot.systemTemplateKey ? { systemTemplateKey: snapshot.systemTemplateKey } : {}),
        });
    }

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        this.assertDeliveryJob(job);
        if (!this.automationDeliveryGate || !await this.automationDeliveryGate.permitsDirectManualJob(job)) {
            if (job.status === "dispatching") throw new AgentAutomationDispatchUncertainError();
            job.cancel("문자 동의 또는 발송 대상 확인이 필요합니다");
            return false;
        }
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }

        const config = job.templateKey === MANUAL_SMS_TEMPLATE_KEY
            ? { smsLogTemplateKey: "manual_sms", automationKey: "ADMIN_DIRECT", triggerType: "manual", title: job.payload.templateVariables["title"] ?? "", usePayloadMessage: true }
            : SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            return false;
        }

        try {
            // A staged snapshot (agent-approved retry: message-external-agent-capabilities.provider.ts)
            // already carries a message body that was hashed and approved before this dispatch.
            // Enriching now would change job.payload.templateVariables and make the canonical
            // re-render diverge from what was approved, so resolveDeliverySnapshot's staged-vs-canonical
            // hash check would reject with "changed after staging" and the provider would never be
            // called. Skip mutating enrichment for a staged snapshot, while allowing its enricher
            // to validate that an approved external capability is still usable.
            const hasStagedSnapshot = this.hasStagedDeliverySnapshot(job);
            const enricher = job.templateKey === MANUAL_SMS_TEMPLATE_KEY ? null : this.enricherRegistry?.get(job.templateKey) ?? null;
            if (hasStagedSnapshot && job.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE) {
                if (!enricher?.validateStagedSnapshot) {
                    throw new SmsTriggerDeliverySkipError(
                        "receipt_link_validation_unavailable",
                        "승인된 영수증 링크를 확인할 수 없어 재시도하지 않았습니다",
                    );
                }
                await enricher.validateStagedSnapshot(job);
            } else if (!hasStagedSnapshot && enricher) {
                await enricher.enrich(job);
            }
            return await this.sendSmsJob(job, config);
        } catch (error) {
            if (error instanceof SmsTriggerDeliverySkipError) {
                job.cancel(`메시지 발송 건너뜀: ${error.message}`);
                this.logger.warn(`[SMS Automation] ${job.templateKey} skipped for job ${job.id}: ${error.reason}`);
                return false;
            }
            if (error instanceof MissingSmsTemplateVariablesError) {
                const reason = `필수 정보 누락 (${error.variableKeys.join(", ")})`;
                if (isManualMessageTriggerJob(job)) job.cancel(`메시지 발송 건너뜀: ${reason}`);
                else job.markNeedsSetup(reason);
                this.logger.warn(
                    `[SMS Automation] ${job.templateKey} skipped for job ${job.id}: missing ${error.variableKeys.join(", ")}`,
                );
                return false;
            }
            if (error instanceof BranchSystemTemplateSnapshotError && !isManualMessageTriggerJob(job)) {
                job.markNeedsSetup("템플릿을 찾을 수 없습니다");
                return false;
            }
            throw error;
        }
    }

    /**
     * Prepare a provider-bound delivery before the caller commits its durable
     * dispatch marker. Receipt/document enrichers run here, while the
     * subsequent `sendPreparedJob` path is intentionally side-effect free
     * until the caller has completed its atomic source/claim fence.
     *
     * The existing `sendJob` API remains unchanged for direct callers and
     * retries. The message-trigger scheduler uses this two-step API so a
     * failed preparation can never leave a job in `dispatching`.
     */
    async prepareJob(job: MessageTriggerJobEntity): Promise<SmsTriggerDeliveryPreparation | null> {
        this.assertDeliveryJob(job);
        if (!this.automationDeliveryGate || !await this.automationDeliveryGate.consumePreparation(job)) {
            job.cancel("문자 동의 또는 발송 대상 확인이 필요합니다");
            return null;
        }
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }

        const config = job.templateKey === MANUAL_SMS_TEMPLATE_KEY
            ? { smsLogTemplateKey: "manual_sms", automationKey: "ADMIN_DIRECT", triggerType: "manual", title: job.payload.templateVariables["title"] ?? "", usePayloadMessage: true }
            : SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            return null;
        }
        // Probe only: an unreadable policy defers the job here, before the
        // irreversible dispatch marker. sendPreparedJob reads it again, fresh.
        await this.readRuleRetryOnFailureOrDefer(job);

        const previousVariables = { ...job.payload.templateVariables };
        const previousButtonUrl = job.payload.buttonUrl;
        try {
            // A staged snapshot is already approved and immutable. Validate
            // its receipt capability without running a mutating enricher;
            // the canonical snapshot check below still verifies the staged
            // values against the current recipient/template contract.
            const hasStagedSnapshot = this.hasStagedDeliverySnapshot(job);
            const enricher = job.templateKey === MANUAL_SMS_TEMPLATE_KEY ? null : this.enricherRegistry?.get(job.templateKey) ?? null;
            if (hasStagedSnapshot && job.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE) {
                if (!enricher?.validateStagedSnapshot) {
                    throw new SmsTriggerDeliverySkipError(
                        "receipt_link_validation_unavailable",
                        "승인된 영수증 링크를 확인할 수 없어 재시도하지 않았습니다",
                    );
                }
                await enricher.validateStagedSnapshot(job);
            } else if (!hasStagedSnapshot && enricher) {
                await enricher.enrich(job);
            }

            const snapshot = await this.resolveDeliverySnapshot(job);
            const serializedSnapshot = hasStagedSnapshot
                ? job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE]
                : this.serializeSnapshot(snapshot);
            if (!serializedSnapshot) {
                throw new Error("SMS delivery snapshot could not be serialized");
            }

            // Reuse the existing staged snapshot field as the durable frozen
            // delivery payload. This makes retries consume the same prepared
            // receipt/message values without introducing another queue or
            // payload format.
            job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = serializedSnapshot;
            return Object.freeze({ snapshot, serializedSnapshot });
        } catch (error) {
            // Preparation is provisional. Restore the payload so a failed
            // receipt render/upload/token issuance leaves no staged snapshot
            // or mutable URL for a later retry to mistake as authorized.
            job.payload.templateVariables = previousVariables;
            job.payload.buttonUrl = previousButtonUrl;

            if (error instanceof SmsTriggerDeliverySkipError) {
                job.cancel(`메시지 발송 건너뜀: ${error.message}`);
                this.logger.warn(`[SMS Automation] ${job.templateKey} skipped for job ${job.id}: ${error.reason}`);
                return null;
            }
            if (error instanceof MissingSmsTemplateVariablesError) {
                const reason = `필수 정보 누락 (${error.variableKeys.join(", ")})`;
                if (isManualMessageTriggerJob(job)) job.cancel(`메시지 발송 건너뜀: ${reason}`);
                else job.markNeedsSetup(reason);
                this.logger.warn(
                    `[SMS Automation] ${job.templateKey} skipped for job ${job.id}: missing ${error.variableKeys.join(", ")}`,
                );
                return null;
            }
            if (error instanceof BranchSystemTemplateSnapshotError && !isManualMessageTriggerJob(job)) {
                job.markNeedsSetup("템플릿을 찾을 수 없습니다");
                return null;
            }
            throw error;
        }
    }

    /**
     * Send the exact snapshot produced by `prepareJob`. No enricher,
     * template lookup, receipt issuance, token minting, or fresh recipient
     * resolution occurs after the caller's durable authorization fence.
     */
    async sendPreparedJob(
        job: MessageTriggerJobEntity,
        preparation: SmsTriggerDeliveryPreparation,
    ): Promise<boolean> {
        this.assertDeliveryJob(job);
        if (!this.automationDeliveryGate) throw new AgentAutomationDispatchUncertainError();
        await this.automationDeliveryGate.consumeDispatch(job, preparation);
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }
        const config = job.templateKey === MANUAL_SMS_TEMPLATE_KEY
            ? { smsLogTemplateKey: "manual_sms", automationKey: "ADMIN_DIRECT", triggerType: "manual", title: job.payload.templateVariables["title"] ?? "", usePayloadMessage: true }
            : SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            return false;
        }
        if (job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] !== preparation.serializedSnapshot) {
            throw new AgentAutomationDispatchUncertainError();
        }
        return this.sendSmsJob(job, config, preparation.snapshot);
    }

    private assertDeliveryJob(job: MessageTriggerJobEntity): void {
        if (job.templateKey === MANUAL_SMS_TEMPLATE_KEY || job.ruleId.startsWith(MANUAL_SMS_RULE_PREFIX)) {
            if (!job.branchId || job.ruleId !== MANUAL_SMS_RULE_PREFIX + job.branchId || job.templateKey !== MANUAL_SMS_TEMPLATE_KEY
                || job.payload.origin !== "ADMIN_DIRECT" || !Number.isSafeInteger(job.payload.existingMessageLogId)
                || !job.payload.existingMessageLogId || job.payload.agentAutomationSeal || job.payload.taskAutomationReference
                || job.employeeScheduleId !== null || !job.dedupeKey.startsWith(`manual-sms:${job.branchId}:`)
                || job.recipientPhone !== job.payload.recipientPhone || typeof job.payload.messageBody !== "string"
                || !job.payload.messageBody.trim()) throw new SmsTriggerDeliverySkipError("Invalid manual SMS holder");
        }
        if (isCaregiverTriggerTemplate(job.templateKey)) {
            const source = job.payload.caregiverSourceSnapshot;
            if (isManualMessageTriggerJob(job) || !job.employeeScheduleId || !source || source.version !== 1
                || !source.groupId || source.ruleId !== job.ruleId || source.schedule.id !== job.employeeScheduleId
                || source.employee.id !== job.payload.employeeId
                || ![MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerRecipientType.SECONDARY_EMPLOYEE].includes(job.recipientType)) {
                throw new SmsTriggerDeliverySkipError("Caregiver service source is unavailable");
            }
        }
        if (isReservedAutomationJob(job)) throw new SmsTriggerDeliverySkipError("Internal automation records cannot be delivered");
    }

    /**
     * True when this job's payload already carries a staged delivery snapshot
     * (SMS_DELIVERY_SNAPSHOT_VARIABLE) — i.e. an agent-approved retry whose message
     * body was already resolved, hashed, and approved before this dispatch.
     */
    private hasStagedDeliverySnapshot(job: MessageTriggerJobEntity): boolean {
        return Boolean(job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE]);
    }

    private async sendSmsJob(
        job: MessageTriggerJobEntity,
        config: SmsTemplateDeliveryConfig,
        preparedSnapshot?: Readonly<SmsTriggerDeliverySnapshot>,
    ): Promise<boolean> {
        const payload = job.payload;
        // Before any attempt row or provider bookkeeping. A prepared send has
        // already crossed the irreversible dispatch marker and cannot be deferred.
        const retryOnFailure = preparedSnapshot
            ? await this.readRuleRetryOnFailureForDispatchedJob(job)
            : await this.readRuleRetryOnFailureOrDefer(job);
        if (!this.systemSettingService || !job.branchId) {
            throw new Error("SMS retry timing policy is unavailable");
        }
        const { configuration } = await this.systemSettingService.getMessageAutomationPolicyConfig(job.branchId);
        const retryDelayMs = configuration.smsRetryIntervalMinutes * 60 * 1000;
        const snapshot = preparedSnapshot ?? await this.resolveDeliverySnapshot(job);

        const pendingAttempt = this.buildSmsLog({
            job,
            config,
            snapshot,
            receiver: snapshot.receiver,
            status: "pending",
            aligoMid: null,
            errorMessage: null,
            msgType: snapshot.requestedDeliveryType,
            templateVariables: payload.templateVariables,
            retryDelayMs,
        });
        // A few legacy in-process adapters return void from save even though
        // the repository contract returns the persisted entity. Treat that as
        // the newly staged attempt; production repositories always return the
        // mapped row and therefore retain duplicate convergence semantics.
        const manualLog = job.templateKey === MANUAL_SMS_TEMPLATE_KEY
            ? await this.logRepository.findByIdInBranch(job.branchId, job.payload.existingMessageLogId!) : null;
        if (job.templateKey === MANUAL_SMS_TEMPLATE_KEY && (!manualLog || manualLog.triggerJobId !== job.id
            || manualLog.providerAcceptanceState !== "prepared" || manualLog.providerCallStartedAt !== null
            || manualLog.receiver !== snapshot.receiver || manualLog.messageBody !== snapshot.message)) throw new AgentAutomationDispatchUncertainError();
        const persistedAttempt = manualLog ?? (this.acceptanceService
            ? await this.acceptanceService.prepare(pendingAttempt)
            : await this.logRepository.save(pendingAttempt)) ?? pendingAttempt;

        // A duplicate dispatch converges on the existing durable row. Never
        // cross the provider boundary again once that row is started,
        // uncertain, or already has a result.
        if (persistedAttempt !== pendingAttempt
            && persistedAttempt.providerAcceptanceState !== "prepared") {
            if (persistedAttempt.providerAcceptanceState === "accepted"
                || persistedAttempt.providerAcceptanceState === "reconciled_delivered"
                || persistedAttempt.status === "sent") {
                return true;
            }
            throw new Error(
                "SMS provider attempt is already in progress or requires reconciliation; automatic resend is disabled",
            );
        }

        const admission = await runSmsQuietHoursAdmission(this.quietHours, this.systemSettingService, job.branchId, snapshot.receiver,
            async (decision, transaction): Promise<
                | { kind: "ready"; attempt: MessageLogEntity }
                | { kind: "held"; hold: MessageQuietHold }
                | { kind: "duplicate" }
                | { kind: "refused"; decision: { action: "CANCEL"; reevaluateAt: null }; canceledAt: Date | null; durableCancellation?: true }
            > => {
                if (!transaction) {
                    // Only the explicit schema-valid OFF direct-builder compatibility path.
                    if (isQuietHoursCanceled(persistedAttempt)) return { kind: "refused", decision: { action: "CANCEL", reevaluateAt: null }, canceledAt: null };
                    return { kind: "ready", attempt: (this.acceptanceService
                        ? await this.acceptanceService.beginProviderCall(persistedAttempt)
                        : this.beginProviderCallWithoutBoundary(persistedAttempt)) ?? persistedAttempt };
                }
                if (!persistedAttempt.providerAcceptanceKey || !persistedAttempt.providerAcceptanceFingerprint) throw new AgentAutomationDispatchUncertainError();
                const current = await transaction.message_log.findUnique({ where: {
                    id: persistedAttempt.id, branchId: job.branchId,
                    providerAcceptanceKey: persistedAttempt.providerAcceptanceKey,
                    providerAcceptanceFingerprint: persistedAttempt.providerAcceptanceFingerprint,
                } });
                if (!current || current.id !== persistedAttempt.id || current.branchId !== job.branchId
                    || current.provider !== "aligo_sms" || current.triggerJobId !== job.id
                    || !persistedAttempt.providerAcceptanceKey || current.providerAcceptanceKey !== persistedAttempt.providerAcceptanceKey
                    || !persistedAttempt.providerAcceptanceFingerprint || current.providerAcceptanceFingerprint !== persistedAttempt.providerAcceptanceFingerprint
                    || current.providerAcceptanceState !== "prepared" || current.providerCallStartedAt !== null) {
                    throw new AgentAutomationDispatchUncertainError();
                }
                const variables = current.variables && typeof current.variables === "object" && !Array.isArray(current.variables)
                    ? current.variables : {};
                const currentHold = parseMessageQuietHold(variables);
                if (variables["quietHoursDisposition"] === "DEFER" && !currentHold) throw new AgentAutomationDispatchUncertainError();
                const canceled = variables["quietHoursDisposition"] === "CANCEL";
                if (canceled && (current.status !== "failed" || current.errorMessage !== QUIET_HOURS_CANCEL_REASON || current.nextRetryAt !== null)) {
                    throw new AgentAutomationDispatchUncertainError();
                }
                const currentJob = await transaction.message_trigger_job.findFirst({ where: { id: job.id, branchId: job.branchId } });
                if (!currentJob || !this.matchesQuietCancellationJob(job, currentJob)
                    || !(currentJob.status === "dispatching" && job.claimToken && currentJob.claimToken === job.claimToken
                        && currentJob.processingDeadlineAt?.getTime() === job.processingDeadlineAt?.getTime())
                    && !(canceled && currentJob.status === "canceled" && currentJob.cancelReason === QUIET_HOURS_CANCEL_REASON)) {
                    throw new AgentAutomationDispatchUncertainError();
                }
                const finish = async (finalDecision: typeof decision, _tx?: Prisma.TransactionClient, revision?: string | null) => {
                    if (finalDecision.action === "CANCEL") {
                        if (currentJob.status === "canceled") return { kind: "refused" as const, decision: finalDecision, canceledAt: currentJob.canceledAt, durableCancellation: true as const };
                        const canceledAt = new Date(Date.now());
                        const canceledJob = await transaction.message_trigger_job.updateMany({
                            where: { id: job.id, branchId: job.branchId, status: "dispatching", claimToken: job.claimToken,
                                processingDeadlineAt: job.processingDeadlineAt, updatedAt: currentJob.updatedAt,
                                ruleId: job.ruleId, clientId: job.clientId, employeeScheduleId: job.employeeScheduleId,
                                recipientType: job.recipientType, recipientPhone: job.recipientPhone, templateKey: job.templateKey,
                                dedupeKey: job.dedupeKey, scheduledFor: job.scheduledFor,
                                payload: { equals: currentJob.payload as Prisma.InputJsonValue } },
                            data: { status: "canceled", cancelReason: QUIET_HOURS_CANCEL_REASON, canceledAt,
                                nextAttemptAt: null, claimToken: null, processingDeadlineAt: null },
                        });
                        if (canceledJob.count !== 1) throw new AgentAutomationDispatchUncertainError();
                        const refused = await transaction.message_log.updateMany({
                            where: { id: current.id, branchId: job.branchId, providerAcceptanceState: "prepared",
                                providerAcceptanceKey: current.providerAcceptanceKey, providerAcceptanceFingerprint: current.providerAcceptanceFingerprint,
                                updatedAt: current.updatedAt, variables: { equals: current.variables as Prisma.InputJsonValue } },
                            data: { status: "failed", nextRetryAt: null, errorMessage: QUIET_HOURS_CANCEL_REASON,
                                variables: { ...variables, quietHoursDisposition: "CANCEL",
                                    ...(job.templateKey === MANUAL_SMS_TEMPLATE_KEY
                                        ? { manualQueueStatus: "canceled", manualQueueReason: QUIET_HOURS_CANCEL_REASON } : {}) } },
                        });
                        if (refused.count !== 1) throw new AgentAutomationDispatchUncertainError();
                        return { kind: "refused" as const, decision: finalDecision, canceledAt, durableCancellation: true as const };
                    }
                    if (finalDecision.action === "DEFER") {
                        if (!this.jobRepository || !revision) throw new AgentAutomationDispatchUncertainError();
                        const hold = await this.jobRepository.transitionQuietHold(job, current.id,
                            persistedAttempt.providerAcceptanceKey!, persistedAttempt.providerAcceptanceFingerprint!, finalDecision, revision, transaction);
                        if (!hold) throw new AgentAutomationDispatchUncertainError();
                        return { kind: "held" as const, hold };
                    }
                    return { kind: "ready" as const, attempt: (this.acceptanceService
                        ? await this.acceptanceService.beginProviderCall(persistedAttempt, transaction)
                        : this.beginProviderCallWithoutBoundary(persistedAttempt)) ?? persistedAttempt };
                };
                if (job.templateKey === MANUAL_SMS_TEMPLATE_KEY) {
                    await this.validateManualInlineSource(job, transaction);
                    const duplicatesEnabled = await this.systemSettingService!.getMessageSettingsPolicyEnabled(job.branchId!, "duplicate-send-confirmation", async key => {
                        const stored = await transaction.system_setting.findUnique({ where: { key } });
                        if (stored && stored.value !== "true" && stored.value !== "false") throw new AgentAutomationDispatchUncertainError();
                        return stored?.value ?? null;
                    });
                    if (duplicatesEnabled) {
                        const policy = await this.systemSettingService!.getMessageAutomationPolicyConfig(job.branchId!, transaction);
                        const now = new Date(Date.now());
                        const matches = await this.logRepository.findSmsDuplicateMatches({ branchId: job.branchId!, receivers: [snapshot.receiver],
                            messageBody: snapshot.message.replace(/\r\n/g, "\n").trim(),
                            from: new Date(now.getTime() - policy.configuration.duplicateWindowHours * 3_600_000), to: now }, transaction);
                        let confirmed: number[] = [];
                        if (typeof variables["duplicateDecision"] === "string") {
                            const previous = JSON.parse(variables["duplicateDecision"]);
                            if (previous.confirmed === true && previous.payloadHash === current.providerAcceptanceFingerprint && Array.isArray(previous.matchIds)) confirmed = previous.matchIds;
                        }
                        if (matches.some(match => !confirmed.includes(match.id))) {
                            if (!this.jobRepository) throw new AgentAutomationDispatchUncertainError();
                            await this.jobRepository.transitionQuietHold(job, current.id, current.providerAcceptanceKey!, current.providerAcceptanceFingerprint!,
                                { action: "CANCEL", reevaluateAt: null }, policy.version ?? "", transaction, "duplicate_at_release");
                            return { kind: "duplicate" as const };
                        }
                    }
                }
                if (canceled) return finish({ action: "CANCEL", reevaluateAt: null });
                // Fresh DB reads above may wait. Reuse the final gate in this SAME
                // transaction so its actual clock is sampled immediately before CAS.
                return runSmsQuietHoursAdmission(this.quietHours, this.systemSettingService, job.branchId, snapshot.receiver, finish, transaction, currentHold?.releaseAt);
            });
        if (admission.kind === "duplicate") {
            job.cancel("duplicate_at_release"); job.nextAttemptAt = null; job.claimToken = null; job.processingDeadlineAt = null;
            persistedAttempt.markRetrySuperseded("duplicate_at_release");
            return false;
        }
        if (admission.kind === "held") {
            job.status = "pending";
            job.nextAttemptAt = admission.hold.releaseAt;
            job.claimToken = null;
            job.processingDeadlineAt = null;
            job.quietHold = admission.hold;
            persistedAttempt.variables = { ...persistedAttempt.variables, ...messageQuietHoldVariables(admission.hold) };
            persistedAttempt.status = "pending";
            persistedAttempt.nextRetryAt = null;
            return false;
        }
        if (admission.kind === "refused") {
            // No in-memory terminal transition is visible until the transaction commits.
            recordQuietHoursRefusal(persistedAttempt, admission.decision);
            if (admission.decision.action === "CANCEL") {
                job.cancel(QUIET_HOURS_CANCEL_REASON);
                job.nextAttemptAt = null;
                if (admission.durableCancellation) {
                    job.claimToken = null;
                    job.processingDeadlineAt = null;
                }
                if (admission.canceledAt) job.canceledAt = admission.canceledAt;
            }
            return false;
        }
        const attempt = admission.attempt;

        try {
            const result = await this.aligoService.sendSms({
                receiver: snapshot.receiver,
                message: snapshot.message,
                recipientName: snapshot.recipientName,
                title: snapshot.title,
                msgType: snapshot.requestedDeliveryType,
                ...(job.templateKey === MANUAL_SMS_TEMPLATE_KEY ? { testMode: job.payload.templateVariables["testMode"] === "true" } : {}),
            });
            const outcome = classifySmsProviderOutcome(result, countSmsRecipients(snapshot.receiver));
            attempt.aligoMid = result?.response?.msg_id ? String(result.response.msg_id) : null;
            if (outcome === "unknown") {
                // 기존 예외 경로에서 uncertain을 기록하고 작업에도 같은 실패를 전달한다.
                attempt.nextRetryAt = null;
                throw new Error("문자 발송 결과를 확인할 수 없어 자동 재전송을 중단했습니다.");
            }
            const isAccepted = outcome === "accepted";
            const rejection = outcome === "rejected" ? classifySmsProviderRejection(result) : null;
            const isPermanent = rejection?.kind === "permanent";
            attempt.receiver = result.request.receiver;
            attempt.providerAcceptanceState = isAccepted ? "accepted" : "rejected";
            attempt.providerAcceptedAt = isAccepted ? new Date(Date.now()) : null;
            attempt.errorMessage = isAccepted ? null : isPermanent
                ? `발송 실패: ${rejection.reason}`
                : result.response.message;
            attempt.status = isAccepted ? "sent" : "failed";
            attempt.attempts += 1;
            attempt.lastAttemptAt = new Date(Date.now());
            attempt.nextRetryAt = !isAccepted && !isPermanent && retryOnFailure && attempt.canRetry()
                ? new Date(Date.now() + retryDelayMs)
                : null;
            attempt.updatedAt = new Date(Date.now());
            if (isAccepted && attempt.aligoMid) {
                attempt.scheduleCarrierCheck(attempt.providerAcceptedAt ?? new Date(Date.now()));
            }
            job.payload.templateVariables["retrySafety"] = isAccepted ? "delivered"
                : isPermanent ? "permanent-provider-rejected" : "provider-rejected";
            if (isPermanent) {
                attempt.variables = { ...attempt.variables, retrySafety: "permanent-provider-rejected" };
            }
            await this.persistAttempt(attempt);
            return isAccepted;
        } catch (error) {
            job.payload.templateVariables["retrySafety"] = "uncertain";
            const errorMessage = this.formatErrorMessage(error);
            try {
                if (attempt.providerAcceptanceState === "started") {
                    attempt.markProviderOutcomeUncertain(errorMessage);
                }
                await this.persistAttempt(attempt);
            } catch (logError) {
                this.logger.warn(
                    `Failed to record SMS log: ${this.formatErrorMessage(logError)}`,
                );
            }
            throw error;
        }
    }

    private matchesQuietCancellationJob(job: MessageTriggerJobEntity,
        current: Awaited<ReturnType<Prisma.TransactionClient["message_trigger_job"]["findFirstOrThrow"]>>): boolean {
        try {
            const payload = current.payload as unknown as MessageTriggerJobEntity["payload"];
            return agentAutomationConcreteJobDigest(current) === agentAutomationConcreteJobDigest(job)
                && agentBindingHash(payload.agentAutomationSeal) === agentBindingHash(job.payload.agentAutomationSeal)
                && payload.templateVariables?.[SMS_DELIVERY_SNAPSHOT_VARIABLE] === job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE];
        } catch { return false; }
    }

    private beginProviderCallWithoutBoundary(log: MessageLogEntity): MessageLogEntity {
        if (log.providerAcceptanceState !== "prepared") {
            throw new Error(`SMS provider attempt cannot start from ${log.providerAcceptanceState}`);
        }
        log.providerAcceptanceState = "started";
        log.providerCallStartedAt = new Date(Date.now());
        return log;
    }

    private async persistAttempt(log: MessageLogEntity): Promise<void> {
        const repository = this.logRepository as IMessageLogRepository & {
            update?: (attempt: MessageLogEntity) => Promise<MessageLogEntity>;
        };
        if (typeof repository.update === "function") {
            await repository.update(log);
        }
    }

    private async resolveCanonicalSnapshot(
        job: MessageTriggerJobEntity,
        config: SmsTemplateDeliveryConfig,
        transaction?: Prisma.TransactionClient,
    ): Promise<Readonly<SmsTriggerDeliverySnapshot>> {
        const branchId = job.branchId;
        if (!branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }
        const payload = job.payload;
        if (job.templateKey === MANUAL_SMS_TEMPLATE_KEY) await this.validateManualInlineSource(job, transaction);
        const baseVariables: Record<string, string> = {
            name: payload.recipientName,
            employeeName: payload.recipientName,
            clientName: payload.recipientName,
            buttonUrl: payload.buttonUrl ?? "",
            serviceRecordUrl: payload.buttonUrl ?? "",
            ...publicMessageVariables(payload.templateVariables),
        };
        const usesPayloadMessage = config.usePayloadMessage || payload.templateVariables["triggerType"] === "agent_scheduled";
        const template = job.templateKey === MANUAL_SMS_TEMPLATE_KEY
            ? { content: payload.messageBody!, version: "manual-inline-v1", hash: this.hash(payload.messageBody), requiredVariableKeys: [] }
            : usesPayloadMessage ? this.resolvePayloadTemplate(job)
            : await this.resolveSystemTemplate(config.systemTemplateKey, branchId, transaction);
        const missingVariableKeys = template.requiredVariableKeys.filter(
            (key) => !baseVariables[key]?.trim(),
        );
        if (missingVariableKeys.length > 0) {
            throw new MissingSmsTemplateVariablesError(missingVariableKeys);
        }
        // Payload messages retain the legacy trim/no-render behavior in
        // resolvePayloadTemplate; editable system templates are rendered
        // byte-for-byte so approval and provider requests remain equivalent.
        const message = usesPayloadMessage
            ? template.content
            : this.renderTemplate(template.content, baseVariables);
        const title = usesPayloadMessage
            ? payload.templateVariables["title"]?.trim() || config.title
            : config.title;
        const receiver = payload.recipientPhone?.trim() || job.recipientPhone?.trim() || "";
        if (!receiver) {
            throw new Error(`SMS recipient is missing for job ${job.id}`);
        }

        const requestedDeliveryType: "AUTO" | AligoSmsMessageType = job.templateKey === MANUAL_SMS_TEMPLATE_KEY && (payload.templateVariables["msgType"] === "SMS" || payload.templateVariables["msgType"] === "LMS")
            ? payload.templateVariables["msgType"] as AligoSmsMessageType : "AUTO";
        const deliveryType = resolveAligoSmsMessageType({ message, title, requestedType: requestedDeliveryType });
        const configHash = this.hash({
            version: SMS_DELIVERY_CONFIG_VERSION,
            templateKey: job.templateKey,
            config,
            title,
            requestedDeliveryType,
        });
        const snapshotWithoutHash = {
            templateKey: job.templateKey,
            receiver,
            maskedReceiver: this.maskedReceiver(receiver),
            recipientName: payload.recipientName,
            message,
            title,
            requestedDeliveryType,
            deliveryType,
            estimatedCost: `${deliveryType} 요금제 기준`,
            templateVersion: template.version,
            templateHash: template.hash,
            configVersion: SMS_DELIVERY_CONFIG_VERSION,
            configHash,
            ...(config.systemTemplateKey ? { systemTemplateKey: config.systemTemplateKey } : {}),
        };
        return Object.freeze({
            ...snapshotWithoutHash,
            snapshotHash: this.hashSnapshot(snapshotWithoutHash),
        });
    }

    private async validateManualInlineSource(job: MessageTriggerJobEntity, transaction?: Prisma.TransactionClient): Promise<void> {
        if (!transaction) {
            if (!this.quietHours) throw new AgentAutomationDispatchUncertainError();
            return this.quietHours.runAdmission(job.branchId!, job.recipientPhone!, async (_decision, tx) => {
                if (!tx) throw new AgentAutomationDispatchUncertainError();
                return this.validateManualInlineSource(job, tx);
            });
        }
        const holder = await transaction.message_trigger_rule.findFirst({ where: { id: job.ruleId, branchId: job.branchId,
            templateKey: MANUAL_SMS_TEMPLATE_KEY, isActive: false, groupId: null, deletedAt: null, retryOnFailure: false, jobsStale: false } });
        const log = await transaction.message_log.findFirst({ where: { id: job.payload.existingMessageLogId, branchId: job.branchId,
            triggerJobId: job.id, provider: "aligo_sms", providerAcceptanceState: "prepared", providerCallStartedAt: null } });
        const v = log?.variables && typeof log.variables === "object" && !Array.isArray(log.variables) ? log.variables : {};
        let fingerprint: Record<string, unknown>;
        try { fingerprint = JSON.parse(String(v["manualQueueFingerprintInput"])); }
        catch { throw new AgentAutomationDispatchUncertainError(); }
        const sender = this.defaultSender?.read();
        if (!sender || sender.availability !== "available" || sender.identityDigest !== job.payload.templateVariables["senderIdentityDigest"]
            || sender.identityDigest !== v["manualQueueSenderIdentity"]) throw new SmsTriggerDeliverySkipError("Manual sender changed");
        const requestKey = v["manualQueueRequestKey"];
        const ordinal = Number(v["manualQueueOrdinal"]);
        const rootKey = typeof requestKey === "string" && requestKey.length
            ? buildSmsProviderAcceptanceKey("manual", `${job.branchId}:${requestKey}`) : null;
        const expectedKey = rootKey && Number.isSafeInteger(ordinal) && ordinal >= 0
            ? ordinal === 0 ? rootKey : buildSmsProviderAcceptanceKey("manual", `${rootKey}:ordinal:${ordinal}`) : null;
        if (!holder || !log || !expectedKey || log.providerAcceptanceKey !== expectedKey
            || job.dedupeKey !== `manual-sms:${job.branchId}:${expectedKey}` || !log.providerAcceptanceFingerprint
            || String(ordinal) !== v["manualQueueOrdinal"] || ordinal >= Number(v["manualQueueCount"])
            || v["origin"] !== "ADMIN_DIRECT" || v["manualQueueMode"] !== "internal"
            || fingerprint["branchId"] !== job.branchId || fingerprint["message"] !== job.payload.messageBody
            || typeof fingerprint["receiver"] !== "string" || !fingerprint["receiver"].split(",").includes(job.recipientPhone!)
            || fingerprint["title"] !== (job.payload.templateVariables["title"]?.trim() || null)
            || fingerprint["msgType"] !== (job.payload.templateVariables["msgType"] ?? "AUTO")
            || fingerprint["testMode"] !== (job.payload.templateVariables["testMode"] === "true")
            || buildSmsProviderAcceptanceFingerprint(fingerprint) !== log.providerAcceptanceFingerprint
            || log.recipientPhone !== job.recipientPhone || log.receiver !== job.recipientPhone
            || log.messageBody !== job.payload.messageBody || log.clientId !== job.clientId) throw new AgentAutomationDispatchUncertainError();
        const identity = job.payload.employeeId != null
            ? await transaction.employee.findFirst({ where: { id: job.payload.employeeId, branchId: job.branchId!, deletedAt: null }, select: { phone: true } })
            : job.clientId != null ? await transaction.client.findFirst({ where: { id: job.clientId, branchId: job.branchId!, deletedAt: null }, select: { phone: true } }) : null;
        if (!identity || normalizePhone(identity.phone) !== job.recipientPhone) throw new SmsTriggerDeliverySkipError("Manual recipient changed");
    }

    private async resolveSystemTemplate(
        systemTemplateKey: SystemTemplateKey | undefined,
        branchId: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<ResolvedSmsTemplate> {
        if (!systemTemplateKey) {
            throw new Error("systemTemplateKey is required for templated SMS delivery");
        }
        if (isCaregiverSystemTemplateKey(systemTemplateKey)) {
            if (!this.caregiverTemplates) throw new BranchSystemTemplateSnapshotError(branchId, systemTemplateKey, "resolver unavailable");
            return this.caregiverTemplates.resolve(branchId, systemTemplateKey, transaction);
        }
        try {
            const template = transaction ? await this.systemTemplateService.getByKeyForBranch(branchId, systemTemplateKey, transaction)
                : await this.systemTemplateService.getByKeyForBranch(branchId, systemTemplateKey);
            const content = template.content;
            const hash = this.hash(content);
            const updatedAt = template.updatedAt instanceof Date && !Number.isNaN(template.updatedAt.getTime())
                ? template.updatedAt.toISOString()
                : `content:${hash}`;
            const requiredVariableKeys = new Set<string>([
                ...SYSTEM_TEMPLATE_REGISTRY[systemTemplateKey].requiredVariables
                    .filter((variable) => variable.required)
                    .map((variable) => variable.key),
                ...(template.requiredVariables ?? [])
                    .filter((variable) => variable.required)
                    .map((variable) => variable.key),
                ...(template.customVariables ?? [])
                    .filter((variable) => variable.required)
                    .map((variable) => variable.key),
            ]);
            return {
                content,
                version: `${template.id || systemTemplateKey}:${updatedAt}`,
                hash,
                requiredVariableKeys: [...requiredVariableKeys],
            };
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                throw new TriggerJobDeferredError(
                    "transient",
                    error instanceof Error ? error.message : String(error),
                );
            }

            // Missing rows are normalized by the branch resolver. Any failure
            // here means the effective content is unknown and must not be sent.
            throw error;
        }
    }

    private resolvePayloadTemplate(job: MessageTriggerJobEntity): ResolvedSmsTemplate {
        const content = job.payload.messageBody?.trim();
        if (!content) {
            throw new Error(`SMS payload message is missing for job ${job.id}`);
        }
        const hash = this.hash(content);
        return { content, version: `payload:${hash}`, hash, requiredVariableKeys: [] };
    }

    private renderTemplate(template: string, variables: Record<string, string>): string {
        return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => variables[key] ?? "");
    }

    private buildSmsLog(params: {
        job: MessageTriggerJobEntity;
        config: SmsTemplateDeliveryConfig;
        snapshot: SmsTriggerDeliverySnapshot;
        receiver: string;
        status: MessageLogStatus;
        aligoMid: string | null;
        errorMessage: string | null;
        msgType: string;
        templateVariables: Record<string, string>;
        retryDelayMs: number;
    }): MessageLogEntity {
        const now = new Date();
        const variables: Record<string, string> = {
            ...this.sanitizeLogVariables(params.templateVariables),
            ...(params.job.quietHold ? messageQuietHoldVariables(params.job.quietHold) : {}),
            automationKey: params.config.automationKey,
            recipientName: params.job.payload.recipientName,
            title: params.snapshot.title,
            triggerType: params.config.triggerType,
            msgType: params.msgType,
            deliveryType: params.snapshot.deliveryType,
            estimatedCost: params.snapshot.estimatedCost,
            templateVersion: params.snapshot.templateVersion,
            templateHash: params.snapshot.templateHash,
            configVersion: params.snapshot.configVersion,
            configHash: params.snapshot.configHash,
            recipientDisplay: params.snapshot.maskedReceiver,
        };
        if (params.config.systemTemplateKey) {
            variables["systemTemplateKey"] = params.config.systemTemplateKey;
        }
        Object.assign(variables, buildAutomationRetrySealVariables(params.job, params.snapshot.snapshotHash));

        const providerAcceptanceKey = buildSmsProviderAcceptanceKey(
            "automation",
            `${params.job.branchId}:${params.job.id}`,
        );
        const providerAcceptanceFingerprint = buildSmsProviderAcceptanceFingerprint({
            branchId: params.job.branchId,
            triggerJobId: params.job.id,
            templateKey: params.config.smsLogTemplateKey,
            receiver: params.snapshot.receiver,
            message: params.snapshot.message,
            title: params.snapshot.title,
            msgType: params.msgType,
            snapshotHash: params.snapshot.snapshotHash,
        });
        return MessageLogEntity.reconstitute(
            0,
            params.job.branchId,
            "aligo_sms",
            params.config.smsLogTemplateKey,
            params.job.id,
            params.receiver,
            params.job.clientId,
            params.snapshot.message,
            variables,
            params.status,
            params.aligoMid,
            params.errorMessage,
            params.status === "pending" ? 0 : 1,
            params.status === "pending" ? null : now,
            params.status === "failed"
                ? new Date(now.getTime() + params.retryDelayMs)
                : null,
            now,
            now,
            params.job.payload.recipientName,
            params.job.payload.recipientPhone,
            providerAcceptanceKey,
            providerAcceptanceFingerprint,
            params.status === "pending" ? "prepared" : "legacy",
            null,
            null,
        );
    }

    private readStagedSnapshot(
        job: MessageTriggerJobEntity,
        canonical: SmsTriggerDeliverySnapshot,
    ): SmsTriggerDeliverySnapshot | null {
        const serialized = job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE];
        if (!serialized) {
            return null;
        }

        try {
            const parsed = JSON.parse(serialized) as Partial<SmsTriggerDeliverySnapshot>;
            if (
                parsed.templateKey !== job.templateKey
                || typeof parsed.message !== "string"
                || typeof parsed.title !== "string"
                || parsed.requestedDeliveryType !== (job.templateKey === MANUAL_SMS_TEMPLATE_KEY ? canonical.requestedDeliveryType : "AUTO")
                || (parsed.deliveryType !== "SMS" && parsed.deliveryType !== "LMS")
                || typeof parsed.maskedReceiver !== "string"
                || parsed.maskedReceiver !== canonical.maskedReceiver
                || typeof parsed.recipientName !== "string"
                || typeof parsed.estimatedCost !== "string"
                || typeof parsed.templateVersion !== "string"
                || typeof parsed.templateHash !== "string"
                || typeof parsed.configVersion !== "string"
                || typeof parsed.configHash !== "string"
                || typeof parsed.snapshotHash !== "string"
            ) {
                throw new Error("invalid staged SMS delivery snapshot");
            }

            const snapshotWithoutHash: Omit<SmsTriggerDeliverySnapshot, "snapshotHash"> = {
                templateKey: parsed.templateKey,
                receiver: canonical.receiver,
                maskedReceiver: canonical.maskedReceiver,
                recipientName: parsed.recipientName,
                message: parsed.message,
                title: parsed.title,
                requestedDeliveryType: canonical.requestedDeliveryType,
                deliveryType: parsed.deliveryType as AligoSmsMessageType,
                estimatedCost: parsed.estimatedCost,
                templateVersion: parsed.templateVersion,
                templateHash: parsed.templateHash,
                configVersion: parsed.configVersion,
                configHash: parsed.configHash,
                ...(parsed.systemTemplateKey ? { systemTemplateKey: parsed.systemTemplateKey } : {}),
            };
            if (this.hashSnapshot(snapshotWithoutHash) !== parsed.snapshotHash) {
                throw new Error("staged SMS delivery snapshot hash mismatch");
            }
            return { ...snapshotWithoutHash, snapshotHash: parsed.snapshotHash };
        } catch (error) {
            throw new Error(
                `SMS delivery snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private sanitizeLogVariables(templateVariables: Record<string, string>): Record<string, string> {
        return Object.fromEntries(
            Object.entries(publicMessageVariables(templateVariables)).filter(([key]) =>
                key !== SMS_DELIVERY_SNAPSHOT_VARIABLE
                && !/(phone|receiver|telephone|mobile)/i.test(key)),
        );
    }

    private maskedReceiver(value: string): string {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 4 ? `••••${digits.slice(-4)}` : "마스킹된 번호";
    }

    private hash(value: unknown): string {
        return createHash("sha256").update(JSON.stringify(value)).digest("hex");
    }

    private hashSnapshot(snapshot: Omit<SmsTriggerDeliverySnapshot, "snapshotHash">): string {
        return this.hash({
            templateKey: snapshot.templateKey,
            receiver: snapshot.receiver,
            maskedReceiver: snapshot.maskedReceiver,
            recipientName: snapshot.recipientName,
            message: snapshot.message,
            title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType,
            estimatedCost: snapshot.estimatedCost,
            templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            ...(snapshot.systemTemplateKey ? { systemTemplateKey: snapshot.systemTemplateKey } : {}),
        });
    }

    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        const message = String(error ?? "").trim();
        return message || "문자 발송 요청이 실패했습니다.";
    }
}
