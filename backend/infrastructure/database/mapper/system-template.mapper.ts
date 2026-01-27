import { system_template, system_template_version } from '@prisma/client';
import { SystemTemplateKey, CustomVariable } from 'domain/constants/system-template-registry';
import { SystemTemplateEntity } from 'domain/entities/system-template.entity';
import { SystemTemplateVersionEntity } from 'domain/entities/system-template-version.entity';

export class SystemTemplateMapper {
  static toDomain(row: system_template): SystemTemplateEntity {
    // Parse customVariables from Prisma Json type
    const customVariables = this.parseCustomVariables(row.customVariables);
    
    return SystemTemplateEntity.reconstitute(
      row.id,
      row.templateKey as SystemTemplateKey,
      row.content,
      row.createdAt,
      row.updatedAt,
      customVariables,
    );
  }

  private static parseCustomVariables(jsonData: unknown): CustomVariable[] {
    // Type guard: Prisma Json can be null, array, or object
    if (!jsonData) return [];
    if (!Array.isArray(jsonData)) return [];
    
    // Validate each item matches CustomVariable shape
    return jsonData.filter((item): item is CustomVariable => {
      return (
        typeof item === 'object' &&
        item !== null &&
        'key' in item &&
        'label' in item &&
        'required' in item &&
        typeof item.key === 'string' &&
        typeof item.label === 'string' &&
        typeof item.required === 'boolean'
      );
    });
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
