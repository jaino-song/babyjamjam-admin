import { Inject, Injectable } from "@nestjs/common";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

@Injectable()
export class RenderTemplateUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY)
    private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey, data: Record<string, unknown>): Promise<string> {
    const template = await this.repository.findByKey(key);
    const content = template?.content ?? SYSTEM_TEMPLATE_REGISTRY[key].defaultContent;

    return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match: string, variableKey: string) => {
      const value = data[variableKey];
      if (value === undefined || value === null) return match;
      return String(value);
    });
  }
}
