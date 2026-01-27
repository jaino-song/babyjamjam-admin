import { SystemTemplateKey, TemplateVariable, CustomVariable } from 'domain/constants/system-template-registry';

export interface SystemTemplateWithRegistryDto {
  id: string;
  templateKey: SystemTemplateKey;
  name: string;
  description: string;
  content: string;
  requiredVariables: TemplateVariable[];
  customVariables: CustomVariable[];
  createdAt: Date;
  updatedAt: Date;
}
