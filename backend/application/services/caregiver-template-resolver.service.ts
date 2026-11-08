import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey, isCaregiverSystemTemplateKey } from "domain/constants/system-template-registry";
import { BranchSystemTemplateSnapshotError, parseBranchSystemTemplateSnapshot } from "domain/entities/branch-system-template-snapshot";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import { findUnsupportedRequiredMessageTriggerVariables } from "domain/constants/message-trigger-variable-sources";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";

/** Read-only and branch-only. Missing content never consults a global template. */
@Injectable()
export class CaregiverTemplateResolverService {
    constructor(@Inject(MESSAGE_AUTOMATION_DATABASE) private readonly database: MessageAutomationDatabase) {}

    async resolve(branchId: string, key: SystemTemplateKey, transaction?: Prisma.TransactionClient): Promise<{
        content: string; version: string; hash: string; requiredVariableKeys: string[];
    }> {
        if (!isCaregiverSystemTemplateKey(key)) throw new BranchSystemTemplateSnapshotError(branchId, key, "unsupported caregiver key");
        const branch = await (transaction ?? this.database).branch.findUnique({ where: { id: branchId }, select: { systemTemplateSnapshot: true } });
        if (!branch) throw new BranchSystemTemplateSnapshotError(branchId, key, "branch not found");
        const snapshot = parseBranchSystemTemplateSnapshot(branch.systemTemplateSnapshot, branchId);
        const entry = snapshot?.templates[key];
        if (entry?.state === "disabled" || entry?.state === "deleted") throw new BranchSystemTemplateSnapshotError(branchId, key, entry.state);
        const content = entry?.content ?? SYSTEM_TEMPLATE_REGISTRY[key].defaultContent;
        const required = [...SYSTEM_TEMPLATE_REGISTRY[key].requiredVariables, ...(entry?.customVariables ?? [])];
        const placeholders = [...content.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]!);
        if (!content.trim() || /\{\{(?![^{]*\}\})/.test(content) || required.some((variable) => variable.required && !placeholders.includes(variable.key))
            || findUnsupportedRequiredMessageTriggerVariables(key as unknown as MessageTriggerTemplateKey, required).length
            || [...content.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].some((match) => !["employeeName", "clientName", "serviceStartDate", "serviceEndDate", "branchName"].includes(match[1]!))) {
            throw new BranchSystemTemplateSnapshotError(branchId, key, "unrenderable caregiver content");
        }
        return { content, hash: agentBindingHash(content), version: entry ? `${entry.id}:${entry.updatedAt}` : `registry:${key}:v1`,
            requiredVariableKeys: required.filter((variable) => variable.required).map((variable) => variable.key) };
    }
}
