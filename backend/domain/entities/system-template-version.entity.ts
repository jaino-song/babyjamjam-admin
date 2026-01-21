export class SystemTemplateVersionEntity {
  constructor(
    public readonly id: string,
    public readonly templateId: string,
    public readonly content: string,
    public readonly versionNumber: number,
    public readonly createdBy: string | null,
    public readonly createdAt: Date,
  ) {}

  static create(templateId: string, content: string, versionNumber: number, createdBy: string | null): SystemTemplateVersionEntity {
    return new SystemTemplateVersionEntity('', templateId, content, versionNumber, createdBy, new Date());
  }

  static reconstitute(id: string, templateId: string, content: string, versionNumber: number, createdBy: string | null, createdAt: Date): SystemTemplateVersionEntity {
    return new SystemTemplateVersionEntity(id, templateId, content, versionNumber, createdBy, createdAt);
  }
}
