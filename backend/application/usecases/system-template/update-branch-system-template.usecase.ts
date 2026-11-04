import { BranchSystemTemplateSnapshotError, type CaregiverTemplateLifecycleAction, type CaregiverTemplateLifecycleResult } from "domain/entities/branch-system-template-snapshot";
import { Inject, Injectable } from "@nestjs/common";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import {
    CustomVariable,
    isCaregiverSystemTemplateKey,
    SystemTemplateKey,
} from "domain/constants/system-template-registry";
import {
    BranchSystemTemplateMutationResult,
    ISystemTemplateRepository,
    SYSTEM_TEMPLATE_REPOSITORY,
} from "domain/repositories/system-template.repository.interface";
import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";

@Injectable()
export class UpdateBranchSystemTemplateUseCase {
    constructor(
        @Inject(SYSTEM_TEMPLATE_REPOSITORY)
        private readonly repository: ISystemTemplateRepository,
        private readonly mutationGuard: SystemTemplateMutationGuardService,
        private readonly automationLock: MessageTemplateAutomationLockService,
    ) {}

    lifecycle(branchId: string, key: SystemTemplateKey, action: CaregiverTemplateLifecycleAction, userId: string): Promise<CaregiverTemplateLifecycleResult> {
        if (!isCaregiverSystemTemplateKey(key) || !["activate", "disable", "delete", "restore"].includes(action)
            || !this.repository.updateCaregiverTemplateLifecycle) throw new BranchSystemTemplateSnapshotError(branchId, key, "caregiver lifecycle is unavailable");
        return this.automationLock.runExclusive(key, (transaction) => this.repository.updateCaregiverTemplateLifecycle!(branchId, key, action, userId, transaction));
    }

    execute(
        branchId: string,
        key: SystemTemplateKey,
        content: string,
        userId: string,
        customVariables?: CustomVariable[],
    ): Promise<BranchSystemTemplateMutationResult> {
        return this.automationLock.runExclusive(
            key,
            (transaction) => this.repository.updateBranchTemplate(
                branchId,
                key,
                content,
                userId,
                customVariables,
                (candidateKey, candidateContent, candidateCustomVariables, candidateTransaction) =>
                    this.mutationGuard.assertValid(
                        candidateKey,
                        candidateContent,
                        candidateCustomVariables,
                        candidateTransaction,
                        branchId,
                    ),
                transaction,
            ),
        );
    }
}
