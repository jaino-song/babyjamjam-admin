import { ClientAutomationSourceReader, type ClientAutomationSettingsSnapshot } from "./client-automation-source.reader";
import { AgentAutomationDeliveryGateService } from "./agent-automation-delivery-gate.service";
import {
    SmsAutomationSafeguardService,
    smsAutomationSafeguardReason,
    type SmsAutomationSafeguardDecision,
} from "./sms-automation-safeguard.service";
import { AgentAutomationDispatchUncertainError } from "domain/errors/agent-automation-dispatch-uncertain.error";
import { DEFAULT_SERVICE_INFO_TRIGGER, DEFAULT_CLIENT_GREETING_TRIGGER, matchesTriggerDefaults, type MessageTriggerRuleDefaults as UpsertRuleParams } from "./message-trigger-defaults";
import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { normalizeKoreanPhoneLookupKey } from "infrastructure/database/repositories/stored-phone-lookup";
import { PrismaService } from "infrastructure/database/prisma.service";
import type { ServiceRecordRevisionDispatchContext } from "@babyjamjam/shared/types/service-record";
import {
    authorizeServiceRecordDispatch,
    deriveServiceRecordDocumentSyncStatus,
    isValidServiceRecordDispatchContext,
    isRevisionDocumentDispatchAllowed,
} from "application/policies/service-record-revision-state.policy";
import type { ServiceRecordDocumentSyncFacts } from "application/policies/service-record-revision-state.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    EVENT_OFFSET_OPTIONS,
    EVENT_RECIPIENT_OPTIONS,
    getMessageTriggerTemplateCatalog,
    isConfigurableSmsTriggerTemplate,
    isCompatibleMessageTriggerTemplate,
    isMessageTriggerTargetClientStatus,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    TARGET_CLIENT_STATUS_MISMATCH_REASON,
    ruleSendPolicyFrom,
    targetClientStatusAllowsSend,
} from "application/policies/message-trigger-target-client-status.policy";
import { findUnsupportedRequiredMessageTriggerVariables } from "domain/constants/message-trigger-variable-sources";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON } from "domain/constants/message-automation-intent";
import {
    MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON,
    PAST_OCCURRENCE_GRACE_MS,
    TRIGGER_JOB_PROCESSING_RECLAIM_MS,
} from "domain/constants/message-automation-policy";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { agentAutomationSourcePayload } from "./agent-automation-job-binding";
import {
    MESSAGE_TRIGGER_RULE_REPOSITORY,
    IMessageTriggerRuleRepository,
} from "domain/repositories/message-trigger-rule.repository.interface";
import {
    CLIENT_REPOSITORY,
    IClientRepository,
} from "domain/repositories/client.repository.interface";
import {
    MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY,
    IMessageTriggerRuleBranchOverrideRepository,
} from "domain/repositories/message-trigger-rule-branch-override.repository.interface";
import { isManualMessageTriggerJob, isManualMessageTriggerRule } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_END_NOTICE_ALREADY_SENT_CANCEL_REASON } from "domain/constants/service-end-notice-message";
import { SERVICE_RECORD_LINK_ENDED_REASON, SERVICE_RECORD_LINK_PRE_BOOKING_REASON, SERVICE_RECORD_LINK_RULE_ID, getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";
import {
    MESSAGE_TRIGGER_JOB_REPOSITORY,
    IMessageTriggerJobRepository,
    type ClientUpcomingMessageTriggerJobCursor,
    type ClientUpcomingMessageTriggerJobRecord,
} from "domain/repositories/message-trigger-job.repository.interface";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
    type MessageHistoryPageCursor,
    type MessageHistorySource,
} from "domain/repositories/message-log.repository.interface";
import { MessageTriggerDeliveryService } from "./message-trigger-delivery.service";
import {
    SMS_DELIVERY_SNAPSHOT_VARIABLE,
    type SmsTriggerDeliveryPreparation,
} from "./sms-trigger-delivery.service";
import { hasColumn, hasTable } from "infrastructure/database/schema-capabilities";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import {
    buildClientMessageRecipe, buildEmployeeAssignmentMessageRecipe,
    isMessageRecipeWithinMaterializationWindow,
    shouldSkipClientPreStartCatchUp,
    buildMessageRecipeDedupeKey, employeeAssignmentScheduleFingerprint, formatMessageRecipeDate,
    type ClientTriggerSource, type EmployeeAssignmentScheduleSource,
} from "./message-trigger-recipes";
import { normalizePhone } from "application/utils/normalize-phone";
import { SystemSettingService } from "./system-setting.service";
import { SystemTemplateService } from "./system-template.service";
import { MessageTemplateAutomationLockService } from "./message-template-automation-lock.service";
import { MessageAutomationBranchLockService } from "./message-automation-branch-lock.service";
import {
    MessageAutomationActivationService,
    MESSAGE_AUTOMATION_PARENT_DISABLED_REASON,
} from "./message-automation-activation.service";
import { AdminAuditActor } from "./admin-audit-event.service";
import { MANUAL_DEDUPE_MARKER } from "domain/constants/service-end-notice-message";
import {
    MessageAutomationPastTriggerConfig,
} from "domain/entities/system-setting.entity";
import type { AgentAutomationTaskCommitReference } from "domain/entities/agent-automation-consent";

export interface MessageTriggerIntentSyncOptions {
    stableBatchAt: Date;
    preserveExisting: boolean;
    /** Internal provenance marker; a reference without this marker is ignored. */
    taskOrigin?: boolean;
    /** Digest-only reference to the task records reviewed for this materialization. */
    taskAutomationReference?: AgentAutomationTaskCommitReference;
}

type MessageTriggerRuleValidationParams = Pick<
    UpsertRuleParams,
    "eventType" | "offsetType" | "offsetDays" | "sendTime" | "recipientType" | "templateKey"
    | "targetClientStatus" | "retryOnFailure"
>;

export type { ClientAutomationSettingsSnapshot } from "./client-automation-source.reader";

interface DispatchClaimedJobOptions {
    /**
     * Manual resend of a '추가 정보 필요' job (BJJ-444): claim from `needs_setup`
     * instead of `pending`, skip only the 24-hour expiry cancel, and never
     * leave the job `pending`.
     */
    resendFromNeedsSetup?: boolean;
}

export interface ResendNeedsSetupJobResult {
    id: string;
    status: MessageTriggerJobEntity["status"];
    reason: string | null;
}

const ORPHANED_TRIGGER_JOB_CANCEL_REASON = "Related client or schedule deleted";
const EXPIRED_PENDING_JOB_CANCEL_REASON = "기존 발송 예정 24시간 경과";
const MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON = "보충 발송 이전 순위 job 없음";
const USER_REQUESTED_CANCEL_REASON = "사용자가 발송을 취소함";
const CANCEL_JOB_CONFLICT_MESSAGE = "이미 발송되었거나 취소할 수 없는 상태입니다";
const RESEND_JOB_CONFLICT_MESSAGE = "지금은 재전송할 수 없습니다. 자동 전송 설정과 받는 사람의 자동 문자 설정을 확인해 주세요.";
const RESEND_TARGET_CHANGED_REASON = "발송 대상 일정이 변경되어 재전송하지 않았습니다";
const RESEND_NEWER_SIBLING_REASON = "새 예약 메시지가 있어 재전송하지 않았습니다";
const CATCH_UP_PREDECESSOR_PENDING_REASON = "보충 발송 이전 순위 job이 아직 끝나지 않음";
const MS_PER_MINUTE = 60 * 1000;
// The authorization fence only validates the current claim/source and commits
// a short CAS before any provider path opens another Prisma connection.
const CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS = 5_000;
const DEFAULT_OVERRIDE_REPOSITORY: IMessageTriggerRuleBranchOverrideRepository = {
    findOne: async () => null,
    findAllByBranch: async () => [],
    upsert: async (branchId, ruleId, isActive) => ({ branchId, ruleId, isActive }),
    cancelJobsForBranchRule: async () => undefined,
};

function normalizeMessageTriggerOffsetDays(
    offsetType: MessageTriggerOffsetType,
    offsetDays?: number,
): number {
    if (
        offsetType === MessageTriggerOffsetType.IMMEDIATE ||
        offsetType === MessageTriggerOffsetType.SAME_DAY
    ) {
        return 0;
    }
    return offsetDays ?? 0;
}

export function validateMessageTriggerRule(
    params: MessageTriggerRuleValidationParams,
    allowedExistingTemplateKey?: MessageTriggerTemplateKey,
): void {
    if (params.sendTime !== undefined && (typeof params.sendTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(params.sendTime))) {
        throw new BadRequestException("발송 시각은 HH:mm 형식이어야 합니다 (한국 시간).");
    }
    if (params.targetClientStatus !== undefined && !isMessageTriggerTargetClientStatus(params.targetClientStatus)) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/targetClientStatus",
            code: "INVALID_VALUE",
            detail: "대상 고객 상태는 all, pre_booking, waiting, active 중 하나여야 합니다.",
            location: "body",
        }));
    }
    if (params.retryOnFailure !== undefined && typeof params.retryOnFailure !== "boolean") {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/retryOnFailure",
            code: "INVALID_VALUE",
            detail: "실패 시 재전송은 true 또는 false여야 합니다.",
            location: "body",
        }));
    }
    const template = MESSAGE_TRIGGER_TEMPLATE_CATALOG[params.templateKey];
    if (!template) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/templateKey",
            code: "INVALID_VALUE",
            detail: "Unknown template key",
            location: "body",
        }));
    }

    if (!template.providers.sms) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/templateKey",
            code: "INVALID_VALUE",
            detail: "SMS 발송 채널이 없는 템플릿입니다.",
            location: "body",
        }));
    }

    if (
        !isConfigurableSmsTriggerTemplate(params.templateKey)
        && params.templateKey !== allowedExistingTemplateKey
    ) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/templateKey",
            code: "INVALID_VALUE",
            detail: "일반 자동 전송 규칙에서 사용할 수 없는 템플릿입니다.",
            location: "body",
        }));
    }

    if (!EVENT_RECIPIENT_OPTIONS[params.eventType].includes(params.recipientType)) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/recipientType",
            code: "INVALID_VALUE",
            detail: "Invalid recipient for selected event type",
            location: "body",
        }));
    }

    if (!EVENT_OFFSET_OPTIONS[params.eventType].includes(params.offsetType)) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/offsetType",
            code: "INVALID_VALUE",
            detail: "Invalid offset type for selected event type",
            location: "body",
        }));
    }

    const normalizedOffsetDays = normalizeMessageTriggerOffsetDays(params.offsetType, params.offsetDays);
    if (
        (params.offsetType === MessageTriggerOffsetType.BEFORE_DAYS ||
            params.offsetType === MessageTriggerOffsetType.AFTER_DAYS) &&
        normalizedOffsetDays <= 0
    ) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/offsetDays",
            code: "INVALID_VALUE",
            detail: "Offset days must be greater than 0",
            location: "body",
        }));
    }

    if (
        !isCompatibleMessageTriggerTemplate({
            templateKey: params.templateKey,
            eventType: params.eventType,
            recipientType: params.recipientType,
        })
    ) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/templateKey",
            code: "INVALID_VALUE",
            detail: "Template is not compatible with the selected event and recipient",
            location: "body",
        }));
    }
}

function isPrismaUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export interface UpcomingMessageTriggerJobView {
    id: string;
    ruleId: string;
    ruleName: string;
    eventType: MessageTriggerEventType | null;
    offsetType: MessageTriggerOffsetType | null;
    offsetDays: number;
    recipientType: MessageTriggerRecipientType;
    recipientPhone: string | null;
    templateKey: MessageTriggerTemplateKey;
    status: string;
    scheduledFor: Date;
    sentAt: Date | null;
    canceledAt: Date | null;
    cancelReason: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
    payload: MessageTriggerJobEntity["payload"];
    createdAt: Date;
    updatedAt: Date;
}

export interface ClientUpcomingMessageTriggerJobView {
    id: string;
    ruleName: string;
    templateKey: MessageTriggerTemplateKey;
    scheduledFor: Date;
    nextAttemptAt: Date | null;
    effectiveDueAt: Date;
    status: "pending" | "processing" | "dispatching";
    recipientType: MessageTriggerRecipientType;
    recipientName: string | null;
}

export interface MessageLogRecordView {
    id: number | string;
    provider: string;
    templateKey: string;
    triggerJobId: string | null;
    receiver: string;
    clientId: number | null;
    recipientPhone: string | null;
    messageBody: string;
    variables: Record<string, string>;
    status: MessageLogEntity["status"] | "canceled" | "needs_setup";
    aligoMid: string | null;
    errorMessage: string | null;
    attempts: number;
    lastAttemptAt: Date | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    ruleId: string | null;
    ruleName: string | null;
    eventType: MessageTriggerEventType | null;
    offsetType: MessageTriggerOffsetType | null;
    offsetDays: number;
    scheduledFor: Date | null;
    recipientType: MessageTriggerRecipientType | null;
    recipientName: string | null;
    clientName: string | null;
    employeeName: string | null;
}

export interface MessageHistoryPageView {
    items: MessageLogRecordView[];
    page: {
        snapshotAt: string;
        nextCursor: string | null;
        hasMore: boolean;
    };
}

interface MessageHistoryCandidate {
    record: MessageLogRecordView;
    source: MessageHistorySource;
    nativeId: string;
}

const MESSAGE_HISTORY_CURSOR_VERSION = 1;
const MESSAGE_HISTORY_MAX_LIMIT = 500;
const MESSAGE_HISTORY_JOB_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_HISTORY_MAX_LIMIT = 100;
const CLIENT_HISTORY_DEFAULT_LIMIT = 50;
const CLIENT_UPCOMING_CURSOR_VERSION = 1;
const CLIENT_UPCOMING_MAX_LIMIT = 100;
const CLIENT_UPCOMING_DEFAULT_LIMIT = 50;
const CLIENT_UPCOMING_CURSOR_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

interface MessageHistoryCursorPayload {
    v: typeof MESSAGE_HISTORY_CURSOR_VERSION;
    branchId: string;
    /** Present only on cursors minted by the client-scoped history endpoint. */
    clientId?: number;
    snapshotAt: string;
    source: MessageHistorySource;
    nativeId: string;
}

interface ClientUpcomingCursorPayload {
    v: typeof CLIENT_UPCOMING_CURSOR_VERSION;
    branchId: string;
    clientId: number;
    effectiveDueAt: string;
    id: string;
}

function isMessageHistorySource(value: unknown): value is MessageHistorySource {
    return value === "log" || value === "job";
}

