import { BabyRecordRolloutPausedException, GROUP_RECORD_LINK_PREFIX, isBabyRecordRolloutEnabled, readBackfilledScalarHousehold } from "application/policies/baby-record-rollout.policy";
import { randomUUID } from "node:crypto";

import { renderServiceRecordLinks } from "@babyjamjam/shared/message/service-record-links";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { codeOnlyProblemBody, codeOnlyProblemException } from "application/utils/problem-bodies";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import {
    getServiceRecordLinkScheduledFor,
    getServiceRecordTokenExpiresAt,
    isServiceRecordLinkManualDedupeKey,
    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
} from "domain/constants/service-record-link-message";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import type { MessageTriggerJobPayload } from "domain/entities/message-trigger-job.entity";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import { hasApprovedRecordLinkSender, lockRecordLinkSchedule } from "infrastructure/database/repositories/record-link-recovery.repository";

import { MessageAutomationActivationService } from "./message-automation-activation.service";
import { MessageAutomationBranchLockService } from "./message-automation-branch-lock.service";
import { DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL } from "./service-record-link-automation-effect-recipe";
import {
    canSendRecordLinkGroup, readRecordLinkGroupSource, recordLinkGroupCarrierEvidence, recordLinkGroupSourceHash,
    recordLinkGroupSupersededReasons, recordLinkGroupVariables,
    recordLinkHash, recordLinkPhone, RECORD_LINK_GROUP_KEY_PREFIX,
    type RecordLinkGroupMember, type RecordLinkGroupSource, unreservedRecordLinkMembers,
} from "./service-record-link-group-source";
import { readLegacyLinkOccurrence } from "./service-record-legacy-link-occurrence";
import { ServiceRecordTokenService } from "./service-record-token.service";
import { SystemTemplateService } from "./system-template.service";

export interface RecordLinkSelection {
    employeeId: number;
    members: { caseId: string; assignmentVersion: number }[];
}

export interface RecordLinkSendSelection extends RecordLinkSelection {
    members: { caseId: string; assignmentVersion: number; preparedLinkToken: string }[];
    recipientPhone?: string;
}

export interface RecordLinkPrepareSelection {
    employeeId: number;
    caseIds: string[];
    recipientPhone?: string;
}

const pendingStatuses = ["pending", "processing", "needs_setup"];

interface ResidualReservation {
    scheduledFor: Date;
    nextAttemptAt: Date | null;
    residualOfManualJobId: string;
}
const changed = () => codeOnlyProblemException("SERVICE_RECORD_WRITE_TARGET_CHANGED");

export function serviceRecordGroupUrl(config: ConfigService, token: string): string {
    const base = config.get<string>("MOBILE_SERVICE_RECORD_BASE_URL", DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL);
    return `${base.replace(/\/+$/, "")}/service-record/${token}`;
}

