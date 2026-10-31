/**
 * 검토완료 re-run over a finalize job the server already holds. The backend keeps the finalize
 * active key while a job is queued/processing/requires_attention, so a re-run answers
 * `existing: true` and creates nothing. The page must not claim it started a job in that case.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { eformsignApi } from "@/services/api";

import { ContractDetail } from "./page";

const mockToast = jest.fn();

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast, dismiss: jest.fn(), toasts: [] }),
  toast: (...args: unknown[]) => mockToast(...args),
}));
jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/lib/pdf-config", () => ({}));
jest.mock("react-pdf", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    Document: ({ children, onLoadSuccess }: { children: ReactNode; onLoadSuccess?: (info: { numPages: number }) => void }) => {
      React.useEffect(() => {
        onLoadSuccess?.({ numPages: 1 });
      }, [onLoadSuccess]);
      return <div data-testid="pdf-document">{children}</div>;
    },
    Page: ({ pageNumber }: { pageNumber: number }) => <div data-testid={`pdf-page-${pageNumber}`}>Page {pageNumber}</div>,
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 060 + 제공기관 검토 step resolves to "검토 필요" (the 제공기록지 review-action branch).
function serviceRecordReviewNeededFixture(): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "C-0001",
    template: { id: "template-2", name: "산모·신생아 건강관리 서비스 제공기록지" },
    document_name: "김고객 제공기록지",
    creator: { recipient_type: "01", id: "creator", name: "인천 아이미래로" },
    created_date: 1756800000000,
    last_editor: { recipient_type: "01", id: "editor", name: "인천 아이미래로" },
    updated_date: 1756800000000,
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
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  } as unknown as EformsignDocument;
}

const EXISTING_ATTENTION_COPY = "이 계약서의 검토완료 작업이 처리중 목록에 남아 있어요. 처리중 목록에서 확인해 주세요.";
const EXISTING_PROCESSING_COPY = "이 계약서의 검토완료가 이미 처리 중이에요.";
const STARTED_COPY = "전자문서 작업을 시작했어요";

function toastedDescriptions(): string[] {
  return mockToast.mock.calls.map(([arg]) => (arg as { description?: string }).description ?? "");
}

describe("ContractDetail 검토완료 over an existing finalize job", () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockToast.mockClear();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    jest.spyOn(api, "get").mockResolvedValue({ data: [] } as never);
    jest.spyOn(api, "post").mockResolvedValue({ data: {} } as never);
    jest.spyOn(eformsignApi, "getDocument").mockResolvedValue(serviceRecordReviewNeededFixture() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runFinalize(response: { jobId: string; status: string; existing: boolean }) {
    const enqueue = jest.spyOn(eformsignApi, "enqueueDocumentFinalization").mockResolvedValue(response as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ContractDetail
          data-component="desktop_contracts_detail"
          document={serviceRecordReviewNeededFixture()}
          reviewAction="preview"
        />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "문서 보기" }));
    await screen.findByTestId("pdf-document");
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await screen.findByText("제공기록지를 검토 완료 처리합니다.");
    fireEvent.click(screen.getByRole("button", { name: "완료" }));

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
  }

  it("reports an error, not success, when the job already exists in requires_attention", async () => {
    await runFinalize({ jobId: "job-1", status: "requires_attention", existing: true });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "최종 확인을 마치지 못했어요",
        description: EXISTING_ATTENTION_COPY,
      }),
    );
    expect(toastedDescriptions()).not.toContain(STARTED_COPY);
  });

  it("reports an error, not success, when the existing job has failed", async () => {
    await runFinalize({ jobId: "job-1", status: "failed", existing: true });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(toastedDescriptions()).toEqual([EXISTING_ATTENTION_COPY]);
  });

  it("says the review is already in progress when the existing job is processing", async () => {
    await runFinalize({ jobId: "job-1", status: "processing", existing: true });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(toastedDescriptions()).toEqual([EXISTING_PROCESSING_COPY]);
    expect(mockToast.mock.calls[0][0]).not.toHaveProperty("variant", "destructive");
    expect(toastedDescriptions()).not.toContain(STARTED_COPY);
  });

  it("keeps the success copy for a newly created job", async () => {
    await runFinalize({ jobId: "job-2", status: "queued", existing: false });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(toastedDescriptions()).toEqual([STARTED_COPY]);
  });
});
