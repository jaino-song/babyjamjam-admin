import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import ClientsPage from '@/app/(protected)/clients/page';
import { api } from '@/lib/api/client';
import { clientKeys } from '@/features/clients/hooks/keys';

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn() } }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/hooks/useGetAuthUser', () => ({
  useGetAuthUser: () => ({ data: { role: 'owner', branchRole: null } }),
}));
jest.mock('@/providers/LocaleProvider', () => ({ useLocale: () => 'ko' }));
jest.mock('@/features/clients/hooks/use-send-client-receipt', () => ({
  useSendClientReceipt: () => ({ isSending: false, sendReceipt: jest.fn() }),
}));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/features/clients/hooks/use-clients', () => ({
  ...jest.requireActual('@/features/clients/hooks/use-clients'),
  useClientDirectory: () => ({
    clients: [{ id: 7, name: 'QA 목록 고객', serviceStatus: 'waiting' }],
    data: {}, matchedTotal: 1, isBranchContextReady: true,
    isInitialLoading: false, isInitialError: false, hasStaleData: false,
  }),
  useClientListSummary: () => ({ isBranchContextReady: true }),
  useClient: () => ({ data: undefined }),
  useDeleteClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/client/badges', () => ({
  getClientAvatarBadge: () => null,
  getClientBadgeAvatarClassName: () => '',
  getClientBadges: () => [],
  getPrimaryClientBadge: () => undefined,
  prioritizeClientBadges: () => [],
}));
jest.mock('@/components/app/clients/ClientFormDialog', () => ({
  CLIENT_FORM_STEPPER_STEPS: [], ClientFormDialog: () => null, ClientFormPanel: () => null,
}));
jest.mock('@/components/app/clients/ClientDetailPanel', () => ({ ClientDetailPanel: () => null }));
jest.mock('@/components/app/clients/MaternityContractDialog', () => ({ MaternityContractDialog: () => null }));
jest.mock('@/components/app/clients/ClientDetailModal', () => ({ ClientDetailModal: () => null }));
jest.mock('@/components/app/clients/ServiceRecordLinkResetResultModal', () => ({ ServiceRecordLinkResetResultModal: () => null }));
jest.mock('@/components/app/service-record/ServiceRecordScheduleDialog', () => ({ ServiceRecordScheduleDialog: () => null }));
jest.mock('@/components/app/ui/automation-status-notice', () => ({ AutomationStatusNotice: () => null }));
jest.mock('@/components/app/ui/NotificationOneButtonModal', () => ({ NotificationOneButtonModal: () => null }));
jest.mock('@/components/app/contracts/ContractClientSelector', () => ({ canCreateNewContractDocument: () => false }));
jest.mock('@/components/app/v3', () => ({
  ...jest.requireActual('@/components/app/v3'),
  StatsBar: ({ trailing }: { trailing?: ReactNode }) => <>{trailing}</>,
}));

afterEach(() => { document.cookie = 'selected_branch_id=; max-age=0; path=/'; });

it('keeps the clients page and list visible without the card after a malformed missing-clients body', async () => {
  document.cookie = 'selected_branch_id=a; path=/';
  jest.mocked(api.get).mockResolvedValue({ data: { data: [], total: 0 } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>);

  await waitFor(() => expect(queryClient.getQueryState(clientKeys.serviceRecordMissing('a'))?.status).toBe('error'));
  expect(screen.getByRole('heading', { name: '고객 목록' })).toBeInTheDocument();
  expect(screen.getByText('QA 목록 고객')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '제공기록지 미작성 고객 보기' })).not.toBeInTheDocument();
  queryClient.clear();
});
