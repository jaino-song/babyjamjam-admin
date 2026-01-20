import { Inject, Injectable } from "@nestjs/common";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
import { SystemTemplateEntity, VariableValidationResult } from "domain/entities/system-template.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

function validateTemplateContent(key: SystemTemplateKey, content: string): VariableValidationResult {
  const contract = SYSTEM_TEMPLATE_REGISTRY[key];
  const allowedKeys = contract.requiredVariables.map(v => v.key);
  const requiredKeys = contract.requiredVariables.filter(v => v.required).map(v => v.key);

  const tempEntity = SystemTemplateEntity.create(key, content);
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
export class ValidateTemplateContentUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY)
    private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey, content: string): Promise<VariableValidationResult> {
    await this.repository.findByKey(key);

    return validateTemplateContent(key, content);
  }
}
