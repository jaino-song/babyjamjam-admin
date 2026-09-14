import { z } from "zod";
export declare const SYSTEM_TEMPLATE_KEYS: readonly ["CLIENT_WELCOME", "SERVICE_START_REMINDER", "SERVICE_END_REMINDER", "EMPLOYEE_ASSIGNED", "PRICE_INFO", "GREETING", "THANKS", "SURVEY", "SERVICE_INFO", "SERVICE_RECORD_LINK", "SERVICE_END_NOTICE", "REMINDER", "INFO"];
export type SystemTemplateKey = (typeof SYSTEM_TEMPLATE_KEYS)[number];
/** Runtime key validation for system-template BFF route parameters. */
export declare const systemTemplateKeySchema: z.ZodEnum<{
    CLIENT_WELCOME: "CLIENT_WELCOME";
    SERVICE_START_REMINDER: "SERVICE_START_REMINDER";
    SERVICE_END_REMINDER: "SERVICE_END_REMINDER";
    EMPLOYEE_ASSIGNED: "EMPLOYEE_ASSIGNED";
    PRICE_INFO: "PRICE_INFO";
    GREETING: "GREETING";
    THANKS: "THANKS";
    SURVEY: "SURVEY";
    SERVICE_INFO: "SERVICE_INFO";
    SERVICE_RECORD_LINK: "SERVICE_RECORD_LINK";
    SERVICE_END_NOTICE: "SERVICE_END_NOTICE";
    REMINDER: "REMINDER";
    INFO: "INFO";
}>;
export declare const SYSTEM_TEMPLATE_DELIVERY_MODES: readonly ["sms", "service-feedback-link", "receipt-link"];
export type SystemTemplateDeliveryMode = (typeof SYSTEM_TEMPLATE_DELIVERY_MODES)[number];
/**
 * Keep the delivery path explicit for every backend registry key.  The
 * `satisfies` constraint makes adding a registry key without choosing a
 * delivery path a compile-time error instead of silently falling back to SMS.
 */
export declare const SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY: {
    CLIENT_WELCOME: "sms";
    SERVICE_START_REMINDER: "sms";
    SERVICE_END_REMINDER: "sms";
    EMPLOYEE_ASSIGNED: "sms";
    PRICE_INFO: "sms";
    GREETING: "sms";
    THANKS: "sms";
    SURVEY: "sms";
    SERVICE_INFO: "sms";
    SERVICE_RECORD_LINK: "service-feedback-link";
    SERVICE_END_NOTICE: "receipt-link";
    REMINDER: "sms";
    INFO: "sms";
};
/**
 * Resolve the delivery preparation path for a system template.
 *
 * SERVICE_RECORD_LINK and SERVICE_END_NOTICE are not generic SMS bodies: they
 * require a service-record link or a receipt link respectively. Every other
 * current system template is delivered as an ordinary SMS body.
 */
export declare function resolveSystemTemplateDeliveryMode(templateKey: SystemTemplateKey): SystemTemplateDeliveryMode;
export declare const getSystemTemplateDeliveryMode: typeof resolveSystemTemplateDeliveryMode;
export declare const resolveSystemTemplateDelivery: typeof resolveSystemTemplateDeliveryMode;
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
/**
 * Backend DTO-compatible request schemas.
 *
 * The production backend uses `forbidNonWhitelisted`, so these schemas reject
 * unknown top-level and nested fields instead of silently forwarding a body
 * that the backend will reject later. `data` remains an open record because
 * preview variables are intentionally caller-defined.
 */
export declare const customVariableSchema: z.ZodObject<{
    key: z.ZodString;
    label: z.ZodString;
    required: z.ZodBoolean;
}, z.core.$strict>;
export declare const updateSystemTemplateSchema: z.ZodObject<{
    content: z.ZodString;
    customVariables: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        required: z.ZodBoolean;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const validateSystemTemplateSchema: z.ZodObject<{
    content: z.ZodString;
}, z.core.$strict>;
export declare const previewSystemTemplateSchema: z.ZodObject<{
    content: z.ZodOptional<z.ZodString>;
    data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strict>;
export type UpdateSystemTemplateInput = z.infer<typeof updateSystemTemplateSchema>;
export type ValidateSystemTemplateInput = z.infer<typeof validateSystemTemplateSchema>;
export type PreviewSystemTemplateInput = z.infer<typeof previewSystemTemplateSchema>;
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
