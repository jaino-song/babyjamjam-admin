import { SystemTemplateKey, SystemTemplateGroup, TemplateVariable, CustomVariable } from 'domain/constants/system-template-registry';

export interface SystemTemplateWithRegistryDto {
  id: string;
  templateKey: SystemTemplateKey;
  name: string;
  group: SystemTemplateGroup;
  groupLabel: string;
  description: string;
  content: string;
  requiredVariables: TemplateVariable[];
  customVariables: CustomVariable[];
  createdAt: Date;
  updatedAt: Date;
}
