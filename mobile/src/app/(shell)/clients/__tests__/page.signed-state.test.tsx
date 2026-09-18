import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type { Client } from "@/lib/client/types";
import ClientsPage from "../page";
import { useClient } from "@/hooks/useClients";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";

const mockClientDetailContent = jest.fn((props: { client: Client; contractDocument?: { id?: string } | null }) => (
  <div data-testid="client-detail-state">
    {props.client.hasSigned ? "signed" : "unsigned"}:{props.client.documentStatus ?? "none"}
  </div>
));
const mockQueryClient = {
  fetchQuery: jest.fn(),
  setQueryData: jest.fn(),
  invalidateQueries: jest.fn(),
};
let mockSearchParams = new URLSearchParams();
let mockCanonicalClient: Client | undefined;
let mockContractDocument: { id: string; current_status: { status_type: string } } | undefined;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockContractDocument }),
  useQueryClient: () => mockQueryClient,
}));

jest.mock("@/hooks/useClients", () => ({
  clientQueryKeys: {
    detail: (id: number) => ["clients", "detail", id],
    lists: () => ["clients", "list"],
  },
  fetchClient: jest.fn(),
  useClient: jest.fn(),
  useDeleteClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useInfiniteClients", () => ({
  useInfiniteClients: jest.fn(),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [] }),
}));

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 8,
    isInitialLoad: true,
    hasMore: false,
    sentinelRef: null,
    scrollContainerRef: null,
    loadMore: jest.fn(),
  }),
}));

jest.mock("@/hooks/useClientMessageHistory", () => ({
  useClientMessageHistory: () => ({
    notificationLogs: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("@/components/app/clients/ClientDetailModal", () => ({
  ClientDetailModal: () => null,
}));

jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
  MobileTwoButtonModal: () => null,
}));

jest.mock("@/components/app/clients/client-detail", () => ({
  GROUPS: [{
    key: "pre_booking",
    title: "예약 전",
    badge: "예약 전",
    badgeTone: "muted",
    badgeMini: "muted",
    match: () => true,
    counter: "명",
  }],
  ClientDetailContent: (props: { client: Client; contractDocument?: { id?: string } | null }) => {
    mockClientDetailContent(props);
    return (
      <div data-testid="client-detail-state">
        {props.client.hasSigned ? "signed" : "unsigned"}:{props.client.documentStatus ?? "none"}
      </div>
    );
  },
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: () => null,
  ListCountSkeleton: () => null,
  ListItemRow: () => null,
  ListLoadMoreSentinel: () => null,
  ListRowBadges: () => null,
  ListRowsSkeleton: () => null,
  MobileSectionNav: () => null,
}));

jest.mock("@/components/app/mobile-redesign/ClientRegistrationPolicySettings", () => ({
  ClientRegistrationPolicySettings: () => null,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ detail }: { detail: ReactNode }) => <>{detail}</>,
  MobileSearchBar: () => null,
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

jest.mock("@/lib/i18n/translations", () => ({
  t: (_locale: string, key: string) => key,
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn() },
}));

jest.mock("@/lib/client/list-helpers", () => ({
  buildAllClientRowsForList: (clients: Client[]) => clients,
  groupForClient: () => ({ badgeTone: "muted" }),
}));

jest.mock("@/lib/client/badges", () => ({
  getMobileClientBadges: () => [],
}));

jest.mock("@/lib/search/korean-search", () => ({
  matchesKoreanSearch: (value: string, query: string) => !query || value.includes(query),
}));

jest.mock("@/stores/form-store", () => ({
  useFormStore: (selector: (state: { prefillFromContract: jest.Mock }) => unknown) =>
    selector({ prefillFromContract: jest.fn() }),
}));

const clientsQuery = jest.mocked(useInfiniteClients);
const clientQuery = jest.mocked(useClient);

function clientFixture(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: "QA 계약 상태 고객",
    birthday: null,
    dueDate: null,
    birthDate: null,
    address: null,
    phone: "010-4350-2680",
    primaryEmployee: null,
    secondaryEmployee: null,
    type: "A통합1형",
    duration: 15,
    fullPrice: "100000",
    grant: "90000",
    actualPrice: "10000",
    startDate: "2026-09-20",
    endDate: "2026-10-04",
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    serviceStatus: "active",
    eDocId: "legacy-document-060",
    hasSigned: false,
    documentStatus: "requested",
    ...overrides,
  };
}

function renderWithLatestProjection(client: Client, pinnedDocumentStatus: string) {
  mockCanonicalClient = client;
  mockContractDocument = {
    id: client.eDocId ?? "legacy-document-060",
    current_status: { status_type: pinnedDocumentStatus },
  };
  mockSearchParams = new URLSearchParams(`id=${client.id}`);
  clientQuery.mockReturnValue({ data: mockCanonicalClient } as ReturnType<typeof useClient> extends infer T ? T : never);
  mockQueryClient.fetchQuery.mockResolvedValue(client);
  render(<ClientsPage />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  mockCanonicalClient = undefined;
  mockContractDocument = undefined;
  clientsQuery.mockReturnValue({
    allClients: [],
    allFilteredClients: [],
    total: 0,
    isLoading: false,
    isFetching: false,
  } as unknown as ReturnType<typeof useInfiniteClients>);
});

describe("clients page canonical contract projection", () => {
  it("keeps latest signed state when the pinned document is an older unsigned 060", () => {
    const latestClient = clientFixture({ hasSigned: true, documentStatus: "requested" });

    renderWithLatestProjection(latestClient, "060");

    const latestProps = mockClientDetailContent.mock.calls.at(-1)?.[0];
    expect(latestProps?.client).toMatchObject({
      hasSigned: true,
      documentStatus: "requested",
    });
    expect(latestProps?.contractDocument).toMatchObject({
      id: "legacy-document-060",
      current_status: { status_type: "060" },
    });
    expect(screen.getByTestId("client-detail-state")).toHaveTextContent("signed:requested");
  });

  it("keeps latest unsigned state when the pinned document is an older completed 003", () => {
    const latestClient = clientFixture({ hasSigned: false, documentStatus: "requested" });

    renderWithLatestProjection(latestClient, "003");

    const latestProps = mockClientDetailContent.mock.calls.at(-1)?.[0];
    expect(latestProps?.client).toMatchObject({
      hasSigned: false,
      documentStatus: "requested",
    });
    expect(latestProps?.contractDocument).toMatchObject({
      id: "legacy-document-060",
      current_status: { status_type: "003" },
    });
    expect(screen.getByTestId("client-detail-state")).toHaveTextContent("unsigned:requested");
  });
});
