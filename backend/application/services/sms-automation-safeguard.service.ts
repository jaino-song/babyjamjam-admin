import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import {
    koreanPhoneStoredDigitCandidates,
    normalizeKoreanPhoneLookupKey,
} from "infrastructure/database/repositories/stored-phone-lookup";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import {
    AGENT_SMS_RETRY_DEDUPE_KEY_PREFIX,
    AGENT_SMS_RULE_ID_PREFIX,
    MessageTriggerRecipientType,
} from "domain/constants/message-trigger-catalog";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";

/** The fields of a message_trigger_job the safeguard reads. */
export interface SmsSafeguardJob {
    branchId: string | null;
    ruleId: string;
    templateKey: string;
    dedupeKey: string;
    clientId: number | null;
    employeeScheduleId: number | null;
    recipientType: string;
    recipientPhone: string | null;
}

export type SmsAutomationSafeguardLevel = "rule" | "recipient" | "branch";

export type SmsAutomationSafeguardDecision =
    | { allowed: true }
    | { allowed: false; level: SmsAutomationSafeguardLevel; reason: string };

/** Cancel / supersede reason recorded when the safeguard blocks a send. */
export function smsAutomationSafeguardReason(level: SmsAutomationSafeguardLevel): string {
    return `sms_automation_safeguard:${level}`;
}

/** AI-agent SMS (immediate, scheduled, approved retry) is automatic but owns an intentionally inactive rule row. */
export function isAgentSmsJob(job: Pick<SmsSafeguardJob, "ruleId" | "dedupeKey">): boolean {
    return job.ruleId.startsWith(AGENT_SMS_RULE_ID_PREFIX)
        || job.dedupeKey.startsWith(AGENT_SMS_RETRY_DEDUPE_KEY_PREFIX);
}

/**
 * An admin's own send (admin 즉시 발송, manual service-record-link and
 * service-end-notice jobs): the only SMS that bypasses all three automation
 * levels. Agent jobs match the ownership "manual" matchers but are automatic.
 */
export function isAdminDirectSendJob(
    job: Pick<SmsSafeguardJob, "templateKey" | "ruleId" | "dedupeKey">,
): boolean {
    return isManualMessageTriggerJob(job) && !isAgentSmsJob(job);
}

/** Bound on user rows read for the phone-match path (users with the flag turned off are staff-scale). */
const PHONE_MATCH_USER_LIMIT = 500;

function hyphenatedForms(digits: string): string[] {
    if (!digits.startsWith("0")) return [];
    if (digits.length === 11) return [`${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`];
    if (digits.length === 10) {
        return digits.startsWith("02")
            ? [`${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`]
            : [`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`];
    }
    return [];
}

/**
 * The single send-time gate for every automatic SMS: an automatic message
 * reaches the provider only when (1) its automation rule is active, (2) the
 * recipient's `smsAutomationEnabled` flag is on, and (3) the branch's
 * trigger-dispatch switch is on. Levels are evaluated in that order and the
 * first block wins. Entity flags are read with direct queries on purpose: the
 * safeguard owns no domain entity or repository mapper.
 */
