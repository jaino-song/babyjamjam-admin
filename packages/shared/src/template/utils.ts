import type { MessageTemplateVariable } from "../types/message";

const TEMPLATE_VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

function isPresentTemplateValue(value: unknown): boolean {
  if (value == null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

export function renderTemplate(
  content: string,
  data: Record<string, unknown>,
  fallbacks: readonly MessageTemplateVariable[] = [],
): string {
  const fallbackByKey = new Map(
    fallbacks.map((variable) => [variable.key, variable.fallback]),
  );

  return content.replace(TEMPLATE_VARIABLE_PATTERN, (match, rawKey: string) => {
    const key = rawKey.trim();
    const hasOwnValue = Object.prototype.hasOwnProperty.call(data, key);
    const value = hasOwnValue ? data[key] : undefined;

    if (isPresentTemplateValue(value)) return String(value);

    const fallback = fallbackByKey.get(key);
    if (isPresentTemplateValue(fallback)) return String(fallback);

    return match;
  });
}

export function extractVariables(content: string): string[] {
  const matches = Array.from(content.matchAll(TEMPLATE_VARIABLE_PATTERN));
  return [...new Set(matches.map((match) => match[1]?.trim() ?? "").filter(Boolean))];
}

export function getUnresolvedKeys(
  content: string,
  data: Record<string, unknown> = {},
  fallbacks: readonly MessageTemplateVariable[] = [],
): string[] {
  return extractVariables(renderTemplate(content, data, fallbacks));
}
