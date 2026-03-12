export function renderTemplate(content: string, data: Record<string, unknown>): string {
    return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
        const value = data[key];

        if (value == null) {
            return match;
        }

        if (typeof value === "string" && value.trim().length === 0) {
            return match;
        }

        return String(value);
    });
}

export function extractVariables(content: string): string[] {
    const regex = /\{\{\s*(\w+)\s*\}\}/g;
    const matches = Array.from(content.matchAll(regex));
    return [...new Set(matches.map((m) => m[1]?.trim() ?? '').filter(Boolean))];
}