@Injectable()
export class ServiceRecordLinkGroupService {
    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE) private readonly prisma: MessageAutomationDatabase,
        private readonly branchLock: MessageAutomationBranchLockService,
        private readonly tokenService: ServiceRecordTokenService,
        private readonly templates: SystemTemplateService,
        private readonly config: ConfigService,
        private readonly activation: MessageAutomationActivationService,
    ) {}

    private async withSource<T>(
        branchId: string, scheduleId: number,
        work: (source: RecordLinkGroupSource, tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
        return this.branchLock.runExclusive(branchId, async tx => {
            // Client/employee/case/schedule locks precede the job and token writes.
            const source = await readRecordLinkGroupSource(tx, branchId, scheduleId, true);
            if (!source) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            if (!await isBabyRecordRolloutEnabled(tx, branchId)) {
                throw new BabyRecordRolloutPausedException();
            }
            await lockRecordLinkSchedule(tx, scheduleId);
            return work(source, tx);
        });
    }

    async targets(branchId: string, scheduleId: number) {
        const source = await readRecordLinkGroupSource(this.prisma, branchId, scheduleId);
        if (!source) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const targets = new Map<number, {
            employeeId: number; employeeName: string; recipientPhone: string;
            members: { caseId: string; babyId: string; assignmentVersion: number; activeRank: number }[];
        }>();
        for (const { employee, employeeId, caseId, babyId, activeRank, assignmentVersion } of source.members) {
            const recipientPhone = recordLinkPhone(employee.phone);
            if (!recipientPhone || !canSendRecordLinkGroup(source, true)) continue;
            const target = targets.get(employeeId) ?? { employeeId, employeeName: employee.name, recipientPhone, members: [] };
            target.members.push({ caseId, babyId, activeRank, assignmentVersion });
            targets.set(employeeId, target);
        }
        return { householdBabyCount: source.householdBabyCount, targets: [...targets.values()] };
    }

    async prepare(branchId: string, scheduleId: number, input: RecordLinkPrepareSelection) {
        return this.withSource(branchId, scheduleId, async (source, tx) => {
            const members = await this.select(tx, source, input.employeeId, input.caseIds.map(caseId => ({ caseId })), input.recipientPhone);
            const prepared = [];
            for (const member of members) {
                const params = this.params(source, member, true);
                const token = await this.tokenService.reuseActiveLink(params, { includeLocked: false }, tx)
                    ?? await this.tokenService.prepareLink(params, tx);
                prepared.push(this.linkMember(member, params.expiresAt, token.linkToken));
            }
            const { content, buttonUrl, template } = await this.preview(tx, source, members, prepared);
            return {
                kind: "group" as const, employeeId: input.employeeId, householdBabyCount: source.householdBabyCount,
                members: prepared, previewContent: content, buttonUrl, effectiveTemplate: template.content,
                templateMetadata: { key: template.templateKey, id: template.id, updatedAt: template.updatedAt,
                    requiredVariables: template.requiredVariables, customVariables: template.customVariables },
            };
        });
    }

    async reset(branchId: string, scheduleId: number, input: RecordLinkSelection) {
        return this.withSource(branchId, scheduleId, async (source, tx) => {
            const members = await this.select(tx, source, input.employeeId, input.members);
            const links = [];
            for (const member of members) {
                const params = this.params(source, member, true);
                const { linkToken } = await this.tokenService.issueLink({ ...params, resetChallenge: true }, tx);
                links.push({
                    caseId: member.caseId, babyId: member.babyId, activeRank: member.activeRank,
                    assignmentVersion: member.assignmentVersion, expiresAt: params.expiresAt,
                    serviceRecordUrl: serviceRecordGroupUrl(this.config, linkToken),
                });
            }
            return { kind: "group" as const, employeeId: input.employeeId, members: links };
        });
    }

    async send(branchId: string, scheduleId: number, input: RecordLinkSendSelection, actorUserId: string) {
        return this.withSource(branchId, scheduleId, async (source, tx) => {
            const members = await this.select(tx, source, input.employeeId, input.members, input.recipientPhone);
            if (!await this.releaseLegacyCredential(tx, source, members, true)) throw changed();
            const selected = new Map(input.members.map(member => [member.caseId, member.preparedLinkToken]));
            const prepared = [];
            for (const member of members) {
                const params = this.params(source, member, true);
                const linkToken = selected.get(member.caseId)!;
                // All target tuples have already passed. Any credential refusal
                // throws out the whole transaction, including earlier activations.
                if (!await this.tokenService.activatePreparedLink({ ...params, linkToken }, tx)) throw changed();
                prepared.push(this.linkMember(member, params.expiresAt, linkToken));
            }
            const preview = await this.preview(tx, source, members, prepared);
            return this.admit(tx, source, members, prepared, { actorUserId, previewHash: recordLinkHash(preview.content) });
        });
    }

    async refreshForEmployee(branchId: string, employeeId: number): Promise<void> {
        const schedules = await this.prisma.employee_schedule.findMany({
            where: { branchId, replaced: false, terminatedAt: null, client: { branchId, deletedAt: null, fetalConfirmation: "CONFIRMED" },
                recordBabyAssignments: { some: { branchId, employeeId, activeOwner: true, endedAt: null, teamSlot: { active: true } } } },
            select: { id: true, clientId: true }, orderBy: { id: "asc" },
        });
        for (const { id, clientId } of schedules) {
            if (await readBackfilledScalarHousehold(this.prisma, { branchId, clientId })) continue;
            try {
                await this.schedule(branchId, id, { employeeId });
            } catch (error) {
                if (!(error instanceof NotFoundException)) throw error;
            }
        }
    }

    async schedule(branchId: string, scheduleId: number,
        options: { employeeId?: number; supersededSourceHash?: string } = {},
    ): Promise<boolean> {
        return this.withSource(branchId, scheduleId, async (source, tx) => {
            if (!canSendRecordLinkGroup(source, false)) return false;
            if (!(await hasApprovedRecordLinkSender(tx, branchId)) || !(await this.activation.getTriggerDispatchEnabled(branchId, tx))) return false;
            if (!await tx.message_trigger_rule.findFirst({
                where: { id: SERVICE_RECORD_LINK_RULE_ID, branchId: null, deletedAt: null, isActive: true }, select: { id: true },
            })) return false;
            const override = await tx.message_trigger_rule_branch_override.findUnique({
                where: { branchId_ruleId: { branchId, ruleId: SERVICE_RECORD_LINK_RULE_ID } }, select: { isActive: true },
            });
            if (override?.isActive === false) return false;
            const groups = new Map<number, RecordLinkGroupMember[]>();
            for (const member of source.members) {
                if (options.employeeId !== undefined && options.employeeId !== member.employeeId) continue;
                if (!member.employee.smsAutomationEnabled || !recordLinkPhone(member.employee.phone)) continue;
                const group = groups.get(member.employeeId) ?? [];
                group.push(member);
                groups.set(member.employeeId, group);
            }
            for (const [employeeId, members] of groups) {
                groups.set(employeeId, await unreservedRecordLinkMembers(tx, source, members));
            }
            const jobs = await tx.message_trigger_job.findMany({
                where: { ...source.scope, employeeScheduleId: scheduleId, ruleId: SERVICE_RECORD_LINK_RULE_ID,
                    recipientEmployeeId: options.employeeId ?? { not: null }, status: { in: pendingStatuses } },
                select: { id: true, recipientEmployeeId: true, payload: true, recordMembers: true },
            });
            for (const job of jobs) {
                const payload = job.payload as unknown as MessageTriggerJobPayload;
                const current = payload.sentByUserId
                    ? source.members.filter(member => member.employeeId === job.recipientEmployeeId)
                    : groups.get(job.recipientEmployeeId!) ?? [];
                const selected = current.filter(member => job.recordMembers.some(row => row.serviceRecordCaseId === member.caseId));
                const expected = payload.sentByUserId ? selected : current;
                if (expected.length === job.recordMembers.length
                    && recordLinkGroupSourceHash(source, expected) === payload.recordLinkGroup?.sourceHash) continue;
                await this.cancel(tx, job.id);
            }
            let admitted = false;
            for (const members of groups.values()) {
                if (!members.length) continue;
                // A locked credential or a policy/template race can refuse a job with an otherwise
                // current source. Dispatch recovery should not continually recreate that same job.
                if (options.supersededSourceHash === recordLinkGroupSourceHash(source, members)) continue;
                if (!await this.releaseLegacyCredential(tx, source, members, false)) continue;
                const result = await this.admit(tx, source, members, await this.automaticLinks(tx, source, members));
                admitted ||= result.created;
            }
            return admitted;
        });
    }

    private async releaseLegacyCredential(
        tx: Prisma.TransactionClient, { scope, schedule, householdBabyCount }: RecordLinkGroupSource,
        members: RecordLinkGroupMember[], manual: boolean,
    ): Promise<boolean> {
        const member = members[0]!;
        const phone = recordLinkPhone(member.employee.phone)!;
        const legacy = await readLegacyLinkOccurrence(tx, { ...scope, scheduleId: schedule.id,
            incarnationId: schedule.incarnationId, employeeId: member.employeeId, phone });
        if (legacy.blocked || legacy.jobs.some(job => (!manual && job.canceledByUser)
            || (householdBabyCount === 1 && member.employeeId === schedule.primaryEmployeeId
                && pendingStatuses.includes(job.status)))) return false;

        const legacyTokens = { branchId: scope.branchId, scheduleId: schedule.id, employeeId: member.employeeId,
            active: true, revokedAt: null, NOT: { linkTokenHash: { startsWith: GROUP_RECORD_LINK_PREFIX } },
            OR: [{ serviceRecordCaseId: { in: members.map(item => item.caseId) } },
                ...(householdBabyCount === 1 ? [{ serviceRecordCaseId: null }] : [])],
        };
        const active = await tx.service_record_token.findMany({ where: legacyTokens,
            select: { id: true, linkTokenHash: true, expectedPhoneHash: true } });
        const rejected = new Set(legacy.rejected.map(log => log.credential));
        if (active.some(token => token.expectedPhoneHash !== recordLinkHash(phone) || !rejected.has(token.linkTokenHash))) return false;
        if (active.length) {
            // Retire only the exact credential proved unused by this occurrence.
            // The original provider and occurrence records are kept for audit.
            await tx.service_record_token.updateMany({
                where: { ...legacyTokens, id: { in: active.map(token => token.id) } },
                data: { active: false, revokedAt: new Date() },
            });
        }
        return true;
    }

    private async automaticLinks(tx: Prisma.TransactionClient, source: RecordLinkGroupSource, members: RecordLinkGroupMember[]) {
        const prepared = [];
        for (const member of members) {
            const params = this.params(source, member, false);
            const token = await this.tokenService.issueLink(params, tx);
            prepared.push(this.linkMember(member, params.expiresAt, token.linkToken));
        }
        return prepared;
    }

    private async select(
        tx: Prisma.TransactionClient, source: RecordLinkGroupSource, employeeId: number,
        selection: readonly { caseId: string; assignmentVersion?: number }[], phone?: string,
    ) {
        const selectors = new Map(selection.map(member => [member.caseId, member.assignmentVersion]));
        const members = source.members.filter(member => member.employeeId === employeeId && selectors.has(member.caseId));
        if (members.length !== selection.length) {
            const count = await tx.service_record_case.count({ where: { ...source.scope, id: { in: [...selectors.keys()] } } });
            if (count !== selectors.size) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            throw changed();
        }
        if (!canSendRecordLinkGroup(source, true) || members.some(member => {
            const expected = selectors.get(member.caseId);
            return expected !== undefined && expected !== member.assignmentVersion;
        })) throw changed();
        const registeredPhone = recordLinkPhone(members[0]?.employee.phone);
        if (phone !== undefined && recordLinkPhone(phone) !== registeredPhone) throw changed();
        if (!registeredPhone) throw new BadRequestException(codeOnlyProblemBody("INVALID_PROVIDER_PHONE"));
        return members;
    }

    private params(source: RecordLinkGroupSource, member: RecordLinkGroupMember, manual: boolean) {
        const expiry = getServiceRecordTokenExpiresAt(member.endDate ?? source.schedule.endDate);
        return {
            branchId: source.scope.branchId, scheduleId: source.schedule.id, serviceRecordCaseId: member.caseId,
            employeeId: member.employeeId, expectedPhone: member.employee.phone,
            grouped: true,
            expiresAt: manual && expiry.getTime() <= Date.now() ? new Date(Date.now() + 86_400_000) : expiry,
        };
    }

    private linkMember(member: RecordLinkGroupMember, expiresAt: Date, preparedLinkToken: string) {
        return {
            caseId: member.caseId, babyId: member.babyId, activeRank: member.activeRank, assignmentVersion: member.assignmentVersion,
            serviceRecordUrl: serviceRecordGroupUrl(this.config, preparedLinkToken), preparedLinkToken, expiresAt,
        };
    }

    private async preview(tx: Prisma.TransactionClient, source: RecordLinkGroupSource, members: RecordLinkGroupMember[],
        links: readonly { activeRank: number; serviceRecordUrl: string }[]) {
        const template = await this.templates.getByKeyForBranch(source.scope.branchId, SystemTemplateKey.SERVICE_RECORD_LINK, tx);
        const result = renderServiceRecordLinks({
            template: template.content, variables: recordLinkGroupVariables(source, members[0]!),
            householdBabyCount: source.householdBabyCount,
            members: links.map(({ activeRank, serviceRecordUrl }) => ({ activeRank, url: serviceRecordUrl })),
        });
        if (!result.ok) throw new BadRequestException({ ...codeOnlyProblemBody("VALIDATION_FAILED"), reason: result.reason });
        return { content: result.content, buttonUrl: result.buttonUrl, template };
    }

    private async cancel(tx: Prisma.TransactionClient, id: string) {
        return tx.message_trigger_job.updateMany({
            where: { id, canceledByUser: false, status: { in: pendingStatuses }, logs: { none: recordLinkGroupCarrierEvidence } },
            data: { status: "canceled", cancelReason: SERVICE_RECORD_LINK_RESCHEDULED_REASON, canceledAt: new Date(),
                claimToken: null, nextAttemptAt: null, processingDeadlineAt: null },
        });
    }

    private async admit(tx: Prisma.TransactionClient, source: RecordLinkGroupSource, members: RecordLinkGroupMember[],
        links: readonly { caseId: string; preparedLinkToken: string }[], manual?: { actorUserId: string; previewHash: string },
        residual?: ResidualReservation): Promise<{ jobId: string; scheduledFor: Date; created: boolean }> {
        const member = members[0]!;
        const { scope, schedule } = source;
        const sourceHash = recordLinkGroupSourceHash(source, members);
        const occurrence = { ...scope, employeeScheduleId: schedule.id, ruleId: SERVICE_RECORD_LINK_RULE_ID, recipientEmployeeId: member.employeeId };
        const jobs = await tx.message_trigger_job.findMany({
            where: occurrence,
            include: { recordMembers: true, logs: { where: recordLinkGroupCarrierEvidence, take: 1, select: { id: true } } },
        });
        const exact = jobs.filter(job => {
            const payload = job.payload as unknown as MessageTriggerJobPayload;
            return payload.recordLinkGroup?.sourceHash === sourceHash;
        });
        // 사용자 취소는 자동 재생성을 막고, 명시적인 수동 발송은 발송 증거가 없는 경우 새 작업을 만들 수 있다.
        const blocksReplacement = (job: typeof jobs[number]) => job.status === "sent" || job.status === "dispatching"
            || job.logs.length > 0 || (!manual && job.canceledByUser);
        const acceptedOrPending = exact.find(job => blocksReplacement(job)
            || (!manual && (pendingStatuses.includes(job.status) || (job.status === "canceled"
                && (job.cancelReason === null || !recordLinkGroupSupersededReasons.includes(job.cancelReason)))))
            || (manual && (job.payload as unknown as MessageTriggerJobPayload).sentByUserId && pendingStatuses.includes(job.status)));
        if (acceptedOrPending) return { jobId: acceptedOrPending.id, scheduledFor: acceptedOrPending.scheduledFor, created: false };

        const targets = new Set(members.map(item => `${item.caseId}:${item.assignmentVersion}`));
        const replaced = [];
        for (const job of jobs) {
            if (!job.recordMembers.some(item => targets.has(`${item.serviceRecordCaseId}:${item.assignmentVersion}`))) continue;
            if (blocksReplacement(job)) {
                if (manual) throw changed();
                return { jobId: job.id, scheduledFor: job.scheduledFor, created: false };
            }
            if (manual && pendingStatuses.includes(job.status)) {
                if ((await this.cancel(tx, job.id)).count !== 1) throw changed();
                if (!isServiceRecordLinkManualDedupeKey(job.dedupeKey)
                    && !(job.payload as unknown as MessageTriggerJobPayload).sentByUserId) replaced.push(job);
            }
        }

        const tokens = await tx.service_record_token.findMany({
            where: { branchId: scope.branchId, scheduleId: schedule.id, employeeId: member.employeeId,
                linkTokenHash: { in: links.map(link => link.preparedLinkToken) }, active: true, revokedAt: null },
            select: { id: true, linkTokenHash: true },
        });
        const proof = links.map(link => {
            const token = tokens.find(item => item.linkTokenHash === link.preparedLinkToken);
            if (!token) throw changed();
            return { caseId: link.caseId, tokenId: token.id };
        });
        const employeePhone = recordLinkPhone(member.employee.phone)!;
        const payload: MessageTriggerJobPayload = {
            clientId: scope.clientId, employeeId: member.employeeId, scheduleId: schedule.id,
            scheduleIncarnationId: schedule.incarnationId, memberId: `employee:${member.employeeId}`,
            recipientName: member.employee.name, recipientPhone: employeePhone, templateVariables: {},
            recordLinkGroup: { version: 1, sourceHash, members: proof, ...(manual ? { previewHash: manual.previewHash } : {}) },
            ...(manual ? { sentByUserId: manual.actorUserId } : {}),
            ...(residual ? { residualOfManualJobId: residual.residualOfManualJobId } : {}),
        };
        const key = `${RECORD_LINK_GROUP_KEY_PREFIX}${schedule.id}:employee:${member.employeeId}`;
        const scheduledFor = manual ? new Date() : residual?.scheduledFor ?? getServiceRecordLinkScheduledFor(schedule.startDate);
        const job = await tx.message_trigger_job.create({
            data: {
                ...occurrence, scheduledFor, nextAttemptAt: residual?.nextAttemptAt, dedupeKey: manual ? `${key}:manual:${randomUUID()}` : `${key}:${sourceHash}:${exact.length}`,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE, recipientPhone: employeePhone,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                payload: payload as unknown as Prisma.InputJsonValue,
            },
            select: { id: true },
        });
        await tx.service_record_job_member.createMany({
            data: members.map(item => ({ ...scope, jobId: job.id, scheduleId: schedule.id, employeeId: member.employeeId,
                serviceRecordCaseId: item.caseId, babyId: item.babyId, assignmentVersion: item.assignmentVersion })),
        });
        if (replaced.length && canSendRecordLinkGroup(source, false) && member.employee.smsAutomationEnabled) {
            const remaining = await unreservedRecordLinkMembers(tx, source, source.members.filter(item => item.employeeId === member.employeeId));
            const reserved = new Set<string>();
            for (const original of replaced.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())) {
                const siblings = remaining.filter(item => {
                    const target = `${item.caseId}:${item.assignmentVersion}`;
                    return !targets.has(target) && !reserved.has(target)
                        && original.recordMembers.some(row => row.serviceRecordCaseId === item.caseId && row.assignmentVersion === item.assignmentVersion);
                });
                if (!siblings.length) continue;
                await this.admit(tx, source, siblings, await this.automaticLinks(tx, source, siblings), undefined, {
                    scheduledFor: original.scheduledFor, nextAttemptAt: original.nextAttemptAt, residualOfManualJobId: job.id,
                });
                siblings.forEach(item => reserved.add(`${item.caseId}:${item.assignmentVersion}`));
            }
        }
        return { jobId: job.id, scheduledFor, created: true };
    }
}
