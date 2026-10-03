import fs from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

import { api } from "@/lib/api/client";
import { eformsignApi } from "@/services/api";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { ContractStatsBar } from "@/components/app/contracts/ContractStatsBar";

import { ContractDetail, contractStatsQueryKeys, getContractStatsValues } from "./page";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("ContractsPage provider summaries", () => {
  it("joins repeated provider names and renders only populated provider cards", () => {
    expect(source).toContain("const provider1Names =");
    expect(source).toContain('const provider1Name = provider1Names.join(", ")');
    expect(source).toContain('value: provider1Name || "–"');
    expect(source).toContain("const providers =");
    expect(source).toContain(".filter((provider) => provider.name || provider.contact)");
    expect(source).toContain('providers.length === 1 ? "제공인력"');
  });

  it("derives the contract end date through split and full-field aliases", () => {
    expect(source).toContain("formatIsoDateInput(\n    extractFieldDate(detailedDocument");
    expect(source).toContain('full: ["계약 종료일", "계약종료일", "endDate", "contractEndDate"]');
  });
});

describe("ContractsPage server-side search", () => {
  // A guard against reintroduction, not a behaviour test. Filtering the server's
  // pages client-side is what left hasNextPage describing the UNfiltered table,
  // so the list kept pulling pages that were filtered away and never stopped.
  // What the search actually sends is covered for real in
  // src/hooks/__tests__/useInfiniteContracts.search.test.tsx, which drives the
  // hook and asserts on the request; those tests fail when the fix is reverted.
  //
  // Asserting on source text cannot tell working code from a plausible string,
  // so this file deliberately keeps only the absence check: it survives
  // renames and formatting, and there is no way to satisfy it while still
  // filtering.
  it("no longer filters the server's pages client-side", () => {
    expect(source).not.toContain("matchesDocumentSearch");
  });
});

describe("ContractsPage infinite-scroll presentation", () => {
  it("does not append placeholder rows while fetching the next page", () => {
    expect(source).not.toContain("fetchingMoreCount");
  });
});

describe("ContractsPage maternity template whitelist", () => {
  // A guard against reintroduction, not a behaviour test. The maternity list once
  // showed every non-제공기록지 document in the eformsign account — including
  // unrelated templates (e.g. 근로계약서) — because the section's filter was a
  // blacklist. It was later whitelisted by client-side template arithmetic, which
  // mobile never picked up and the two surfaces diverged. The decision now lives
  // in the backend (EformsignTemplateScopeService resolves the branch's
  // area_template registry from section=maternity), so the page must only name
  // the section; computing template lists here would silently drift from mobile
  // again.
  it("names the section and lets the server resolve the template filter", () => {
    expect(source).toContain("section: contractsSection");
    expect(source).not.toContain("buildContractTemplateFilter(");
    expect(source).not.toContain("maternityTemplateIds");
  });
});

const CONTRACT_STATS_ITEMS: ComponentProps<typeof ContractStatsBar>["items"] = [
  { icon: Clock3, value: 0, label: "검토 필요", counter: "건" },
  { icon: Clock3, value: 0, label: "서명 완료", counter: "건" },
  { icon: Clock3, value: 0, label: "이용자 완료 필요", counter: "건" },
  { icon: Clock3, value: 0, label: "작성 대기중", counter: "건" },
  { icon: Clock3, value: 0, label: "기간 만료", counter: "건" },
];

function renderContractStatsBar(
  overrides: Partial<ComponentProps<typeof ContractStatsBar>> = {},
) {
  return render(
    <ContractStatsBar
      name="contracts"
      items={CONTRACT_STATS_ITEMS}
      showDocumentJobs={false}
      {...overrides}
    />,
  );
}

