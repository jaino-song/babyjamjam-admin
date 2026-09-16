import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    CustomVariable,
    SYSTEM_TEMPLATE_REGISTRY,
    SystemTemplateKey,
} from "domain/constants/system-template-registry";
import {
    findUnsupportedRequiredMessageTriggerVariables,
    getMessageTriggerTemplateKeysForSystemTemplate,
} from "domain/constants/message-trigger-variable-sources";
import { SystemTemplateEntity, VariableValidationResult } from "domain/entities/system-template.entity";
import {
    IMessageTriggerRuleRepository,
    MESSAGE_TRIGGER_RULE_REPOSITORY,
} from "domain/repositories/message-trigger-rule.repository.interface";

export function validateSystemTemplateCandidate(
    key: SystemTemplateKey,
    content: string,
    customVariables: CustomVariable[] = [],
): VariableValidationResult {
    const contract = SYSTEM_TEMPLATE_REGISTRY[key];
    const registryKeys = contract.requiredVariables.map((variable) => variable.key);
    const registryRequiredKeys = contract.requiredVariables
        .filter((variable) => variable.required)
        .map((variable) => variable.key);
    const customVariableKeys = customVariables.map((variable) => variable.key);
    const requiredCustomVariableKeys = customVariables
        .filter((variable) => variable.required)
        .map((variable) => variable.key);
    const allowedKeys = new Set([...registryKeys, ...customVariableKeys]);
    const requiredKeys = [...registryRequiredKeys, ...requiredCustomVariableKeys];
    const template = SystemTemplateEntity.create(key, content, customVariables);
    const contentVariables = template.extractVariables();
    const contentSet = new Set(contentVariables);
    const missingVariables = requiredKeys.filter((variable) => !contentSet.has(variable));
    const unknownVariables = contentVariables.filter((variable) => !allowedKeys.has(variable));
    const syntaxErrors = content.match(/\{\{(?![^{]*\}\})/g)
        ? ["템플릿에 닫히지 않은 {{ 가 있습니다"]
        : [];

    return {
        valid:
            missingVariables.length === 0
            && unknownVariables.length === 0
            && syntaxErrors.length === 0,
        missingVariables,
        unknownVariables,
        syntaxErrors,
    };
}

@Injectable()
export class SystemTemplateMutationGuardService {
    constructor(
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly messageTriggerRuleRepository: IMessageTriggerRuleRepository,
    ) {}

    async assertValid(
        key: SystemTemplateKey,
        content: string,
        customVariables: CustomVariable[] = [],
        transaction?: Prisma.TransactionClient,
        branchId?: string,
    ): Promise<void> {
        const validation = validateSystemTemplateCandidate(key, content, customVariables);
        if (!validation.valid) {
            // 입력 검증 거절은 공개 검증 계약으로 변환해요. RFC6901 포인터는 본문의 content
            // 필드를 가리키고, 세부 원인은 호환 별칭 message와 변수 토큰으로 식별해요.
            throw new BadRequestException({
                code: "VALIDATION_FAILED",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
                message: "Template validation failed",
                errors: [
                    ...validation.missingVariables.map((variable) => ({
                        pointer: "/content",
                        code: "REQUIRED" as const,
                        detail: `필수 변수 누락: {{${variable}}}`,
                    })),
                    ...validation.unknownVariables.map((variable) => ({
                        pointer: "/content",
                        code: "INVALID_VALUE" as const,
                        detail: `정의되지 않은 변수: {{${variable}}}`,
                    })),
                    ...validation.syntaxErrors.map((message) => ({
                        pointer: "/content",
                        code: "INVALID_FORMAT" as const,
                        detail: message,
                    })),
                ],
            });
        }

        const unsupportedByTriggerTemplate = new Map(
            getMessageTriggerTemplateKeysForSystemTemplate(key)
                .map((triggerTemplateKey) => [
                    triggerTemplateKey,
                    findUnsupportedRequiredMessageTriggerVariables(
                        triggerTemplateKey,
                        customVariables,
                    ),
                ] as const)
                .filter(([, unsupportedVariables]) => unsupportedVariables.length > 0),
        );
        if (unsupportedByTriggerTemplate.size === 0) return;

        const activeTemplateKeys = branchId === undefined
            ? await this.messageTriggerRuleRepository.findActiveTemplateKeys(
                [...unsupportedByTriggerTemplate.keys()],
                transaction,
            )
            : await this.messageTriggerRuleRepository.findActiveTemplateKeys(
                [...unsupportedByTriggerTemplate.keys()],
                branchId,
                transaction,
            );
        const unsupportedActiveVariables = [...new Set(
            activeTemplateKeys.flatMap(
                (templateKey) => unsupportedByTriggerTemplate.get(templateKey) ?? [],
            ),
        )];
        if (unsupportedActiveVariables.length === 0) return;

        // 활성 자동 발송 규칙이 요구하는 변수를 자동 소스 없이 요구하는 편집 거절도 같은
        // 공개 검증 계약으로 변환해요. 변수별 포인터로 원인을 식별하고, 기존 소비자가 읽는
        // unsupportedVariables 목록은 호환을 위해 그대로 남겨요.
        throw new BadRequestException({
            code: "VALIDATION_FAILED",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            message: "활성 자동 발송 규칙에서 입력할 수 없는 필수 템플릿 변수가 있습니다.",
            errors: unsupportedActiveVariables.map((variable) => ({
                pointer: `/customVariables/${variable}`,
                code: "INVALID_VALUE" as const,
                detail: `자동 발송 규칙에서 입력할 수 없는 변수: {{${variable}}}`,
            })),
            unsupportedVariables: unsupportedActiveVariables,
        });
    }
}
