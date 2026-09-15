import { act, renderHook } from '@testing-library/react';

import { eformsignApi } from '@/services/api';

import { useSendClientReceipt } from './use-send-client-receipt';

const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/services/api', () => ({
  eformsignApi: { prepareReceiptLink: jest.fn(), sendReceiptLink: jest.fn() },
}));

const prepare = jest.mocked(eformsignApi.prepareReceiptLink);
const send = jest.mocked(eformsignApi.sendReceiptLink);
const preparation = {
  clientId: 117, clientName: '테스트 산모', recipientPhone: '01000000000',
  documentId: 'receipt-document', receiptUrl: 'https://example.test/receipt', expiresAt: '2026-10-16',
};

describe('useSendClientReceipt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prepare.mockResolvedValue(preparation);
    send.mockResolvedValue({ jobId: 'job-1', scheduledFor: '2026-09-16', clientName: preparation.clientName });
  });

  it('prepares the clicked client and queues the existing receipt message with identity pins', async () => {
    const { result } = renderHook(() => useSendClientReceipt());
    await act(async () => { await result.current.sendReceipt(117); });
    expect(prepare).toHaveBeenCalledWith(117);
    expect(send).toHaveBeenCalledWith('receipt-document', { clientId: 117, recipientPhone: '01000000000' });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: '본인부담금 영수증 발송 예약' }));
    expect(result.current.isSending).toBe(false);
  });

  it('does not send when preparation belongs to another client', async () => {
    prepare.mockResolvedValue({ ...preparation, clientId: 118 });
    const { result } = renderHook(() => useSendClientReceipt());
    await act(async () => { await result.current.sendReceipt(117); });
    expect(send).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('blocks duplicate clicks while preparation is pending and keeps the clicked client authoritative', async () => {
    let resolve!: (value: typeof preparation) => void;
    prepare.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useSendClientReceipt());
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendReceipt(117); });
    expect(result.current.isSending).toBe(true);
    await act(async () => { await result.current.sendReceipt(118); });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    await act(async () => { resolve(preparation); await pending; });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('receipt-document', { clientId: 117, recipientPhone: '01000000000' });
  });

  it('shows the existing eligibility error without sending and permits retry', async () => {
    prepare.mockRejectedValueOnce({ response: { data: { reason: 'contract_not_signed' } } });
    const { result } = renderHook(() => useSendClientReceipt());
    await act(async () => { await result.current.sendReceipt(117); });
    expect(send).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ description: '계약서 서명이 완료된 후 발송할 수 있어요.' }));
    expect(result.current.isSending).toBe(false);
    await act(async () => { await result.current.sendReceipt(117); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports send failure without claiming success or retrying automatically', async () => {
    send.mockRejectedValueOnce(new Error('network unavailable'));
    const { result } = renderHook(() => useSendClientReceipt());
    await act(async () => { await result.current.sendReceipt(117); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(result.current.isSending).toBe(false);
  });
});
