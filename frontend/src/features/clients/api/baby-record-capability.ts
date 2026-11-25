export function parseBabyRecordCapability(data: unknown): { enabled: boolean } | null {
    if (data === null || typeof data !== "object" || !("enabled" in data) || typeof data.enabled !== "boolean") {
        return null;
    }
    return { enabled: data.enabled };
}
