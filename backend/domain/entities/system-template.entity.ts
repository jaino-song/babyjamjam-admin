import { SystemTemplateKey } from '../constants/system-template-registry';

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

  validateVariables(requiredVariableKeys: string[]): VariableValidationResult {
    const contentVars = this.extractVariables();
    const requiredSet = new Set(requiredVariableKeys);
    const contentSet = new Set(contentVars);
    
    const missingVariables = requiredVariableKeys.filter(v => !contentSet.has(v));
    const unknownVariables = contentVars.filter(v => !requiredSet.has(v));
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

  static create(templateKey: SystemTemplateKey, content: string): SystemTemplateEntity {
    return new SystemTemplateEntity('', templateKey, content, new Date(), new Date());
  }

  static reconstitute(id: string, templateKey: SystemTemplateKey, content: string, createdAt: Date, updatedAt: Date): SystemTemplateEntity {
    return new SystemTemplateEntity(id, templateKey, content, createdAt, updatedAt);
  }
}
