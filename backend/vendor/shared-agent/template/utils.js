"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = renderTemplate;
exports.extractVariables = extractVariables;
exports.getUnresolvedKeys = getUnresolvedKeys;
const TEMPLATE_VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;
function isPresentTemplateValue(value) {
    if (value == null)
        return false;
    return typeof value !== "string" || value.trim().length > 0;
}
function renderTemplate(content, data, fallbacks = []) {
    const fallbackByKey = new Map(fallbacks.map((variable) => [variable.key, variable.fallback]));
    return content.replace(TEMPLATE_VARIABLE_PATTERN, (match, rawKey) => {
        const key = rawKey.trim();
        const hasOwnValue = Object.prototype.hasOwnProperty.call(data, key);
        const value = hasOwnValue ? data[key] : undefined;
        if (isPresentTemplateValue(value))
            return String(value);
        const fallback = fallbackByKey.get(key);
        if (isPresentTemplateValue(fallback))
            return String(fallback);
        return match;
    });
}
function extractVariables(content) {
    const matches = Array.from(content.matchAll(TEMPLATE_VARIABLE_PATTERN));
    return [...new Set(matches.map((match) => match[1]?.trim() ?? "").filter(Boolean))];
}
function getUnresolvedKeys(content, data = {}, fallbacks = []) {
    return extractVariables(renderTemplate(content, data, fallbacks));
}