describe("ContractsPage contract stats states", () => {
  it("keeps successful empty responses as genuine zeroes while undefined stays unavailable", () => {
    expect(getContractStatsValues(undefined)).toBeNull();
    expect(getContractStatsValues({ documents: [] })).toEqual({
      reviewNeeded: 0,
      signed: 0,
      sendRequired: 0,
      drafting: 0,
      expired: 0,
    });
  });

  it("shows unavailable markers and a local retry after an initial stats failure", () => {
    const onRetryStats = jest.fn();
    renderContractStatsBar({
      items: CONTRACT_STATS_ITEMS.map((item) => ({ ...item, value: "—" })),
      statsError: new Error("status counts unavailable"),
      onRetryStats,
    });

    expect(screen.getByRole("alert")).toHaveTextContent("계약 통계를 불러오지 못했어요");
    expect(screen.getAllByText("—")).toHaveLength(CONTRACT_STATS_ITEMS.length);
    expect(screen.queryAllByText("0")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "계약 통계 다시 시도" }));
    expect(onRetryStats).toHaveBeenCalledTimes(1);
  });

  it("retains successful values and marks the bar stale after a refresh failure", () => {
    renderContractStatsBar({
      items: CONTRACT_STATS_ITEMS.map((item, index) => ({ ...item, value: index + 1 })),
      statsError: new Error("refresh failed"),
      statsHasData: true,
      onRetryStats: jest.fn(),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("최근 성공한 통계를 표시하고 있어요");
    expect(screen.getByRole("alert")).toHaveTextContent("계약 통계를 최신 상태로 불러오지 못했어요");
    for (const value of [1, 2, 3, 4, 5]) {
      expect(screen.getByText(String(value))).toBeInTheDocument();
    }
  });

  it("partitions status-counts caches by the authorized branch scope", () => {
    expect(contractStatsQueryKeys.statusCounts("branch-a")).not.toEqual(
      contractStatsQueryKeys.statusCounts("branch-b"),
    );
    expect(contractStatsQueryKeys.statusCounts("branch-a")).toEqual([
      "eformsign-status-counts",
      "branch-a",
    ]);
    expect(contractStatsQueryKeys.statusCounts(null)).toEqual([
      "eformsign-status-counts",
      "unavailable",
    ]);
  });
});

describe("ContractsPage headless finalization fallback", () => {
  it("does not reopen the reviewer iframe when the backend verdict is unknown", () => {
    expect(source).toContain("let transportOutcomeUnknown = false");
    expect(source).toContain("transportOutcomeUnknown = true");
    expect(source).toContain("if (manualCheckRequired || transportOutcomeUnknown)");
    expect(source).not.toContain("headless finalize threw, falling back to iframe");
  });

  // BJJ-319 5-4c: the additive envelope `outcome` is the primary
  // classification — an UNKNOWN verdict must reach the manual-check recovery
  // (확인 필요 copy, no reviewer iframe) even if fallbackHint would say
  // otherwise. Envelopes without the field keep the fallbackHint decision.
  it("treats an UNKNOWN envelope outcome as a manual check, never the reviewer iframe", () => {
    expect(source).toContain("const structuredOutcome = readHeadlessOutcome(headless.outcome);");
    expect(source).toContain('manualCheckRequired = headless.fallbackHint === "manual_check"\n            || structuredOutcome === "UNKNOWN";');
  });
});

function pendingDetailDocumentFixture(): EformsignDocument {
  // status_type "060" (customer signature step: step_type "05", step_name "이용자")
  // — the customer has NOT signed yet, so the receipt-send gate must withhold
  // the button (backend would reject the send with contract_not_signed).
  return {
    ...receiptDetailDocumentFixture(),
    current_status: {
      status_type: "060",
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "05",
      step_index: "1",
      step_name: "이용자",
      step_recipients: [],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
  } as unknown as EformsignDocument;
}

// ---------------------------------------------------------------------------
// F2: behavioral coverage of the manual receipt-send interaction (trigger ->
// confirm dialog -> mutation), rendering ContractDetail directly rather than
// the full ContractsPage list/search tree. Mutants this guards against:
//   - ReceiptSendConfirmDialog's onConfirm wired to a no-op
//   - the "영수증 문자 발송" trigger calling sendReceiptLink.mutate() directly,
//     bypassing the confirm dialog
// ---------------------------------------------------------------------------
interface MockPdfDocumentProps {
  children: ReactNode;
  onLoadSuccess?: (info: { numPages: number }) => void;
}
interface MockPdfPageProps {
  pageNumber: number;
}

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/lib/pdf-config", () => ({}));
jest.mock("react-pdf", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    Document: ({ children, onLoadSuccess }: MockPdfDocumentProps) => {
      React.useEffect(() => {
        onLoadSuccess?.({ numPages: 1 });
      }, [onLoadSuccess]);
      return <div data-testid="pdf-document">{children}</div>;
    },
    Page: ({ pageNumber }: MockPdfPageProps) => <div data-testid={`pdf-page-${pageNumber}`}>Page {pageNumber}</div>,
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function receiptDetailDocumentFixture(): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "C-0001",
    template: { id: "template-1", name: "산모 서비스 계약서" },
    document_name: "산모신생아건강관리서비스 계약서",
    creator: { recipient_type: "01", id: "creator", name: "인천 아이미래로" },
    created_date: 1756800000000,
    last_editor: { recipient_type: "01", id: "editor", name: "인천 아이미래로" },
    updated_date: 1756800000000,
    // status_type "003" (doc_complete) resolves to the "completed" category, which
    // always shows the single unconditional "문서 보기" trigger (never the
    // 검토 필요 review-action branch) — keeps this test's render surface minimal.
    current_status: {
      status_type: "003",
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "05",
      step_index: "2",
      step_name: "이용자",
      step_recipients: [],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  } as unknown as EformsignDocument;
}

function serviceRecordReviewNeededFixture(): EformsignDocument {
  // 060 + 제공기관 검토 step (no contract end date) resolves to "검토 필요",
  // which routes ContractDetail into the review-action header branch.
  return {
    ...receiptDetailDocumentFixture(),
    template: { id: "template-2", name: "산모·신생아 건강관리 서비스 제공기록지" },
    document_name: "김고객 제공기록지",
    current_status: {
      status_type: "060",
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "06",
      step_index: "3",
      step_name: "제공기관 검토",
      step_recipients: [{ recipient_type: "01" }],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
  } as unknown as EformsignDocument;
}

async function renderContractDetailAndOpenPreview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const doc = receiptDetailDocumentFixture();

  render(
    <QueryClientProvider client={queryClient}>
      <ContractDetail data-component="desktop_contracts_detail" document={doc} />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "문서 보기" }));
  await screen.findByTestId("pdf-document");

  const sendButton = document.body.querySelector(
    '[data-component="desktop_contracts_detail_dialogs_document-preview_footer_file-actions_receipt-send"]',
  ) as HTMLButtonElement | null;
  expect(sendButton).not.toBeNull();
  return { sendButton: sendButton as HTMLButtonElement };
}

