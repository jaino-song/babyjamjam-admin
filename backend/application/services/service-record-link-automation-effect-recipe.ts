import { createHash } from "node:crypto";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    getServiceRecordLinkScheduledFor,
    SERVICE_RECORD_LINK_RULE_ID,
} from "domain/constants/service-record-link-message";
import { agentAutomationScheduleIdentity } from "application/agent/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { normalizePhone } from "application/utils/normalize-phone";
import type { ClientMessageEffectPolicy, ClientMessageLogicalSubject } from "./client-message-effect-recipe";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";

const RECIPE_VERSION = "service-record-link-automation-recipe-v1";
/** Keep this default aligned with ServiceRecordLinkService.buildServiceRecordUrl. */
export const DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL = "https://m.admin.babyjamjam.com";
const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LINK_TOKEN = /^[A-Za-z0-9_-]+$/;
const MAX_FAILED_ATTEMPTS = 5;

export interface ServiceRecordLinkScheduleSource {
    id: number;
    incarnationId: string;
    branchId: string | null;
    clientId: number;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    terminatedAt: Date | null;
    primaryEmployeeId: number;
    client: {
        id: number;
        name: string;
        branchId: string | null;
        createdAt: Date;
        serviceStatus: string | null;
    };
    primaryEmployee: {
        id: number;
        name: string;
        phone: string;
        branchId: string | null;
        deletedAt: Date | null;
    };
}

export interface ServiceRecordLinkCaseSource {
    id: string;
    branchId: string;
    clientId: number | null;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    requiredSessionCount: number | null;
    formVersion: number;
    version: number;
    finalizedAt: Date | null;
    updatedAt: Date;
}

export interface ServiceRecordLinkTokenSource {
    id: string;
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId: string | null;
    linkTokenHash: string;
    expectedPhoneHash: string;
    expiresAt: Date;
    active: boolean;
    revokedAt: Date | null;
    lockedAt: Date | null;
    failedAttempts: number;
    createdAt: Date;
}

type ServiceRecordLinkRule = Pick<
    MessageTriggerRuleEntity,
    | "id"
    | "branchId"
    | "isActive"
    | "eventType"
    | "offsetType"
    | "offsetDays"
    | "sendTime"
    | "recipientType"
    | "templateKey"
>;

/** The exact payload shape emitted after ServiceRecordLinkService promotes a job. */
export function buildServiceRecordLinkPayload(input: {
    clientId: number;
    clientName: string;
    employeeId: number;
    employeeName: string;
    recipientPhone: string;
    buttonUrl: string;
    serviceRecordUrl: string;
    serviceStartDate: string;
    serviceEndDate: string;
}): Record<string, unknown> {
    return {
        clientId: input.clientId,
        clientName: input.clientName,
        employeeId: input.employeeId,
        employeeName: input.employeeName,
        memberId: `employee:${input.employeeId}`,
        recipientName: input.employeeName,
        recipientPhone: input.recipientPhone,
        buttonUrl: input.buttonUrl,
        messageBody: buildServiceRecordLinkMessage({
            clientName: input.clientName,
            employeeName: input.employeeName,
            serviceRecordUrl: input.serviceRecordUrl,
        }),
        templateVariables: {
            clientName: input.clientName,
            employeeName: input.employeeName,
            serviceRecordUrl: input.serviceRecordUrl,
            serviceStartDate: input.serviceStartDate,
            serviceEndDate: input.serviceEndDate,
        },
    };
}

/** Keep the service-record SMS body in one owner for materialization and replay. */
export function buildServiceRecordLinkMessage(input: {
    clientName: string;
    employeeName: string;
    serviceRecordUrl: string;
}): string {
    return `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

${input.employeeName} 관리사님, ${input.clientName} 산모님의 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
${input.serviceRecordUrl}`;
}

/**
 * Rebuild the service-record-link effect from current owned rows. Only digests
 * leave this function; the URL, phone, names and template body remain transient.
 */
