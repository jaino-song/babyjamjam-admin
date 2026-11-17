export interface ServiceRecordMissingClients {
  count: number;
  items: Array<{
    clientId: number;
    clientName: string;
    primaryEmployeeName: string;
    unwrittenThroughSessionIndex: number;
  }>;
}
