import type { ServiceRecordMissingClients } from '../types/service-record-missing';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isServiceRecordMissingClients(value: unknown): value is ServiceRecordMissingClients {
  return isRecord(value)
    && typeof value.count === 'number'
    && Number.isFinite(value.count)
    && Array.isArray(value.items)
    && value.items.every(item => isRecord(item)
      && typeof item.clientId === 'number'
      && typeof item.clientName === 'string'
      && typeof item.primaryEmployeeName === 'string'
      && typeof item.unwrittenThroughSessionIndex === 'number');
}

export function parseServiceRecordMissingClients(value: unknown): ServiceRecordMissingClients {
  if (!isServiceRecordMissingClients(value)) {
    throw new Error('Invalid service-record-missing response');
  }
  return value;
}
