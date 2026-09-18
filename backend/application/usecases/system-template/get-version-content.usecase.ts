import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateVersionEntity } from "domain/entities/system-template-version.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

@Injectable()
export class GetVersionContentUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY) private readonly repository: ISystemTemplateRepository,
  ) {}

  async execute(key: SystemTemplateKey, versionNumber: number): Promise<SystemTemplateVersionEntity> {
    const version = await this.repository.getVersionByNumber(key, versionNumber);
    if (!version) {
      throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
    }

    return version;
  }
}
