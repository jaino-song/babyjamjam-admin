import { Inject, Injectable } from "@nestjs/common";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateVersionEntity } from "domain/entities/system-template-version.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

@Injectable()
export class GetVersionHistoryUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY) private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey): Promise<SystemTemplateVersionEntity[]> {
    return this.repository.getVersionHistory(key);
  }
}