describe("ContractDetail manual receipt-send interaction", () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    jest.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.startsWith("/eformsign/documents/")) {
        return { data: receiptDetailDocumentFixture() };
      }
      return { data: [] };
    });
    jest.spyOn(api, "post").mockResolvedValue({ data: {} } as never);
    jest.spyOn(eformsignApi, "getDocument").mockResolvedValue(receiptDetailDocumentFixture() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(["1986.7.9", "1986년 7월 9일", "1986. 7. 9.", "1986 07 09", "86.7.9", "１９８６．７．９", "1986-07-09 00:00:00"])("renders document birthday %s as YYYY-MM-DD", async (raw) => {
    const doc = receiptDetailDocumentFixture();
    doc.fields = [{ id: "이용자 생년월일", value: raw, type: "text" }];
    jest.spyOn(eformsignApi, "getDocument").mockResolvedValue(doc as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ContractDetail data-component="desktop_contracts_detail" document={doc} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("1986-07-09")).toBeInTheDocument();
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
  });

  it("replaces detail actions with a non-interactive skeleton while loading", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const doc = receiptDetailDocumentFixture();
    let resolveDetail: (document: EformsignDocument) => void = () => {};
    const pendingDetail = new Promise<EformsignDocument>((resolve) => {
      resolveDetail = resolve;
    });
    jest.spyOn(eformsignApi, "getDocument").mockReturnValue(pendingDetail as never);

    render(
      <QueryClientProvider client={queryClient}>
        <ContractDetail data-component="desktop_contracts_detail" document={doc} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("status", { name: "계약 작업 불러오는 중" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "문서 보기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "검토 완료 확인" })).not.toBeInTheDocument();

    await act(async () => {
      resolveDetail(doc);
      await pendingDetail;
    });

    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "계약 작업 불러오는 중" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "문서 보기" })).toBeInTheDocument();
  });

  it("clicking the trigger opens the confirm dialog without calling the send API", async () => {
    const sendReceiptLink = jest.spyOn(eformsignApi, "sendReceiptLink").mockResolvedValue({
      jobId: "job-1",
      scheduledFor: "2026-09-03T00:00:00.000Z",
      clientName: "김산모",
    } as never);

    const { sendButton } = await renderContractDetailAndOpenPreview();
    fireEvent.click(sendButton);

    expect(await screen.findByText("서비스 종료 안내 문자를 보낼까요?")).toBeInTheDocument();
    expect(sendReceiptLink).not.toHaveBeenCalled();
  });

  it("clicking the dialog's confirm button calls the send API exactly once with the selected document id", async () => {
    const sendReceiptLink = jest.spyOn(eformsignApi, "sendReceiptLink").mockResolvedValue({
      jobId: "job-1",
      scheduledFor: "2026-09-03T00:00:00.000Z",
      clientName: "김산모",
    } as never);

    const { sendButton } = await renderContractDetailAndOpenPreview();
    fireEvent.click(sendButton);
    await screen.findByText("서비스 종료 안내 문자를 보낼까요?");

    fireEvent.click(screen.getByRole("button", { name: "발송하기" }));

    await waitFor(() => expect(sendReceiptLink).toHaveBeenCalledTimes(1));
    expect(sendReceiptLink).toHaveBeenCalledWith("doc-1");
    // Let the mutation's onSuccess (closes the confirm dialog, fires a toast) settle
    // inside act() before the test ends, or React logs an act() warning.
    await waitFor(() =>
      expect(screen.queryByText("서비스 종료 안내 문자를 보낼까요?")).not.toBeInTheDocument(),
    );
  });

  it("disables the preview modal's trigger button while the send is pending", async () => {
    let resolveSend: (value: { jobId: string; scheduledFor: string; clientName: string }) => void = () => {};
    const pending = new Promise<{ jobId: string; scheduledFor: string; clientName: string }>((resolve) => {
      resolveSend = resolve;
    });
    jest.spyOn(eformsignApi, "sendReceiptLink").mockReturnValue(pending as never);

    const { sendButton } = await renderContractDetailAndOpenPreview();
    fireEvent.click(sendButton);
    await screen.findByText("서비스 종료 안내 문자를 보낼까요?");

    fireEvent.click(screen.getByRole("button", { name: "발송하기" }));

    await waitFor(() => expect(sendButton).toBeDisabled());

    resolveSend({ jobId: "job-1", scheduledFor: "2026-09-03T00:00:00.000Z", clientName: "김산모" });
    // Flush the mutation's onSuccess state updates inside act() before the test ends.
    await waitFor(() =>
      expect(screen.queryByText("서비스 종료 안내 문자를 보낼까요?")).not.toBeInTheDocument(),
    );
  });

  // F8: onSendReceiptLink must be undefined on the 제공기록지 preview surface
  // (reviewAction="preview") — ContractDocumentPreviewModal.test.tsx already pins
  // that the button doesn't render without a handler ("hides the button without a
  // handler and disables it while sending"); this pins the page-level wiring that
  // withholds the handler for that surface.
  it("does not offer the receipt-send button on the 제공기록지 preview surface (reviewAction=preview)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const doc = receiptDetailDocumentFixture();

    render(
      <QueryClientProvider client={queryClient}>
        <ContractDetail data-component="desktop_contracts_detail" document={doc} reviewAction="preview" />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "문서 보기" }));
    await screen.findByTestId("pdf-document");

    expect(screen.queryByRole("button", { name: "영수증 문자 발송" })).toBeNull();
  });

  // The 제공기록지 review-needed surface reuses the 계약서 preview trigger: 문서 보기
  // opens the shared preview modal (the service-record document itself), whose 확인
  // action continues into the same 검토 완료 confirm flow; the receipt-send button
  // stays withheld on that surface.
  it("previews the 제공기록지 document from the reused preview trigger while review is needed", async () => {
    jest.spyOn(eformsignApi, "getDocument").mockResolvedValue(serviceRecordReviewNeededFixture() as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const doc = serviceRecordReviewNeededFixture();

    render(
      <QueryClientProvider client={queryClient}>
        <ContractDetail data-component="desktop_contracts_detail" document={doc} reviewAction="preview" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "문서 보기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검토하기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "문서 보기" }));
    await screen.findByTestId("pdf-document");

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(await screen.findByText("제공기록지를 검토 완료 처리합니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "영수증 문자 발송" })).toBeNull();
  });

  // Signed gate: the receipt-send button must be withheld while the document is
  // still awaiting the customer's signature (status 060, 이용자 step) — the backend
  // rejects such sends with contract_not_signed. The completed (003) fixtures
  // above pin the button's presence once the document is signed/completed.
  it("does not offer the receipt-send button while the customer has not signed yet (status 060)", async () => {
    jest.spyOn(eformsignApi, "getDocument").mockResolvedValue(pendingDetailDocumentFixture() as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const doc = pendingDetailDocumentFixture();

    render(
      <QueryClientProvider client={queryClient}>
        <ContractDetail data-component="desktop_contracts_detail" document={doc} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "문서 보기" }));
    await screen.findByTestId("pdf-document");

    expect(screen.queryByRole("button", { name: "영수증 문자 발송" })).toBeNull();
  });
});
