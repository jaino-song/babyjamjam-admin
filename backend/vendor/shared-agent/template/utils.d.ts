import type { MessageTemplateVariable } from "../types/message";
export declare function renderTemplate(content: string, data: Record<string, unknown>, fallbacks?: readonly MessageTemplateVariable[]): string;
export declare function extractVariables(content: string): string[];
export declare function getUnresolvedKeys(content: string, data?: Record<string, unknown>, fallbacks?: readonly MessageTemplateVariable[]): string[];
