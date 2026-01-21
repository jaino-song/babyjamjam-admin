import { Injectable, Inject } from "@nestjs/common";
import { SYSTEM_TEMPLATE_REPOSITORY, ISystemTemplateRepository } from "domain/repositories/system-template.repository.interface";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";

@Injectable()
export class GetSystemTemplateUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY)
    private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey): Promise<SystemTemplateEntity> {
    const template = await this.repository.findByKey(key);
    if (template) return template;

    const contract = SYSTEM_TEMPLATE_REGISTRY[key];
    return SystemTemplateEntity.create(key, contract.defaultContent);
  }
}