export function describeServiceRecordLinkEffect(input: {
    branchId: string;
    subject: ClientMessageLogicalSubject;
    rule: ServiceRecordLinkRule;
    schedule: ServiceRecordLinkScheduleSource;
    serviceRecordCase: ServiceRecordLinkCaseSource | null;
    token: ServiceRecordLinkTokenSource;
    scheduleIdentity: string;
    serviceRecordUrl: string;
    sourcePayload: Record<string, unknown>;
    scheduledFor: Date;
    dedupeKey: string;
    snapshot: Readonly<SmsTriggerDeliverySnapshot>;
    change: AgentAutomationEffect["change"];
    policy: ClientMessageEffectPolicy;
    now: Date;
}): AgentAutomationEffect | null {
    const {
        branchId,
        subject,
        rule,
        schedule,
        serviceRecordCase,
        token,
        scheduleIdentity,
        serviceRecordUrl,
        sourcePayload,
        scheduledFor,
        dedupeKey,
        snapshot,
        change,
        policy,
        now,
    } = input;

    if (rule.id !== SERVICE_RECORD_LINK_RULE_ID || rule.branchId !== null || !rule.isActive
        || rule.eventType !== MessageTriggerEventType.SERVICE_START
        || rule.offsetType !== MessageTriggerOffsetType.SAME_DAY || rule.offsetDays !== 0
        || rule.recipientType !== MessageTriggerRecipientType.PRIMARY_EMPLOYEE
        || rule.templateKey !== MessageTriggerTemplateKey.SERVICE_RECORD_LINK
        || schedule.branchId !== branchId || schedule.clientId !== schedule.client.id
        || schedule.replaced || schedule.terminatedAt !== null
        || schedule.primaryEmployeeId !== schedule.primaryEmployee.id
        || schedule.client.branchId !== null && schedule.client.branchId !== branchId
        || schedule.client.serviceStatus === "terminated"
        || schedule.primaryEmployee.branchId !== null && schedule.primaryEmployee.branchId !== branchId
        || schedule.primaryEmployee.deletedAt !== null
        || !DIGEST.test(scheduleIdentity)
        || !policy.dispatchEnabled || !policy.senderApproved
        || !policy.senderIdentityDigest || !DIGEST.test(policy.senderIdentityDigest)
        || !Number.isSafeInteger(schedule.id) || schedule.id < 1
        || !Number.isSafeInteger(schedule.clientId) || schedule.clientId < 1
        || !Number.isSafeInteger(schedule.primaryEmployee.id) || schedule.primaryEmployee.id < 1
        || !validDate(schedule.startDate) || !validDate(schedule.endDate)
        || !validDate(now)) return null;

    if (subject.kind === "client"
        ? (subject.clientId !== schedule.clientId || !DIGEST.test(subject.clientIdentity))
        : !UUID.test(subject.taskId)) return null;

    let canonicalScheduleIdentity: string;
    try {
        canonicalScheduleIdentity = agentAutomationScheduleIdentity(schedule.incarnationId);
    } catch {
        return null;
    }
    if (canonicalScheduleIdentity !== scheduleIdentity) return null;

    const expectedScheduledFor = getServiceRecordLinkScheduledFor(schedule.startDate);
    if (scheduledFor.getTime() !== expectedScheduledFor.getTime()
        || dedupeKey !== `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${schedule.id}:primary`) return null;

    if (!serviceRecordUrl || !sameServiceRecordUrl(serviceRecordUrl, token.linkTokenHash)) return null;
    if (token.branchId !== branchId || token.scheduleId !== schedule.id
        || token.employeeId !== schedule.primaryEmployee.id
        || token.serviceRecordCaseId !== (serviceRecordCase?.id ?? null)
        || !token.active || token.revokedAt !== null || token.lockedAt !== null
        || !Number.isInteger(token.failedAttempts) || token.failedAttempts < 0 || token.failedAttempts >= MAX_FAILED_ATTEMPTS
        || !validDate(token.expiresAt)
        || token.expiresAt.getTime() <= now.getTime() || !validDate(token.createdAt)) return null;
    if (serviceRecordCase && (serviceRecordCase.branchId !== branchId
        || serviceRecordCase.clientId !== schedule.clientId || serviceRecordCase.finalizedAt !== null
        || !validDate(serviceRecordCase.updatedAt)
        || (serviceRecordCase.startDate !== null && !validDate(serviceRecordCase.startDate))
        || (serviceRecordCase.endDate !== null && !validDate(serviceRecordCase.endDate)))) return null;

    const tokenPhone = tokenPhoneKey(schedule.primaryEmployee.phone);
    const normalizedPhone = normalizePhone(schedule.primaryEmployee.phone);
    if (!tokenPhone || !/^01[016789]\d{7,8}$/.test(tokenPhone) || !normalizedPhone
        || token.expectedPhoneHash !== createHash("sha256").update(tokenPhone).digest("hex")) return null;

    const expectedPayload = buildServiceRecordLinkPayload({
        clientId: schedule.clientId,
        clientName: schedule.client.name,
        employeeId: schedule.primaryEmployee.id,
        employeeName: schedule.primaryEmployee.name,
        recipientPhone: schedule.primaryEmployee.phone,
        buttonUrl: serviceRecordUrl,
        serviceRecordUrl,
        serviceStartDate: formatDate(schedule.startDate),
        serviceEndDate: formatDate(schedule.endDate),
    });
    if (agentBindingHash(sourcePayload) !== agentBindingHash(expectedPayload)) return null;

    if (snapshot.templateKey !== MessageTriggerTemplateKey.SERVICE_RECORD_LINK
        || snapshot.receiver !== schedule.primaryEmployee.phone
        || snapshot.recipientName !== schedule.primaryEmployee.name
        || !snapshot.message || !snapshot.title || !snapshot.templateVersion || !DIGEST.test(snapshot.templateHash)
        || !snapshot.configVersion || !DIGEST.test(snapshot.configHash) || !DIGEST.test(snapshot.snapshotHash)) return null;

    const recipientType = "primary-employee" as const;
    return {
        kind: "service-record-link",
        ruleId: SERVICE_RECORD_LINK_RULE_ID,
        scheduleId: schedule.id,
        recipientType,
        templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        change,
        recipientDigest: agentBindingHash({ branchId, subject, recipientType, receiver: normalizedPhone }),
        sourceDigest: agentBindingHash({
            version: RECIPE_VERSION,
            branchId,
            subject,
            client: {
                id: schedule.client.id,
                createdAt: schedule.client.createdAt.toISOString(),
                name: schedule.client.name,
            },
            schedule: {
                id: schedule.id,
                incarnationId: scheduleIdentity,
                clientId: schedule.clientId,
                startDate: schedule.startDate.toISOString(),
                endDate: schedule.endDate.toISOString(),
            },
            employee: {
                id: schedule.primaryEmployee.id,
                name: schedule.primaryEmployee.name,
                phone: normalizedPhone,
            },
            serviceRecordCase: serviceRecordCase
                ? {
                    id: serviceRecordCase.id,
                    // Case scheduling/session bookkeeping is repaired by
                    // ensureForClient during the same customer write. The
                    // link operation only depends on case identity and
                    // finalization, while schedule dates and the token bind
                    // the actual message payload.
                    finalizedAt: serviceRecordCase.finalizedAt?.toISOString() ?? null,
                    // Lifecycle repair increments the case bookkeeping
                    // version/timestamp while re-projecting the same
                    // assignment. Those fields are not part of the link
                    // payload or recipient policy, so they must not turn a
                    // committed task effect into a false consent change.
                }
                : null,
            token: {
                id: token.id,
                serviceRecordCaseId: token.serviceRecordCaseId,
                expectedPhoneHash: token.expectedPhoneHash,
                expiresAt: token.expiresAt.toISOString(),
                createdAt: token.createdAt.toISOString(),
                linkDigest: agentBindingHash(serviceRecordUrl),
            },
            payload: {
                recipientName: expectedPayload["recipientName"],
                variables: expectedPayload["templateVariables"],
            },
        }),
        templateDigest: agentBindingHash({
            templateKey: snapshot.templateKey,
            templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            message: snapshot.message,
            title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType,
            systemTemplateKey: snapshot.systemTemplateKey ?? null,
        }),
        policyDigest: agentBindingHash({ version: RECIPE_VERSION, branchId, ...policy }),
        recipeDigest: agentBindingHash({
            version: RECIPE_VERSION,
            operation: "service-record-link",
            scheduling: { kind: "service-start-15-kst", scheduledFor: expectedScheduledFor.toISOString() },
            eventType: rule.eventType,
            offsetType: rule.offsetType,
            offsetDays: rule.offsetDays,
            sendTime: rule.sendTime,
            recipientType: rule.recipientType,
            scheduleIdentity,
            serviceRecordCaseId: serviceRecordCase?.id ?? null,
        }),
    };
}

function sameServiceRecordUrl(value: string, token: string): boolean {
    if (!LINK_TOKEN.test(token)) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
            && parsed.search === "" && parsed.hash === ""
            && parsed.pathname === `/service-record/${token}`;
    } catch {
        return false;
    }
}

function tokenPhoneKey(phone: string): string | null {
    const digits = phone.replace(/\D/g, "");
    return digits.length > 0 ? digits : null;
}

function formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function validDate(value: Date): boolean {
    return value instanceof Date && !Number.isNaN(value.getTime());
}
