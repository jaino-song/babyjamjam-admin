export interface TemplateVariable {
    key: string;
    label: string;
    type: 'string' | 'number' | 'currency';
    required: boolean;
    description?: string;
}

export interface CustomVariable {
    key: string;
    label: string;
    required: boolean;
}

export interface SystemTemplate {
    id: string;
    templateKey: string;
    name: string;
    description: string;
    content: string;
    requiredVariables: TemplateVariable[];
    customVariables: CustomVariable[];
    updatedAt: string;
}

export interface VersionHistoryItem {
    versionNumber: number;
    createdAt: string;
    createdBy: string | null;
}

export interface VersionDetail extends VersionHistoryItem {
    content: string;
}

export interface ValidationResult {
    valid: boolean;
    missingVariables: string[];
    unknownVariables: string[];
    syntaxErrors: string[];
}
