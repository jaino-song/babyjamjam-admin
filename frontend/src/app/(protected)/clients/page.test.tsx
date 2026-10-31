import fs from "node:fs";
import { fireEvent, render, screen, cleanup, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";

const mockRouter = { replace: jest.fn(), push: jest.fn() };
let mockSearchParams = new URLSearchParams();
const mockDirectory = jest.fn();
const mockListSummary = jest.fn();
let mockActiveBranchId = "branch-a";
let mockClientFromParam: { id: number; name: string } | undefined;
const mockClientRefetch = jest.fn();
const IDLE_MOCK_CLIENT_QUERY = { isError: false, isFetching: false, isPaused: false, isLoading: false };
let mockClientQueryState: { isError: boolean; isFetching: boolean; isPaused: boolean; isLoading: boolean } = IDLE_MOCK_CLIENT_QUERY;
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

let mockAuthUser: { role: string; branchRole: string | null } = { role: "owner", branchRole: null };

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: mockAuthUser,
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
  useClient: () => ({
    data: mockClientFromParam,
    isBranchContextReady: mockActiveBranchId !== null,
    refetch: mockClientRefetch,
    ...mockClientQueryState,
  }),
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
  MaternityContractDialog: ({ supersedeDocumentId }: { supersedeDocumentId?: string }) => (
    <div data-testid="reissue-document">{supersedeDocumentId ?? "none"}</div>
  ),
}));

jest.mock("@/components/app/contracts/ContractClientSelector", () => ({
  canCreateNewContractDocument: () => false,
}));

