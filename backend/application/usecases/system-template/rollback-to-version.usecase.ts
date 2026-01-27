import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

@Injectable()
export class RollbackToVersionUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY) private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey, versionNumber: number, userId: string): Promise<SystemTemplateEntity> {
    const version = await this.repository.getVersionByNumber(key, versionNumber);
    if (!version) {
      throw new NotFoundException(`Version ${versionNumber} not found`);
    }

    let template = await this.repository.findByKey(key);
    if (!template) {
      throw new NotFoundException(`Template ${key} not found`);
    }

    await this.repository.createVersion(template.id, template.content, userId);

    template.updateContent(version.content);
    return this.repository.save(template);
  }
}
