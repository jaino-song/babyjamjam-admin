export declare const SYSTEM_TEMPLATE_KEYS: readonly ["PRICE_INFO", "GREETING", "THANKS", "SURVEY", "SERVICE_INFO", "SERVICE_RECORD_LINK", "SERVICE_END_NOTICE", "REMINDER", "INFO"];
export type SystemTemplateKey = (typeof SYSTEM_TEMPLATE_KEYS)[number];
export type TemplateVariableType = 'string' | 'number' | 'currency';
export interface TemplateVariable {
    key: string;
    label: string;
    type: TemplateVariableType;
    required: boolean;
    description?: string;
}
export interface CustomVariable {
    key: string;
    label: string;
    required: boolean;
}
export interface SystemTemplateContract {
    key: SystemTemplateKey;
    name: string;
    description: string;
    requiredVariables: TemplateVariable[];
    defaultContent: string;
}
export interface RawSystemTemplateRecord {
    id: string;
    templateKey: SystemTemplateKey;
    content: string;
    customVariables: CustomVariable[];
    createdAt: Date;
    updatedAt: Date;
}
export interface SystemTemplateRecord {
    id: string;
    templateKey: SystemTemplateKey;
    content: string;
    customVariables: CustomVariable[];
    createdAt: string;
    updatedAt: string;
}
export interface RawSystemTemplate extends RawSystemTemplateRecord {
    name: string;
    description: string;
    requiredVariables: TemplateVariable[];
}
export interface SystemTemplate extends SystemTemplateRecord {
    name: string;
    description: string;
    requiredVariables: TemplateVariable[];
}
export interface UpdateSystemTemplateRequest {
    content: string;
    customVariables?: CustomVariable[];
}
export interface ValidateSystemTemplateRequest {
    content: string;
}
export interface PreviewSystemTemplateRequest {
    content?: string;
    data: Record<string, unknown>;
}
export interface SystemTemplateValidationResult {
    valid: boolean;
    missingVariables: string[];
    unknownVariables: string[];
    syntaxErrors: string[];
}
export interface RawSystemTemplateVersionRecord {
    id: string;
    templateId: string;
    content: string;
    versionNumber: number;
    createdBy: string | null;
    createdAt: Date;
}
export interface SystemTemplateVersionRecord {
    id: string;
    templateId: string;
    content: string;
    versionNumber: number;
    createdBy: string | null;
    createdAt: string;
}
export interface SystemTemplateVersionSummary {
    versionNumber: number;
    createdAt: string;
    createdBy: string | null;
}
export interface SystemTemplateVersionDetail extends SystemTemplateVersionSummary {
    content: string;
}
export type SystemTemplateListResponse = SystemTemplate[];
export type UpdateSystemTemplateResponse = SystemTemplateRecord;
export type ValidateSystemTemplateResponse = SystemTemplateValidationResult;
export type PreviewSystemTemplateResponse = string;
export type SystemTemplateVersionListResponse = SystemTemplateVersionSummary[];
export type SystemTemplateVersionDetailResponse = SystemTemplateVersionDetail;
export type RollbackSystemTemplateResponse = SystemTemplateRecord;
export type ResetSystemTemplateResponse = SystemTemplateRecord;
