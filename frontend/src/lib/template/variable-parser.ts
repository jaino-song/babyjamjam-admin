export const extractVariables = (content: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = Array.from(content.matchAll(regex));
    return [...new Set(matches.map(m => m[1]?.trim() ?? "").filter(Boolean))];
};

export const renderTemplate = (content: string, values: Record<string, string>): string => {
    let rendered = content;
    const keys = Object.keys(values);
    
    for (const key of keys) {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
        rendered = rendered.replace(regex, values[key] || `{{${key}}}`);
    }
    
    return rendered;
};
