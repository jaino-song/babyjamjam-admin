import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MESSAGE_TRIGGER_RULE_REPOSITORY, type IMessageTriggerRuleRepository } from "domain/repositories/message-trigger-rule.repository.interface";
import { MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY, type IMessageTriggerRuleBranchOverrideRepository } from "domain/repositories/message-trigger-rule-branch-override.repository.interface";
import { DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG, type MessageAutomationPastTriggerConfig } from "domain/entities/system-setting.entity";
import { isRuleActiveForBranch } from "domain/utils/message-trigger-rule-activation";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import { hasColumn, hasTable } from "infrastructure/database/schema-capabilities";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import { SystemSettingService } from "./system-setting.service";
import { MessageAutomationActivationService } from "./message-automation-activation.service";
import type { ClientTriggerSource, EmployeeAssignmentScheduleSource } from "./message-trigger-recipes";
import { DEFAULT_SERVICE_INFO_TRIGGER, DEFAULT_CLIENT_GREETING_TRIGGER, matchesTriggerDefaults } from "./message-trigger-defaults";
import type {
    ServiceRecordLinkCaseSource,
    ServiceRecordLinkScheduleSource,
    ServiceRecordLinkTokenSource,
} from "./service-record-link-automation-effect-recipe";

export type ClientAutomationSettingsSnapshot = {
    status: "available";
    rules: MessageTriggerRuleEntity[];
    defaultsPresent: boolean;
    dispatchEnabled: boolean;
    senderApproved: boolean;
    senderApprovedAt: Date | null;
    pastTriggerEnabled: boolean;
    pastTriggerConfig: MessageAutomationPastTriggerConfig;
} | { status: "unavailable" };

export type ClientAutomationServiceRecordLinkSource = {
    schedule: ServiceRecordLinkScheduleSource;
    serviceRecordCase: ServiceRecordLinkCaseSource | null;
    token: ServiceRecordLinkTokenSource | null;
};

