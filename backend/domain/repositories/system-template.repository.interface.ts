import { SystemTemplateKey } from '../constants/system-template-registry';
import { SystemTemplateEntity } from '../entities/system-template.entity';
import { SystemTemplateVersionEntity } from '../entities/system-template-version.entity';

export const SYSTEM_TEMPLATE_REPOSITORY = Symbol('SYSTEM_TEMPLATE_REPOSITORY');

export interface ISystemTemplateRepository {
  findByKey(key: SystemTemplateKey): Promise<SystemTemplateEntity | null>;
  findAll(): Promise<SystemTemplateEntity[]>;
  save(template: SystemTemplateEntity): Promise<SystemTemplateEntity>;
  getVersionHistory(templateKey: SystemTemplateKey): Promise<SystemTemplateVersionEntity[]>;
  getVersionByNumber(templateKey: SystemTemplateKey, versionNumber: number): Promise<SystemTemplateVersionEntity | null>;
  createVersion(templateId: string, content: string, userId: string | null): Promise<SystemTemplateVersionEntity>;
}
