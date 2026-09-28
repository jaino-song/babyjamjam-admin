import fs from "node:fs";

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

  it("keeps the matched total separate from loaded rows and reaches the final page", () => {
    expect(source).toContain("matchedTotal");
    expect(source).toContain("일치 ${matchedTotal}명 · 현재 ${clients.length}명 표시");
    expect(source).toContain("const listScopeSubtitle");
    expect(source).toContain("subtitle={listScopeSubtitle}");
    expect(source).not.toContain('data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_scope_count"');
    expect(source).toContain("hasMore={Boolean(directory.hasNextPage && !directory.isNextPageError)}");
    expect(source).toContain("onLoadMore={() => void directory.fetchNextPage()}");
    expect(source).toContain("isFetchingMore={directory.isFetchingNextPage}");
    expect(source).toContain("directory.isNextPageError");
    expect(source).toContain("directory.isEndOfList");
  });

  it("labels summary scope, dueDate months, and the returned Korea-time service-end range", () => {
    expect(source).toContain("이번 달 출산 예정");
    expect(source).toContain("다음 달 출산 예정");
    expect(source).toContain("서비스 종료 예정");
    expect(source).not.toContain("이번달 dueDate");
    expect(source).not.toContain("다음달 dueDate");
    expect(source).toContain("summary.serviceEnd.from");
    expect(source).toContain("summary.serviceEnd.to");
    expect(source).toContain("한국시간, 양끝 포함");
    expect(source).toContain("summaryScopeLabel");
    expect(source).toContain('data-component="desktop_clients_summary_scope"');
    expect(source).toContain("상태 탭과 무관한 지점 전체 검색 결과 기준");
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
