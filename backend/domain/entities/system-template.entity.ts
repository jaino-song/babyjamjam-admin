import { SystemTemplateKey, CustomVariable } from '../constants/system-template-registry';

export interface VariableValidationResult {
  valid: boolean;
  missingVariables: string[];
  unknownVariables: string[];
  syntaxErrors: string[];
}

export class SystemTemplateEntity {
  constructor(
    public readonly id: string,
    public readonly templateKey: SystemTemplateKey,
    public content: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public readonly customVariables: CustomVariable[] = [],
  ) {}

  updateContent(newContent: string): void {
    this.content = newContent;
    this.updatedAt = new Date();
  }

  extractVariables(): string[] {
    const regex = /\{\{\s*(\w+)\s*\}\}/g;
    const matches = Array.from(this.content.matchAll(regex));
    return [...new Set(matches.map(m => m[1]?.trim() ?? '').filter(Boolean))];
  }

  validateVariables(requiredVariableKeys: string[], customVariables?: CustomVariable[]): VariableValidationResult {
    const contentVars = this.extractVariables();
    const customVars = customVariables ?? this.customVariables;
    
    // Combine registry required keys with custom variable keys for allowed list
    const customVarKeys = customVars.map(cv => cv.key);
    const allowedKeys = new Set([...requiredVariableKeys, ...customVarKeys]);
    
    // Required custom variables (where required: true) should be included in missing check
    const requiredCustomVarKeys = customVars.filter(cv => cv.required).map(cv => cv.key);
    const allRequiredKeys = [...requiredVariableKeys, ...requiredCustomVarKeys];
    
    const contentSet = new Set(contentVars);
    
    const missingVariables = allRequiredKeys.filter(v => !contentSet.has(v));
    const unknownVariables = contentVars.filter(v => !allowedKeys.has(v));
    const syntaxErrors = this.findSyntaxErrors();
    
    return {
      valid: missingVariables.length === 0 && unknownVariables.length === 0 && syntaxErrors.length === 0,
      missingVariables,
      unknownVariables,
      syntaxErrors,
    };
  }

  private findSyntaxErrors(): string[] {
    const errors: string[] = [];
    const unclosedOpen = this.content.match(/\{\{(?![^{]*\}\})/g);
    if (unclosedOpen) {
      errors.push('템플릿에 닫히지 않은 {{ 가 있습니다');
    }
    return errors;
  }

  static create(templateKey: SystemTemplateKey, content: string, customVariables?: CustomVariable[]): SystemTemplateEntity {
    return new SystemTemplateEntity('', templateKey, content, new Date(), new Date(), customVariables ?? []);
  }

  static reconstitute(id: string, templateKey: SystemTemplateKey, content: string, createdAt: Date, updatedAt: Date, customVariables?: CustomVariable[]): SystemTemplateEntity {
    return new SystemTemplateEntity(id, templateKey, content, createdAt, updatedAt, customVariables ?? []);
  }
}
