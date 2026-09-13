import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";
import { UpdateBranchSystemTemplateUseCase } from "application/usecases/system-template/update-branch-system-template.usecase";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";

describe("UpdateBranchSystemTemplateUseCase automation variable safety", () => {
    const transaction = { id: "branch-template-mutation-transaction" };
    const templateContent = "{{name}} 예약 번호: {{reservationCode}}";
    const customVariables = [{ key: "reservationCode", label: "예약 코드", required: true }];

    const createHarness = (activeRuleBranches: Array<string | null>) => {
        const repository = {
            updateBranchTemplate: jest.fn().mockImplementation(async (
                branchId: string,
                key: SystemTemplateKey,
                content: string,
                userId: string,
                variables: typeof customVariables | undefined,
                validateCandidate: (
                    candidateKey: SystemTemplateKey,
                    candidateContent: string,
                    candidateVariables: typeof customVariables,
                    candidateTransaction: unknown,
                ) => Promise<void>,
                writeTransaction: unknown,
            ) => {
                await validateCandidate(key, content, variables ?? [], writeTransaction);
                return {
                    template: SystemTemplateEntity.reconstitute(
                        `template-${branchId}`,
                        key,
                        content,
                        new Date("2026-09-10T00:00:00.000Z"),
                        new Date("2026-09-10T00:00:00.000Z"),
                        variables ?? [],
                    ),
                    changed: true,
                    userId,
                };
            }),
        };
        const messageTriggerRuleRepository = {
            findActiveTemplateKeys: jest.fn().mockImplementation(async (
                templateKeys: MessageTriggerTemplateKey[],
                branchId: string,
                writeTransaction: unknown,
            ) => {
                expect(templateKeys).toEqual([MessageTriggerTemplateKey.SERVICE_INFO]);
                expect(writeTransaction).toBe(transaction);
                return activeRuleBranches.includes(branchId) || activeRuleBranches.includes(null)
                    ? [MessageTriggerTemplateKey.SERVICE_INFO]
                    : [];
            }),
        };
        const mutationGuard = new SystemTemplateMutationGuardService(
            messageTriggerRuleRepository as never,
        );
        const automationLock = {
            runExclusive: jest.fn().mockImplementation(async (
                _key: SystemTemplateKey,
                work: (writeTransaction: unknown) => Promise<unknown>,
            ) => work(transaction)),
        };
        const useCase = new UpdateBranchSystemTemplateUseCase(
            repository as never,
            mutationGuard,
            automationLock as never,
        );
        return { useCase, repository, messageTriggerRuleRepository };
    };

    it("allows an edit when only an unrelated branch has the active rule", async () => {
        const { useCase, repository, messageTriggerRuleRepository } = createHarness(["branch-b"]);

        await expect(useCase.execute(
            "branch-a",
            SystemTemplateKey.SERVICE_INFO,
            templateContent,
            "user-a",
            customVariables,
        )).resolves.toEqual(expect.objectContaining({ changed: true }));

        expect(messageTriggerRuleRepository.findActiveTemplateKeys).toHaveBeenCalledWith(
            [MessageTriggerTemplateKey.SERVICE_INFO],
            "branch-a",
            transaction,
        );
        expect(repository.updateBranchTemplate).toHaveBeenCalledWith(
            "branch-a",
            SystemTemplateKey.SERVICE_INFO,
            templateContent,
            "user-a",
            customVariables,
            expect.any(Function),
            transaction,
        );
    });

    it("rejects an edit when the same branch has the active rule", async () => {
        const { useCase, repository } = createHarness(["branch-a"]);

        await expect(useCase.execute(
            "branch-a",
            SystemTemplateKey.SERVICE_INFO,
            templateContent,
            "user-a",
            customVariables,
        )).rejects.toMatchObject({
            response: expect.objectContaining({
                unsupportedVariables: ["reservationCode"],
            }),
        });

        expect(repository.updateBranchTemplate).toHaveBeenCalledTimes(1);
    });

    it("rejects an edit when an applicable branchless global rule is active", async () => {
        const { useCase, repository, messageTriggerRuleRepository } = createHarness([null]);

        await expect(useCase.execute(
            "branch-a",
            SystemTemplateKey.SERVICE_INFO,
            templateContent,
            "user-a",
            customVariables,
        )).rejects.toMatchObject({
            response: expect.objectContaining({
                unsupportedVariables: ["reservationCode"],
            }),
        });

        expect(messageTriggerRuleRepository.findActiveTemplateKeys).toHaveBeenCalledWith(
            [MessageTriggerTemplateKey.SERVICE_INFO],
            "branch-a",
            transaction,
        );
        expect(repository.updateBranchTemplate).toHaveBeenCalledTimes(1);
    });
});
