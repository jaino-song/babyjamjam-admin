import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { useSystemTemplates } from '@/features/system-templates/hooks/useSystemTemplates';
import type { SystemTemplate } from '@/features/system-templates/types';
import { useMessageTemplates } from '@/hooks/use-message-templates';
import { useBankAccountInfos, useVoucherPriceInfos, type BankAccountInfo, type VoucherPriceInfo } from '@/hooks/useVoucherData';

import { MessageMaker } from './MessageMaker';

jest.mock('next/navigation', () => ({ usePathname: () => '/messages/compose', useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/useGetAuthUser', () => ({ useGetAuthUser: jest.fn() }));
jest.mock('@/features/system-templates/hooks/useSystemTemplates', () => ({ useSystemTemplates: jest.fn() }));
jest.mock('@/hooks/use-message-templates', () => ({ useMessageTemplates: jest.fn() }));
jest.mock('@/hooks/useVoucherData', () => ({ useBankAccountInfos: jest.fn(), useVoucherPriceInfos: jest.fn() }));

const query = <T,>(data: T, loading = false, fetching = false) => ({
  data, isLoading: loading, isFetching: fetching, isError: false, isPlaceholderData: false,
  refetch: jest.fn().mockResolvedValue({ data, isError: false }),
});
const template = {
  id: 'PRICE_INFO', templateKey: 'PRICE_INFO', name: '비용 안내', content: '{{type}} {{duration}} {{bankName}}',
  group: 'mother', groupLabel: '산모', description: '', createdAt: '', updatedAt: '',
  requiredVariables: [
    { key: 'type', label: '바우처 유형', required: true, type: 'string' },
    { key: 'duration', label: '서비스 기간', required: true, type: 'string' },
  ], customVariables: [],
} as SystemTemplate;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
});

beforeEach(() => {
  jest.mocked(useGetAuthUser).mockReturnValue(query({ branchId: 'QA-branch', role: 'owner' }) as unknown as ReturnType<typeof useGetAuthUser>);
  jest.mocked(useSystemTemplates).mockReturnValue(query([template]) as unknown as ReturnType<typeof useSystemTemplates>);
  jest.mocked(useMessageTemplates).mockReturnValue(query([]) as unknown as ReturnType<typeof useMessageTemplates>);
});

it.each(['initial', 'refresh'] as const)('uses single inline statuses for price and account %s loading, then restores empty rows and loaded controls', async (phase) => {
  const prices = query<VoucherPriceInfo[]>([], phase === 'initial', phase === 'refresh');
  const accounts = query<BankAccountInfo[]>([], phase === 'initial', phase === 'refresh');
  jest.mocked(useVoucherPriceInfos).mockReturnValue(prices as unknown as ReturnType<typeof useVoucherPriceInfos>);
  jest.mocked(useBankAccountInfos).mockReturnValue(accounts as unknown as ReturnType<typeof useBankAccountInfos>);
  const view = render(<MessageMaker data-component="mobile_messages-compose_page" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: /바우처 유형/ }));
  await user.click(await screen.findByRole('option', { name: 'A가-1형' }));

  const rows = [
    { label: '비용 정보를 불러오는 중', empty: '선택한 유형과 연도의 비용 정보가 없습니다.', retry: '비용 정보 다시 시도' },
    { label: '계좌 정보를 불러오는 중', empty: '등록된 계좌 정보가 없습니다.', retry: '계좌 정보 다시 시도' },
  ].map(({ label, ...expected }) => {
    const status = screen.getByRole('status', { name: label });
    expect(status).toHaveAttribute('data-slot', 'loading-state');
    expect(status.tagName).toBe('SPAN');
    expect(status.querySelector('.sr-only')).toHaveTextContent(label);
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute('aria-hidden', 'true');
    const row = status.parentElement!;
    expect(row).not.toHaveAttribute('role');
    expect(within(row).getAllByRole('status')).toHaveLength(1);
    return { row, label, ...expected };
  });

  prices.isLoading = accounts.isLoading = false;
  prices.isFetching = accounts.isFetching = false;
  view.rerender(<MessageMaker data-component="mobile_messages-compose_page" />);
  for (const { row, label, empty, retry } of rows) {
    expect(screen.queryByRole('status', { name: label })).not.toBeInTheDocument();
    expect(row.querySelector('[data-slot="loading-state"]')).toBeNull();
    expect(row).toHaveAttribute('role', 'status');
    expect(row).toHaveTextContent(empty);
    expect(within(row).getByRole('button', { name: retry })).toBeEnabled();
  }

  prices.data = [{ id: 1, type: 'A가1형', duration: '5', fullPrice: '100', grant: '60', actualPrice: '40' }];
  accounts.data = [{ area: 'Namdonggu', bankName: 'QA-bank', accNum: 'QA-account' }];
  view.rerender(<MessageMaker data-component="mobile_messages-compose_page" />);
  for (const { row } of rows) expect(row).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /서비스 기간/ })).toBeEnabled();
  expect(screen.getByRole('combobox', { name: '지역' })).toBeEnabled();
  await user.click(screen.getByRole('combobox', { name: /서비스 기간/ }));
  expect(await screen.findByRole('option', { name: '5일' })).toBeInTheDocument();
});
