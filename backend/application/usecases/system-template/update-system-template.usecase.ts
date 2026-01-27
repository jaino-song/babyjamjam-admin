import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY, CustomVariable } from "domain/constants/system-template-registry";
import { SystemTemplateEntity, VariableValidationResult } from "domain/entities/system-template.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

function validateTemplateContent(key: SystemTemplateKey, content: string, customVariables: CustomVariable[] = []): VariableValidationResult {
  const contract = SYSTEM_TEMPLATE_REGISTRY[key];
  const registryKeys = contract.requiredVariables.map(v => v.key);
  const registryRequiredKeys = contract.requiredVariables.filter(v => v.required).map(v => v.key);

  // Combine registry keys with custom variable keys for allowed list
  const customVarKeys = customVariables.map(cv => cv.key);
  const allowedKeys = [...registryKeys, ...customVarKeys];

  // Required custom variables (where required: true) should be checked as missing if not in content
  const requiredCustomVarKeys = customVariables.filter(cv => cv.required).map(cv => cv.key);
  const requiredKeys = [...registryRequiredKeys, ...requiredCustomVarKeys];

  const tempEntity = SystemTemplateEntity.create(key, content, customVariables);
  const contentVars = tempEntity.extractVariables();

  const contentSet = new Set(contentVars);
  const allowedSet = new Set(allowedKeys);

  const missingVariables = requiredKeys.filter(v => !contentSet.has(v));
  const unknownVariables = contentVars.filter(v => !allowedSet.has(v));

  const syntaxErrors: string[] = [];
  const unclosedOpen = content.match(/\{\{(?![^{]*\}\})/g);
  if (unclosedOpen) {
    syntaxErrors.push("템플릿에 닫히지 않은 {{ 가 있습니다");
  }

  return {
    valid: missingVariables.length === 0 && unknownVariables.length === 0 && syntaxErrors.length === 0,
    missingVariables,
    unknownVariables,
    syntaxErrors,
  };
}

@Injectable()
export class UpdateSystemTemplateUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY)
    private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey, content: string, userId: string, customVariables: CustomVariable[] = []): Promise<SystemTemplateEntity> {
    const validation = validateTemplateContent(key, content, customVariables);
    if (!validation.valid) {
      throw new BadRequestException({
        message: "Template validation failed",
        errors: [
          ...validation.missingVariables.map(v => ({ field: "content", message: `필수 변수 누락: {{${v}}}` })),
          ...validation.unknownVariables.map(v => ({ field: "content", message: `정의되지 않은 변수: {{${v}}}` })),
          ...validation.syntaxErrors.map(e => ({ field: "content", message: e })),
        ],
      });
    }

    const contract = SYSTEM_TEMPLATE_REGISTRY[key];

    let template = await this.repository.findByKey(key);
    if (!template) {
      template = SystemTemplateEntity.create(key, contract.defaultContent, customVariables);
    }

    template = await this.repository.save(template);

    await this.repository.createVersion(template.id, template.content, userId);

    template.updateContent(content);
    const updatedTemplate = SystemTemplateEntity.reconstitute(
      template.id,
      template.templateKey,
      content,
      template.createdAt,
      new Date(),
      customVariables
    );
    return this.repository.save(updatedTemplate);
  }
}
