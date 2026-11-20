import { api } from '@/lib/api/client';
import { clientsApi } from '../clients.api';

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn() } }));

const item = {
  clientId: 7, clientName: 'QA 고객', primaryEmployeeName: 'QA 제공인력',
  unwrittenThroughSessionIndex: 3,
};
const validBody = { count: 1, items: [item] };

beforeEach(() => jest.clearAllMocks());

describe('listServiceRecordMissing response parsing', () => {
  it.each([validBody, { count: 0, items: [] }])('accepts a valid body (%j)', async body => {
    const response = { data: body, status: 200 };
    jest.mocked(api.get).mockResolvedValue(response);
    await expect(clientsApi.listServiceRecordMissing()).resolves.toEqual(response);
    expect(api.get).toHaveBeenCalledWith('/clients/service-record-missing');
  });

  it.each([
    ['missing items', { count: 1 }],
    ['non-array items', { count: 1, items: {} }],
    ['string clientId', { count: 1, items: [{ ...item, clientId: '7' }] }],
    ['missing count', { items: [] }],
    ['list-shaped body', { data: [], total: 0 }],
    ['string count', { count: '1', items: [] }],
    ['NaN count', { count: NaN, items: [] }],
    ['infinite count', { count: Infinity, items: [] }],
    ['missing clientName', { count: 1, items: [{ clientId: 7, primaryEmployeeName: 'QA', unwrittenThroughSessionIndex: 3 }] }],
    ['non-string primaryEmployeeName', { count: 1, items: [{ ...item, primaryEmployeeName: null }] }],
    ['non-number session index', { count: 1, items: [{ ...item, unwrittenThroughSessionIndex: '3' }] }],
    ['null item', { count: 1, items: [null] }],
    ['null body', null],
  ])('rejects %s', async (_label, body) => {
    jest.mocked(api.get).mockResolvedValue({ data: body });
    await expect(clientsApi.listServiceRecordMissing()).rejects.toThrow(Error);
  });
});