@Injectable()
export class SmsAutomationSafeguardService {
    private readonly logger = new Logger(SmsAutomationSafeguardService.name);

    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE)
        private readonly database: MessageAutomationDatabase,
        private readonly activationService: MessageAutomationActivationService,
    ) {}

    isAdminDirectSend(job: Pick<SmsSafeguardJob, "templateKey" | "ruleId" | "dedupeKey">): boolean {
        return isAdminDirectSendJob(job);
    }

    async check(job: SmsSafeguardJob, transaction?: Prisma.TransactionClient): Promise<SmsAutomationSafeguardDecision> {
        const db = transaction ?? this.database;

        if (!isAgentSmsJob(job)) {
            const rule = await this.checkRule(db, job);
            if (rule) return rule;
        }

        const recipient = await this.checkRecipient(db, job);
        if (recipient) return recipient;

        if (!job.branchId) return { allowed: false, level: "branch", reason: "job has no branch" };
        const enabled = await this.activationService.getTriggerDispatchEnabled(job.branchId, transaction);
        if (!enabled) return { allowed: false, level: "branch", reason: "branch trigger dispatch is off" };

        return { allowed: true };
    }

    /**
     * Load a persisted job and check it, for callers that hold only an id (the
     * automatic retry path). Admin-direct jobs and a vanished job pass: those
     * are decided by the caller's own existing checks.
     */
    async checkJobById(
        branchId: string,
        jobId: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<SmsAutomationSafeguardDecision> {
        const db = transaction ?? this.database;
        const row = await db.message_trigger_job.findFirst({
            where: { id: jobId, branchId },
            select: {
                branchId: true, ruleId: true, templateKey: true, dedupeKey: true, clientId: true,
                employeeScheduleId: true, recipientType: true, recipientPhone: true,
            },
        });
        if (!row || isAdminDirectSendJob(row)) return { allowed: true };
        return this.check(row, transaction);
    }

    warnBlocked(subject: string, decision: Extract<SmsAutomationSafeguardDecision, { allowed: false }>): void {
        this.logger.warn(`[SMS Safeguard] Blocked automatic SMS ${subject}: level=${decision.level} reason=${decision.reason}`);
    }

    private async checkRule(
        db: Prisma.TransactionClient,
        job: SmsSafeguardJob,
    ): Promise<SmsAutomationSafeguardDecision | null> {
        const rule = await db.message_trigger_rule.findFirst({
            where: { id: job.ruleId },
            select: { isActive: true, branchId: true },
        });
        if (!rule) return { allowed: false, level: "rule", reason: "automation rule is missing" };
        if (!rule.isActive) return { allowed: false, level: "rule", reason: "automation rule is inactive" };
        // A rule is evaluable by its own branch or, when branchless (global), by every branch.
        if (rule.branchId !== null && rule.branchId !== job.branchId) {
            return { allowed: false, level: "rule", reason: "automation rule belongs to another branch" };
        }
        if (rule.branchId === null && job.branchId) {
            const override = await db.message_trigger_rule_branch_override.findFirst({
                where: { branchId: job.branchId, ruleId: job.ruleId },
                select: { isActive: true },
            });
            if (override && !override.isActive) {
                return { allowed: false, level: "rule", reason: "automation rule is disabled for this branch" };
            }
        }
        return null;
    }

    private async checkRecipient(
        db: Prisma.TransactionClient,
        job: SmsSafeguardJob,
    ): Promise<SmsAutomationSafeguardDecision | null> {
        const branchScope = job.branchId ? { branchId: job.branchId } : {};

        if (job.recipientType === MessageTriggerRecipientType.CLIENT && job.clientId !== null) {
            const client = await db.client.findFirst({
                where: { id: job.clientId, ...branchScope },
                select: { smsAutomationEnabled: true },
            });
            if (!client) return { allowed: false, level: "recipient", reason: "recipient client is missing" };
            if (!client.smsAutomationEnabled) {
                return { allowed: false, level: "recipient", reason: "client SMS automation is off" };
            }
            return null;
        }

        const employeeRecipient = job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            || job.recipientType === MessageTriggerRecipientType.SECONDARY_EMPLOYEE;
        if (employeeRecipient && job.employeeScheduleId !== null) {
            const schedule = await db.employee_schedule.findFirst({
                where: { id: job.employeeScheduleId, ...branchScope },
                select: {
                    primaryEmployee: { select: { smsAutomationEnabled: true } },
                    secondaryEmployee: { select: { smsAutomationEnabled: true } },
                },
            });
            const employee = job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
                ? schedule?.primaryEmployee
                : schedule?.secondaryEmployee;
            if (!employee) return { allowed: false, level: "recipient", reason: "recipient employee is missing" };
            if (!employee.smsAutomationEnabled) {
                return { allowed: false, level: "recipient", reason: "employee SMS automation is off" };
            }
            return null;
        }

        return this.checkRecipientByPhone(db, job);
    }

    /** No client/employee reference (agent jobs, raw phone): any matched entity with the flag off blocks. */
    private async checkRecipientByPhone(
        db: Prisma.TransactionClient,
        job: SmsSafeguardJob,
    ): Promise<SmsAutomationSafeguardDecision | null> {
        if (!job.branchId) return null;
        const keys = [...new Set(
            (job.recipientPhone ?? "")
                .split(/[,;\n]/)
                .map((piece) => normalizeKoreanPhoneLookupKey(piece))
                .filter((key) => key.length > 0),
        )];
        if (keys.length === 0) return null;
        const candidates = [...new Set(keys.flatMap((key) => [
            ...koreanPhoneStoredDigitCandidates(key),
            ...hyphenatedForms(key),
        ]))];
        const keySet = new Set(keys);
        const phoneMatch = { OR: [{ phoneNormalized: { in: candidates } }, { phone: { in: candidates } }] };

        const client = await db.client.findFirst({
            where: { branchId: job.branchId, smsAutomationEnabled: false, ...phoneMatch },
            select: { id: true },
        });
        if (client) return { allowed: false, level: "recipient", reason: "matched client SMS automation is off" };

        const employee = await db.employee.findFirst({
            where: { branchId: job.branchId, smsAutomationEnabled: false, ...phoneMatch },
            select: { id: true },
        });
        if (employee) return { allowed: false, level: "recipient", reason: "matched employee SMS automation is off" };

        // Users carry no normalized phone and no branchId; they are scoped by user_branch.
        const users = await db.user.findMany({
            where: {
                smsAutomationEnabled: false,
                phone: { not: null },
                userBranches: { some: { branchId: job.branchId } },
            },
            select: { phone: true },
            take: PHONE_MATCH_USER_LIMIT,
        });
        if (users.some((user) => keySet.has(normalizeKoreanPhoneLookupKey(user.phone)))) {
            return { allowed: false, level: "recipient", reason: "matched user SMS automation is off" };
        }
        return null;
    }
}
