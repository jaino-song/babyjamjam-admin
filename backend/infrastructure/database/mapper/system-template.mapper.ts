import { system_template, system_template_version } from '@prisma/client';
import { SystemTemplateKey } from 'domain/constants/system-template-registry';
import { SystemTemplateEntity } from 'domain/entities/system-template.entity';
import { SystemTemplateVersionEntity } from 'domain/entities/system-template-version.entity';

export class SystemTemplateMapper {
  static toDomain(row: system_template): SystemTemplateEntity {
    return SystemTemplateEntity.reconstitute(
      row.id,
      row.templateKey as SystemTemplateKey,
      row.content,
      row.createdAt,
      row.updatedAt,
    );
  }

  static versionToDomain(row: system_template_version): SystemTemplateVersionEntity {
    return SystemTemplateVersionEntity.reconstitute(
      row.id,
      row.templateId,
      row.content,
      row.versionNumber,
      row.createdBy,
      row.createdAt,
    );
  }
}
