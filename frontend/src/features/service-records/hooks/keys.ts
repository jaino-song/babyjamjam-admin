export const serviceRecordKeys = {
    all: ["service-records"] as const,
    clientOverviews: () => [...serviceRecordKeys.all, "client-overview"] as const,
    clientOverview: (clientId: number | null) =>
        [...serviceRecordKeys.clientOverviews(), clientId ?? "none"] as const,
};
