export const serviceRecordKeys = {
    all: ["service-records"] as const,
    clientOverviews: () => [...serviceRecordKeys.all, "client-overview"] as const,
    clientOverview: (clientId: number | null, caseId?: string) =>
        [...serviceRecordKeys.clientOverviews(), clientId ?? "none", ...(caseId ? [caseId] : [])] as const,
    revisionHistories: () => [...serviceRecordKeys.all, "revision-history"] as const,
    revisionHistory: (clientId: number | null, caseId?: string) =>
        [...serviceRecordKeys.revisionHistories(), clientId ?? "none", ...(caseId ? [caseId] : [])] as const,
    revisionChangeLists: () => [...serviceRecordKeys.all, "revision-changes"] as const,
    revisionChanges: (clientId: number | null, revisionId: string | null, caseId?: string) =>
        [...serviceRecordKeys.revisionChangeLists(), clientId ?? "none", revisionId ?? "none", ...(caseId ? [caseId] : [])] as const,
    caregiverEditChangeLists: () => [...serviceRecordKeys.all, "caregiver-edit-changes"] as const,
    caregiverEditChanges: (clientId: number | null, editId: string | null, caseId?: string) =>
        [...serviceRecordKeys.caregiverEditChangeLists(), clientId ?? "none", editId ?? "none", ...(caseId ? [caseId] : [])] as const,
};
