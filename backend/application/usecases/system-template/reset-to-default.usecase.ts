import { Inject, Injectable } from "@nestjs/common";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

@Injectable()
export class ResetToDefaultUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY)
    private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey, userId: string): Promise<SystemTemplateEntity> {
    const contract = SYSTEM_TEMPLATE_REGISTRY[key];

    let template = await this.repository.findByKey(key);
    if (!template) {
      template = SystemTemplateEntity.create(key, contract.defaultContent);
    }

    template = await this.repository.save(template);
    await this.repository.createVersion(template.id, template.content, userId);

    template.updateContent(contract.defaultContent);
    return this.repository.save(template);
  }
}
