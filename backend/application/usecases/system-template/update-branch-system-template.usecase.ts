import { Inject, Injectable } from "@nestjs/common";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import {
    CustomVariable,
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
                    ),
                transaction,
            ),
        );
    }
}