function parseHistoryCursorDate(value: unknown): Date | null {
    if (typeof value !== "string" || value.length === 0) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function encodeMessageHistoryCursor(payload: MessageHistoryCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeMessageHistoryCursor(cursor: string, branchId: string): MessageHistoryPageCursor & {
    branchId: string;
    snapshotAt: Date;
} {
    try {
        if (cursor.length > 4096) throw new Error("cursor too long");
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<MessageHistoryCursorPayload>;
        const snapshotAt = parseHistoryCursorDate(decoded.snapshotAt);
        if (
            decoded.v !== MESSAGE_HISTORY_CURSOR_VERSION
            || decoded.branchId !== branchId
            || !snapshotAt
            || !isMessageHistorySource(decoded.source)
            || typeof decoded.nativeId !== "string"
            || decoded.nativeId.length === 0
            || snapshotAt.getTime() > Date.now()
        ) {
            throw new Error("invalid cursor payload");
        }
        if (decoded.source === "log") {
            const numericId = Number(decoded.nativeId);
            if (!Number.isSafeInteger(numericId) || numericId <= 0 || String(numericId) !== decoded.nativeId) {
                throw new Error("invalid log cursor id");
            }
        } else if (!MESSAGE_HISTORY_JOB_UUID_PATTERN.test(decoded.nativeId)) {
            throw new Error("invalid job cursor id");
        }
        return {
            branchId,
            snapshotAt,
            source: decoded.source,
            nativeId: decoded.nativeId,
        };
    } catch {
        throw new BadRequestException("메시지 발송 기록 페이지 커서가 올바르지 않습니다.");
    }
}

/**
 * A client-scoped cursor is a history cursor that is also pinned to one client:
 * a cursor minted for client A is refused for client B even inside one branch.
 */
function decodeClientHistoryCursor(
    cursor: string,
    branchId: string,
    clientId: number,
): ReturnType<typeof decodeMessageHistoryCursor> {
    const decoded = decodeMessageHistoryCursor(cursor, branchId);
    try {
        const raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<MessageHistoryCursorPayload>;
        if (raw.clientId !== clientId) throw new Error("cursor belongs to another client");
    } catch {
        throw new BadRequestException("메시지 발송 기록 페이지 커서가 올바르지 않습니다.");
    }
    return decoded;
}

function encodeClientUpcomingCursor(payload: ClientUpcomingCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeClientUpcomingCursor(
    cursor: string,
    branchId: string,
    clientId: number,
): ClientUpcomingMessageTriggerJobCursor {
    try {
        if (cursor.length > 4096) throw new Error("cursor too long");
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ClientUpcomingCursorPayload>;
        const effectiveDueAt = parseHistoryCursorDate(decoded.effectiveDueAt);
        if (
            decoded.v !== CLIENT_UPCOMING_CURSOR_VERSION
            || decoded.branchId !== branchId
            || decoded.clientId !== clientId
            || !effectiveDueAt
            || typeof decoded.id !== "string"
            || !CLIENT_UPCOMING_CURSOR_ID_PATTERN.test(decoded.id)
        ) {
            throw new Error("invalid cursor payload");
        }
        return { effectiveDueAt, id: decoded.id };
    } catch {
        throw new BadRequestException("고객 알림 발송 예정 페이지 커서가 올바르지 않습니다.");
    }
}

type ClientRuleJobCandidate = {
    rule: MessageTriggerRuleEntity;
    job: MessageTriggerJobEntity;
};

type PreProviderSendFenceResult =
    | { kind: "allow" }
    // returnedToNeedsSetup: a resend refused at the final gate went back to
    // '추가 정보 필요' instead of being canceled.
    | { kind: "stale"; reason: string; returnedToNeedsSetup?: true }
    | { kind: "lost" };

const SERVICE_RECORD_LINK_REVOKED_CANCEL_REASON = "제공기록지 링크가 철회되어 발송하지 않았습니다";

const SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";

function plannedSessionDatesFromJson(value: Prisma.JsonValue | null): Array<{
    sessionIndex: number;
    serviceDate: string;
}> {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
            const row = entry as Record<string, Prisma.JsonValue>;
            const sessionIndex = row["sessionIndex"];
            const serviceDate = row["serviceDate"];
            if (
                typeof sessionIndex !== "number"
                || !Number.isInteger(sessionIndex)
                || typeof serviceDate !== "string"
            ) return null;
            return { sessionIndex, serviceDate };
        })
        .filter((entry): entry is { sessionIndex: number; serviceDate: string } => entry !== null)
        .sort((left, right) => left.sessionIndex - right.sessionIndex);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function revisionPayloadFingerprint(payload: Prisma.JsonValue | null | undefined): string | null {
    if (payload === null || payload === undefined) return null;
    return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function revisionDocumentJobFacts(
    row: {
        payload: Prisma.JsonValue | null;
        payload_fingerprint: string | null;
        status: string;
        progress_step: string | null;
    } | null,
): ServiceRecordDocumentSyncFacts["revisionJob"] {
    if (!row) return null;
    const payload = row.payload;
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
        return {
            revisionId: null,
            payloadFingerprint: row.payload_fingerprint,
            status: row.status,
            progressStep: row.progress_step,
            completeness: null,
            manualReviewRequired: true,
        };
    }
    const record = payload as Record<string, Prisma.JsonValue>;
    const completeness = record["completeness"] === "complete" || record["completeness"] === "partial"
        ? record["completeness"]
        : null;
    return {
        revisionId: typeof record["revisionId"] === "string" ? record["revisionId"] : null,
        payloadFingerprint: row.payload_fingerprint,
        status: row.status,
        progressStep: row.progress_step,
        completeness,
        manualReviewRequired: record["manualReviewRequired"] === true,
    };
}

@Injectable()
export class MessageTriggerService {
    private readonly logger = new Logger(MessageTriggerService.name);
    private readonly automationSources: ClientAutomationSourceReader;

    constructor(
        private readonly prisma: PrismaService,
        private readonly deliveryService: MessageTriggerDeliveryService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly ruleRepository: IMessageTriggerRuleRepository,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository: IMessageTriggerJobRepository,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly messageLogRepository: IMessageLogRepository,
        private readonly systemTemplateService: SystemTemplateService,
        private readonly templateAutomationLock: MessageTemplateAutomationLockService,
        @Optional()
        private readonly systemSettingService?: SystemSettingService,
        @Inject(MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY)
        private readonly overrideRepository: IMessageTriggerRuleBranchOverrideRepository =
            DEFAULT_OVERRIDE_REPOSITORY,
        @Optional()
        private readonly messageAutomationActivationService?: MessageAutomationActivationService,
        @Optional()
        private readonly messageAutomationBranchLockService?: MessageAutomationBranchLockService,
        @Optional() automationSources?: ClientAutomationSourceReader,
        @Optional() private readonly automationDeliveryGate?: AgentAutomationDeliveryGateService,
        @Optional()
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository?: IClientRepository,
        // Required in production: Nest must refuse to boot without it so the SMS
        // safeguard can never fail open. Optional only for constructor-built tests.
        private readonly smsAutomationSafeguard?: SmsAutomationSafeguardService,
    ) {
        // Preserve constructor-based callers while sharing exactly the same read
        // implementation; the production module injects its registered reader.
        this.automationSources = automationSources ?? new ClientAutomationSourceReader(prisma, ruleRepository,
            overrideRepository, messageSenderApprovalService, systemSettingService, messageAutomationActivationService);
    }

    async listRules(branchId: string): Promise<MessageTriggerRuleEntity[]> {
        const { rules, parentEnabled } = await this.resolvePersistedRules(branchId);
        if (!parentEnabled || !(await this.messageSenderApprovalService.isApproved(branchId))) {
            return rules;
        }
        return this.ensureDefaultServiceInfoTrigger(branchId, rules);
    }

    /** Resolve persisted rules for read capabilities without provisioning defaults or jobs. */
    async listRulesReadOnly(branchId: string): Promise<MessageTriggerRuleEntity[]> {
        return (await this.resolvePersistedRules(branchId)).rules;
    }

    /** Read-only compatibility entrypoints; all consumers share the source owner. */
    async readClientAutomationSettings(branchId: string, transaction?: Prisma.TransactionClient): Promise<ClientAutomationSettingsSnapshot> {
        return this.automationSources.readClientAutomationSettings(branchId, transaction);
    }

    private async resolvePersistedRules(branchId: string, transaction?: Prisma.TransactionClient) {
        return this.automationSources.resolvePersistedRules(branchId, transaction);
    }

    async ensureDefaultRulesForBranch(branchId: string): Promise<void> {
        if (!(await this.hasTriggerSchema())) return;
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) return;
        if (!(await this.isMessageAutomationParentEnabled(branchId))) return;

        const rules = await this.ruleRepository.findAll(branchId);
        await this.ensureDefaultServiceInfoTrigger(branchId, rules);
    }

    async listUpcomingJobs(
        branchId: string,
        limit = 200,
    ): Promise<UpcomingMessageTriggerJobView[]> {
        if (!(await this.hasTriggerSchema())) {
            return [];
        }

        await this.reconcileOrphanedClientJobs(branchId);
        const jobs = await this.jobRepository.findUpcomingPendingByBranch(branchId, limit);
        const manualScheduledLogs = await this.listManualScheduledSmsLogs(branchId, limit);
        if (jobs.length === 0 && manualScheduledLogs.length === 0) {
            return [];
        }

        const rules = jobs.length > 0 ? await this.ruleRepository.findAll(branchId) : [];
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        const triggerJobs = jobs.map((job): UpcomingMessageTriggerJobView => {
            const rule = rulesById.get(job.ruleId);
            const publicPayload = { ...job.payload };
            delete publicPayload.agentAutomationSeal;

            return {
                id: job.id,
                ruleId: job.ruleId,
                ruleName: rule?.name ?? "알 수 없는 규칙",
                eventType: rule?.eventType ?? null,
                offsetType: rule?.offsetType ?? null,
                offsetDays: rule?.offsetDays ?? 0,
                recipientType: job.recipientType,
                recipientPhone: job.recipientPhone,
                templateKey: job.templateKey,
                status: job.status,
                scheduledFor: job.scheduledFor,
                sentAt: job.sentAt,
                canceledAt: job.canceledAt,
                cancelReason: job.cancelReason,
                clientId: job.clientId,
                employeeScheduleId: job.employeeScheduleId,
                payload: publicPayload,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            };
        });

        return [...triggerJobs, ...manualScheduledLogs]
            .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime())
            .slice(0, limit);
    }

    async listClientUpcomingJobs(
        branchId: string,
        clientId: number,
        limit = CLIENT_UPCOMING_DEFAULT_LIMIT,
        cursor?: string,
    ): Promise<{ items: ClientUpcomingMessageTriggerJobView[]; nextCursor: string | null }> {
        if (!Number.isSafeInteger(clientId) || clientId < 1) {
            throw new BadRequestException("고객 ID가 올바르지 않습니다.");
        }
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > CLIENT_UPCOMING_MAX_LIMIT) {
            throw new BadRequestException("고객 알림 발송 예정 페이지 크기가 올바르지 않습니다.");
        }

        const decodedCursor = cursor === undefined
            ? undefined
            : decodeClientUpcomingCursor(cursor, branchId, clientId);

        const client = this.clientRepository
            ? await this.clientRepository.findById(branchId, clientId)
            : this.prisma.client?.findFirst
                ? await this.prisma.client.findFirst({
                    where: { id: clientId, branchId },
                    select: { id: true },
                })
                : null;
        if (!client) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        if (!(await this.hasTriggerSchema())) {
            return { items: [], nextCursor: null };
        }

        const rows = await this.jobRepository.findUpcomingByClient(
            branchId,
            clientId,
            limit + 1,
            decodedCursor,
        );
        const visibleRows = rows.slice(0, limit);
        const items = visibleRows.map((row: ClientUpcomingMessageTriggerJobRecord): ClientUpcomingMessageTriggerJobView => ({
            id: row.id,
            ruleName: row.ruleName,
            templateKey: row.templateKey as MessageTriggerTemplateKey,
            scheduledFor: row.scheduledFor,
            nextAttemptAt: row.nextAttemptAt,
            effectiveDueAt: row.effectiveDueAt,
            status: row.status,
            recipientType: row.recipientType as MessageTriggerRecipientType,
            recipientName: row.recipientName,
        }));
        const last = visibleRows[visibleRows.length - 1];
        const nextCursor = rows.length > limit && last
            ? encodeClientUpcomingCursor({
                v: CLIENT_UPCOMING_CURSOR_VERSION,
                branchId,
                clientId,
                effectiveDueAt: last.effectiveDueAt.toISOString(),
                id: last.id,
            })
            : null;

        return { items, nextCursor };
    }

    async listHistory(
        branchId: string,
        limit = 200,
        skip = 0,
    ): Promise<MessageLogRecordView[]> {
        const candidateLimit = limit + skip;
        const hasMessageLogTable = await hasTable(this.prisma, "message_log");
        const logs = hasMessageLogTable
            ? await this.messageLogRepository.findRecentByBranch(branchId, candidateLimit, 0)
            : [];
        const terminalJobs = await this.hasTriggerSchema()
            ? await this.jobRepository.findTerminalByBranch(branchId, candidateLimit)
            : [];

        if (logs.length === 0 && terminalJobs.length === 0) {
            return [];
        }

        const triggerJobIds = logs
            .map((log) => log.triggerJobId)
            .filter((id): id is string => !!id);

        const jobs = triggerJobIds.length > 0
            ? await this.prisma.message_trigger_job.findMany({
                where: { id: { in: triggerJobIds } },
                select: {
                    id: true,
                    ruleId: true,
                    scheduledFor: true,
                    recipientType: true,
                    payload: true,
                },
            })
            : [];

        const jobsById = new Map(jobs.map((job) => [job.id, job]));
        const rules = await this.ruleRepository.findAll(branchId);
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        const logRecords = logs.map((log): MessageLogRecordView => {
            const job = log.triggerJobId ? jobsById.get(log.triggerJobId) : null;
            const payload = (job?.payload as MessageTriggerJobEntity["payload"] | undefined) ?? null;
            const rule = job ? rulesById.get(job.ruleId) ?? null : null;

            return {
                id: log.id,
                provider: log.provider,
                templateKey: log.templateKey,
                triggerJobId: log.triggerJobId,
                receiver: log.receiver,
                clientId: log.clientId,
                recipientPhone: log.recipientPhone ?? log.receiver,
                messageBody: log.messageBody,
                variables: log.variables,
                status: log.status,
                aligoMid: log.aligoMid,
                errorMessage: log.errorMessage,
                attempts: log.attempts,
                lastAttemptAt: log.lastAttemptAt,
                nextRetryAt: log.nextRetryAt,
                createdAt: log.createdAt,
                updatedAt: log.updatedAt,
                ruleId: job?.ruleId ?? null,
                ruleName: rule?.name ?? null,
                eventType: rule?.eventType ?? null,
                offsetType: rule?.offsetType ?? null,
                offsetDays: rule?.offsetDays ?? 0,
                scheduledFor: job?.scheduledFor ?? null,
                recipientType: (job?.recipientType as MessageTriggerRecipientType | undefined) ?? null,
                recipientName: log.recipientName ?? payload?.recipientName ?? null,
                clientName: payload?.clientName ?? null,
                employeeName: payload?.employeeName ?? null,
            };
        });

        const loggedTriggerJobIds = new Set(
            logs
                .map((log) => log.triggerJobId)
                .filter((id): id is string => Boolean(id)),
        );
        const terminalJobRecords = terminalJobs
            .filter((job) => !loggedTriggerJobIds.has(job.id))
            .map((job): MessageLogRecordView => {
                const rule = rulesById.get(job.ruleId) ?? null;
                const receiver = job.recipientPhone ?? job.payload.recipientPhone ?? "";

                return {
                    id: `job:${job.id}`,
                    provider: "message_job",
                    templateKey: job.templateKey,
                    triggerJobId: job.id,
                    receiver,
                    clientId: job.clientId,
                    recipientPhone: receiver || null,
                    messageBody: job.payload.messageBody ?? "",
                    variables: {
                        ...job.payload.templateVariables,
                        recipientName: job.payload.recipientName,
                        historySource: "message_trigger_job",
                    },
                    status: job.status === "needs_setup" ? "needs_setup" : job.status === "canceled" ? "canceled" : "failed",
                    aligoMid: null,
                    errorMessage: job.cancelReason,
                    attempts: job.attempts,
                    lastAttemptAt: job.updatedAt,
                    nextRetryAt: null,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    ruleId: job.ruleId,
                    ruleName: rule?.name ?? null,
                    eventType: rule?.eventType ?? null,
                    offsetType: rule?.offsetType ?? null,
                    offsetDays: rule?.offsetDays ?? 0,
                    scheduledFor: job.scheduledFor,
                    recipientType: job.recipientType,
                    recipientName: job.payload.recipientName,
                    clientName: job.payload.clientName ?? null,
                    employeeName: job.payload.employeeName ?? null,
                };
            });

        return [...logRecords, ...terminalJobRecords]
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
            .slice(skip, skip + limit);
    }

    /**
     * Read history one bounded page at a time. The initial snapshot is an
     * application-time createdAt eligibility cutoff, not a multi-request
     * database MVCC transaction: rows created after it may be deferred to the
     * next fresh walk, while current status changes may appear or disappear
     * as the view is read.
     * Each source is ordered by its immutable native id; mutable retry
     * timestamps remain presentation fields and never move a cursor, including
     * when database timestamps have microsecond precision.
     */
    async listHistoryPage(
        branchId: string,
        limit = MESSAGE_HISTORY_MAX_LIMIT,
        cursor?: string,
    ): Promise<MessageHistoryPageView> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MESSAGE_HISTORY_MAX_LIMIT) {
            throw new BadRequestException("메시지 발송 기록 페이지 크기가 올바르지 않습니다.");
        }

        const decodedCursor = cursor === undefined
            ? null
            : decodeMessageHistoryCursor(cursor, branchId);
        const snapshotAt = decodedCursor?.snapshotAt ?? new Date();
        const after: MessageHistoryPageCursor | null = decodedCursor
            ? {
                source: decodedCursor.source,
                nativeId: decodedCursor.nativeId,
            }
            : null;
        const hasMessageLogTable = await hasTable(this.prisma, "message_log");
        const hasTriggerSchema = await this.hasTriggerSchema();
        const logs = hasMessageLogTable && (!after || after.source === "log")
            ? await this.messageLogRepository.findHistoryPageByBranch(branchId, {
                snapshotAt,
                after,
                // Logs are the first source in the public ordering. Read only
                // enough rows to fill the page, plus one lookahead row.
                limit: limit + 1,
            })
            : [];
        const visibleLogs = logs.slice(0, limit);
        const logLookahead = logs.length > limit;
        const remainingSlots = Math.max(limit - visibleLogs.length, 0);
        const terminalJobs = hasTriggerSchema && !logLookahead
            ? await this.jobRepository.findHistoryPageByBranch(branchId, {
                snapshotAt,
                after,
                // One extra row detects a job continuation when logs fill the
                // page exactly; otherwise read only the remaining slots plus
                // one lookahead row.
                limit: remainingSlots + 1,
            })
            : [];

        const triggerJobIds = visibleLogs
            .map((log) => log.triggerJobId)
            .filter((id): id is string => Boolean(id));
        const jobs = triggerJobIds.length > 0
            ? await this.prisma.message_trigger_job.findMany({
                where: { branchId, id: { in: triggerJobIds } },
                select: {
                    id: true,
                    ruleId: true,
                    scheduledFor: true,
                    recipientType: true,
                    payload: true,
                },
            })
            : [];
        const jobsById = new Map(jobs.map((job) => [job.id, job]));
        const rules = visibleLogs.length > 0 || terminalJobs.length > 0
            ? await this.ruleRepository.findAll(branchId)
            : [];
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        const logCandidates: MessageHistoryCandidate[] = visibleLogs.map((log) => {
            const job = log.triggerJobId ? jobsById.get(log.triggerJobId) : null;
            const payload = (job?.payload as MessageTriggerJobEntity["payload"] | undefined) ?? null;
            const rule = job ? rulesById.get(job.ruleId) ?? null : null;
            const record: MessageLogRecordView = {
                id: log.id,
                provider: log.provider,
                templateKey: log.templateKey,
                triggerJobId: log.triggerJobId,
                receiver: log.receiver,
                clientId: log.clientId,
                recipientPhone: log.recipientPhone ?? log.receiver,
                messageBody: log.messageBody,
                variables: log.variables,
                status: log.status,
                aligoMid: log.aligoMid,
                errorMessage: log.errorMessage,
                attempts: log.attempts,
                lastAttemptAt: log.lastAttemptAt,
                nextRetryAt: log.nextRetryAt,
                createdAt: log.createdAt,
                updatedAt: log.updatedAt,
                ruleId: job?.ruleId ?? null,
                ruleName: rule?.name ?? null,
                eventType: rule?.eventType ?? null,
                offsetType: rule?.offsetType ?? null,
                offsetDays: rule?.offsetDays ?? 0,
                scheduledFor: job?.scheduledFor ?? null,
                recipientType: (job?.recipientType as MessageTriggerRecipientType | undefined) ?? null,
                recipientName: log.recipientName ?? payload?.recipientName ?? null,
                clientName: payload?.clientName ?? null,
                employeeName: payload?.employeeName ?? null,
            };
            return {
                record,
                source: "log",
                nativeId: String(log.id),
            };
        });

        // The repository suppresses only logs present at this snapshot. Keep a
        // defensive ID filter here as well so alternate repository adapters do
        // not expose a terminal job and its materialized log twice.
        const loggedTriggerJobIds = new Set(
            visibleLogs
                .map((log) => log.triggerJobId)
                .filter((id): id is string => Boolean(id)),
        );
        const jobCandidates: MessageHistoryCandidate[] = terminalJobs
            .filter((job) => !loggedTriggerJobIds.has(job.id))
            .map((job) => {
                const rule = rulesById.get(job.ruleId) ?? null;
                const receiver = job.recipientPhone ?? job.payload.recipientPhone ?? "";
                const record: MessageLogRecordView = {
                    id: `job:${job.id}`,
                    provider: "message_job",
                    templateKey: job.templateKey,
                    triggerJobId: job.id,
                    receiver,
                    clientId: job.clientId,
                    recipientPhone: receiver || null,
                    messageBody: job.payload.messageBody ?? "",
                    variables: {
                        ...job.payload.templateVariables,
                        recipientName: job.payload.recipientName,
                        historySource: "message_trigger_job",
                    },
                    status: job.status === "needs_setup" ? "needs_setup" : job.status === "canceled" ? "canceled" : "failed",
                    aligoMid: null,
                    errorMessage: job.cancelReason,
                    attempts: job.attempts,
                    lastAttemptAt: job.updatedAt,
                    nextRetryAt: null,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    ruleId: job.ruleId,
                    ruleName: rule?.name ?? null,
                    eventType: rule?.eventType ?? null,
                    offsetType: rule?.offsetType ?? null,
                    offsetDays: rule?.offsetDays ?? 0,
                    scheduledFor: job.scheduledFor,
                    recipientType: job.recipientType,
                    recipientName: job.payload.recipientName,
                    clientName: job.payload.clientName ?? null,
                    employeeName: job.payload.employeeName ?? null,
                };
                return {
                    record,
                    source: "job",
                    nativeId: job.id,
                };
            });

        // The two repositories already return native-id DESC order. Logs are
        // the first source and terminal jobs follow only when log rows leave
        // room, so no JavaScript timestamp or UUID sort can disturb a page
        // boundary.
        const candidates = [...logCandidates, ...jobCandidates];
        const hasMore = logLookahead || jobCandidates.length > remainingSlots;
        const items = candidates.slice(0, limit).map((candidate) => candidate.record);
        const lastCandidate = candidates[limit - 1];
        const nextCursor = hasMore && lastCandidate
            ? encodeMessageHistoryCursor({
                v: MESSAGE_HISTORY_CURSOR_VERSION,
                branchId,
                snapshotAt: snapshotAt.toISOString(),
                source: lastCandidate.source,
                nativeId: lastCandidate.nativeId,
            })
            : null;

        return {
            items,
            page: {
                snapshotAt: snapshotAt.toISOString(),
                nextCursor,
                hasMore,
            },
        };
    }

    /**
     * One client's message history, newest first, read straight from the
     * database by client — never by slicing the branch-wide window in a browser.
     * Same page shape, snapshot rule and native-id cursor as `listHistoryPage`
     * (logs first, then terminal jobs that never produced a log), pinned to a
     * branch-owned client exactly like `listClientUpcomingJobs`: another
     * branch's client is a 404, and every query is also filtered by branch.
     *
     * Rows carrying no client id are included only when their stored phone
     * normalises (`normalizeKoreanPhoneLookupKey`) to the client's current
     * phone; a row owned by another client is never matched by phone.
     */
    async listClientHistoryPage(
        branchId: string,
        clientId: number,
        limit = CLIENT_HISTORY_DEFAULT_LIMIT,
        cursor?: string,
    ): Promise<MessageHistoryPageView> {
        if (!Number.isSafeInteger(clientId) || clientId < 1) {
            throw new BadRequestException("고객 ID가 올바르지 않습니다.");
        }
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > CLIENT_HISTORY_MAX_LIMIT) {
            throw new BadRequestException("메시지 발송 기록 페이지 크기가 올바르지 않습니다.");
        }

        const decodedCursor = cursor === undefined
            ? null
            : decodeClientHistoryCursor(cursor, branchId, clientId);

        const client = this.clientRepository
            ? await this.clientRepository.findById(branchId, clientId)
            : this.prisma.client?.findFirst
                ? await this.prisma.client.findFirst({
                    where: { id: clientId, branchId },
                    select: { id: true, phone: true },
                })
                : null;
        if (!client) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const phoneKey = normalizeKoreanPhoneLookupKey(
            (client as { phone?: string | null }).phone ?? "",
        ) || null;
        const scope = { clientId, phoneKey };

        const snapshotAt = decodedCursor?.snapshotAt ?? new Date();
        const after: MessageHistoryPageCursor | null = decodedCursor
            ? { source: decodedCursor.source, nativeId: decodedCursor.nativeId }
            : null;
        const hasMessageLogTable = await hasTable(this.prisma, "message_log");
        const hasTriggerSchema = await this.hasTriggerSchema();
        const logs = hasMessageLogTable && (!after || after.source === "log")
            ? await this.messageLogRepository.findClientHistoryPageByBranch(branchId, scope, {
                snapshotAt,
                after,
                limit: limit + 1,
            })
            : [];
        const visibleLogs = logs.slice(0, limit);
        const logLookahead = logs.length > limit;
        const remainingSlots = Math.max(limit - visibleLogs.length, 0);
        const terminalJobs = hasTriggerSchema && !logLookahead
            ? await this.jobRepository.findClientHistoryPageByBranch(branchId, scope, {
                snapshotAt,
                after,
                limit: remainingSlots + 1,
            })
            : [];

        const triggerJobIds = visibleLogs
            .map((log) => log.triggerJobId)
            .filter((id): id is string => Boolean(id));
        const jobs = triggerJobIds.length > 0
            ? await this.prisma.message_trigger_job.findMany({
                where: { branchId, id: { in: triggerJobIds } },
                select: {
                    id: true,
                    ruleId: true,
                    scheduledFor: true,
                    recipientType: true,
                    payload: true,
                },
            })
            : [];
        const jobsById = new Map(jobs.map((job) => [job.id, job]));
        const rules = visibleLogs.length > 0 || terminalJobs.length > 0
            ? await this.ruleRepository.findAll(branchId)
            : [];
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        const logCandidates: MessageHistoryCandidate[] = visibleLogs.map((log) => {
            const job = log.triggerJobId ? jobsById.get(log.triggerJobId) : null;
            const payload = (job?.payload as MessageTriggerJobEntity["payload"] | undefined) ?? null;
            const rule = job ? rulesById.get(job.ruleId) ?? null : null;
            return {
                record: {
                    id: log.id,
                    provider: log.provider,
                    templateKey: log.templateKey,
                    triggerJobId: log.triggerJobId,
                    receiver: log.receiver,
                    clientId: log.clientId,
                    recipientPhone: log.recipientPhone ?? log.receiver,
                    messageBody: log.messageBody,
                    variables: log.variables,
                    status: log.status,
                    aligoMid: log.aligoMid,
                    errorMessage: log.errorMessage,
                    attempts: log.attempts,
                    lastAttemptAt: log.lastAttemptAt,
                    nextRetryAt: log.nextRetryAt,
                    createdAt: log.createdAt,
                    updatedAt: log.updatedAt,
                    ruleId: job?.ruleId ?? null,
                    ruleName: rule?.name ?? null,
                    eventType: rule?.eventType ?? null,
                    offsetType: rule?.offsetType ?? null,
                    offsetDays: rule?.offsetDays ?? 0,
                    scheduledFor: job?.scheduledFor ?? null,
                    recipientType: (job?.recipientType as MessageTriggerRecipientType | undefined) ?? null,
                    recipientName: log.recipientName ?? payload?.recipientName ?? null,
                    clientName: payload?.clientName ?? null,
                    employeeName: payload?.employeeName ?? null,
                },
                source: "log",
                nativeId: String(log.id),
            };
        });

        const loggedTriggerJobIds = new Set(
            visibleLogs
                .map((log) => log.triggerJobId)
                .filter((id): id is string => Boolean(id)),
        );
        const jobCandidates: MessageHistoryCandidate[] = terminalJobs
            .filter((job) => !loggedTriggerJobIds.has(job.id))
            .map((job) => {
                const rule = rulesById.get(job.ruleId) ?? null;
                const receiver = job.recipientPhone ?? job.payload.recipientPhone ?? "";
                return {
                    record: {
                        id: `job:${job.id}`,
                        provider: "message_job",
                        templateKey: job.templateKey,
                        triggerJobId: job.id,
                        receiver,
                        clientId: job.clientId,
                        recipientPhone: receiver || null,
                        messageBody: job.payload.messageBody ?? "",
                        variables: {
                            ...job.payload.templateVariables,
                            recipientName: job.payload.recipientName,
                            historySource: "message_trigger_job",
                        },
                        status: job.status === "needs_setup" ? "needs_setup" : job.status === "canceled" ? "canceled" : "failed",
                        aligoMid: null,
                        errorMessage: job.cancelReason,
                        attempts: job.attempts,
                        lastAttemptAt: job.updatedAt,
                        nextRetryAt: null,
                        createdAt: job.createdAt,
                        updatedAt: job.updatedAt,
                        ruleId: job.ruleId,
                        ruleName: rule?.name ?? null,
                        eventType: rule?.eventType ?? null,
                        offsetType: rule?.offsetType ?? null,
                        offsetDays: rule?.offsetDays ?? 0,
                        scheduledFor: job.scheduledFor,
                        recipientType: job.recipientType,
                        recipientName: job.payload.recipientName,
                        clientName: job.payload.clientName ?? null,
                        employeeName: job.payload.employeeName ?? null,
                    },
                    source: "job",
                    nativeId: job.id,
                };
            });

        const candidates = [...logCandidates, ...jobCandidates];
        const hasMore = logLookahead || jobCandidates.length > remainingSlots;
        const items = candidates.slice(0, limit).map((candidate) => candidate.record);
        const lastCandidate = candidates[limit - 1];
        const nextCursor = hasMore && lastCandidate
            ? encodeMessageHistoryCursor({
                v: MESSAGE_HISTORY_CURSOR_VERSION,
                branchId,
                clientId,
                snapshotAt: snapshotAt.toISOString(),
                source: lastCandidate.source,
                nativeId: lastCandidate.nativeId,
            })
            : null;

        return {
            items,
            page: {
                snapshotAt: snapshotAt.toISOString(),
                nextCursor,
                hasMore,
            },
        };
    }

    async getRule(branchId: string, id: string): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        const rule = await this.ruleRepository.findById(branchId, id);
        if (!rule) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        if (!(await this.isMessageAutomationParentEnabled(branchId))) {
            rule.isActive = false;
        }
        return rule;
    }

    async activateRuleWithParent(
        branchId: string,
        id: string,
        options?: { actor?: AdminAuditActor },
    ): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        if (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        await this.messageSenderApprovalService.ensureApproved(branchId);
        return this.messageAutomationBranchLockService.runExclusive(branchId, async (transaction) => {
            // Read the candidate only after the branch lock is held. A stale
            // pre-lock snapshot could validate the wrong template while a
            // concurrent metadata update changes the rule.
            const candidate = (await this.ruleRepository.findAll(branchId)).find((rule) => rule.id === id);
            if (!candidate) throw new NotFoundException(`Trigger rule ${id} not found`);
            if (!isManualMessageTriggerRule(candidate)) {
                const systemTemplateKey = this.getRuleSystemTemplateKey(candidate.templateKey);
                if (!systemTemplateKey) throw new BadRequestException("SMS 발송 채널이 없는 템플릿입니다.");
                await this.templateAutomationLock.runExclusive(
                    systemTemplateKey,
                    async () => {
                        await this.ensureActiveRuleTemplateVariablesSupported(branchId, {
                            name: candidate.name,
                            isActive: true,
                            eventType: candidate.eventType,
                            offsetType: candidate.offsetType,
                            offsetDays: candidate.offsetDays,
                            sendTime: candidate.sendTime,
                            recipientType: candidate.recipientType,
                            templateKey: candidate.templateKey,
                        });
                    },
                    transaction,
                );
            }
            return this.messageAutomationActivationService!.activateRuleWithParent(
                branchId,
                id,
                options,
                transaction,
            );
        });
    }

    async updateRuleBranchActivation(branchId: string, id: string, isActive: boolean): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        if (!this.messageAutomationActivationService) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        return this.messageAutomationActivationService.setGlobalRuleBranchActivation(branchId, id, isActive);
    }

    listTemplates(params: {
        eventType?: MessageTriggerEventType;
        recipientType?: MessageTriggerRecipientType;
    }) {
        return getMessageTriggerTemplateCatalog("sms").filter((item) => {
            if (!isConfigurableSmsTriggerTemplate(item.key)) return false;
            if (params.eventType && !item.allowedEventTypes.includes(params.eventType)) return false;
            if (
                params.recipientType &&
                !item.allowedRecipientTypes.includes(params.recipientType)
            ) {
                return false;
            }
            return true;
        });
    }

    async createRule(
        branchId: string,
        params: UpsertRuleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        this.validateRule(params);
        // A newly created rule always gets a fresh, DB-generated id — it can never be the
        // SERVICE_END_NOTICE system manual row (id = SERVICE_END_NOTICE_RULE_ID), so a new
        // branch rule is always automatic regardless of templateKey (BJJ-342).
        const isAutomaticRule = true;
        if (isAutomaticRule && !this.messageAutomationActivationService) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        let persistedParams: UpsertRuleParams = params;
        const persistRule = async (writeTransaction: Prisma.TransactionClient) => {
            const rule = await this.ruleRepository.create(
                branchId,
                MessageTriggerRuleEntity.create({
                    branchId,
                    ...persistedParams,
                    offsetDays: this.normalizeOffsetDays(persistedParams.offsetType, persistedParams.offsetDays),
                }),
                writeTransaction,
            );
            await this.ruleRepository.markJobsStale(branchId, rule.id, writeTransaction);
            return rule;
        };
        const rule = await this.runRuleTemplateMutation(
            branchId,
            persistedParams,
            persistRule,
            transaction,
            {
                resolveParams: async (writeTransaction) => {
                    // Same reasoning as isAutomaticRule above: a new rule is never the system row.
                    if (
                        !(await this.messageAutomationActivationService!.getTriggerDispatchEnabled(branchId, writeTransaction))
                    ) {
                        if (params.isActive === true) {
                            return { ...persistedParams, isActive: true };
                        }
                        persistedParams = { ...persistedParams, isActive: false };
                    }
                    return persistedParams;
                },
            },
        );
        // Agent capability creates may still be inside their caller-owned
        // transaction, so the global repositories cannot safely observe that
        // row until commit. HTTP/admin creates have no transaction and can
        // converge the generation before the success response is returned.
        if (transaction) return rule;
        return await this.reconcileRuleGenerationAfterMutation(branchId, rule.id) ?? rule;
    }

    async updateRule(
        branchId: string,
        id: string,
        params: Partial<UpsertRuleParams>,
    ): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        const rule = await this.ruleRepository.findById(branchId, id);
        if (!rule) throw new NotFoundException(`Trigger rule ${id} not found`);
        const metadataOnlyUpdate = params.isActive === undefined;
        let effectiveRule = rule;
        let effectiveState: UpsertRuleParams = {
            name: params.name ?? rule.name,
            isActive: params.isActive ?? rule.isActive,
            eventType: params.eventType ?? rule.eventType,
            offsetType: params.offsetType ?? rule.offsetType,
            offsetDays: params.offsetDays ?? rule.offsetDays,
            sendTime: params.sendTime === undefined ? rule.sendTime : params.sendTime,
            recipientType: params.recipientType ?? rule.recipientType,
            templateKey: params.templateKey ?? rule.templateKey,
            targetClientStatus: params.targetClientStatus ?? rule.targetClientStatus,
            retryOnFailure: params.retryOnFailure ?? rule.retryOnFailure,
        };

        this.validateRule(effectiveState, rule.templateKey);
        const updated = await this.runRuleTemplateMutation(branchId, effectiveState, async (transaction) => {
            effectiveRule.update({
                ...effectiveState,
                offsetDays: this.normalizeOffsetDays(effectiveState.offsetType, effectiveState.offsetDays),
            });
            const persisted = await this.ruleRepository.update(branchId, effectiveRule, transaction);
            await this.ruleRepository.markJobsStale(branchId, persisted.id, transaction);
            return persisted;
        }, undefined, {
            allowPersistedActivationUnderParentOff: metadataOnlyUpdate,
            resolveParams: async (transaction) => {
                const current = await this.ruleRepository.findById(branchId, id, transaction);
                if (!current) throw new NotFoundException(`Trigger rule ${id} not found`);
                effectiveRule = current;
                const templateKey = params.templateKey ?? current.templateKey;
                const automatic = !isManualMessageTriggerRule({ id: current.id, templateKey });
                if (automatic && !this.messageAutomationActivationService) {
                    throw new ServiceUnavailableException("Message automation activation is not configured");
                }
                const parentEnabled = !automatic
                    ? true
                    : await this.messageAutomationActivationService!.getTriggerDispatchEnabled(branchId, transaction);
                const requestedActive = params.isActive ?? current.isActive;
                const isActive = !parentEnabled && automatic
                    ? (params.isActive === true ? true : false)
                    : requestedActive;
                effectiveState = {
                    name: params.name ?? current.name,
                    isActive,
                    eventType: params.eventType ?? current.eventType,
                    offsetType: params.offsetType ?? current.offsetType,
                    offsetDays: params.offsetDays ?? current.offsetDays,
                    sendTime: params.sendTime === undefined ? current.sendTime : params.sendTime,
                    recipientType: params.recipientType ?? current.recipientType,
                    templateKey,
                    targetClientStatus: params.targetClientStatus ?? current.targetClientStatus,
                    retryOnFailure: params.retryOnFailure ?? current.retryOnFailure,
                };
                this.validateRule(effectiveState, current.templateKey);
                return effectiveState;
            },
        });
        await this.cancelPendingJobsForRule(branchId, updated, "Rule updated", false);
        return await this.reconcileRuleGenerationAfterMutation(branchId, updated.id) ?? updated;
    }

    /**
     * Mutate an automation rule against the exact inspected snapshot. The
     * repository performs the branch/resource-scoped conditional update; this
     * method intentionally does not re-read the rule before writing.
     */
    async updateRuleApprovedTarget(
        branchId: string,
        id: string,
        params: Partial<UpsertRuleParams>,
        expectedTargetVersion: string,
        targetSnapshot: Record<string, unknown> | undefined,
    ): Promise<MessageTriggerRuleEntity> {
        const mutationStartedAt = new Date();
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        const expected = this.ruleFromApprovedSnapshot(targetSnapshot);
        if (
            !expected
            || expected.id !== id
            || expected.branchId !== branchId
            || this.ruleTargetVersion(expected) !== expectedTargetVersion
        ) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/targetVersion",
                code: "INVALID_VALUE",
                detail: "Automation rule approval snapshot is missing or stale",
                location: "body",
            }));
        }

        const nextState: UpsertRuleParams = {
            name: params.name ?? expected.name,
            isActive: params.isActive ?? expected.isActive,
            eventType: params.eventType ?? expected.eventType,
            offsetType: params.offsetType ?? expected.offsetType,
            offsetDays: params.offsetDays ?? expected.offsetDays,
            sendTime: params.sendTime === undefined ? expected.sendTime : params.sendTime,
            recipientType: params.recipientType ?? expected.recipientType,
            templateKey: params.templateKey ?? expected.templateKey,
            targetClientStatus: params.targetClientStatus ?? expected.targetClientStatus,
            retryOnFailure: params.retryOnFailure ?? expected.retryOnFailure,
        };
        if (
            !isManualMessageTriggerRule({ id: expected.id, templateKey: nextState.templateKey })
            && !this.messageAutomationActivationService
        ) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        this.validateRule(nextState, expected.templateKey);
        const next = MessageTriggerRuleEntity.reconstitute(
            expected.id,
            expected.branchId,
            expected.name,
            expected.isActive,
            expected.eventType,
            expected.offsetType,
            expected.offsetDays,
            expected.recipientType,
            expected.templateKey,
            expected.createdAt,
            expected.updatedAt,
            expected.isDefault,
            expected.jobsStale,
            expected.sendTime,
            expected.targetClientStatus,
            expected.retryOnFailure,
        );
        next.update({
            ...nextState,
            offsetDays: this.normalizeOffsetDays(nextState.offsetType, nextState.offsetDays),
        });
        const nextForWrite = next;

        const updated = await this.runRuleTemplateMutation(
            branchId,
            nextState,
            (transaction) => this.ruleRepository.updateIfTargetMatchesAndFenceJobs(
                branchId,
                expected,
                nextForWrite,
                "Rule updated",
                mutationStartedAt,
                transaction,
            ),
            undefined,
            {
                allowPersistedActivationUnderParentOff: params.isActive === undefined,
                resolveParams: async (transaction) => {
                    const current = await this.ruleRepository.findById(branchId, id, transaction);
                    if (!current) return nextState;
                    const templateKey = params.templateKey ?? current.templateKey;
                    const automatic = !isManualMessageTriggerRule({ id: current.id, templateKey });
                    if (automatic && !this.messageAutomationActivationService) {
                        throw new ServiceUnavailableException("Message automation activation is not configured");
                    }
                    const parentEnabled = automatic
                        ? await this.messageAutomationActivationService!.getTriggerDispatchEnabled(branchId, transaction)
                        : true;
                    const requestedActive = params.isActive ?? current.isActive;
                    const resolvedState: UpsertRuleParams = {
                        name: params.name ?? current.name,
                        isActive: !parentEnabled && automatic
                            ? (params.isActive === true ? true : false)
                            : requestedActive,
                        eventType: params.eventType ?? current.eventType,
                        offsetType: params.offsetType ?? current.offsetType,
                        offsetDays: params.offsetDays ?? current.offsetDays,
                        sendTime: params.sendTime === undefined ? current.sendTime : params.sendTime,
                        recipientType: params.recipientType ?? current.recipientType,
                        templateKey,
                        targetClientStatus: params.targetClientStatus ?? current.targetClientStatus,
                        retryOnFailure: params.retryOnFailure ?? current.retryOnFailure,
                    };
                    this.validateRule(resolvedState, current.templateKey);
                    nextForWrite.update({
                        ...resolvedState,
                        offsetDays: this.normalizeOffsetDays(
                            resolvedState.offsetType,
                            resolvedState.offsetDays,
                        ),
                    });
                    return resolvedState;
                },
            },
        );
        if (!updated) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/targetVersion",
                code: "INVALID_VALUE",
                detail: "Automation rule changed after approval",
                location: "body",
            }));
        }
        return updated;
    }

    async deleteRule(branchId: string, id: string): Promise<void> {
        await this.ensureTriggerSchemaReady();
        const rule = await this.getRule(branchId, id);
        await this.cancelPendingJobsForRule(branchId, rule, "Rule deleted", false);
        await this.ruleRepository.delete(branchId, id);
    }

    /** Delete an automation rule only when its inspected snapshot still matches. */
    async deleteRuleApprovedTarget(
        branchId: string,
        id: string,
        expectedTargetVersion: string,
        targetSnapshot: Record<string, unknown> | undefined,
    ): Promise<void> {
        const mutationStartedAt = new Date();
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        const expected = this.ruleFromApprovedSnapshot(targetSnapshot);
        if (
            !expected
            || expected.id !== id
            || expected.branchId !== branchId
            || this.ruleTargetVersion(expected) !== expectedTargetVersion
        ) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/targetVersion",
                code: "INVALID_VALUE",
                detail: "Automation rule approval snapshot is missing or stale",
                location: "body",
            }));
        }
        const deleted = await this.ruleRepository.deleteIfTargetMatchesAndFenceJobs(
            branchId,
            expected,
            "Rule deleted",
            mutationStartedAt,
        );
        if (!deleted) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/targetVersion",
                code: "INVALID_VALUE",
                detail: "Automation rule changed after approval",
                location: "body",
            }));
        }
    }

    /**
     * Reconciliation must prove the whole automation mutation converged. A
     * matching rule alone is insufficient while its stale-job rebuild is
     * pending or an older active job remains dispatchable.
     */
    async isRuleMutationComplete(
        branchId: string,
        id: string,
        params: Partial<UpsertRuleParams>,
    ): Promise<boolean> {
        const rule = await this.getRule(branchId, id);
        const matches = Object.entries(params).every(([key, value]) => {
            if (value === undefined) return true;
            return JSON.stringify(rule[key as keyof MessageTriggerRuleEntity]) === JSON.stringify(value);
        });
        if (!matches || rule.jobsStale) return false;
        return !(await this.jobRepository.hasActiveJobsBefore(branchId, rule.id, rule.updatedAt));
    }

    async dispatchDueJobs(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        await this.jobRepository.cancelOrphanedPending(ORPHANED_TRIGGER_JOB_CANCEL_REASON);
        await this.reclaimStaleProcessingJobs();
        await this.recoverApprovedBranches();
        // Rebuild before querying due rows so a rule saved immediately before
        // this tick can dispatch on this tick instead of waiting another minute.
        await this.processStaleRuleRebuilds();
        const jobs = await this.jobRepository.findDuePendingSystemScope(100);
        const policyCache = new Map<string, boolean>();
        const isEnabled = async (
            branchId: string,
            policyId: "trigger-dispatch" | "trigger-job-retry",
        ): Promise<boolean> => {
            const cacheKey = `${branchId}:${policyId}`;
            const cached = policyCache.get(cacheKey);
            if (cached !== undefined) return cached;
            const enabled = await this.getMessagePolicyEnabled(branchId, policyId);
            policyCache.set(cacheKey, enabled);
            return enabled;
        };
        const eligibleJobs: MessageTriggerJobEntity[] = [];
        for (const job of jobs) {
            if (!job.branchId) continue;
            if (this.isAutomaticMessageJob(job) && !(await isEnabled(job.branchId, "trigger-dispatch"))) continue;
            const isRetry = job.attempts > 0 || job.nextAttemptAt !== null;
            if (isRetry && !(await isEnabled(job.branchId, "trigger-job-retry"))) continue;
            eligibleJobs.push(job);
        }

        if (eligibleJobs.length > 0) {
            const approvedBranchIds = await this.messageSenderApprovalService.getApprovedBranchIds(
                [...new Set(eligibleJobs.map((job) => job.branchId).filter((id): id is string => !!id))],
            );
            const sentIds = await this.messageLogRepository.findSentTriggerJobIdsSystemScope(
                eligibleJobs.map((job) => job.id),
            );
            for (const job of eligibleJobs) {
                try {
                    await this.dispatchClaimedJob(job, sentIds, approvedBranchIds);
                } catch (error) {
                    this.logger.error(
                        `[Message Automation] Failed to dispatch trigger job ${job.id}`,
                        error instanceof Error ? error.stack : String(error),
                    );
                }
            }
        }

    }

    async dispatchPendingJobNow(
        jobId: string,
        scope: { expectedBranchId: string },
    ): Promise<MessageTriggerJobEntity> {
        const fetchJob = () => this.jobRepository.findByIdInBranch(scope.expectedBranchId, jobId);

        const job = await fetchJob();
        if (!job) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        if (job.status !== "pending") {
            return job;
        }

        const approvedBranchIds = await this.messageSenderApprovalService.getApprovedBranchIds(
            job.branchId ? [job.branchId] : [],
        );
        const sentIds = await this.messageLogRepository.findSentTriggerJobIdsSystemScope([job.id]);
        await this.dispatchClaimedJob(job, sentIds, approvedBranchIds);

        return await fetchJob() ?? job;
    }

    /**
     * Manual, one-at-a-time resend of a '추가 정보 필요' (needs_setup) job after the
     * admin fixed the cause (BJJ-444, 메시지-04). The stored payload is sent as
     * is. A lost claim — concurrent resend, inactive rule or branch override,
     * stale rule, trigger dispatch off — leaves the row untouched and is a 409.
     */
    async resendNeedsSetupJob(branchId: string, id: string): Promise<ResendNeedsSetupJobResult> {
        await this.ensureTriggerSchemaReady();
        const fetchJob = () => this.jobRepository.findByIdInBranch(branchId, id);
        const job = await fetchJob();
        if (!job) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        if (job.status !== "needs_setup") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        const approvedBranchIds = await this.messageSenderApprovalService.getApprovedBranchIds(
            job.branchId ? [job.branchId] : [],
        );
        const sentIds = await this.messageLogRepository.findSentTriggerJobIdsSystemScope([job.id]);
        const claimed = await this.dispatchClaimedJob(job, sentIds, approvedBranchIds, { resendFromNeedsSetup: true });
        if (!claimed) {
            throw new ConflictException({ ...codeOnlyProblemBody("REQUEST_CONFLICT"), message: RESEND_JOB_CONFLICT_MESSAGE });
        }

        const current = await fetchJob() ?? job;
        return { id: current.id, status: current.status, reason: current.cancelReason ?? null };
    }

    /**
     * Cancel a scheduled trigger job on the user's behalf. Pending and
     * processing jobs scoped to the caller's branch are canceled atomically;
     * a processing claim is invalidated before the provider fence. The
     * repository call is a single conditional update, so there is no separate
     * existence/branch pre-check to race against it. Every other outcome
     * (already sent, already canceled, or no such job) collapses to the same
     * conflict-style failure — the caller does not need to know which.
     */
    async cancelJobByUser(branchId: string, id: string): Promise<{ id: string; status: "canceled" }> {
        await this.ensureTriggerSchemaReady();
        const canceled = await this.jobRepository.cancelPendingByUser(
            id,
            branchId,
            USER_REQUESTED_CANCEL_REASON,
        );
        if (!canceled) {
            throw new ConflictException({ ...codeOnlyProblemBody("REQUEST_CONFLICT"), message: CANCEL_JOB_CONFLICT_MESSAGE });
        }
        return { id, status: "canceled" };
    }

    async readClientAutomationSource(branchId: string, clientId: number, transaction?: Prisma.TransactionClient) {
        return this.automationSources.readClientAutomationSource(branchId, clientId, transaction);
    }

    async readClientAutomationArea(branchId: string, areaId: string, transaction?: Prisma.TransactionClient) {
        return this.automationSources.readClientAutomationArea(branchId, areaId, transaction);
    }

    async readClientAutomationSchedules(branchId: string, clientId: number, transaction?: Prisma.TransactionClient) {
        return this.automationSources.readClientAutomationSchedules(branchId, clientId, transaction);
    }

    async syncClientRulesForClient(
        branchId: string,
        clientId: number,
        includePast: boolean,
        suppressGreeting = false,
        intentOptions?: MessageTriggerIntentSyncOptions,
    ): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return;
        }

        const client = await this.readClientAutomationSource(branchId, clientId);
        if (!client) return;

        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, [
            MessageTriggerEventType.CLIENT_CREATED,
            MessageTriggerEventType.SERVICE_START,
            MessageTriggerEventType.SERVICE_END,
        ]);

        if (includePast) {
            if (!intentOptions?.preserveExisting) {
                await this.cancelPendingJobsForClient(
                    branchId,
                    rules,
                    clientId,
                    "Client data changed",
                );
            }
        } else {
            const immediateRules = rules.filter(
                (rule) => rule.offsetType === MessageTriggerOffsetType.IMMEDIATE,
            );
            const nonImmediateRules = rules.filter(
                (rule) => rule.offsetType !== MessageTriggerOffsetType.IMMEDIATE,
            );

            if (nonImmediateRules.length > 0) {
                await this.cancelPendingJobsForClient(
                    branchId,
                    nonImmediateRules,
                    clientId,
                    "Client data changed",
                );
            }

            await this.refreshPendingImmediateClientJobs(branchId, immediateRules, clientId, client);
        }

        const candidateJobs: ClientRuleJobCandidate[] = [];
        for (const rule of rules) {
            if (rule.eventType === MessageTriggerEventType.CLIENT_CREATED && !client.createdAt) {
                continue;
            }
            if (rule.templateKey === MessageTriggerTemplateKey.CLIENT_GREETING && suppressGreeting) {
                continue;
            }
            if (includePast && this.shouldSkipPreStartCatchUp(rule, client)) {
                continue;
            }
            const job = this.buildClientJob(rule, client);
            if (!job) continue;
            candidateJobs.push({ rule, job });
        }

        const jobsToPersist = includePast
            ? await this.applyRetroactiveSendConfig(
                branchId,
                candidateJobs,
                intentOptions?.stableBatchAt,
            )
            : candidateJobs;

        for (const { rule, job } of jobsToPersist) {
            await this.persistPendingJob(
                job,
                rule,
                includePast,
                false,
                intentOptions?.preserveExisting === true,
                undefined,
                intentOptions?.taskOrigin ? intentOptions.taskAutomationReference : undefined,
            );
        }
    }

    async cancelPendingJobsForClientDeletion(branchId: string, clientId: number): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        await this.jobRepository.cancelPendingByClientContext(
            branchId,
            clientId,
            "Client deleted",
        );
    }

    private async reconcileOrphanedClientJobs(branchId: string): Promise<void> {
        const orphanedJobs = await this.jobRepository.findRecoverableOrphanedClientJobs(branchId);
        await this.jobRepository.cancelOrphanedPending(
            ORPHANED_TRIGGER_JOB_CANCEL_REASON,
            branchId,
        );
        if (orphanedJobs.length === 0) {
            return;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return;
        }

        const clients = await this.prisma.client.findMany({
            where: { branchId, phone: { not: null } },
            select: { id: true, phone: true, createdAt: true, suppressGreetingSms: true },
        });
        const clientsByPhone = new Map<string, typeof clients>();
        for (const client of clients) {
            const phone = normalizePhone(client.phone);
            if (!phone) continue;
            const matches = clientsByPhone.get(phone) ?? [];
            matches.push(client);
            clientsByPhone.set(phone, matches);
        }

        const orphanIdsByReplacementClient = new Map<number, string[]>();
        for (const job of orphanedJobs) {
            const phone = normalizePhone(job.recipientPhone ?? job.payload.recipientPhone);
            if (!phone) continue;
            const matches = clientsByPhone.get(phone) ?? [];
            if (matches.length !== 1) continue;
            const [replacementClient] = matches;
            if (!replacementClient || replacementClient.createdAt <= job.createdAt) continue;

            const jobIds = orphanIdsByReplacementClient.get(replacementClient.id) ?? [];
            jobIds.push(job.id);
            orphanIdsByReplacementClient.set(replacementClient.id, jobIds);
        }

        for (const [clientId, jobIds] of orphanIdsByReplacementClient) {
            const client = clients.find((candidate) => candidate.id === clientId);
            await this.syncClientRulesForClient(
                branchId,
                clientId,
                true,
                client?.suppressGreetingSms ?? false,
            );
            await this.jobRepository.markOrphanedJobsReconciled(jobIds, clientId);
        }
    }

    async syncEmployeeAssignmentRulesForSchedule(
        branchId: string,
        employeeScheduleId: number,
        includePast: boolean,
        intentOptions?: Pick<MessageTriggerIntentSyncOptions, "preserveExisting" | "taskOrigin" | "taskAutomationReference">,
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return false;
        }

        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: employeeScheduleId, branchId },
            include: {
                client: true,
                primaryEmployee: true,
                secondaryEmployee: true,
            },
        });
        if (!schedule) return true;

        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, [
            MessageTriggerEventType.EMPLOYEE_ASSIGNED,
        ]);

        // A replaced schedule is terminal for employee-assignment automation.
        // Even an intent replay that normally preserves an existing generation
        // must cancel any pending assignment before returning, and must not
        // create a replacement for the retired schedule.
        let retryable = false;
        if (!intentOptions?.preserveExisting || schedule.replaced) {
            const canceled = await this.cancelPendingJobsForEmployeeSchedule(
                branchId,
                rules,
                employeeScheduleId,
                EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            );
            if (!canceled && !schedule.replaced) retryable = true;
        }

        if (schedule.replaced) return true;

        for (const rule of rules) {
            const job = this.buildEmployeeAssignmentJob(rule, schedule);
            if (!job) continue;
            if (await this.hasSentEmployeeAssignmentJobForSameEmployee(job)) {
                continue;
            }
            const persisted = await this.persistPendingJob(
                job,
                rule,
                includePast,
                false,
                intentOptions?.preserveExisting === true,
                undefined,
                intentOptions?.taskOrigin ? intentOptions.taskAutomationReference : undefined,
            );
            if (!persisted) retryable = true;
        }
        return !retryable;
    }

    /**
     * Refresh assignment jobs whose source payload contains the client's name.
     * The schedule itself remains the same generation, so its deterministic
     * dedupe key lets the mutable pending row be rebuilt in place.
     */
    async syncEmployeeAssignmentRulesForClient(
        branchId: string,
        clientId: number,
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return false;
        }

        const schedules = await this.prisma.employee_schedule.findMany({
            // A terminated assignment must not be re-armed. This path rebuilds the job
            // with scheduledFor = now and includePast = true, which skips the past and
            // IMMEDIATE guards, so without this bound editing a terminated client's name
            // sends the provider a fresh 배정 안내 for a service that is over.
            where: { branchId, clientId, replaced: false, terminatedAt: null },
            select: { id: true },
            orderBy: { id: "asc" },
        });

        let retryable = false;
        for (const schedule of schedules) {
            const refreshed = await this.syncEmployeeAssignmentRulesForSchedule(
                branchId,
                schedule.id,
                true,
            );
            if (refreshed === false) retryable = true;
        }
        return !retryable;
    }

    /**
     * Refresh assignment jobs for every active schedule that references the
     * employee. Branch and replacement predicates keep the reconciliation
     * inside the caller's tenant and out of retired schedule generations.
     */
    async syncEmployeeAssignmentRulesForEmployee(
        branchId: string,
        employeeId: number,
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return false;
        }

        const schedules = await this.prisma.employee_schedule.findMany({
            where: {
                branchId,
                replaced: false,
                // Same re-arm hazard as the per-client sync above: editing the provider's
                // name or phone must not resurrect a 배정 안내 for a terminated service.
                terminatedAt: null,
                OR: [
                    { primaryEmployeeId: employeeId },
                    { secondaryEmployeeId: employeeId },
                ],
            },
            select: { id: true },
            orderBy: { id: "asc" },
        });

        let retryable = false;
        for (const schedule of schedules) {
            const refreshed = await this.syncEmployeeAssignmentRulesForSchedule(
                branchId,
                schedule.id,
                true,
            );
            if (refreshed === false) retryable = true;
        }
        return !retryable;
    }

    async hasActiveRulesForEvents(
        branchId: string,
        eventTypes: MessageTriggerEventType[],
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, eventTypes);
        return rules.length > 0;
    }

    private async ensureDefaultTrigger(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        defaults: UpsertRuleParams,
        matchTemplateKeyOnly = false,
    ): Promise<{ rules: MessageTriggerRuleEntity[]; created: MessageTriggerRuleEntity | null }> {
        const matchesDefault = (rule: MessageTriggerRuleEntity): boolean => matchesTriggerDefaults(rule, defaults, matchTemplateKeyOnly);

        // Provisioning asks whether THIS branch already has its default, so it
        // may only consider rules the branch owns. findAll also returns the
        // global system rules — and system:message_automation_intent carries
        // the client-greeting tuple as its bookkeeping marker, so matching
        // against a global rule would convince every branch it already had a
        // default it never got.
        const ownsRule = (rule: MessageTriggerRuleEntity): boolean => rule.branchId === branchId;

        // Once a provisioned default exists, admin edits must be respected. Template-key-only
        // matching prevents an edited default from being silently recreated with the old tuple.
        const existing = rules.filter(ownsRule).find(matchesDefault);
        if (existing) return { rules, created: null };

        let created: MessageTriggerRuleEntity;
        try {
            created = await this.runRuleTemplateMutation(
                branchId,
                defaults,
                (transaction) => this.ruleRepository.create(
                    branchId,
                    MessageTriggerRuleEntity.create({
                        branchId,
                        ...defaults,
                        isDefault: true,
                    }),
                    transaction,
                ),
            );
        } catch (error) {
            if (!isPrismaUniqueViolation(error)) {
                throw error;
            }

            const latestRules = await this.ruleRepository.findAll(branchId);
            const existingAfterRace = latestRules.filter(ownsRule).find(matchesDefault);
            if (existingAfterRace) {
                return { rules: latestRules, created: null };
            }
            throw error;
        }
        await this.rebuildJobsForRule(branchId, created, false);
        return { rules: [created, ...rules], created };
    }

    private async ensureDefaultServiceInfoTrigger(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
    ): Promise<MessageTriggerRuleEntity[]> {
        if (!branchId) return rules;

        const { rules: rulesAfterServiceInfo } = await this.ensureDefaultTrigger(
            branchId,
            rules,
            DEFAULT_SERVICE_INFO_TRIGGER,
            true,
        );

        const { rules: finalRules } = await this.ensureDefaultTrigger(
            branchId,
            rulesAfterServiceInfo,
            DEFAULT_CLIENT_GREETING_TRIGGER,
            true,
        );

        return finalRules;
    }

    private async rebuildJobsForRule(
        branchId: string | null,
        rule: MessageTriggerRuleEntity,
        includePast: boolean,
        transaction?: Prisma.TransactionClient,
    ): Promise<void> {
        if (!rule.isActive) return;
        if (!branchId) return;

        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return;
        }

        if (rule.eventType === MessageTriggerEventType.EMPLOYEE_ASSIGNED) {
            return;
        }

        if (rule.offsetType === MessageTriggerOffsetType.IMMEDIATE) return;

        const supportsCreatedAt = await hasColumn(this.prisma, "client", "created_at");
        if (rule.eventType === MessageTriggerEventType.CLIENT_CREATED && !supportsCreatedAt) {
            return;
        }

        const supportsAreaId = await hasColumn(this.prisma, "client", "area_id");
        // Prisma's type inference does not correctly narrow the `area` relation type when
        // the select key is inside a conditional spread; cast to ClientTriggerSource[] explicitly.
        const clients = await (transaction ?? this.prisma).client.findMany({
            where: { branchId },
            select: {
                id: true,
                name: true,
                phone: true,
                type: true,
                startDate: true,
                endDate: true,
                serviceEndNoticeSentAt: true,
                duration: true,
                fullPrice: true,
                grant: true,
                actualPrice: true,
                ...(supportsAreaId ? { area: { select: { bankAccountInfo: { select: { bankName: true, accNum: true } } } } } : {}),
                ...(supportsCreatedAt ? { createdAt: true } : {}),
            },
        }) as ClientTriggerSource[];

        for (const client of clients) {
            const job = this.buildClientJob(rule, client);
            await this.persistPendingJob(job, rule, includePast, rule.jobsStale, false, transaction);
        }
    }

    private async persistPendingJob(
        job: MessageTriggerJobEntity | null,
        rule: MessageTriggerRuleEntity,
        includePast: boolean,
        expectedJobsStale: boolean,
        preserveExisting = false,
        transaction?: Prisma.TransactionClient,
        taskAutomationReference?: AgentAutomationTaskCommitReference,
    ): Promise<boolean> {
        if (!job) return true;
        // The reference is carried only in the materialized job payload. It is
        // digest-only and does not alter the source recipe, so callers without
        // a task-origin intent retain the exact legacy object and expectations.
        const materializedJob = taskAutomationReference
            ? {
                ...job,
                payload: {
                    ...job.payload,
                    taskAutomationReference,
                },
            } as MessageTriggerJobEntity
            : job;
        const automaticJob = this.isAutomaticMessageJob(materializedJob);
        if (
            automaticJob
            && (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService || !this.automationDeliveryGate || !materializedJob.branchId)
        ) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        if (!isMessageRecipeWithinMaterializationWindow(materializedJob, rule, includePast, new Date())) return true;
        const persist = async (transaction?: Prisma.TransactionClient): Promise<MessageTriggerJobEntity | null> => {
            if (automaticJob && materializedJob.branchId) {
                const enabled = await this.messageAutomationActivationService!.getTriggerDispatchEnabled(materializedJob.branchId, transaction);
                if (!enabled) return null;
            }
            const persisted = await (transaction
                ? this.jobRepository.upsertPendingForRuleGeneration(
                    materializedJob,
                    rule.updatedAt,
                    expectedJobsStale,
                    preserveExisting,
                    transaction,
                )
                : preserveExisting
                    ? this.jobRepository.upsertPendingForRuleGeneration(
                        materializedJob,
                        rule.updatedAt,
                        expectedJobsStale,
                        true,
                    )
                    : this.jobRepository.upsertPendingForRuleGeneration(
                        materializedJob,
                        rule.updatedAt,
                        expectedJobsStale,
                    ));
            if (automaticJob && persisted?.status === "pending") {
                if (!transaction || !this.automationDeliveryGate) throw new ServiceUnavailableException("Message automation authority is not configured");
                await this.automationDeliveryGate.bindMaterialization(transaction, persisted,
                    (candidate, tx) => this.deliveryService.resolveCanonicalDeliverySnapshot(candidate, tx));
            }
            return persisted;
        };
        const persisted = automaticJob
            ? await this.messageAutomationBranchLockService!.runExclusive(
                materializedJob.branchId!,
                (lockTransaction) => persist(lockTransaction),
                transaction,
            )
            : await persist(transaction);
        return persisted !== null;
    }

    private async applyRetroactiveSendConfig(
        branchId: string,
        candidates: ClientRuleJobCandidate[],
        stableBatchAt?: Date,
    ): Promise<ClientRuleJobCandidate[]> {
        if (candidates.length === 0) return candidates;

        const pastTriggerEnabled = await this.getMessagePolicyEnabled(branchId, "past-trigger");
        if (!pastTriggerEnabled) {
            return candidates.filter(({ job }) => job.scheduledFor.getTime() > Date.now());
        }

        const config = await this.getRetroactiveSendConfig(branchId);
        const now = Date.now();
        const baseScheduledFor = stableBatchAt
            ? new Date(stableBatchAt)
            : new Date(now);
        const dueCandidates = candidates.filter(({ job }) => job.scheduledFor.getTime() <= now);
        const futureCandidates = candidates
            .filter(({ job }) => job.scheduledFor.getTime() > now)
            .sort((left, right) => left.job.scheduledFor.getTime() - right.job.scheduledFor.getTime());

        const orderedDueCandidates = this.orderRetroactiveCandidates(
            dueCandidates,
            config.ruleOrder,
        );

        orderedDueCandidates.forEach(({ rule, job }, index) => {
            const originalScheduledFor = job.scheduledFor.toISOString();
            const scheduledFor = new Date(
                baseScheduledFor.getTime() + (index * config.sendIntervalMinutes * MS_PER_MINUTE),
            );
            job.scheduledFor = scheduledFor;
            if (job.clientId !== null) {
                job.dedupeKey = buildMessageRecipeDedupeKey(
                    rule.id,
                    `client:${job.clientId}`,
                    scheduledFor,
                    rule.recipientType,
                );
            }
            job.payload.catchUp = {
                batchId: `client:${job.clientId ?? "unknown"}:${baseScheduledFor.toISOString()}`,
                sequence: index + 1,
                intervalMinutes: config.sendIntervalMinutes,
                originalScheduledFor,
                predecessorDedupeKey: index > 0
                    ? orderedDueCandidates[index - 1]?.job.dedupeKey ?? null
                    : null,
            };
        });

        return [...orderedDueCandidates, ...futureCandidates];
    }

    private async getRetroactiveSendConfig(branchId: string, transaction?: Prisma.TransactionClient): Promise<MessageAutomationPastTriggerConfig> {
        return this.automationSources.getRetroactiveSendConfig(branchId, transaction);
    }

    private async getMessagePolicyEnabled(branchId: string, policyId: "trigger-dispatch" | "trigger-job-retry" | "past-trigger", transaction?: Prisma.TransactionClient): Promise<boolean> {
        return this.automationSources.getMessagePolicyEnabled(branchId, policyId, transaction);
    }

    private async isMessageAutomationParentEnabled(branchId: string, transaction?: Prisma.TransactionClient): Promise<boolean> {
        return this.automationSources.isMessageAutomationParentEnabled(branchId, transaction);
    }

    private isAutomaticMessageJob(job: Pick<MessageTriggerJobEntity, "templateKey" | "ruleId" | "dedupeKey">): boolean {
        return !isManualMessageTriggerJob(job);
    }

    private orderRetroactiveCandidates(
        candidates: ClientRuleJobCandidate[],
        ruleOrder: string[],
    ): ClientRuleJobCandidate[] {
        const orderMap = new Map(ruleOrder.map((ruleId, index) => [ruleId, index]));

        return [...candidates].sort((left, right) => {
            const leftOrder = orderMap.get(left.rule.id);
            const rightOrder = orderMap.get(right.rule.id);

            if (leftOrder !== undefined && rightOrder !== undefined) {
                return leftOrder - rightOrder;
            }
            if (leftOrder !== undefined) return -1;
            if (rightOrder !== undefined) return 1;

            const scheduledForDiff = left.job.scheduledFor.getTime() - right.job.scheduledFor.getTime();
            if (scheduledForDiff !== 0) return scheduledForDiff;

            return left.rule.createdAt.getTime() - right.rule.createdAt.getTime();
        });
    }

    private async refreshPendingImmediateClientJobs(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        clientId: number,
        client: ClientTriggerSource,
    ): Promise<void> {
        if (rules.length === 0) return;

        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
        const jobs = await this.jobRepository.findPendingByRuleIdsAndClientId(
            rules.map((rule) => rule.id),
            clientId,
        );

        for (const job of jobs) {
            const rule = rulesById.get(job.ruleId);
            if (!rule) continue;

            // A client mutation can race a job that was already claimed for
            // delivery. Invalidate that active claim before refreshing the
            // pending payload, in ONE status-predicated statement: it matches
            // only a row that is still `processing` under the token read above.
            // A worker that has since moved the job to `dispatching` (the token
            // does not change at that step) or replaced the claim wins, and its
            // job is left untouched instead of being overwritten as canceled
            // while its message goes out.
            if (job.status === "processing") {
                if (job.claimToken) {
                    await this.jobRepository.cancelProcessingClaim(job.id, job.claimToken, "Client data changed");
                }
                continue;
            }

            const refreshedJob = this.buildClientJob(rule, client);
            if (!refreshedJob) continue;
            const refreshedPayload = {
                ...refreshedJob.payload,
                ...(job.payload.catchUp ? { catchUp: job.payload.catchUp } : {}),
                ...(job.status === "needs_setup" && job.payload.taskAutomationReference ? { taskAutomationReference: job.payload.taskAutomationReference } : {}),
            };

            // 고객 정보 수정은 추가 정보 필요 작업도 새 payload로 재생성한다.
            // 일반 resync/upsert는 이 상태를 복구하지 않는다.
            if (job.status === "needs_setup") {
                // 오래된 추가 정보 필요 작업은 재생성해도 dispatch에서 만료되므로 보존한다.
                if (job.scheduledFor.getTime() <= Date.now() - PAST_OCCURRENCE_GRACE_MS) continue;
                if (job.recipientPhone === refreshedJob.recipientPhone
                    && agentBindingHash(agentAutomationSourcePayload(job.payload, job.templateKey))
                        === agentBindingHash(agentAutomationSourcePayload(refreshedPayload, job.templateKey))) continue;
                const canceled = await this.jobRepository.cancelPendingForRuleGeneration(
                    branchId, rule.id, rule.updatedAt, false, "Client data changed", { clientId, needsSetup: "within_window" },
                );
                if (canceled === null || canceled === 0) continue;
                job.status = "pending";
            }

            job.recipientPhone = refreshedJob.recipientPhone;
            job.payload = refreshedPayload;
            await this.persistPendingJob(job, rule, true, false);
        }
    }

    private buildClientJob(
        rule: MessageTriggerRuleEntity,
        client: ClientTriggerSource,
    ): MessageTriggerJobEntity | null {
        const recipe = buildClientMessageRecipe(rule, client, new Date());
        return recipe ? MessageTriggerJobEntity.create(recipe) : null;
    }

    private buildEmployeeAssignmentJob(
        rule: MessageTriggerRuleEntity,
        schedule: EmployeeAssignmentScheduleSource,
    ): MessageTriggerJobEntity | null {
        const recipe = buildEmployeeAssignmentMessageRecipe(rule, schedule, new Date());
        return recipe ? MessageTriggerJobEntity.create(recipe) : null;
    }

    private async hasSentEmployeeAssignmentJobForSameEmployee(
        job: MessageTriggerJobEntity,
    ): Promise<boolean> {
        if (job.employeeScheduleId === null) return false;

        const sentJobs = await this.jobRepository.findSentByRuleIdAndEmployeeScheduleId(
            job.ruleId,
            job.employeeScheduleId,
        );
        return sentJobs.some((sentJob) => this.isSameEmployeeAssignmentRecipient(sentJob, job));
    }

    private isSameEmployeeAssignmentRecipient(
        sentJob: MessageTriggerJobEntity,
        newJob: MessageTriggerJobEntity,
    ): boolean {
        if (sentJob.recipientType !== newJob.recipientType) return false;

        const sentEmployeeId = sentJob.payload.employeeId;
        const newEmployeeId = newJob.payload.employeeId;
        if (typeof sentEmployeeId === "number" && typeof newEmployeeId === "number") {
            return sentEmployeeId === newEmployeeId;
        }

        return Boolean(
            sentJob.recipientPhone &&
            newJob.recipientPhone &&
            sentJob.recipientPhone === newJob.recipientPhone,
        );
    }

    private describeTiming(rule: MessageTriggerRuleEntity, anchorLabel: string): string {
        switch (rule.offsetType) {
            case MessageTriggerOffsetType.SAME_DAY:
                return `${anchorLabel} 당일 안내`;
            case MessageTriggerOffsetType.BEFORE_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 전 안내`;
            case MessageTriggerOffsetType.AFTER_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 후 안내`;
            case MessageTriggerOffsetType.IMMEDIATE:
                return "즉시 안내";
            default:
                return "알림 안내";
        }
    }

    private normalizeOffsetDays(
        offsetType: MessageTriggerOffsetType,
        offsetDays?: number,
    ): number {
        return normalizeMessageTriggerOffsetDays(offsetType, offsetDays);
    }

    private ruleTargetVersion(rule: MessageTriggerRuleEntity): string {
        return createHash("sha256").update(JSON.stringify({
            id: rule.id,
            name: rule.name,
            isActive: rule.isActive,
            eventType: rule.eventType,
            offsetType: rule.offsetType,
            offsetDays: rule.offsetDays,
            sendTime: rule.sendTime,
            recipientType: rule.recipientType,
            templateKey: rule.templateKey,
            isDefault: rule.isDefault,
            jobsStale: rule.jobsStale,
            targetClientStatus: rule.targetClientStatus,
            retryOnFailure: rule.retryOnFailure,
            updatedAt: rule.updatedAt.toISOString(),
        })).digest("hex");
    }

    private ruleFromApprovedSnapshot(snapshot: Record<string, unknown> | undefined): MessageTriggerRuleEntity | null {
        if (!snapshot) return null;
        const id = snapshot["id"];
        const branchId = snapshot["branchId"];
        const name = snapshot["name"];
        const isActive = snapshot["isActive"];
        const eventType = snapshot["eventType"];
        const offsetType = snapshot["offsetType"];
        const offsetDays = snapshot["offsetDays"];
        const sendTime = snapshot["sendTime"];
        const recipientType = snapshot["recipientType"];
        const templateKey = snapshot["templateKey"];
        const isDefault = snapshot["isDefault"];
        const jobsStale = snapshot["jobsStale"];
        const targetClientStatus = snapshot["targetClientStatus"];
        const retryOnFailure = snapshot["retryOnFailure"];
        const createdAt = snapshot["createdAt"];
        const updatedAt = snapshot["updatedAt"];
        if (
            typeof id !== "string"
            || typeof branchId !== "string"
            || typeof name !== "string"
            || typeof isActive !== "boolean"
            || typeof eventType !== "string"
            || typeof offsetType !== "string"
            || typeof offsetDays !== "number"
            || typeof sendTime !== "string"
            || !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)
            || typeof recipientType !== "string"
            || typeof templateKey !== "string"
            || typeof isDefault !== "boolean"
            || typeof jobsStale !== "boolean"
            // An approval issued before these fields existed lacks them; it is
            // stale by definition and must never be defaulted into a write.
            || !isMessageTriggerTargetClientStatus(targetClientStatus)
            || typeof retryOnFailure !== "boolean"
            || typeof createdAt !== "string"
            || typeof updatedAt !== "string"
        ) {
            return null;
        }
        const created = new Date(createdAt);
        const updated = new Date(updatedAt);
        if (Number.isNaN(created.getTime()) || Number.isNaN(updated.getTime())) return null;
        return MessageTriggerRuleEntity.reconstitute(
            id,
            branchId,
            name,
            isActive,
            eventType as MessageTriggerEventType,
            offsetType as MessageTriggerOffsetType,
            offsetDays,
            recipientType as MessageTriggerRecipientType,
            templateKey as MessageTriggerTemplateKey,
            created,
            updated,
            isDefault,
            jobsStale,
            sendTime,
            targetClientStatus,
            retryOnFailure,
        );
    }

    private validateRule(
        params: UpsertRuleParams,
        allowedExistingTemplateKey?: MessageTriggerTemplateKey,
    ): void {
        validateMessageTriggerRule(params, allowedExistingTemplateKey);
    }

    private async ensureActiveRuleTemplateVariablesSupported(
        branchId: string,
        params: UpsertRuleParams,
    ): Promise<void> {
        if (params.isActive === false) return;

        const systemTemplateKey = MESSAGE_TRIGGER_TEMPLATE_CATALOG[params.templateKey]
            .providers.sms?.templateKey;
        if (!systemTemplateKey) return;

        const template = await this.systemTemplateService.getByKeyForBranch(branchId, systemTemplateKey);
        const unsupportedVariables = findUnsupportedRequiredMessageTriggerVariables(
            params.templateKey,
            template.customVariables ?? [],
        );
        if (unsupportedVariables.length === 0) return;

        throw new BadRequestException({
            ...problemBody("VALIDATION_FAILED", {
                pointer: "/templateKey",
                code: "INVALID_VALUE",
                detail: "자동 발송에서 입력할 수 없는 필수 템플릿 변수가 있습니다.",
                location: "body",
            }),
            unsupportedVariables,
        });
    }

    private getRuleSystemTemplateKey(
        templateKey: MessageTriggerTemplateKey,
    ): SystemTemplateKey | null {
        const systemTemplateKey =
            MESSAGE_TRIGGER_TEMPLATE_CATALOG[templateKey].providers.sms?.templateKey;
        return systemTemplateKey ? systemTemplateKey as SystemTemplateKey : null;
    }

    private async runRuleTemplateMutation<T>(
        branchId: string,
        params: UpsertRuleParams,
        work: (transaction: Prisma.TransactionClient) => Promise<T>,
        transaction?: Prisma.TransactionClient,
        options: {
            allowPersistedActivationUnderParentOff?: boolean;
            resolveParams?: (transaction: Prisma.TransactionClient) => Promise<UpsertRuleParams>;
        } = {},
    ): Promise<T> {
        // No rule id is available at this generic mutation layer (createRule has none yet;
        // updateRule/updateRuleApprovedTarget resolve the real id and ownership themselves
        // inside resolveParams before this point). Neither caller ever targets the branchless
        // SERVICE_END_NOTICE system row here, so both this initial guess and the refined
        // decision below are unconditionally automatic (BJJ-342).
        const initiallyAutomatic = true;
        const runWithBranchLock = async (branchTransaction: Prisma.TransactionClient): Promise<T> => {
            const effectiveParams = options.resolveParams
                ? await options.resolveParams(branchTransaction)
                : params;
            const isAutomaticRule = true;
            if (
                isAutomaticRule
                && (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService)
            ) {
                throw new ServiceUnavailableException("Message automation activation is not configured");
            }
            if (
                effectiveParams.isActive !== false
                && isAutomaticRule
                && !options.allowPersistedActivationUnderParentOff
            ) {
                await this.messageAutomationActivationService!.assertTriggerDispatchEnabled(branchId, branchTransaction);
            }

            if (effectiveParams.isActive === false) return work(branchTransaction);

            const systemTemplateKey = this.getRuleSystemTemplateKey(effectiveParams.templateKey);
            if (!systemTemplateKey) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/templateKey",
                    code: "INVALID_VALUE",
                    detail: "SMS 발송 채널이 없는 템플릿입니다.",
                    location: "body",
                }));
            }
            const withTemplateLock = async (writeTransaction: Prisma.TransactionClient): Promise<T> => {
                await this.ensureActiveRuleTemplateVariablesSupported(branchId, effectiveParams);
                return work(writeTransaction);
            };
            return this.templateAutomationLock.runExclusive(
                systemTemplateKey,
                withTemplateLock,
                branchTransaction,
            );
        };

        if (initiallyAutomatic) {
            if (!this.messageAutomationBranchLockService) {
                throw new ServiceUnavailableException("Message automation activation is not configured");
            }
            return this.messageAutomationBranchLockService.runExclusive(
                branchId,
                runWithBranchLock,
                transaction,
            );
        }
        if (this.messageAutomationBranchLockService) {
            return this.messageAutomationBranchLockService.runExclusive(
                branchId,
                runWithBranchLock,
                transaction,
            );
        }
        return transaction ? work(transaction) : this.prisma.$transaction(work);
    }

    private async cancelPendingJobsForRule(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        reason: string,
        expectedJobsStale: boolean,
    ): Promise<boolean> {
        const canceled = await this.jobRepository.cancelPendingForRuleGeneration(
            branchId,
            rule.id,
            rule.updatedAt,
            expectedJobsStale,
            reason,
            { needsSetup: reason === "Rule deleted" || !rule.isActive ? "all" : undefined },
        );
        return canceled !== null;
    }

    private async listManualScheduledSmsLogs(
        branchId: string,
        limit: number,
    ): Promise<UpcomingMessageTriggerJobView[]> {
        if (!this.prisma.message_log) {
            return [];
        }
        if (!(await hasTable(this.prisma, "message_log"))) {
            return [];
        }

        const logs = await this.prisma.message_log.findMany({
            where: {
                branchId,
                provider: "aligo_sms",
                status: "pending",
                variables: {
                    path: ["triggerType"],
                    equals: "scheduled",
                },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        });

        return logs.flatMap((log) => {
            const variables = this.toStringRecord(log.variables);
            const scheduledFor = this.parseManualScheduledAt(
                variables["scheduledDate"],
                variables["scheduledTime"],
            );
            if (!scheduledFor) {
                return [];
            }

            const recipientName = log.recipientName?.trim() || "수신자";
            const recipientPhone = log.recipientPhone?.trim() || log.receiver;

            return [{
                id: `log:${log.id}`,
                ruleId: `manual-sms:${log.id}`,
                ruleName: variables["title"]?.trim() || "수동 예약 발송",
                eventType: null,
                offsetType: null,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                recipientPhone,
                templateKey: MessageTriggerTemplateKey.INFO,
                status: "pending",
                scheduledFor,
                sentAt: null,
                canceledAt: null,
                cancelReason: null,
                clientId: log.clientId,
                employeeScheduleId: null,
                payload: {
                    clientId: log.clientId,
                    clientName: recipientName,
                    memberId: `message-log:${log.id}`,
                    recipientName,
                    recipientPhone,
                    templateVariables: variables,
                    messageBody: log.messageBody,
                },
                createdAt: log.createdAt,
                updatedAt: log.updatedAt,
            }];
        });
    }

    private toStringRecord(value: Prisma.JsonValue): Record<string, string> {
        if (!value || Array.isArray(value) || typeof value !== "object") {
            return {};
        }

        return Object.fromEntries(
            Object.entries(value)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
    }

    private parseManualScheduledAt(
        scheduledDate?: string,
        scheduledTime?: string,
    ): Date | null {
        if (!scheduledDate || !scheduledTime) return null;

        const date = scheduledDate.replace(/\D/g, "");
        const time = scheduledTime.replace(/\D/g, "");
        if (date.length !== 8 || time.length !== 4) return null;

        const parsed = new Date(
            `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`,
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private async cancelPendingJobsForClient(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        clientId: number,
        reason: string,
    ): Promise<void> {
        for (const rule of rules) {
            await this.jobRepository.cancelPendingForRuleGeneration(
                branchId,
                rule.id,
                rule.updatedAt,
                false,
                reason,
                { clientId, needsSetup: rule.offsetType !== MessageTriggerOffsetType.IMMEDIATE
                    && rule.eventType !== MessageTriggerEventType.EMPLOYEE_ASSIGNED ? "within_window" : undefined },
            );
        }
    }

    private async cancelPendingJobsForEmployeeSchedule(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        employeeScheduleId: number,
        reason: string,
    ): Promise<boolean> {
        let succeeded = true;
        for (const rule of rules) {
            const canceled = await this.jobRepository.cancelPendingForRuleGeneration(
                branchId,
                rule.id,
                rule.updatedAt,
                false,
                reason,
                { employeeScheduleId, needsSetup: "all" },
            );
            if (canceled === null) succeeded = false;
        }
        return succeeded;
    }

    private async dispatchClaimedJob(
        job: MessageTriggerJobEntity,
        sentIds: ReadonlySet<string>,
        approvedBranchIds: ReadonlySet<string>,
        options: DispatchClaimedJobOptions = {},
    ): Promise<boolean> {
        const resend = options.resendFromNeedsSetup === true;
        const automaticJob = this.isAutomaticMessageJob(job);
        if (
            automaticJob
            && (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService || !job.branchId)
        ) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        // Admin 즉시 발송 is the only send that bypasses the safeguard. Rule jobs,
        // retries, AI-agent SMS and an admin resend of a '추가 정보 필요' job never
        // do: a resent job was automatic, and a blocked resend stays needs_setup.
        const skipSafeguard = !this.smsAutomationSafeguard
            || this.smsAutomationSafeguard.isAdminDirectSend(job);
        let safeguardBlock: Extract<SmsAutomationSafeguardDecision, { allowed: false }> | null = null;
        const claim = async (transaction?: Prisma.TransactionClient): Promise<string | null> => {
            if (!skipSafeguard) {
                const decision = await this.smsAutomationSafeguard!.check(job, transaction);
                if (!decision.allowed) {
                    // A refused resend leaves the row '추가 정보 필요' (the caller
                    // answers 409). An ordinary job held only by the branch switch
                    // stays pending (normalizeBranchOff owns it). Every other block
                    // cancels the job so it cannot starve the due-job window.
                    if (resend) {
                        this.smsAutomationSafeguard!.warnBlocked(`resend of trigger job ${job.id}`, decision);
                        return null;
                    }
                    if (automaticJob && decision.level === "branch") return null;
                    if (await this.cancelPendingForSafeguard(job.id, decision, transaction)) {
                        safeguardBlock = decision;
                    }
                    return null;
                }
            }
            if (automaticJob && job.branchId) {
                if (!(await this.messageAutomationActivationService!.getTriggerDispatchEnabled(job.branchId, transaction))) {
                    return null;
                }
            }
            if (resend) {
                return transaction
                    ? this.jobRepository.claimNeedsSetupWithRuleFence(job.id, job.branchId, transaction)
                    : this.jobRepository.claimNeedsSetupWithRuleFence(job.id, job.branchId);
            }
            return transaction
                ? this.jobRepository.claimPendingWithRuleFence(job.id, job.branchId, transaction)
                : this.jobRepository.claimPendingWithRuleFence(job.id, job.branchId);
        };
        const claimed = automaticJob
            ? await this.messageAutomationBranchLockService!.runExclusive(job.branchId!, (transaction) => claim(transaction))
            : await claim();
        if (!claimed) {
            if (safeguardBlock) {
                const block: Extract<SmsAutomationSafeguardDecision, { allowed: false }> = safeguardBlock;
                job.cancel(smsAutomationSafeguardReason(block.level));
                this.smsAutomationSafeguard!.warnBlocked(`trigger job ${job.id}`, block);
                return true;
            }
            return false;
        }

        // The SQL claim returns the immutable attempt token. A claim without
        // one is not safe to deliver: the pre-provider fence fails closed.
        const claimToken = claimed;
        job.claimToken = claimToken;
        // The resend claim keeps the setup reason on the in-flight row: a
        // non-null `cancel_reason` on a `processing` row is the durable mark
        // that the stale-processing reclaim reads to return it to
        // `needs_setup`. The ordinary claim clears it (repository), so keep the
        // in-memory entity aligned. Whatever the attempt ends as sets its own
        // reason; `markSent` clears it.
        if (!resend) job.cancelReason = null;

        if (sentIds.has(job.id)) {
            job.markSent();
            await this.persistTriggerJobStatus(job, "persist sent trigger job reconciliation");
            return true;
        }

        let linkClient: { serviceStatus: string | null; startDate: Date | null; endDate: Date | null; bookingConfirmedAt: Date | null } | null = null;
        if (automaticJob && job.ruleId === SERVICE_RECORD_LINK_RULE_ID) {
            // 늦게 등록한 링크 문자는 명목 예약 시각을 유지하고 종료일까지 발송한다.
            const schedule = job.employeeScheduleId && job.branchId
                ? await this.prisma.employee_schedule.findFirst({
                    where: { id: job.employeeScheduleId, branchId: job.branchId },
                    select: {
                        endDate: true, replaced: true, terminatedAt: true,
                        client: { select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true } },
                    },
                })
                : null;
            if (!schedule || schedule.replaced || schedule.terminatedAt) {
                job.cancel("Service record link schedule ended or replaced");
                await this.persistTriggerJobStatus(job, "persist ended service record link job");
                return true;
            }
            if (getServiceRecordTokenExpiresAt(schedule.endDate).getTime() <= Date.now()) {
                job.cancel(SERVICE_RECORD_LINK_ENDED_REASON);
                await this.persistTriggerJobStatus(job, "persist ended service record link job");
                return true;
            }
            linkClient = schedule.client;
        } else if (!resend && job.scheduledFor.getTime() <= Date.now() - PAST_OCCURRENCE_GRACE_MS) {
            job.cancel(EXPIRED_PENDING_JOB_CANCEL_REASON);
            await this.persistTriggerJobStatus(job, "persist expired trigger job");
            return true;
        }

        if (job.templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK) {
            if (!(automaticJob && job.ruleId === SERVICE_RECORD_LINK_RULE_ID) && job.employeeScheduleId) {
                const schedule = await this.prisma.employee_schedule.findFirst({
                    where: { id: job.employeeScheduleId, branchId: job.branchId },
                    select: { client: { select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true } } },
                });
                linkClient = schedule?.client ?? null;
            }
            if (
                linkClient
                && getEffectiveClientServiceStatus(linkClient.serviceStatus, linkClient.startDate, linkClient.endDate, linkClient.bookingConfirmedAt) === "pre_booking"
            ) {
                job.cancel(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
                await this.persistTriggerJobStatus(job, "persist pre-booking service record link job");
                return true;
            }
        }

        if (!job.branchId || !approvedBranchIds.has(job.branchId)) {
            job.cancel(MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON);
            await this.persistTriggerJobStatus(job, "persist sender approval canceled trigger job");
            return true;
        }

        // Only ordinary automatic rule jobs are subject to the routine's 대상
        // 고객 상태. Manual-owned jobs (agent-approved retries and scheduled
        // sends, manual service-record-link / service-end-notice sends) are a
        // human decision and never read the rule for this gate.
        if (this.isAutomaticMessageJob(job) && await this.cancelJobOutsideRuleTargetClientStatus(job)) {
            return true;
        }

        if (await this.postponeCatchUpJobUntilPredecessorCompletes(job, resend)) {
            return true;
        }

        job.markProcessing(claimToken);
        if (resend && automaticJob && job.ruleId !== SERVICE_RECORD_LINK_RULE_ID
            && !job.payload.agentAutomationSeal) {
            if (!(await this.rebuildNeedsSetupJobForResend(job))) return true;
        }
        // Keep narrow legacy test doubles and third-party in-process callers
        // on the established one-step path until they provide the new
        // preparation seam. The production MessageTriggerDeliveryService
        // always exposes both methods, so real dispatches use the frozen
        // snapshot boundary below.
        const supportsPreparedDelivery = typeof (this.deliveryService as unknown as {
            prepareJob?: unknown;
            sendPreparedJob?: unknown;
        }).prepareJob === "function"
            && typeof (this.deliveryService as unknown as {
                sendPreparedJob?: unknown;
            }).sendPreparedJob === "function";
        if (!supportsPreparedDelivery) {
            const authorization = await this.authorizeClaimedJobForDispatch(job, undefined, skipSafeguard, resend);
            if (authorization.kind === "lost") {
                return true;
            }
            if (authorization.kind === "stale" && authorization.returnedToNeedsSetup) {
                job.markNeedsSetup(job.cancelReason ?? authorization.reason);
                return false;
            }
            if (authorization.kind === "stale") {
                job.cancel(authorization.reason);
                await this.persistTriggerJobStatus(job, "persist stale trigger job");
                return true;
            }
            job.markDispatchAuthorized();
            if (await this.deliverClaimedJob(job, undefined, resend) === "preserve-stored") return true;
            await this.persistTriggerJobStatus(job, "persist dispatched trigger job");
            return true;
        }

        // Receipt preparation can render, upload, and mint a token. Revalidate
        // the persisted service-record source while the claim is still
        // reversible, then release the common locks before opening that
        // preparation boundary. The post-preparation authorization below is
        // still required because a confirm may win while preparation runs.
        const preparationFence = await this.authorizeClaimedJobBeforePreparation(job);
        if (preparationFence.kind === "lost") {
            return true;
        }
        if (preparationFence.kind === "stale") {
            job.cancel(preparationFence.reason);
            await this.persistTriggerJobStatus(job, "persist stale trigger job before preparation");
            return true;
        }

        const preparation = await this.prepareClaimedJob(job, resend);
        if (!preparation) {
            // Preparation either canceled the job with a policy skip reason or
            // recorded a failed/deferred state. In both cases the irreversible
            // dispatching marker must remain untouched.
            if (job.status === "processing") {
                job.markFailed("Provider disabled or delivery failed");
                await this.persistTriggerJobStatus(job, "persist unsupported trigger delivery");
            } else if (job.status === "canceled" || job.status === "needs_setup") {
                // Delivery policy skips can cancel in memory without writing
                // the job. Persist through the claim-token fence so the row
                // cannot remain processing or overwrite a newer claim.
                await this.persistTriggerJobStatus(job, "persist canceled trigger preparation");
            }
            return true;
        }
        if (!(await this.persistPreparedDelivery(job))) {
            return true;
        }

        const authorization = await this.authorizeClaimedJobForDispatch(job, preparation, skipSafeguard, resend);
        if (authorization.kind === "lost") {
            return true;
        }
        if (authorization.kind === "stale" && authorization.returnedToNeedsSetup) {
            job.markNeedsSetup(job.cancelReason ?? authorization.reason);
            return false;
        }
        if (authorization.kind === "stale") {
            // The authorization transaction already invalidated this claim
            // when the source snapshot was stale. Keep the in-memory entity
            // aligned so the token-CAS write below is a harmless no-op if a
            // concurrent cancellation won the race first.
            job.cancel(authorization.reason);
            await this.persistTriggerJobStatus(job, "persist stale trigger job");
            return true;
        }

        // The transaction has committed the irreversible dispatching state.
        // Provider delivery and its message_log writes must happen outside the
        // claim transaction so the FK insert cannot wait on a held row lock.
        job.markDispatchAuthorized();
        if (await this.deliverClaimedJob(job, preparation, resend) === "preserve-stored") return true;
        await this.persistTriggerJobStatus(job, "persist dispatched trigger job");
        return true;
    }

    private async rebuildNeedsSetupJobForResend(job: MessageTriggerJobEntity): Promise<boolean> {
        const rule = job.branchId
            ? await this.ruleRepository.findByIdIncludingGlobal(job.branchId, job.ruleId)
            : null;
        const now = new Date(job.payload.catchUp?.originalScheduledFor ?? job.scheduledFor);
        let recipe: ReturnType<typeof buildClientMessageRecipe> = null;
        if (rule && job.branchId && job.clientId !== null) {
            if (job.employeeScheduleId === null) {
                const client = await this.readClientAutomationSource(job.branchId, job.clientId);
                if (client) recipe = buildClientMessageRecipe(rule, client, now);
            } else {
                const schedule = (await this.readClientAutomationSchedules(job.branchId, job.clientId))
                    .find((source) => source.id === job.employeeScheduleId);
                if (schedule) recipe = buildEmployeeAssignmentMessageRecipe(rule, schedule, now);
            }
        }
        const identityMatches = recipe && (job.payload.catchUp
            ? recipe.scheduledFor.toISOString() === job.payload.catchUp.originalScheduledFor
            : recipe.dedupeKey === job.dedupeKey && (job.employeeScheduleId !== null
                || recipe.scheduledFor.getTime() === job.scheduledFor.getTime()));
        if (!recipe || !identityMatches) {
            job.cancel(RESEND_TARGET_CHANGED_REASON);
            await this.persistTriggerJobStatus(job, "persist changed resend target");
            return false;
        }
        if (job.employeeScheduleId === null && job.branchId && job.clientId !== null) {
            if (await this.jobRepository.hasNewerClientRuleSibling({
                branchId: job.branchId,
                clientId: job.clientId,
                ruleId: job.ruleId,
                recipientType: job.recipientType,
                excludeJobId: job.id,
                createdAfter: job.createdAt,
            })) {
                job.cancel(RESEND_NEWER_SIBLING_REASON);
                await this.persistTriggerJobStatus(job, "persist newer resend sibling");
                return false;
            }
        }
        job.payload = {
            ...recipe.payload,
            ...(job.payload.catchUp ? { catchUp: job.payload.catchUp } : {}),
            ...(job.payload.taskAutomationReference ? { taskAutomationReference: job.payload.taskAutomationReference } : {}),
        };
        job.recipientPhone = recipe.recipientPhone ?? null;
        // The gate binds the stored digest, so persist before either delivery path.
        // Preserve processing + cancelReason as the durable resend recovery mark.
        const setupReason = job.cancelReason;
        try {
            await this.jobRepository.update(job);
        } catch {
            // needs_setup carries its existing reason through the resend claim.
            job.markNeedsSetup(setupReason!);
            await this.persistTriggerJobStatus(job, "persist resend rebuild setup failure");
            return false;
        }
        return true;
    }

    /**
     * 규칙 메시지-04 send-time gate. A routine whose 대상 고객 상태 is not 전체
     * only sends while the job's client is in that EFFECTIVE status (the same
     * derivation the rest of the code uses, read fresh now). The rule row is
     * read now too, never copied at scheduling, so an admin's change applies to
     * jobs that are already scheduled. A mismatch ends the job as a non-failure
     * skip (canceled, no message log, no provider call, no retry); because it is
     * a system cancel, a later resync revives it and this gate re-evaluates, so
     * e.g. a 대기-only routine sends after [예약 확정] inside the 24-hour window.
     * Jobs with no client are not subject to the gate.
     */
    private async cancelJobOutsideRuleTargetClientStatus(job: MessageTriggerJobEntity): Promise<boolean> {
        if (job.clientId === null || !job.branchId) return false;
        // Global (branchless) rules are accepted by the claim, so the
        // branch-scoped findById cannot be used here.
        const rule = await this.ruleRepository.findByIdIncludingGlobal(job.branchId, job.ruleId);
        const { targetClientStatus } = ruleSendPolicyFrom(rule);
        if (targetClientStatus === "all") return false;
        const client = await this.prisma.client.findFirst({
            where: { id: job.clientId, branchId: job.branchId },
            select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true },
        });
        if (targetClientStatusAllowsSend(targetClientStatus, client)) return false;
        job.cancel(TARGET_CLIENT_STATUS_MISMATCH_REASON);
        await this.persistTriggerJobStatus(job, "persist target client status skipped job");
        return true;
    }

    /**
     * Check revised service-record ownership and document readiness before
     * receipt preparation. This transaction never marks the job dispatching;
     * it only holds the common aggregate locks for the authoritative reread,
     * then commits and releases them before rendering/upload/token work.
     *
     * Legacy SMS jobs have no revision context, so the source helper keeps
     * their established common-lock behavior and the claim-token check still
     * protects the preparation boundary. Their existing post-preparation
     * claim fence remains responsible for cancellation races after a source
     * change during preparation.
     */
    private async authorizeClaimedJobBeforePreparation(
        job: MessageTriggerJobEntity,
    ): Promise<PreProviderSendFenceResult> {
        const automaticJob = this.isAutomaticMessageJob(job);
        if (
            automaticJob
            && (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService || !job.branchId)
        ) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        const authorize = async (transaction: Prisma.TransactionClient): Promise<PreProviderSendFenceResult> => {
            const parentFence = await this.fenceMessageAutomationParent(job, transaction);
            if (parentFence.kind !== "allow") return parentFence;
            const serviceEndNoticeFence = await this.fenceServiceEndNoticeBeforeProviderSend(
                job,
                transaction,
            );
            if (serviceEndNoticeFence.kind !== "allow") {
                return serviceEndNoticeFence;
            }

            const revisionFence = await this.fenceServiceRecordRevisionBeforeProviderSend(
                job,
                transaction,
            );
            if (revisionFence.kind !== "allow") {
                return revisionFence;
            }

            // Verify that the claim is still processing and owned by this
            // worker before releasing the source locks. No snapshot exists
            // yet, so the post-preparation snapshot CAS remains authoritative
            // after enrichment completes.
            return this.fenceClaimTokenBeforeProviderSend(job, transaction);
        };
        if (automaticJob) {
            if (!this.automationDeliveryGate) throw new ServiceUnavailableException("Message automation authority is not configured");
            return this.automationDeliveryGate.authorizePreparation(job,
                (candidate, tx) => this.deliveryService.resolveCanonicalDeliverySnapshot(candidate, tx), authorize);
        }
        return this.prisma.$transaction(authorize, {
            maxWait: CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS,
            timeout: CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS,
        });
    }

    /**
     * Prepare the exact provider payload while the claim is still reversible.
     * A preparation failure is terminal/deferred at the job layer and never
     * reaches the durable dispatch authorization transaction.
     */
    private async prepareClaimedJob(
        job: MessageTriggerJobEntity,
        resend = false,
    ): Promise<SmsTriggerDeliveryPreparation | null> {
        try {
            return await this.deliveryService.prepareJob(job);
        } catch (error) {
            if (error instanceof TriggerJobDeferredError) {
                this.deferOrReturnToNeedsSetup(job, error, resend);
            } else {
                job.markFailed(error instanceof Error ? error.message : String(error));
            }
            await this.persistTriggerJobStatus(job, "persist failed trigger delivery preparation");
            return null;
        }
    }

    /**
     * Persist the frozen delivery snapshot before any dispatch marker can be
     * committed. If this write loses the claim, fail closed without opening a
     * provider boundary.
     */
    private async persistPreparedDelivery(job: MessageTriggerJobEntity): Promise<boolean> {
        try {
            await this.jobRepository.update(job);
            return true;
        } catch (error) {
            job.markFailed(error instanceof Error ? error.message : String(error));
            await this.persistTriggerJobStatus(job, "persist failed frozen delivery snapshot");
            return false;
        }
    }

    /**
     * Revalidate cancellation/source state and atomically authorize one
     * claimed attempt for provider delivery. This transaction deliberately
     * ends before `deliverClaimedJob`: the delivery service persists its own
     * message_log attempt through another Prisma connection.
     */
    private async authorizeClaimedJobForDispatch(
        job: MessageTriggerJobEntity,
        preparation?: SmsTriggerDeliveryPreparation,
        skipSafeguard = false,
        resend = false,
    ): Promise<PreProviderSendFenceResult> {
        const authorize = async (transaction: Prisma.TransactionClient): Promise<PreProviderSendFenceResult> => {
            if (
                this.isAutomaticMessageJob(job)
                && (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService || !job.branchId)
            ) {
                throw new ServiceUnavailableException("Message automation activation is not configured");
            }
            if (
                this.messageAutomationActivationService
                && this.isAutomaticMessageJob(job)
                && job.branchId
            ) {
                await this.messageAutomationActivationService.assertTriggerDispatchEnabled(job.branchId, transaction);
            }
            const serviceEndNoticeFence = await this.fenceServiceEndNoticeBeforeProviderSend(
                job,
                transaction,
            );
            if (serviceEndNoticeFence.kind === "lost") return serviceEndNoticeFence;

            // Revised service-record messages carry a server-derived context.
            // Acquire the same client-owned lock set before the job row and
            // compare that context after the lock. This keeps a confirm that
            // wins the common boundary from being followed by an old SMS.
            const revisionFence = await this.fenceServiceRecordRevisionBeforeProviderSend(
                job,
                transaction,
            );
            if (revisionFence.kind === "lost") return revisionFence;

            // Employee schedule writers lock the source row before committing
            // their replacement. Preserve that order here, then lock the job
            // row for the token/CAS check; no provider work occurs while either
            // lock is held.
            const sourceFence = job.templateKey === MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED
                && job.employeeScheduleId !== null
                ? await this.fenceEmployeeAssignmentBeforeProviderSend(job, transaction)
                : { kind: "allow" as const };
            if (sourceFence.kind === "lost") {
                return sourceFence;
            }

            const tokenFence = await this.fenceClaimTokenBeforeProviderSend(
                job,
                transaction,
                preparation?.serializedSnapshot,
            );
            if (tokenFence.kind === "lost") {
                return tokenFence;
            }
            // Last gate before the irreversible `dispatching` marker, under the
            // job row lock: a rule, recipient flag or branch switch that flipped
            // off since the claim cancels the job instead of sending it.
            const safeguardFence = skipSafeguard || !this.smsAutomationSafeguard
                ? { kind: "allow" as const }
                : await this.fenceSmsAutomationSafeguard(job, transaction);
            // Read after the job row lock above: a revoke locks the schedule's
            // jobs and only then writes the token rows, so either it committed
            // first (the revoked token is seen here) or it waits for this
            // transaction and leaves the then-dispatching job alone.
            const linkTokenFence = await this.fenceServiceRecordLinkTokenBeforeProviderSend(
                job,
                transaction,
            );
            const staleFence = safeguardFence.kind === "stale"
                ? safeguardFence
                : sourceFence.kind === "stale"
                ? sourceFence
                : revisionFence.kind === "stale"
                    ? revisionFence
                    : serviceEndNoticeFence.kind === "stale"
                        ? serviceEndNoticeFence
                        : linkTokenFence.kind === "stale"
                            ? linkTokenFence
                            : null;
            if (resend && safeguardFence.kind === "stale") {
                // A resend refused by the safeguard after its claim goes back to
                // '추가 정보 필요' with its setup reason kept, exactly like a
                // refusal at claim time, so the admin can resend it later.
                const returned = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    UPDATE "message_trigger_job"
                    SET status = 'needs_setup',
                        claim_token = NULL,
                        next_attempt_at = NULL,
                        updated_at = date_trunc('milliseconds', clock_timestamp())
                    WHERE id = ${job.id}
                      AND status = 'processing'
                      AND claim_token = ${job.claimToken}
                    RETURNING id
                `);
                return returned.length === 1
                    ? { kind: "stale" as const, reason: safeguardFence.reason, returnedToNeedsSetup: true as const }
                    : { kind: "lost" as const };
            }
            if (staleFence) {
                const canceled = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    UPDATE "message_trigger_job"
                    SET status = 'canceled',
                        canceled_at = date_trunc('milliseconds', clock_timestamp()),
                        cancel_reason = ${staleFence.reason},
                        claim_token = NULL,
                        updated_at = date_trunc('milliseconds', clock_timestamp())
                    WHERE id = ${job.id}
                      AND status = 'processing'
                      AND claim_token = ${job.claimToken}
                    RETURNING id
                `);
                return canceled.length === 1 ? staleFence : { kind: "lost" as const };
            }

            const authorized = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "message_trigger_job"
                SET status = 'dispatching',
                    updated_at = date_trunc('milliseconds', clock_timestamp())
                WHERE id = ${job.id}
                  AND status = 'processing'
                  AND claim_token = ${job.claimToken}
                RETURNING id
            `);
            return authorized.length === 1 ? { kind: "allow" as const } : { kind: "lost" as const };
        };
        if (this.isAutomaticMessageJob(job)) {
            // Automatic delivery has no one-step compatibility bypass.
            if (!preparation) return { kind: "stale", reason: "문자 발송 준비를 다시 확인해야 합니다" };
            if (!this.automationDeliveryGate) throw new ServiceUnavailableException("Message automation authority is not configured");
            return this.automationDeliveryGate.authorizeDispatch(job, preparation,
                (candidate, tx) => this.deliveryService.resolveCanonicalDeliverySnapshot(candidate, tx), authorize);
        }
        return this.prisma.$transaction(authorize, {
            maxWait: CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS,
            timeout: CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS,
        });
    }

    private async fenceSmsAutomationSafeguard(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        const decision = await this.smsAutomationSafeguard!.check(job, transaction);
        if (decision.allowed) return { kind: "allow" };
        this.smsAutomationSafeguard!.warnBlocked(`trigger job ${job.id} at dispatch authorization`, decision);
        return { kind: "stale", reason: smsAutomationSafeguardReason(decision.level) };
    }

    /**
     * Cancel a still-pending job the safeguard refuses. The compare-and-set on
     * `pending` loses harmlessly to a concurrent claim, whose own authorize
     * transaction re-runs the safeguard. Not a user cancellation.
     */
    private async cancelPendingForSafeguard(
        jobId: string,
        decision: Extract<SmsAutomationSafeguardDecision, { allowed: false }>,
        transaction?: Prisma.TransactionClient,
    ): Promise<boolean> {
        const result = await (transaction ?? this.prisma).message_trigger_job.updateMany({
            where: { id: jobId, status: "pending" },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: smsAutomationSafeguardReason(decision.level),
                canceledByUser: false,
                nextAttemptAt: null,
                claimToken: null,
            },
        });
        return result.count === 1;
    }

    private async fenceMessageAutomationParent(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        const automaticJob = this.isAutomaticMessageJob(job);
        if (
            automaticJob
            && (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService || !job.branchId)
        ) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        if (!job.branchId || !automaticJob) {
            return { kind: "allow" };
        }
        if (await this.messageAutomationActivationService!.getTriggerDispatchEnabled(job.branchId, transaction)) {
            return { kind: "allow" };
        }
        const canceled = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            UPDATE "message_trigger_job"
            SET status = 'canceled',
                canceled_at = date_trunc('milliseconds', clock_timestamp()),
                cancel_reason = ${MESSAGE_AUTOMATION_PARENT_DISABLED_REASON},
                canceled_by_user = false,
                claim_token = NULL,
                next_attempt_at = NULL,
                updated_at = date_trunc('milliseconds', clock_timestamp())
            WHERE id = ${job.id}
              AND status = 'processing'
              AND claim_token = ${job.claimToken}
            RETURNING id
        `);
        return canceled.length === 1
            ? { kind: "stale", reason: MESSAGE_AUTOMATION_PARENT_DISABLED_REASON }
            : { kind: "lost" };
    }

    /**
     * A service-record link job (automatic, manual, or an `agent-sms-retry:`
     * copy of a failed one) carries its 제공기록지 URL in its payload. Revoke
     * cancels pending/processing jobs but not failed source jobs, so a retry
     * created from one after the revoke would otherwise go out with a dead
     * link. Under the already-held job row lock, require the link's token row
     * to belong to the job's branch and schedule and to be active and not
     * revoked; otherwise cancel the job instead of dispatching it.
     *
     * Plain read (no token row lock): lock order stays jobs -> tokens, the
     * order revoke uses (schedule advisory -> jobs -> tokens), so it cannot
     * invert with it.
     */
    private async fenceServiceRecordLinkTokenBeforeProviderSend(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        if (job.templateKey !== MessageTriggerTemplateKey.SERVICE_RECORD_LINK) return { kind: "allow" };
        const stale = { kind: "stale" as const, reason: SERVICE_RECORD_LINK_REVOKED_CANCEL_REASON };
        const linkToken = this.readServiceRecordLinkToken(job);
        if (!linkToken || !job.branchId || job.employeeScheduleId === null) return stale;

        const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM "service_record_token"
            WHERE "link_token_hash" = ${linkToken}
              AND "branch_id" = ${job.branchId}::uuid
              AND "schedule_id" = ${job.employeeScheduleId}
              AND "active" = true
              AND "revoked_at" IS NULL
        `);
        return rows.length > 0 ? { kind: "allow" } : stale;
    }

    private readServiceRecordLinkToken(job: MessageTriggerJobEntity): string | null {
        const templateVariables = job.payload.templateVariables as Record<string, unknown> | undefined;
        const candidates = [job.payload.buttonUrl, templateVariables?.["serviceRecordUrl"]];
        for (const candidate of candidates) {
            if (typeof candidate !== "string" || candidate === "") continue;
            try {
                const prefix = "/service-record/";
                const { pathname } = new URL(candidate);
                if (!pathname.startsWith(prefix)) continue;
                const token = pathname.slice(prefix.length);
                if (token && !token.includes("/")) return token;
            } catch {
                continue;
            }
        }
        return null;
    }

    private async fenceServiceEndNoticeBeforeProviderSend(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        if (
            job.templateKey !== MessageTriggerTemplateKey.SERVICE_END_NOTICE
            || job.dedupeKey.includes(MANUAL_DEDUPE_MARKER)
        ) {
            return { kind: "allow" };
        }
        if (!job.branchId || job.clientId === null) {
            return { kind: "lost" };
        }

        const rows = await transaction.$queryRaw<Array<{
            service_end_notice_sent_at: Date | null;
        }>>(Prisma.sql`
            SELECT service_end_notice_sent_at
            FROM "client"
            WHERE id = ${job.clientId}
              AND branch_id = ${job.branchId}::uuid
            FOR UPDATE
        `);
        const client = rows[0];
        if (!client) return { kind: "lost" };
        return client.service_end_notice_sent_at === null
            ? { kind: "allow" }
            : { kind: "stale", reason: SERVICE_END_NOTICE_ALREADY_SENT_CANCEL_REASON };
    }

    /**
     * Revalidate an optional service-record revision context while holding the
     * common client-owned write locks. Legacy jobs omit the context and retain
     * their existing source fences. Missing Prisma delegates are treated as a
     * lost authorization so a narrow test double can never accidentally claim
     * a revised job without the database boundary.
     */
    private async fenceServiceRecordRevisionBeforeProviderSend(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        const expected = job.payload.serviceRecordRevisionContext;
        if (expected === undefined) {
            // Legacy client jobs predate the revision context, but they still
            // share the service-record aggregate with confirm and schedule
            // writers. Acquire the common client-owned lock set before the
            // claim-token CAS so a confirm that wins this boundary can cancel
            // the pending/processing job before any provider call.
            if (!job.branchId || job.clientId === null) return { kind: "allow" };
            // Narrow unit doubles used by the existing message scheduler tests
            // intentionally expose only the message/job delegates. A real
            // Prisma transaction always has the service-record case delegate;
            // preserve those doubles' legacy source-fence behavior while
            // keeping the aggregate lock mandatory on the database path.
            const caseDelegate = (transaction as unknown as {
                service_record_case?: { findUnique?: unknown };
            }).service_record_case;
            if (typeof caseDelegate?.findUnique !== "function") return { kind: "allow" };
            await lockServiceRecordWriteSet(transaction, {
                branchId: job.branchId,
                clientId: job.clientId,
            });
            return { kind: "allow" };
        }
        if (
            !job.branchId
            || job.clientId === null
            || !isValidServiceRecordDispatchContext(expected)
            || expected.branchId !== job.branchId
            || expected.clientId !== job.clientId
        ) {
            return { kind: "stale", reason: "SERVICE_RECORD_REVISION_CONTEXT_INVALID" };
        }

        const caseDelegate = transaction.service_record_case as unknown as {
            findUnique?: (args: unknown) => Promise<{
                id: string;
                branchId: string;
                clientId: number | null;
                requiredSessionCount: number | null;
                plannedSessions: Prisma.JsonValue | null;
                currentRevisionId: string | null;
                currentUsableRevisionId: string | null;
                currentUsableDocumentVersion: number | null;
                formVersion: number;
                status: string;
            } | null>;
        } | undefined;
        const revisionDelegate = transaction.service_record_revision as unknown as {
            findUnique?: (args: unknown) => Promise<{
                revisionNumber: number;
                payload: Prisma.JsonValue;
            } | null>;
        } | undefined;
        if (typeof caseDelegate?.findUnique !== "function") {
            return { kind: "lost" };
        }

        await lockServiceRecordWriteSet(transaction, {
            branchId: job.branchId,
            clientId: expected.clientId,
            caseId: expected.serviceRecordCaseId,
        });

        const current = await caseDelegate.findUnique({
            where: { id: expected.serviceRecordCaseId },
            select: {
                id: true,
                branchId: true,
                clientId: true,
                requiredSessionCount: true,
                plannedSessions: true,
                currentRevisionId: true,
                currentUsableRevisionId: true,
                currentUsableDocumentVersion: true,
                formVersion: true,
                status: true,
            },
        });
        if (
            !current
            || current.id !== expected.serviceRecordCaseId
            || current.branchId !== expected.branchId
            || current.clientId !== expected.clientId
        ) {
            return { kind: "lost", };
        }

        let revisionNumber = current.currentRevisionId === null ? null : expected.revisionNumber;
        let businessFingerprint = expected.businessFingerprint;
        if (current.currentRevisionId !== null && typeof revisionDelegate?.findUnique === "function") {
            const revision = await revisionDelegate.findUnique({
                where: { id: current.currentRevisionId },
                select: { revisionNumber: true, payload: true },
            });
            if (!revision) return { kind: "lost", };
            revisionNumber = revision.revisionNumber;
            businessFingerprint = revisionPayloadFingerprint(revision.payload) ?? "";
        }

        // The expected context's documentSyncStatus is only a captured input;
        // derive the observed value from the locked, persisted revision job and
        // current usable pointers. A job row without matching complete
        // pointers is deliberately treated as unknown by the shared policy.
        const revisionJobRows = typeof transaction.$queryRaw === "function"
            ? await transaction.$queryRaw<Array<{
                payload: Prisma.JsonValue | null;
                payload_fingerprint: string | null;
                status: string;
                progress_step: string | null;
            }>>(Prisma.sql`
                SELECT payload,
                       payload_fingerprint,
                       status,
                       progress_step
                FROM "eformsign_document_job"
                WHERE branch_id = ${expected.branchId}::uuid
                  AND job_type = 'create_document'
                  AND payload->'context'->>'serviceRecordCaseId' = ${expected.serviceRecordCaseId}
                  AND payload->'context'->>'branchId' = ${expected.branchId}
                  AND payload->'context'->>'clientId' = ${String(expected.clientId)}
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
            `)
            : [];
        const observedDocumentSyncStatus = deriveServiceRecordDocumentSyncStatus({
            currentRevisionId: current.currentRevisionId ?? null,
            currentUsableRevisionId: current.currentUsableRevisionId ?? null,
            currentUsableDocumentVersion: current.currentUsableDocumentVersion ?? null,
            revisionJob: revisionDocumentJobFacts(revisionJobRows[0] ?? null),
        });

        const observed: ServiceRecordRevisionDispatchContext = {
            branchId: current.branchId,
            clientId: current.clientId,
            serviceRecordCaseId: current.id,
            revisionId: current.currentRevisionId,
            revisionNumber,
            businessFingerprint,
            plannedSessionCount: current.requiredSessionCount,
            plannedSessionDates: plannedSessionDatesFromJson(current.plannedSessions),
            documentSyncStatus: observedDocumentSyncStatus,
            lifecycleStatus: current.status,
            formVersion: current.formVersion,
        };
        const authorization = authorizeServiceRecordDispatch(expected, observed);
        if (authorization.kind === "allow" && !isRevisionDocumentDispatchAllowed(observed)) {
            return {
                kind: "stale",
                reason: "SERVICE_RECORD_DOCUMENT_SYNC_UNVERIFIED",
            };
        }
        if (authorization.kind === "stale") {
            return {
                kind: "stale",
                reason: authorization.reason ?? "SERVICE_RECORD_REVISION_CONTEXT_STALE",
            };
        }
        return authorization.kind === "lost"
            ? { kind: "lost" }
            : { kind: "allow" };
    }

    /**
     * A transient deferral normally re-queues the job as `pending` with one more
     * attempt. A manual resend of a '추가 정보 필요' job must never become `pending`:
     * the ordinary dispatcher would expire an old job on its next tick. It goes
     * back to `needs_setup` with the transient reason, attempts untouched.
     */
    private deferOrReturnToNeedsSetup(
        job: MessageTriggerJobEntity,
        error: TriggerJobDeferredError,
        resend: boolean,
    ): void {
        if (resend) {
            job.markNeedsSetup(error.message);
            return;
        }
        job.defer(error.kind, error.message);
    }

    private async deliverClaimedJob(
        job: MessageTriggerJobEntity,
        preparation?: SmsTriggerDeliveryPreparation,
        resend = false,
    ): Promise<"persist-result" | "preserve-stored"> {
        try {
            const sent = preparation
                ? await this.deliveryService.sendPreparedJob(job, preparation)
                : await this.deliveryService.sendJob(job);
            if (sent) {
                job.markSent();
            } else if (job.status === "processing" || job.status === "dispatching") {
                job.markFailed("Provider disabled or delivery failed");
            }
        } catch (error) {
            // The final admission read may have observed a newer terminal
            // result under this same claim. Never rewrite it with this stale
            // entity; an unchanged dispatching row remains for reconciliation.
            if (error instanceof AgentAutomationDispatchUncertainError) return "preserve-stored";
            if (error instanceof TriggerJobDeferredError) {
                this.deferOrReturnToNeedsSetup(job, error, resend);
            } else {
                job.markFailed(error instanceof Error ? error.message : String(error));
            }
        }
        return "persist-result";
    }

    /**
     * Re-read the claimed job and its schedule immediately before provider
     * invocation. BJJ-35 fences pending rows in the schedule update
     * transaction, but a row already claimed as `processing` needs this final
     * source check as well. When called from the authorization transaction,
     * the schedule row is locked only until that transaction commits; provider
     * delivery never runs while this lock is held. A lost claim is left
     * untouched so a concurrent user cancel or retry transition is never
     * overwritten.
     */
    private async fenceEmployeeAssignmentBeforeProviderSend(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        const employeeScheduleId = job.employeeScheduleId;
        if (employeeScheduleId === null) return { kind: "lost" };
        const currentJob = await transaction.message_trigger_job.findUnique({
            where: { id: job.id },
            select: {
                status: true,
                branchId: true,
                ruleId: true,
                clientId: true,
                employeeScheduleId: true,
                recipientType: true,
                templateKey: true,
                claimToken: true,
            },
        });
        if (
            !currentJob
            || currentJob.status !== "processing"
            || currentJob.branchId !== job.branchId
            || currentJob.ruleId !== job.ruleId
            || currentJob.clientId !== job.clientId
            || currentJob.employeeScheduleId !== employeeScheduleId
            || currentJob.recipientType !== job.recipientType
            || currentJob.templateKey !== job.templateKey
            || currentJob.claimToken !== job.claimToken
        ) {
            return { kind: "lost" };
        }

        const lockedSchedule = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT id
            FROM "employee_schedule"
            WHERE id = ${employeeScheduleId}
              AND "branch_id" = ${job.branchId}::uuid
            FOR UPDATE
        `);
        if (lockedSchedule.length === 0) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const schedule = await transaction.employee_schedule.findFirst({
            where: {
                id: employeeScheduleId,
                branchId: job.branchId,
            },
            select: {
                id: true,
                branchId: true,
                clientId: true,
                workAddress: true,
                startDate: true,
                endDate: true,
                replaced: true,
                terminatedAt: true,
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
                client: { select: { id: true, name: true } },
                primaryEmployee: { select: { id: true, name: true, phone: true } },
                secondaryEmployee: { select: { id: true, name: true, phone: true } },
            },
        });

        if (!schedule || schedule.branchId !== job.branchId || schedule.clientId !== job.clientId) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        // Replacement is a terminal source state. This explicit check is
        // required for legacy jobs because they predate the source
        // fingerprint and cannot otherwise prove replacement equality.
        if (schedule.replaced) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        // Early termination is terminal in the same way replacement is, and it needs the
        // same explicit check: terminated_at is deliberately absent from the fingerprint,
        // because adding a field would change every schedule's hash at once and cancel
        // every already-pending assignment job on its next dispatch. Until this change,
        // termination happened to stale these jobs by rewriting end_date — a fingerprint
        // input. Now that the contracted period is preserved, the hash still matches and
        // nothing else here would stop the send.
        if (schedule.terminatedAt) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const fingerprint = job.payload.employeeScheduleFingerprint;
        if (fingerprint) {
            return employeeAssignmentScheduleFingerprint(schedule, job.recipientType) === fingerprint
                ? { kind: "allow" }
                : {
                    kind: "stale",
                    reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
                };
        }

        const expectedEmployeeId = job.payload.employeeId;
        const currentEmployeeId = job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            ? schedule.primaryEmployeeId
            : schedule.secondaryEmployeeId;
        if (typeof expectedEmployeeId !== "number" || expectedEmployeeId !== currentEmployeeId) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const currentEmployee = job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            ? schedule.primaryEmployee
            : schedule.secondaryEmployee;
        const expectedEmployeeName = job.payload.employeeName ?? job.payload.recipientName;
        if (expectedEmployeeName && expectedEmployeeName !== currentEmployee?.name) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const currentEmployeePhone = normalizePhone(currentEmployee?.phone);
        const expectedRecipientPhones = [job.recipientPhone, job.payload.recipientPhone]
            .filter((phone): phone is string => Boolean(phone));
        if (expectedRecipientPhones.some((phone) => normalizePhone(phone) !== currentEmployeePhone)) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedClientNames = [
            job.payload.clientName,
            job.payload.templateVariables["clientName"],
        ].filter((name): name is string => Boolean(name));
        if (expectedClientNames.some((name) => name !== schedule.client.name)) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedTemplateEmployeeName = job.payload.templateVariables["employeeName"];
        if (expectedTemplateEmployeeName && expectedTemplateEmployeeName !== currentEmployee?.name) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedStartDate = job.payload.templateVariables["serviceStartDate"];
        if (expectedStartDate && formatMessageRecipeDate(schedule.startDate) !== expectedStartDate) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        // Some pre-fingerprint jobs may already carry additional source
        // snapshots. Compare them when present; old payloads without these
        // keys remain compatible but are protected by the checks above.
        const expectedEndDate = job.payload.templateVariables["serviceEndDate"];
        if (expectedEndDate && formatMessageRecipeDate(schedule.endDate) !== expectedEndDate) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedWorkAddress = job.payload.templateVariables["workAddress"];
        if (expectedWorkAddress && schedule.workAddress !== expectedWorkAddress) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        return { kind: "allow" };
    }

    /**
     * Lock and re-read the active claim as the final half of the dispatch
     * authorization transaction. A mutation that wins before this check
     * clears/replaces the token and fails closed; once the caller commits the
     * `dispatching` CAS, later mutations cannot revoke an already-authorized
     * provider crossing and terminal completion remains token fenced.
     */
    private async fenceClaimTokenBeforeProviderSend(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
        expectedPreparedSnapshot?: string,
    ): Promise<PreProviderSendFenceResult> {
        if (!job.claimToken) return { kind: "lost" };

        const rows = await transaction.$queryRaw<Array<{
            status: string;
            claim_token: string | null;
            branch_id?: string | null;
            rule_id?: string;
            client_id?: number | null;
            employee_schedule_id?: number | null;
            recipient_type?: string;
            template_key?: string;
            payload?: Prisma.JsonValue | null;
        }>>(Prisma.sql`
            SELECT status,
                   claim_token,
                   branch_id,
                   rule_id,
                   client_id,
                   employee_schedule_id,
                   recipient_type,
                   template_key,
                   payload
            FROM "message_trigger_job"
            WHERE id = ${job.id}
            FOR UPDATE
        `);
        const current = rows[0];
        if (
            !current
            || current.status !== "processing"
            || current.claim_token !== job.claimToken
            || (current.branch_id !== undefined && current.branch_id !== job.branchId)
            || (current.rule_id !== undefined && current.rule_id !== job.ruleId)
            || (current.client_id !== undefined && current.client_id !== job.clientId)
            || (current.employee_schedule_id !== undefined && current.employee_schedule_id !== job.employeeScheduleId)
            || (current.recipient_type !== undefined && current.recipient_type !== job.recipientType)
            || (current.template_key !== undefined && current.template_key !== job.templateKey)
        ) {
            return { kind: "lost" };
        }

        if (expectedPreparedSnapshot !== undefined) {
            const persistedPayload = current.payload;
            const persistedTemplateVariables = persistedPayload
                && typeof persistedPayload === "object"
                && !Array.isArray(persistedPayload)
                && persistedPayload["templateVariables"]
                && typeof persistedPayload["templateVariables"] === "object"
                && !Array.isArray(persistedPayload["templateVariables"])
                ? persistedPayload["templateVariables"]
                : null;
            const persistedSnapshot = persistedTemplateVariables
                && typeof persistedTemplateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] === "string"
                ? persistedTemplateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE]
                : undefined;
            if (persistedSnapshot !== expectedPreparedSnapshot) {
                return { kind: "lost" };
            }
        }

        return { kind: "allow" };
    }

    private shouldSkipPreStartCatchUp(
        rule: MessageTriggerRuleEntity,
        client: ClientTriggerSource,
    ): boolean {
        return shouldSkipClientPreStartCatchUp(rule, client, new Date());
    }

    private async postponeCatchUpJobUntilPredecessorCompletes(
        job: MessageTriggerJobEntity,
        resend = false,
    ): Promise<boolean> {
        const catchUp = job.payload.catchUp;
        if (!catchUp?.predecessorDedupeKey) {
            return false;
        }

        const predecessor = await this.prisma.message_trigger_job.findUnique({
            where: { dedupeKey: catchUp.predecessorDedupeKey },
            select: {
                status: true,
                scheduledFor: true,
                sentAt: true,
                canceledAt: true,
                nextAttemptAt: true,
                updatedAt: true,
            },
        });
        if (!predecessor) {
            job.cancel(MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON);
            await this.persistTriggerJobStatus(job, "persist catch-up job with missing predecessor");
            return true;
        }

        const intervalMs = catchUp.intervalMinutes * MS_PER_MINUTE;
        const now = Date.now();
        const predecessorReference = predecessor.status === "pending"
            || predecessor.status === "processing"
            || predecessor.status === "dispatching"
            ? predecessor.nextAttemptAt ?? predecessor.scheduledFor
            : predecessor.sentAt ?? predecessor.canceledAt ?? predecessor.updatedAt;
        const earliestNextSend = new Date(predecessorReference.getTime() + intervalMs);

        if (
            predecessor.status === "pending" ||
            predecessor.status === "processing" ||
            predecessor.status === "dispatching" ||
            earliestNextSend.getTime() > now
        ) {
            if (resend) {
                // Never `pending` under a manual resend (see deferOrReturnToNeedsSetup);
                // `scheduledFor` stays as it was.
                job.markNeedsSetup(CATCH_UP_PREDECESSOR_PENDING_REASON);
                await this.persistTriggerJobStatus(job, "return resent catch-up job to needs_setup");
                return true;
            }
            const retryAt = new Date(Math.max(earliestNextSend.getTime(), now + intervalMs));
            job.status = "pending";
            job.scheduledFor = retryAt;
            job.nextAttemptAt = null;
            await this.persistTriggerJobStatus(job, "postpone catch-up job for predecessor");
            return true;
        }

        return false;
    }

    private async processStaleRule(rule: MessageTriggerRuleEntity): Promise<void> {
        if (!rule.branchId) return;
        const automaticRule = !isManualMessageTriggerRule(rule);
        if (automaticRule && (!this.messageAutomationActivationService || !this.messageAutomationBranchLockService)) {
            throw new ServiceUnavailableException("Message automation activation is not configured");
        }
        const reconcile = async (transaction?: Prisma.TransactionClient): Promise<void> => {
            // Disabled branches must drain their stale markers as well: leaving
            // them in the oldest bounded page would block every other branch.
            const parentEnabled = !automaticRule || await this.messageAutomationActivationService!.getTriggerDispatchEnabled(rule.branchId!, transaction);

            const readUpdatedAt = rule.updatedAt;
            const canceled = await this.jobRepository.cancelPendingForRuleGeneration(
                rule.branchId!,
                rule.id,
                readUpdatedAt,
                true,
                !parentEnabled ? MESSAGE_AUTOMATION_PARENT_DISABLED_REASON : rule.isActive ? "규칙 재생성" : "Rule deactivated",
                { needsSetup: !parentEnabled || !rule.isActive ? "all"
                    : rule.offsetType !== MessageTriggerOffsetType.IMMEDIATE
                        && rule.eventType !== MessageTriggerEventType.EMPLOYEE_ASSIGNED ? "within_window" : undefined },
                transaction,
            );
            // Another worker may have already rebuilt and cleared this generation.
            // Never rebuild or clear a newer generation.
            if (canceled === null) return;

            if (parentEnabled && rule.isActive) {
                await this.rebuildJobsForRule(rule.branchId, rule, false, transaction);
            }

            await this.ruleRepository.clearJobsStaleIfUnchanged(rule.id, readUpdatedAt, transaction);
        };

        if (automaticRule) {
            await this.messageAutomationBranchLockService!.runExclusive(rule.branchId, (transaction) => reconcile(transaction));
            return;
        }
        await reconcile();
    }

    private async reconcileRuleGenerationAfterMutation(
        branchId: string,
        ruleId: string,
    ): Promise<MessageTriggerRuleEntity | null> {
        try {
            const staleRule = await this.ruleRepository.findById(branchId, ruleId);
            if (!staleRule || !staleRule.jobsStale) return staleRule;

            await this.processStaleRule(staleRule);
            return await this.ruleRepository.findById(branchId, ruleId);
        } catch (error) {
            // Rule persistence and its durable stale marker already succeeded.
            // Treat every post-write reconciliation read/write as best effort so
            // a transient repository failure cannot invite a duplicate retry.
            // The scheduler will recover the still-stale generation.
            this.logger.error(
                `[Message Automation] Failed to reconcile trigger rule ${ruleId} after mutation`,
                error instanceof Error ? error.stack : String(error),
            );
            return null;
        }
    }

    private async processStaleRuleRebuilds(): Promise<void> {
        const staleRules = await this.ruleRepository.findStaleRules(10);

        for (const rule of staleRules) {
            try {
                await this.processStaleRule(rule);
            } catch (error) {
                this.logger.error(
                    `[Message Automation] Failed to process stale trigger rule ${rule.id}`,
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }
    }

    private async recoverApprovedBranches(): Promise<void> {
        const candidates = await this.ruleRepository.findInactiveDefaultRules(50);
        if (candidates.length === 0) return;

        const branchIds = [
            ...new Set(candidates.map((rule) => rule.branchId).filter((id): id is string => !!id)),
        ];
        const approvedBranches =
            await this.messageSenderApprovalService.getApprovedBranches(branchIds);

        for (const rule of candidates) {
            if (!rule.branchId) {
                continue;
            }

            const approvedAt = approvedBranches.get(rule.branchId);
            if (approvedAt === undefined) {
                continue;
            }

            // 규칙 관리는 승인 후에만 가능하므로, 승인 전 비활성화 기록만 cleanup patch가 만든 상태로 본다.
            if (approvedAt !== null && rule.updatedAt >= approvedAt) {
                continue;
            }

            try {
                const nextState: UpsertRuleParams = {
                    name: rule.name,
                    isActive: true,
                    eventType: rule.eventType,
                    offsetType: rule.offsetType,
                    offsetDays: rule.offsetDays,
                    sendTime: rule.sendTime,
                    recipientType: rule.recipientType,
                    templateKey: rule.templateKey,
                    targetClientStatus: rule.targetClientStatus,
                    retryOnFailure: rule.retryOnFailure,
                };
                await this.runRuleTemplateMutation(rule.branchId!, nextState, async (transaction) => {
                    rule.update({ isActive: true });
                    await this.ruleRepository.update(rule.branchId!, rule, transaction);
                    await this.ruleRepository.markJobsStale(rule.branchId!, rule.id, transaction);
                });
            } catch (error) {
                this.logger.error(
                    `[Message Automation] Failed to recover approved default trigger rule ${rule.id}`,
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }
    }

    private async reclaimStaleProcessingJobs(): Promise<void> {
        const cutoff = new Date(Date.now() - TRIGGER_JOB_PROCESSING_RECLAIM_MS);
        const stale = await this.jobRepository.findStaleProcessingSystemScope(cutoff);
        if (stale.length === 0) {
            return;
        }

        const sentIds = await this.messageLogRepository.findSentTriggerJobIdsSystemScope(
            stale.map((job) => job.id),
        );
        const logRepository = this.messageLogRepository as IMessageLogRepository & {
            findUncertainTriggerJobIdsSystemScope?: (jobIds: string[]) => Promise<Set<string>>;
        };
        const uncertainIds = typeof logRepository.findUncertainTriggerJobIdsSystemScope === "function"
            ? await logRepository.findUncertainTriggerJobIdsSystemScope(stale.map((job) => job.id))
            : new Set<string>();
        for (const job of stale) {
            if (sentIds.has(job.id)) {
                job.markSent();
            } else if (uncertainIds.has(job.id)) {
                job.markFailed(SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON);
            } else if (job.status === "dispatching") {
                // Dispatch authorization is the irreversible crossing into
                // the provider path. A worker crash after that CAS cannot
                // prove that no provider request was accepted, so never
                // re-queue the row for another send.
                job.markFailed(SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON);
            } else if (job.status === "processing" && job.cancelReason !== null) {
                // A manual-resend claim (BJJ-444): the claim left the setup
                // reason on the row. Never `pending`: the ordinary dispatcher
                // would expire an old job. Back to '추가 정보 필요', reason kept,
                // attempts and scheduledFor untouched; the write is fenced by
                // the claim token so a newer owner is never overwritten.
                job.markNeedsSetup(job.cancelReason);
            } else {
                job.defer("transient", "Reclaimed stale processing job");
            }
            await this.persistTriggerJobStatus(job, "persist reclaimed trigger job");
        }
    }

    private async persistTriggerJobStatus(
        job: MessageTriggerJobEntity,
        action: string,
    ): Promise<void> {
        try {
            await this.jobRepository.update(job);
        } catch (error) {
            this.logger.error(
                `[Message Automation] Failed to ${action} ${job.id}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private async hasTriggerSchema(transaction?: Prisma.TransactionClient): Promise<boolean> {
        return this.automationSources.hasTriggerSchema(transaction);
    }

    private async ensureTriggerSchemaReady(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            throw new ServiceUnavailableException(codeOnlyProblemBody("DEPENDENCY_UNAVAILABLE"));
        }
    }
}