/** Shared read owner. It cannot provision defaults, mutate jobs, enrich content or deliver messages. */
@Injectable()
export class ClientAutomationSourceReader {
    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE) private readonly prisma: MessageAutomationDatabase,
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY) private readonly ruleRepository: IMessageTriggerRuleRepository,
        @Inject(MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY) private readonly overrideRepository: IMessageTriggerRuleBranchOverrideRepository,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Optional() private readonly systemSettingService?: SystemSettingService,
        @Optional() private readonly messageAutomationActivationService?: MessageAutomationActivationService,
    ) {}

    /** Server-only preview input. Reads neither provision defaults nor materialize delivery jobs. */
    async readClientAutomationSettings(branchId: string, transaction?: Prisma.TransactionClient): Promise<ClientAutomationSettingsSnapshot> {
        const { rules, parentEnabled, schemaReady } = await this.resolvePersistedRules(branchId, transaction);
        if (!schemaReady) return { status: "unavailable" };
        const [approvedBranches, pastTriggerEnabled, pastTriggerConfig] = await Promise.all([
            transaction ? this.messageSenderApprovalService.getApprovedBranches([branchId], transaction)
                : this.messageSenderApprovalService.getApprovedBranches([branchId]),
            this.getMessagePolicyEnabled(branchId, "past-trigger", transaction),
            this.getRetroactiveSendConfig(branchId, transaction),
        ]);
        const defaultsPresent = [DEFAULT_SERVICE_INFO_TRIGGER, DEFAULT_CLIENT_GREETING_TRIGGER]
            .every((defaults) => rules.some((rule) => rule.branchId === branchId && matchesTriggerDefaults(rule, defaults, true)));
        return { status: "available", rules, defaultsPresent, dispatchEnabled: parentEnabled,
            senderApproved: approvedBranches.has(branchId), senderApprovedAt: approvedBranches.get(branchId) ?? null,
            pastTriggerEnabled, pastTriggerConfig };
    }

    async resolvePersistedRules(branchId: string, transaction?: Prisma.TransactionClient): Promise<{
        rules: MessageTriggerRuleEntity[];
        parentEnabled: boolean;
        schemaReady: boolean;
    }> {
        if (!(await this.hasTriggerSchema(transaction))) {
            return { rules: [], parentEnabled: false, schemaReady: false };
        }
        const parentEnabled = await this.isMessageAutomationParentEnabled(branchId, transaction);
        const rules = transaction ? await this.ruleRepository.findAll(branchId, transaction) : await this.ruleRepository.findAll(branchId);
        // The pure override port remains Prisma-free; this existing aggregate owns
        // the transaction-bound projection of the same three stored columns.
        const overrides = transaction ? await transaction.message_trigger_rule_branch_override.findMany({
            where: { branchId }, select: { branchId: true, ruleId: true, isActive: true },
        }) : await this.overrideRepository.findAllByBranch(branchId);
        const overrideMap = new Map(overrides.map((override) => [override.ruleId, override]));
        for (const rule of rules) {
            if (rule.branchId === null) {
                rule.isLockedByGlobal = !rule.isActive;
                rule.isActive = isRuleActiveForBranch(rule.isActive, overrideMap.get(rule.id)?.isActive);
            }
        }
        if (!parentEnabled) {
            for (const rule of rules) rule.isActive = false;
        }
        return { rules, parentEnabled, schemaReady: true };
    }

    /** The same branch-scoped source is used by preview and by job materialization. */
    async readClientAutomationSource(branchId: string, clientId: number, transaction?: Prisma.TransactionClient): Promise<ClientTriggerSource | null> {
        const supportsCreatedAt = await hasColumn(transaction ?? this.prisma, "client", "created_at");
        const supportsAreaId = await hasColumn(transaction ?? this.prisma, "client", "area_id");
        // Prisma's type inference does not correctly narrow the `area` relation type when
        // the select key is inside a conditional spread; cast to ClientTriggerSource explicitly.
        return await (transaction ?? this.prisma).client.findFirst({
            where: { id: clientId, branchId },
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
        }) as ClientTriggerSource | null;
    }

    /** Normal client writes permit branch-owned and global areas; preview uses the same scope. */
    async readClientAutomationArea(branchId: string, areaId: string, transaction?: Prisma.TransactionClient): Promise<ClientTriggerSource["area"] | undefined> {
        return (await (transaction ?? this.prisma).area.findFirst({
            where: { id: areaId, OR: [{ branchId }, { branchId: null }] },
            select: { bankAccountInfo: { select: { bankName: true, accNum: true } } },
        })) ?? undefined;
    }

    /** IDs are not creation identities. Include the immutable incarnation for task consent. */
    async readClientAutomationSchedules(branchId: string, clientId: number, transaction?: Prisma.TransactionClient): Promise<(EmployeeAssignmentScheduleSource & { incarnationId: string })[]> {
        return (transaction ?? this.prisma).employee_schedule.findMany({
            where: { branchId, clientId, replaced: false, terminatedAt: null },
            select: {
                id: true, incarnationId: true, branchId: true, clientId: true, workAddress: true,
                startDate: true, endDate: true, replaced: true, terminatedAt: true,
                primaryEmployeeId: true, secondaryEmployeeId: true,
                client: { select: { id: true, name: true } },
                primaryEmployee: { select: { id: true, name: true, phone: true } },
                secondaryEmployee: { select: { id: true, name: true, phone: true } },
            }, orderBy: { id: "asc" }, take: 501,
        });
    }

    /**
     * Read the complete, branch-owned source for the dedicated service-record
     * link recipe. This is intentionally read-only: link issuance and job
     * promotion remain owned by ServiceRecordLinkService after approval.
     */
    async readClientAutomationServiceRecordLinks(
        branchId: string,
        clientId: number,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientAutomationServiceRecordLinkSource[]> {
        // The dispatch authority resolves the client-owned case by branch+client
        // (AgentAutomationJobAuthorityService), never by following the token's
        // serviceRecordCaseId relation: a legacy token can keep a stale null
        // case id after a case exists, and trusting the relation here would let
        // preview accept a token/case pair that dispatch later rejects. Read
        // the same source so preview and dispatch evaluate identical inputs.
        const serviceRecordCase = await (transaction ?? this.prisma).service_record_case.findFirst({
            where: { branchId, clientId },
            select: {
                id: true,
                branchId: true,
                clientId: true,
                status: true,
                startDate: true,
                endDate: true,
                requiredSessionCount: true,
                formVersion: true,
                version: true,
                finalizedAt: true,
                updatedAt: true,
            },
        });
        const rows = await (transaction ?? this.prisma).employee_schedule.findMany({
            where: { branchId, clientId, replaced: false, terminatedAt: null },
            select: {
                id: true,
                incarnationId: true,
                branchId: true,
                clientId: true,
                startDate: true,
                endDate: true,
                replaced: true,
                terminatedAt: true,
                primaryEmployeeId: true,
                client: {
                    select: {
                        id: true,
                        name: true,
                        branchId: true,
                        createdAt: true,
                        serviceStatus: true,
                    },
                },
                primaryEmployee: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        branchId: true,
                        deletedAt: true,
                    },
                },
                serviceRecordTokens: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: {
                        id: true,
                        branchId: true,
                        scheduleId: true,
                        employeeId: true,
                        serviceRecordCaseId: true,
                        linkTokenHash: true,
                        expectedPhoneHash: true,
                        expiresAt: true,
                        active: true,
                        revokedAt: true,
                        lockedAt: true,
                        failedAttempts: true,
                        createdAt: true,
                    },
                },
            },
            orderBy: { id: "asc" },
            take: 501,
        });

        return rows.map((row) => {
            const token = row.serviceRecordTokens[0] ?? null;
            return {
                schedule: row as unknown as ServiceRecordLinkScheduleSource,
                serviceRecordCase: token
                    ? serviceRecordCase as ServiceRecordLinkCaseSource | null
                    : null,
                token: token
                    ? token as unknown as ServiceRecordLinkTokenSource
                    : null,
            };
        });
    }

    async getRetroactiveSendConfig(
        branchId: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageAutomationPastTriggerConfig> {
        if (!this.systemSettingService) {
            return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;
        }
        return transaction ? this.systemSettingService.getMessageAutomationPastTriggerConfig(branchId, this.transactionSettingReader(transaction))
            : this.systemSettingService.getMessageAutomationPastTriggerConfig(branchId);
    }

    async getMessagePolicyEnabled(
        branchId: string,
        policyId: "trigger-dispatch" | "trigger-job-retry" | "past-trigger",
        transaction?: Prisma.TransactionClient,
    ): Promise<boolean> {
        if (policyId === "trigger-dispatch") {
            if (!this.messageAutomationActivationService) return false;
            return transaction ? this.messageAutomationActivationService.getTriggerDispatchEnabled(branchId, transaction)
                : this.messageAutomationActivationService.getTriggerDispatchEnabled(branchId);
        }
        if (
            !this.systemSettingService
            || typeof this.systemSettingService.getMessageSettingsPolicyEnabled !== "function"
        ) return true;
        return transaction ? this.systemSettingService.getMessageSettingsPolicyEnabled(branchId, policyId, this.transactionSettingReader(transaction))
            : this.systemSettingService.getMessageSettingsPolicyEnabled(branchId, policyId);
    }

    async isMessageAutomationParentEnabled(branchId: string, transaction?: Prisma.TransactionClient): Promise<boolean> {
        if (!this.messageAutomationActivationService) return false;
        return transaction ? this.messageAutomationActivationService.getTriggerDispatchEnabled(branchId, transaction)
            : this.messageAutomationActivationService.getTriggerDispatchEnabled(branchId);
    }

    private transactionSettingReader(transaction: Prisma.TransactionClient): (key: string) => Promise<string | null> {
        return async (key) => (await transaction.system_setting.findUnique({ where: { key }, select: { value: true } }))?.value ?? null;
    }

    async hasTriggerSchema(transaction?: Prisma.TransactionClient): Promise<boolean> {
        const [hasRuleTable, hasJobTable, hasSendTime] = await Promise.all([
            hasTable(transaction ?? this.prisma, "message_trigger_rule"),
            hasTable(transaction ?? this.prisma, "message_trigger_job"),
            hasColumn(transaction ?? this.prisma, "message_trigger_rule", "send_time"),
        ]);
        return hasRuleTable && hasJobTable && hasSendTime;
    }

}
