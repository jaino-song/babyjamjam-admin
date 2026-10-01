import fs from "node:fs";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";

const mockRouter = { replace: jest.fn(), push: jest.fn() };
let mockSearchParams = new URLSearchParams();
const mockDirectory = jest.fn();
const mockListSummary = jest.fn();
let mockActiveBranchId = "branch-a";
let mockClientFromParam: { id: number; name: string } | undefined;
const mockQueryClient = {
  cancelQueries: jest.fn(),
  getQueryData: jest.fn(),
  invalidateQueries: jest.fn(),
  setQueryData: jest.fn(),
};
const mockCreatedClient = { id: 901, name: "새로 등록한 고객" };
let mockDirectoryState: Record<string, unknown>;

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => mockQueryClient,
}));

jest.mock("use-debounce", () => ({
  useDebounce: <T,>(value: T) => [value],
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { role: "owner", branchRole: null },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

jest.mock("@/features/system-templates/branch-context", () => ({
  useActiveBranchId: () => mockActiveBranchId,
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
  useClientDirectory: () => mockDirectory(),
  useClientListSummary: () => mockListSummary(),
  useDeleteClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useClient: () => ({ data: mockClientFromParam, isBranchContextReady: mockActiveBranchId !== null }),
}));

jest.mock("@/features/clients/hooks/use-send-client-receipt", () => ({
  useSendClientReceipt: () => ({ isSending: false, sendReceipt: jest.fn() }),
}));

jest.mock("@/features/service-records/api/service-records.api", () => ({
  serviceRecordsApi: {
    applyScheduleChange: jest.fn(),
    getClientOverview: jest.fn(),
    previewScheduleChange: jest.fn(),
    resetLink: jest.fn(),
  },
}));

jest.mock("@/features/service-records/utils/schedule-change-error", () => ({
  getScheduleChangeErrorMessage: () => "일정 변경에 실패했어요",
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/lib/client/badges", () => ({
  getClientBadgeAvatarClassName: () => "",
  getClientBadges: () => [],
  getPrimaryClientBadge: () => undefined,
  prioritizeClientBadges: () => [],
}));

jest.mock("@/components/app/clients/ClientFormDialog", () => ({
  CLIENT_FORM_STEPPER_STEPS: [
    { label: "이용자 정보" },
    { label: "제공인력 정보" },
    { label: "바우처 정보" },
    { label: "계약 정보" },
  ],
  ClientFormDialog: () => null,
  ClientFormPanel: ({
    onBeforeClose,
    onClose,
    onDirtyChange,
    onSuccess,
  }: {
    onBeforeClose?: () => boolean;
    onClose: () => void;
    onDirtyChange?: (dirty: boolean) => void;
    onSuccess?: (client: typeof mockCreatedClient) => void;
  }) => (
    <div data-testid="client-form-panel">
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        입력 시작
      </button>
      <button
        type="button"
        onClick={() => {
          if (onBeforeClose && !onBeforeClose()) return;
          onClose();
        }}
      >
        고객 추가 취소
      </button>
      <button
        type="button"
        onClick={() => {
          onSuccess?.(mockCreatedClient);
          onClose();
        }}
      >
        고객 저장
      </button>
    </div>
  ),
}));

jest.mock("@/components/app/clients/MaternityContractDialog", () => ({
  MaternityContractDialog: () => null,
}));

jest.mock("@/components/app/contracts/ContractClientSelector", () => ({
  canCreateNewContractDocument: () => false,
}));

jest.mock("@/components/app/clients/ClientDetailPanel", () => ({
  ClientDetailPanel: ({ client }: { client: { name: string } }) => (
    <div data-testid="client-detail">{client.name}</div>
  ),
}));

jest.mock("@/components/app/clients/client-display", () => ({
  getClientDisplayLabel: (label: string) => label,
}));

jest.mock("@/components/app/ui/TwoButtonModal", () => ({
  TwoButtonModal: ({
    approvalLabel,
    onApprove,
    open,
    title,
  }: {
    approvalLabel: ReactNode;
    onApprove: () => void;
    open: boolean;
    title: ReactNode;
  }) => open ? (
    <div role="alertdialog">
      <h2>{title}</h2>
      <button type="button" onClick={onApprove}>{approvalLabel}</button>
    </div>
  ) : null,
}));

jest.mock("@/components/app/ui/automation-status-notice", () => ({
  AutomationStatusNotice: () => null,
}));

jest.mock("@/components/app/ui/NotificationOneButtonModal", () => ({
  NotificationOneButtonModal: () => null,
}));

jest.mock("@/components/app/clients/ClientDetailModal", () => ({
  ClientDetailModal: () => null,
}));

jest.mock("@/components/app/clients/ServiceRecordLinkResetResultModal", () => ({
  ServiceRecordLinkResetResultModal: () => null,
}));

jest.mock("@/components/app/clients/ServiceScheduleChangeModal", () => ({
  ServiceScheduleChangeModal: () => null,
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/lib/i18n/translations", () => ({
  t: (_locale: string, key: string) => ({
    "clients.add": "고객 추가",
    "clients.no-data": "고객이 없습니다",
    "clients.search-placeholder": "고객 검색",
  }[key] ?? key),
}));

jest.mock("@/components/ui/skeleton", () => ({ Skeleton: () => <div /> }));

jest.mock("@/components/ui/alert", () => ({
  Alert: ({ children, ...props }: { children: ReactNode }) => <div role="alert" {...props}>{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => <button {...props}>{children}</button>,
}));

jest.mock("@/components/ui/switch", () => ({ Switch: () => null }));

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/app/v3", () => ({
  AnimatedSlotList: ({
    isLoading,
    items = [],
    onSlotClick,
    render: renderItem,
  }: {
    isLoading?: boolean;
    items?: Array<{ id: number }>;
    onSlotClick?: (item: { id: number }) => void;
    render: (props: { item: { id: number }; isLoading: boolean }) => ReactNode;
  }) => (
    <div>
      {isLoading ? null : items.map((item) => (
        <button key={item.id} type="button" onClick={() => onSlotClick?.(item)}>
          {renderItem({ item, isLoading: false })}
        </button>
      ))}
    </div>
  ),
  AnimatedSlotListItemContent: ({ title }: { title: ReactNode }) => <span>{title}</span>,
  DetailPanel: ({ children, overlay }: { children?: ReactNode; overlay?: ReactNode }) => <div>{overlay}{children}</div>,
  EmptyState: ({ message }: { message: ReactNode }) => <div>{message}</div>,
  HeaderActionButton: ({ label, onClick }: { label: ReactNode; onClick: () => void }) => <button type="button" onClick={onClick}>{label}</button>,
  InfoCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListEmptyState: ({ message }: { message: ReactNode }) => <div>{message}</div>,
  ListPanel: ({ children, emptyState, headerActions, subHeader, subtitle, title }: { children: ReactNode; emptyState?: ReactNode; headerActions?: ReactNode; subHeader?: ReactNode; subtitle?: ReactNode; title: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {subtitle ? <div data-testid="clients-list-subtitle">{subtitle}</div> : null}
      {headerActions}
      {subHeader}
      {emptyState}
      {children}
    </section>
  ),
  PageSection: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SectionNav: ({ items, onSelect }: { items: Array<{ id: string; label: string }>; onSelect: (id: string) => void }) => (
    <nav>{items.map((item) => <button key={item.id} type="button" onClick={() => onSelect(item.id)}>{item.label}</button>)}</nav>
  ),
  SplitLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StatsBar: () => null,
  StatusBadge: () => null,
  SteppedWizardStepper: () => null,
}));

jest.mock("@/lib/phone", () => ({
  formatKoreanPhoneNumber: (phone: string) => phone,
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getClientRegistrationPolicy: jest.fn(),
    updateClientRegistrationPolicy: jest.fn(),
  },
}));

afterEach(() => {
  mockActiveBranchId = "branch-a";
  mockClientFromParam = undefined;
});

const source = fs.readFileSync(require.resolve("./page"), "utf8");
const formSource = fs.readFileSync(
  require.resolve("../../../components/app/clients/ClientFormDialog"),
  "utf8",
);

describe("ClientsPage deletion conflicts", () => {
  it("should close the confirmation optimistically before awaiting deletion", () => {
    const handler = source.slice(
      source.indexOf("const handleDeleteConfirm"),
      source.indexOf("const clearSelectedClientScheduleChange"),
    );

    expect(handler).toContain("setDeleteTargetClientId(null)");
    expect(handler).toContain("await deleteClient.mutateAsync");
    expect(handler.indexOf("setDeleteTargetClientId(null)")).toBeLessThan(
      handler.indexOf("await deleteClient.mutateAsync"),
    );
    // The delete failure resolves through the problem contract — the verified
    // catalog copy or the locally authored fallback; the legacy message
    // adapter is gone.
    expect(handler).toContain("normalizeApiError");
    expect(handler).toContain('"고객 삭제에 실패했어요. 다시 시도해 주세요."');
    expect(handler).not.toContain("getApiErrorMessage");
    expect(source).toContain('data-component="desktop_clients_modals_delete-error-notification"');
  });
});

describe("ClientsPage visual conventions", () => {
  it("renders overflow client statuses as plain text instead of a badge", () => {
    expect(source).toContain(
      'data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content_item_status-more"',
    );
    expect(source).toContain("+{remainingClientBadges.length}");
    const overflowStatus = source.slice(
      source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content_item_status-more"') - 80,
      source.indexOf("+{remainingClientBadges.length}") + 40,
    );
    expect(overflowStatus).toContain("<span");
    expect(overflowStatus).not.toContain("StatusPill");
  });

  it("uses the people icon for the empty client list", () => {
    expect(source).toContain(
      '<ListEmptyState icon={Users} message={t(locale, "clients.no-data")} />',
    );
  });

  it("uses the destructive dropdown variant for delete", () => {
    const deleteMenuItem = source.slice(
      source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_delete"'),
      source.indexOf("</DropdownMenuItem>", source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_delete"')),
    );

    expect(deleteMenuItem).toContain('variant="destructive"');
  });

  it("opens the read-only service-record editor from the customer menu", () => {
    const marker = source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_view-service-record"');
    const menuItem = source.slice(
      source.lastIndexOf("<DropdownMenuItem", marker),
      source.indexOf("</DropdownMenuItem>", marker),
    );

    expect(menuItem).toContain("asChild");
    expect(menuItem).toContain("제공기록지 보기");
    expect(menuItem).toContain('target="_blank"');
    expect(menuItem).toContain('rel="noopener noreferrer"');
    expect(menuItem).toContain("encodeURIComponent");
  });
});

describe("ClientsPage directory and summary contracts", () => {
  it("uses the server-paginated directory and independent summary hooks", () => {
    expect(source).toContain("useClientDirectory");
    expect(source).toContain("useClientListSummary");
    expect(source).toContain("limit: 20");
    expect(source).toContain("tab: activeFilter");
    expect(source).toContain("search: debouncedSearchQuery || undefined");
    expect(source).not.toContain("useClients(1, 50)");
    expect(source).not.toContain("matchesSearchQuery");
    expect(source).not.toContain("const filteredClients");
  });

  it("renders no list-panel subtitle and reaches the final page", () => {
    expect(source).not.toContain("listScopeSubtitle");
    expect(source).not.toContain("일치 ${matchedTotal}명");
    expect(source).not.toContain('data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_scope_count"');
    expect(source).toContain("hasMore={Boolean(directory.hasNextPage && !directory.isNextPageError)}");
    expect(source).toContain("onLoadMore={() => void directory.fetchNextPage()}");
    expect(source).toContain("isFetchingMore={directory.isFetchingNextPage}");
    expect(source).toContain("directory.isNextPageError");
    expect(source).toContain("directory.isEndOfList");
  });

  it("labels summary scope and dueDate months", () => {
    expect(source).toContain("이번 달 출산 예정");
    expect(source).toContain("다음 달 출산 예정");
    expect(source).toContain("서비스 종료 예정");
    expect(source).not.toContain("이번달 dueDate");
    expect(source).not.toContain("다음달 dueDate");
    expect(source).toContain("summaryScopeLabel");
    expect(source).not.toContain('data-component="desktop_clients_summary_scope"');
    expect(source).toContain('thisMonthCount: summary?.dueDate.thisMonth ?? "—"');
  });

  it("distinguishes unavailable, initial, refresh, and next-page failures from a real empty result", () => {
    expect(source).toContain("isDirectoryUnavailable");
    expect(source).toContain("isLoading={isDirectoryInitialLoading}");
    expect(source).toContain("현재 지점 정보를 확인한 뒤 다시 시도해 주세요.");
    expect(source).toContain("isDirectoryInitialError");
    expect(source).toContain("directory.hasStaleData");
    expect(source).toContain("listSummary.isInitialError");
    expect(source).toContain("listSummary.isRefreshError");
    expect(source).toContain("directory.isSuccessfulEmpty");
    expect(source).toContain('aria-label="고객 목록 다시 시도"');
    expect(source).toContain('aria-label="고객 목록 더 불러오기 다시 시도"');
  });
});

describe("ClientsPage selection and draft transitions", () => {
  it("clears URL selection sources and selection on a different tab", () => {
    expect(source).toContain("const handleFilterChange");
    expect(source).toContain("applyFilterChange(normalizedFilter)");
    expect(source).toContain("clearClientSelectionSources");
    expect(source).toContain("urlSelectionSuppressed");
    expect(source).toContain("effectiveClientIdParam");
    expect(source).toContain("effectiveOpenClientForm");
    expect(source).toContain("setUrlSelectionSuppressed(true)");
    expect(source).toContain('router.replace("/clients")');
    expect(source).toContain("setSelectedClient(null)");
    expect(source).toContain("onBack={handleCompactBack}");
  });

  it("guards repeated add and all dirty panel transitions with a two-button discard modal", () => {
    expect(source).toContain("if (shouldShowClientFormPanel) return;");
    expect(source).toContain("onBeforeClose={handleFormPanelBeforeClose}");
    expect(source).toContain("onDirtyChange={handleCreateFormDirtyChange}");
    expect(source).toContain("pendingCreateDiscard");
    expect(source).toContain('data-component="desktop_clients_modals_create-discard-approval"');
    expect(source).toContain("onApprove={handleDiscardCreateDraft}");
    expect(source).toContain("setPendingCreateDiscard({ type: \"filter\"");
    expect(source).toContain("setPendingCreateDiscard({ type: \"select\"");
    expect(source).toContain("setPendingCreateDiscard({ type: \"back\" }");
    expect(source).toContain("setPendingCreateDiscard({ type: \"close\" }");
  });

  it("exports dirty tracking and intercepts close before the form resets", () => {
    expect(formSource).toContain("onDirtyChange?: (dirty: boolean) => void");
    expect(formSource).toContain("onBeforeClose?: () => boolean");
    expect(formSource).toContain("formDataBaselineRef");
    expect(formSource).toContain("JSON.stringify(formData) !== JSON.stringify(formDataBaselineRef.current)");
    expect(formSource).toContain("if (onBeforeClose && !onBeforeClose()) {");
    expect(formSource).toContain("return;");
    expect(formSource.indexOf("if (onBeforeClose && !onBeforeClose())")).toBeLessThan(
      formSource.indexOf("setPendingDurationConfirmation(null);", formSource.indexOf("if (onBeforeClose && !onBeforeClose())")),
    );
  });
});

describe("ClientsPage directory subtitle behavior", () => {
  let ClientsPage: ComponentType;

  beforeAll(async () => {
    const pageModule = await import("./page");
    ClientsPage = pageModule.default as ComponentType;
  });

  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockRouter.replace.mockReset();
    mockDirectory.mockReset();
    mockListSummary.mockReset();
    mockListSummary.mockReturnValue({
      data: undefined,
      isBranchContextReady: true,
      isInitialError: false,
      isInitialLoading: false,
      isRefreshError: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderClientsPage(overrides: Record<string, unknown> = {}) {
    mockDirectoryState = {
      clients: [],
      data: undefined,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      hasStaleData: false,
      isBranchContextReady: true,
      isEndOfList: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isInitialError: false,
      isInitialLoading: false,
      isNextPageError: false,
      isRefetchError: false,
      isRefreshError: false,
      isSuccessfulEmpty: false,
      matchedTotal: 0,
      refetch: jest.fn(),
      ...overrides,
    };
    mockDirectory.mockImplementation(() => mockDirectoryState);
    return render(<ClientsPage />);
  }

  it("does not render a list subtitle while pending, empty, or populated", () => {
    const { rerender } = renderClientsPage({ isInitialLoading: true });

    expect(screen.queryByTestId("clients-list-subtitle")).not.toBeInTheDocument();

    mockDirectoryState = {
      ...mockDirectoryState,
      data: { pages: [{ data: [], total: 0 }] },
      isInitialLoading: false,
      isSuccessfulEmpty: true,
    };
    rerender(<ClientsPage />);

    expect(screen.queryByTestId("clients-list-subtitle")).not.toBeInTheDocument();

    mockDirectoryState = {
      ...mockDirectoryState,
      clients: [{ id: 1, name: "기존 고객" }],
      data: { pages: [{ data: [{ id: 1, name: "기존 고객" }], total: 4 }] },
      isSuccessfulEmpty: false,
      matchedTotal: 4,
    };
    rerender(<ClientsPage />);

    expect(screen.queryByTestId("clients-list-subtitle")).not.toBeInTheDocument();
  });

  it("shows the cached-data alert without a subtitle when a same-scope refresh fails", () => {
    renderClientsPage({
      clients: [{ id: 1, name: "기존 고객" }],
      data: { pages: [{ data: [{ id: 1, name: "기존 고객" }], total: 4 }] },
      hasStaleData: true,
      isRefetchError: true,
      isRefreshError: true,
      matchedTotal: 4,
    });

    expect(screen.queryByTestId("clients-list-subtitle")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("최근에 확인된 목록을 표시하고 있어요");
  });

  it("does not render a URL-selected detail from branch A after a cross-tab branch switch to B", () => {
    mockSearchParams = new URLSearchParams("id=7");
    mockClientFromParam = { id: 7, name: "지점 A 고객" };

    const { rerender } = renderClientsPage({
      clients: [],
      data: { pages: [{ data: [], total: 0 }] },
    });

    expect(screen.getByTestId("client-detail")).toHaveTextContent("지점 A 고객");

    mockActiveBranchId = "branch-b";
    rerender(<ClientsPage />);

    expect(screen.queryByTestId("client-detail")).not.toBeInTheDocument();
  });

  it("keeps normal same-branch URL selection visible", () => {
    mockSearchParams = new URLSearchParams("id=8");
    mockClientFromParam = { id: 8, name: "지점 A 고객 2" };

    renderClientsPage({
      clients: [],
      data: { pages: [{ data: [], total: 0 }] },
    });

    expect(screen.getByTestId("client-detail")).toHaveTextContent("지점 A 고객 2");
  });
});

describe("ClientsPage create selection behavior", () => {
  let ClientsPage: ComponentType;

  beforeAll(async () => {
    const pageModule = await import("./page");
    ClientsPage = pageModule.default as ComponentType;
  });

  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockRouter.replace.mockReset();
    mockDirectory.mockReset();
    mockDirectory.mockReturnValue({
      clients: [],
      data: { pages: [{ data: [], total: 0 }] },
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      hasStaleData: false,
      isBranchContextReady: true,
      isEndOfList: true,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isInitialError: false,
      isInitialLoading: false,
      isNextPageError: false,
      isRefetchError: false,
      isRefreshError: false,
      isSuccessfulEmpty: true,
      matchedTotal: 0,
      refetch: jest.fn(),
    });
    mockListSummary.mockReturnValue({
      data: undefined,
      isBranchContextReady: true,
      isInitialError: false,
      isInitialLoading: false,
      isRefreshError: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the newly created detail selected through onSuccess then onClose", () => {
    render(<ClientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "고객 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "고객 저장" }));

    expect(screen.queryByTestId("client-form-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("client-detail")).toHaveTextContent("새로 등록한 고객");
  });

  it("clears the create panel and selection on an ordinary cancel close", () => {
    render(<ClientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "고객 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "고객 추가 취소" }));

    expect(screen.queryByTestId("client-form-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("client-detail")).not.toBeInTheDocument();
    expect(screen.getByText("고객을 선택하면 상세 정보가 표시됩니다")).toBeInTheDocument();
  });

  it("keeps dirty cancel and discard on the clearing path", () => {
    render(<ClientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "고객 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "입력 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "고객 추가 취소" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent("작성 중인 고객 정보를 버리시겠습니까?");
    fireEvent.click(screen.getByRole("button", { name: "버리기" }));

    expect(screen.queryByTestId("client-form-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("client-detail")).not.toBeInTheDocument();
    expect(screen.getByText("고객을 선택하면 상세 정보가 표시됩니다")).toBeInTheDocument();
  });
});