jest.mock("@/components/app/clients/ClientDetailPanel", () => ({
  ClientDetailPanel: ({ client, trailing, onBookingConfirmed }: {
    client: { id: number; name: string; bookingConfirmedAt?: string | null; serviceStatus?: string | null };
    trailing?: ReactNode;
    onBookingConfirmed?: (booking: { id: number; bookingConfirmedAt: string; serviceStatus: "waiting" }) => void;
  }) => (
    <div data-testid="client-detail" data-booking-confirmed-at={client.bookingConfirmedAt} data-service-status={client.serviceStatus}>
      {client.name}{trailing}
      <button onClick={() => onBookingConfirmed?.({ id: client.id, bookingConfirmedAt: "2026-10-13T00:00:00.000Z", serviceStatus: "waiting" })}>확정 응답 적용</button>
    </div>
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

jest.mock("@/components/app/service-record/ServiceRecordScheduleDialog", () => ({
  ServiceRecordScheduleDialog: ({ clientId, clientName, onOpenChange, onSaved }: {
    clientId: number;
    clientName: string;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void | Promise<void>;
  }) => (
    <div data-testid="service-record-schedule-dialog" data-client-id={clientId}>
      {clientName}
      <button onClick={() => onOpenChange(false)}>일정 창 닫기</button>
      <button onClick={() => void onSaved()}>일정 저장 완료</button>
    </div>
  ),
}));

jest.mock("@/components/app/clients/ServiceScheduleChangeModal", () => ({
  ServiceScheduleChangeModal: ({ onSubmit }: { onSubmit: (allow: boolean) => void }) => (
    <button onClick={() => onSubmit(false)}>일정 변경 적용</button>
  ),
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
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
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
    <div data-testid="clients-slot-list" data-loading={String(Boolean(isLoading))}>
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
  ListPanel: ({ children, emptyState, headerActions, onSearchChange, searchValue, subHeader, subtitle, title }: { children: ReactNode; emptyState?: ReactNode; headerActions?: ReactNode; onSearchChange?: (value: string) => void; searchValue?: string; subHeader?: ReactNode; subtitle?: ReactNode; title: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {subtitle ? <div data-testid="clients-list-subtitle">{subtitle}</div> : null}
      <input aria-label="고객 검색" value={searchValue ?? ""} onChange={(event) => onSearchChange?.(event.target.value)} />
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
  SplitLayout: ({ children, hasSelection }: { children: ReactNode; hasSelection?: boolean }) => (
    <div data-testid="clients-split-layout" data-has-selection={String(Boolean(hasSelection))}>{children}</div>
  ),
  StatsBar: ({ items = [], isLoading }: { items?: Array<{ label: string; value: unknown }>; isLoading?: boolean }) => (
    <div data-testid="clients-stats" data-loading={String(Boolean(isLoading))}>
      {items.map((item) => (
        <span key={item.label} data-testid={`clients-stat-${item.label}`}>{String(item.value)}</span>
      ))}
    </div>
  ),
  StatusBadge: () => null,
  SteppedWizardStepper: () => null,
}));

jest.mock("@/lib/phone", () => ({
  formatKoreanPhoneNumber: (phone: string) => phone,
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn().mockResolvedValue({ fields: [] }) },
  settingsApi: {
    getClientRegistrationPolicy: jest.fn(),
    updateClientRegistrationPolicy: jest.fn(),
  },
}));

afterEach(() => {
  mockAuthUser = { role: "owner", branchRole: null };
  mockActiveBranchId = "branch-a";
  mockClientFromParam = undefined;
  mockClientQueryState = IDLE_MOCK_CLIENT_QUERY;
  mockClientRefetch.mockReset();
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

  it("offers the service-record schedule change right under the viewer, behind the same branch-management gate", () => {
    const viewMarker = source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_view-service-record"');
    const scheduleMarker = source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_edit-service-record-schedule"');
    expect(viewMarker).toBeGreaterThan(-1);
    expect(scheduleMarker).toBeGreaterThan(viewMarker);
    // No other item sits between the viewer and the schedule item (only the schedule item's own opening tag does).
    const between = source.slice(viewMarker, scheduleMarker);
    expect(between.match(/<DropdownMenuItem/g)).toHaveLength(1);

    const gateStart = source.lastIndexOf("{canManageBranchFeatures && (", scheduleMarker);
    const scheduleItem = source.slice(source.lastIndexOf("<DropdownMenuItem", scheduleMarker), source.indexOf("</DropdownMenuItem>", scheduleMarker));
    expect(source.slice(gateStart, scheduleMarker)).not.toContain("</DropdownMenuItem>");
    expect(scheduleItem).toContain("제공기록지 일정 변경");
    expect(scheduleItem).toContain("setServiceRecordScheduleClient(activeSelectedClient)");
  });
});

describe("ClientsPage directory and summary contracts", () => {
  it("uses the server-paginated directory and independent summary hooks", () => {
    expect(source).toContain("useClientDirectory");
    expect(source).toContain("useClientListSummary");
    expect(source).toContain("limit: 20");
    expect(source).toContain("tab: activeFilter");
    expect(source).toContain("search: debouncedSearchQuery || undefined");
    // The summary is branch-wide: it takes no search and is not gated on the search debounce.
    expect(source).toContain("useClientListSummary()");
    expect(source).toContain("const isSummaryInitialLoading = listSummary.isInitialLoading;");
    expect(source).not.toContain("useClients(1, 50)");
    expect(source).not.toContain("matchesSearchQuery");
    expect(source).not.toContain("const filteredClients");
  });

  it("keeps the matched total separate from loaded rows and reaches the final page", () => {
    expect(source).toContain("matchedTotal");
    expect(source).toContain("`검색 결과 ${matchedTotal}명`");
    expect(source).not.toContain("명 표시");
    expect(source).toContain("const listScopeSubtitle");
    expect(source).toContain("subtitle={listScopeSubtitle}");
    expect(source).not.toContain('data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_scope_count"');
    expect(source).toContain("hasMore={Boolean(directory.hasNextPage && !directory.isNextPageError)}");
    expect(source).toContain("onLoadMore={() => void directory.fetchNextPage()}");
    expect(source).toContain("isFetchingMore={directory.isFetchingNextPage}");
    expect(source).toContain("directory.isNextPageError");
    // The end of the list is not announced: the scope subtitle already says how many are shown.
    expect(source).not.toContain("모든 검색 결과를 불러왔어요");
  });

  it("labels dueDate months and keeps the summary unscoped by search", () => {
    expect(source).toContain("이번 달 출산 예정");
    expect(source).toContain("다음 달 출산 예정");
    expect(source).toContain("서비스 종료 예정");
    expect(source).not.toContain("이번달 dueDate");
    expect(source).not.toContain("다음달 dueDate");
    expect(source).not.toContain("summaryScopeLabel");
    expect(source).not.toContain("현재 검색 범위");
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
    expect(formSource).toContain("JSON.stringify(formData) !== JSON.stringify(getEffectiveBaseline())");
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

  it("hides the match subtitle while the current directory query is pending", () => {
    renderClientsPage({ isInitialLoading: true });

    expect(screen.queryByTestId("clients-list-subtitle")).not.toBeInTheDocument();
  });

  it("shows a genuine successful empty zero and populated current count", () => {
    const { rerender } = renderClientsPage({
      data: { pages: [{ data: [], total: 0 }] },
      isSuccessfulEmpty: true,
    });

    expect(screen.getByTestId("clients-list-subtitle")).toHaveTextContent(/^0명$/);

    mockDirectoryState = {
      ...mockDirectoryState,
      clients: [{ id: 1, name: "기존 고객" }],
      data: { pages: [{ data: [{ id: 1, name: "기존 고객" }], total: 4 }] },
      isSuccessfulEmpty: false,
      matchedTotal: 4,
    };
    rerender(<ClientsPage />);

    expect(screen.getByTestId("clients-list-subtitle")).toHaveTextContent(/^4명$/);
  });

  it("prefixes the count with 검색 결과 while a search is applied and leaves the stats untouched", () => {
    mockListSummary.mockReturnValue({
      data: { dueDate: { thisMonth: 3, nextMonth: 5 }, byTab: { active: 7, waiting: 2 }, serviceEnd: { count: 1 }, total: 89 },
      isBranchContextReady: true,
      isInitialError: false,
      isInitialLoading: false,
      isRefreshError: false,
    });
    renderClientsPage({
      clients: [{ id: 1, name: "김예지" }],
      data: { pages: [{ data: [{ id: 1, name: "김예지" }], total: 89 }] },
      matchedTotal: 89,
    });
    const statsBefore = screen.getByTestId("clients-stats").textContent;
    expect(screen.getByTestId("clients-list-subtitle")).toHaveTextContent(/^89명$/);

    mockDirectoryState = { ...mockDirectoryState, matchedTotal: 8 };
    fireEvent.change(screen.getByLabelText("고객 검색"), { target: { value: "김예지" } });

    expect(screen.getByTestId("clients-list-subtitle")).toHaveTextContent(/^검색 결과 8명$/);
    expect(mockListSummary).toHaveBeenCalled();
    expect(screen.getByTestId("clients-stats")).toHaveAttribute("data-loading", "false");
    expect(screen.getByTestId("clients-stats").textContent).toBe(statsBefore);
  });

  it("keeps the cached match count visible when a same-scope refresh fails", () => {
    renderClientsPage({
      clients: [{ id: 1, name: "기존 고객" }],
      data: { pages: [{ data: [{ id: 1, name: "기존 고객" }], total: 4 }] },
      hasStaleData: true,
      isRefetchError: true,
      isRefreshError: true,
      matchedTotal: 4,
    });

    expect(screen.getByTestId("clients-list-subtitle")).toHaveTextContent(/^4명$/);
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

  describe("service-record schedule menu item", () => {
    const selectClient = () => {
      mockSearchParams = new URLSearchParams("id=8");
      mockClientFromParam = { id: 8, name: "지점 A 고객 2" };
      renderClientsPage({ clients: [], data: { pages: [{ data: [], total: 0 }] } });
    };

    it("sits right below 제공기록지 보기 for a branch manager and opens the dialog for the selected client", () => {
      selectClient();

      const view = screen.getByText("제공기록지 보기");
      const item = screen.getByRole("button", { name: "제공기록지 일정 변경" });
      expect(view.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByTestId("service-record-schedule-dialog")).not.toBeInTheDocument();

      fireEvent.click(item);

      const dialog = screen.getByTestId("service-record-schedule-dialog");
      expect(dialog).toHaveAttribute("data-client-id", "8");
      expect(dialog).toHaveTextContent("지점 A 고객 2");
    });

    it("closes the dialog when it asks to, and refreshes the client data after a save", async () => {
      mockQueryClient.invalidateQueries.mockClear();
      selectClient();
      fireEvent.click(screen.getByRole("button", { name: "제공기록지 일정 변경" }));

      fireEvent.click(screen.getByRole("button", { name: "일정 저장 완료" }));
      await waitFor(() => expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["clients"] }));

      fireEvent.click(screen.getByRole("button", { name: "일정 창 닫기" }));
      expect(screen.queryByTestId("service-record-schedule-dialog")).not.toBeInTheDocument();
    });

    it("works for a branch admin or manager too", () => {
      mockAuthUser = { role: "staff", branchRole: "manager" };
      selectClient();

      expect(screen.getByRole("button", { name: "제공기록지 일정 변경" })).toBeInTheDocument();
    });

    it("is absent for a user who cannot manage the branch", () => {
      mockAuthUser = { role: "staff", branchRole: "employee" };
      selectClient();

      expect(screen.getByTestId("client-detail")).toBeInTheDocument();
      expect(screen.queryByText("제공기록지 보기")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "제공기록지 일정 변경" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("service-record-schedule-dialog")).not.toBeInTheDocument();
    });
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

  it.each([
    ["requested", "latest-document"],
    ["completed", "none"],
  ])("reissues using the latest document's %s status, not the stale pin", async (documentStatus, expected) => {
    const { eformsignApi } = await import("@/services/api");
    const { serviceRecordsApi } = await import("@/features/service-records/api/service-records.api");
    jest.mocked(serviceRecordsApi.getClientOverview).mockResolvedValue({
      data: { assignments: [{ scheduleId: 7, replaced: false }] },
    } as never);
    jest.mocked(serviceRecordsApi.previewScheduleChange).mockResolvedValue({
      data: { fromDate: "2026-10-05", minimumDate: "2026-10-05", sessionIndex: 1 },
    } as never);
    jest.mocked(serviceRecordsApi.applyScheduleChange).mockResolvedValue({
      data: { clientId: 7, newEndDate: "2026-10-30" },
    } as never);
    const target = {
      id: 7, name: "재발행 고객", eDocId: "old-document",
      latestContractDocumentId: "latest-document", documentStatus,
    };
    mockSearchParams = new URLSearchParams("id=7");
    mockClientFromParam = target;
    render(<ClientsPage />);

    fireEvent.click(screen.getByText("서비스 일정 변경"));
    fireEvent.click(await screen.findByText("일정 변경 적용"));
    fireEvent.click(await screen.findByText("수정 전송"));

    await waitFor(() => expect(screen.getByTestId("reissue-document")).toHaveTextContent(expected));
    expect(eformsignApi.getDocument).toHaveBeenLastCalledWith("latest-document");
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

describe("ClientsPage unknown data is never shown as a definite value (paused / failed deep link)", () => {
  let ClientsPage: ComponentType;
  const PLACEHOLDER = "고객을 선택하면 상세 정보가 표시됩니다";
  const DEEP_LINK_TITLE = "고객 정보를 불러오지 못했습니다";
  const STAT_LABELS = [
    "이번 달 출산 예정",
    "다음 달 출산 예정",
    "서비스 진행중",
    "서비스 대기중",
    "서비스 종료 예정",
  ];
  const IDLE_CLIENT_QUERY = { isError: false, isFetching: false, isPaused: false, isLoading: false };
  const FAILED_CLIENT_QUERY = { ...IDLE_CLIENT_QUERY, isError: true };

  function successfulDirectory(clients: Array<{ id: number; name: string }>) {
    return {
      clients,
      data: { pages: [{ data: clients, total: clients.length }] },
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
      isSuccessfulEmpty: clients.length === 0,
      matchedTotal: clients.length,
      refetch: jest.fn(),
    };
  }

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
    mockDirectory.mockReturnValue(successfulDirectory([]));
  });

  afterEach(() => {
    cleanup();
  });

  // Characterisation: the hooks already report a paused first load (no data, device offline) as
  // isInitialLoading (pinned in use-clients.directory.test.ts); these assert what the page does with it.
  it("renders skeleton rows, no empty-list text and em-dash stats while the first load is paused", () => {
    mockDirectory.mockReturnValue({
      ...successfulDirectory([]),
      data: undefined,
      fetchStatus: "paused",
      isEndOfList: false,
      isError: false,
      isFetching: false,
      isInitialLoading: true,
      isLoading: false,
      isPaused: true,
      isPending: true,
      isSuccessfulEmpty: false,
      status: "pending",
    });
    mockListSummary.mockReturnValue({
      data: undefined,
      fetchStatus: "paused",
      isBranchContextReady: true,
      isError: false,
      isFetching: false,
      isInitialError: false,
      isInitialLoading: true,
      isLoading: false,
      isPaused: true,
      isPending: true,
      isRefreshError: false,
      status: "pending",
    });

    render(<ClientsPage />);

    expect(screen.getByTestId("clients-slot-list")).toHaveAttribute("data-loading", "true");
    expect(screen.getByTestId("clients-stats")).toHaveAttribute("data-loading", "true");
    expect(screen.queryByText("고객이 없습니다")).not.toBeInTheDocument();
    for (const label of STAT_LABELS) {
      expect(screen.getByTestId(`clients-stat-${label}`)).toHaveTextContent("—");
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the real empty text and no skeleton after a successful empty load", () => {
    render(<ClientsPage />);

    expect(screen.getByText("고객이 없습니다")).toBeInTheDocument();
    expect(screen.getByTestId("clients-slot-list")).toHaveAttribute("data-loading", "false");
  });

  describe("deep-linked client (?id=)", () => {
    beforeEach(() => {
      mockSearchParams = new URLSearchParams("id=123");
    });

    it("shows one failure alert with a retry that refetches the client query, instead of the placeholder", () => {
      mockClientQueryState = FAILED_CLIENT_QUERY;

      render(<ClientsPage />);

      const alerts = screen.getAllByRole("alert").filter((alert) => alert.textContent?.includes(DEEP_LINK_TITLE));
      expect(alerts).toHaveLength(1);
      expect(screen.queryByText(PLACEHOLDER)).not.toBeInTheDocument();
      expect(screen.queryByTestId("client-detail")).not.toBeInTheDocument();
      expect(screen.getByTestId("clients-split-layout")).toHaveAttribute("data-has-selection", "true");

      fireEvent.click(within(alerts[0]).getByRole("button", { name: /다시 시도/ }));
      expect(mockClientRefetch).toHaveBeenCalledTimes(1);
    });

    it("keeps the placeholder, not the failure, while the client query is loading or a failed one retries", () => {
      // react-query v5 resets a failed no-data query to pending (isError false, isLoading true) while it refetches,
      // so the failure panel disappears during a retry instead of staying up with a disabled button.
      mockClientQueryState = { ...IDLE_CLIENT_QUERY, isFetching: true, isLoading: true };

      render(<ClientsPage />);

      expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
      expect(screen.queryByText(DEEP_LINK_TITLE)).not.toBeInTheDocument();
      expect(screen.queryAllByRole("alert").filter((alert) => alert.textContent?.includes(DEEP_LINK_TITLE))).toHaveLength(0);
      expect(screen.getByTestId("clients-split-layout")).toHaveAttribute("data-has-selection", "false");
    });

    it("keeps the placeholder while the client query is paused with no data", () => {
      mockClientQueryState = { ...IDLE_CLIENT_QUERY, isPaused: true };

      render(<ClientsPage />);

      expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
      expect(screen.queryByText(DEEP_LINK_TITLE)).not.toBeInTheDocument();
    });

    it("shows the detail, not the failure, when the client query failed but the client is cached", () => {
      mockClientFromParam = { id: 123, name: "캐시된 고객" };
      mockClientQueryState = FAILED_CLIENT_QUERY;

      render(<ClientsPage />);

      expect(screen.getByTestId("client-detail")).toHaveTextContent("캐시된 고객");
      expect(screen.queryByText(DEEP_LINK_TITLE)).not.toBeInTheDocument();
    });

    it("shows the detail, not the failure, when the client is in the loaded list", () => {
      mockDirectory.mockReturnValue(successfulDirectory([{ id: 123, name: "목록 속 고객" }]));
      mockClientQueryState = FAILED_CLIENT_QUERY;

      render(<ClientsPage />);

      expect(screen.getByTestId("client-detail")).toHaveTextContent("목록 속 고객");
      expect(screen.queryByText(DEEP_LINK_TITLE)).not.toBeInTheDocument();
    });

    it("keeps the placeholder without a deep link even if the client query reports an error", () => {
      mockSearchParams = new URLSearchParams();
      mockClientQueryState = FAILED_CLIENT_QUERY;

      render(<ClientsPage />);

      expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
      expect(screen.queryByText(DEEP_LINK_TITLE)).not.toBeInTheDocument();
    });
  });
});

describe("ClientsPage a new ?id= outranks a stale row selection (BJJ-432)", () => {
  let ClientsPage: ComponentType;
  const CLIENT_A = { id: 21, name: "목록에서 고른 고객" };
  const CLIENT_B = { id: 42, name: "알림으로 연 고객" };

  function directoryOf(clients: Array<{ id: number; name: string }>) {
    return {
      clients,
      data: { pages: [{ data: clients, total: clients.length }] },
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
      isSuccessfulEmpty: false,
      matchedTotal: clients.length,
      refetch: jest.fn(),
    };
  }

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
    mockDirectory.mockReturnValue(directoryOf([CLIENT_A]));
  });

  afterEach(() => {
    cleanup();
  });

  it("patches booking fields without losing a locally selected client's name while the list is stale", () => {
    render(<ClientsPage />);
    fireEvent.click(screen.getByRole("button", { name: CLIENT_A.name }));
    fireEvent.click(screen.getByRole("button", { name: "확정 응답 적용" }));
    expect(screen.getByTestId("client-detail")).toHaveAttribute("data-booking-confirmed-at", "2026-10-13T00:00:00.000Z");
    expect(screen.getByTestId("client-detail")).toHaveAttribute("data-service-status", "waiting");
    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_A.name);
  });

  it("patches a deep-linked snapshot when no row has been selected", () => {
    mockSearchParams = new URLSearchParams("id=42");
    mockClientFromParam = CLIENT_B;
    render(<ClientsPage />);
    fireEvent.click(screen.getByRole("button", { name: "확정 응답 적용" }));
    expect(screen.getByTestId("client-detail")).toHaveAttribute("data-service-status", "waiting");
    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_B.name);
  });

  it("shows the URL-selected client after the id changes while another row is selected", () => {
    const { rerender } = render(<ClientsPage />);

    fireEvent.click(screen.getByRole("button", { name: CLIENT_A.name }));
    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_A.name);

    mockSearchParams = new URLSearchParams(`id=${CLIENT_B.id}`);
    mockClientFromParam = CLIENT_B;
    rerender(<ClientsPage />);

    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_B.name);
    expect(screen.getByTestId("client-detail")).not.toHaveTextContent(CLIENT_A.name);
  });

  it("keeps a row selected while the URL still carries the same id", () => {
    mockSearchParams = new URLSearchParams(`id=${CLIENT_B.id}`);
    mockClientFromParam = CLIENT_B;
    const { rerender } = render(<ClientsPage />);
    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_B.name);

    fireEvent.click(screen.getByRole("button", { name: CLIENT_A.name }));
    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_A.name);

    mockSearchParams = new URLSearchParams(`id=${CLIENT_B.id}`);
    rerender(<ClientsPage />);

    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_A.name);
  });

  it("keeps a row selected across a rerender when the URL has no id", () => {
    const { rerender } = render(<ClientsPage />);

    fireEvent.click(screen.getByRole("button", { name: CLIENT_A.name }));
    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_A.name);

    mockSearchParams = new URLSearchParams();
    rerender(<ClientsPage />);

    expect(screen.getByTestId("client-detail")).toHaveTextContent(CLIENT_A.name);
  });
});
