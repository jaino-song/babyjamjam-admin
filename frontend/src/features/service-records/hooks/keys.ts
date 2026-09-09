export const serviceRecordKeys = {
    all: ["service-records"] as const,
    clientOverviews: () => [...serviceRecordKeys.all, "client-overview"] as const,
    clientOverview: (clientId: number | null) =>
        [...serviceRecordKeys.clientOverviews(), clientId ?? "none"] as const,
    revisionHistories: () => [...serviceRecordKeys.all, "revision-history"] as const,
    revisionHistory: (clientId: number | null) =>
        [...serviceRecordKeys.revisionHistories(), clientId ?? "none"] as const,
};
