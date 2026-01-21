import { SystemTemplateKey, TemplateVariable } from 'domain/constants/system-template-registry';

export interface SystemTemplateWithRegistryDto {
  id: string;
  templateKey: SystemTemplateKey;
  name: string;
  description: string;
  content: string;
  requiredVariables: TemplateVariable[];
  createdAt: Date;
  updatedAt: Date;
}
