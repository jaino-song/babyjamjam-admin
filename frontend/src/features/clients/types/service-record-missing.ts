export interface ServiceRecordMissingClients {
  count: number;
  recordCount?: number;
  items: Array<{
    clientId: number;
    caseId?: string;
    rank?: number | null;
    babyCount?: number | null;
    legacyName?: string | null;
    clientName: string;
    primaryEmployeeName: string;
    unwrittenThroughSessionIndex: number;
  }>;
}
