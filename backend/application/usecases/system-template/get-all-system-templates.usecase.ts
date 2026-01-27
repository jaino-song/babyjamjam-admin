import { Injectable, Inject } from "@nestjs/common";
import { SYSTEM_TEMPLATE_REPOSITORY, ISystemTemplateRepository } from "domain/repositories/system-template.repository.interface";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";

@Injectable()
export class GetAllSystemTemplatesUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY)
    private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(): Promise<SystemTemplateEntity[]> {
    const templates = await this.repository.findAll();
    const templatesByKey = new Map<SystemTemplateKey, SystemTemplateEntity>();

    for (const template of templates) {
      templatesByKey.set(template.templateKey, template);
    }

    const allKeys = Object.values(SystemTemplateKey);
    for (const key of allKeys) {
      if (templatesByKey.has(key)) continue;
      const contract = SYSTEM_TEMPLATE_REGISTRY[key];
      templatesByKey.set(key, SystemTemplateEntity.create(key, contract.defaultContent));
    }

    return allKeys.map(key => templatesByKey.get(key)!).filter(Boolean);
  }
}
