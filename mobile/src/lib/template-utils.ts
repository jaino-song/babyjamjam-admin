export function renderTemplate(content: string, data: Record<string, unknown>): string {
    return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
        return data[key] !== undefined ? String(data[key]) : match;
    });
}

export function extractVariables(content: string): string[] {
    const regex = /\{\{\s*(\w+)\s*\}\}/g;
    const matches = Array.from(content.matchAll(regex));
    return [...new Set(matches.map((m) => m[1]?.trim() ?? '').filter(Boolean))];
}
