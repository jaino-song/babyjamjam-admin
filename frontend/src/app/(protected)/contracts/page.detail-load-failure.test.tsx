import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import type { ServiceRecordOverview } from "@/features/service-records/types";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { eformsignApi } from "@/services/api";

import { ContractDetail } from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
  useBusinessDayCalendar: () => ({ calendar: undefined }),
}));
jest.mock("@/hooks/useVoucherData", () => ({ useAllVoucherPriceInfos: () => ({ data: [] }) }));
jest.mock("@/hooks/useEformsignDocumentJobs", () => ({
  useEnqueueEformsignDocumentFinalization: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/services/api", () => ({ eformsignApi: { getDocument: jest.fn() } }));
jest.mock("@/features/service-records/api/service-records.api", () => ({
  serviceRecordsApi: { getClientOverview: jest.fn() },
}));

const doc: EformsignDocument = {
  id: "contract-1", document_name: "목록에 있던 문서", document_number: "1",
  created_date: 100, updated_date: 100,
  template: { id: "template", name: "Contract" },
  creator: { recipient_type: "01", name: "Test" },
  last_editor: { recipient_type: "01", name: "Test" },
  current_status: {
    status_type: "003", status_doc_type: "", status_doc_detail: "",
    step_type: "", step_index: "", step_name: "", step_recipients: [],
    step_group: 0, expired_date: 0, _expired: false,
  },
  fields: [], next_status: [], previous_status: [], histories: [],
  recipients: [], detail_template_info: [],
};
const emptyOverview: ServiceRecordOverview = { record: null, assignments: [] };
const cachedOverview: ServiceRecordOverview = {
  assignments: [],
  record: {
    header: {
      momName: "캐시 산모", momBirth: null, babyName: null, babyBirth: null,
      deliveryType: null, babyWeight: null,
      createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    },
  } as ServiceRecordOverview["record"],
};
const getDetail = jest.mocked(eformsignApi.getDocument);
const getOverview = jest.mocked(serviceRecordsApi.getClientOverview);
const detailKey = ["eformsign-documents", "detail", doc.id];
const emptyText = "아직 작성된 기본정보가 없습니다.";

function setup(preview = false, linked = true, client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
})) {
  const view = render(
    <QueryClientProvider client={client}>
      <ContractDetail data-component="desktop_contracts_detail" document={doc}
        reviewAction={preview ? "preview" : "finalize"}
        documentClientSummary={linked ? {
          documentId: doc.id, clientId: 1, clientName: "고객", clientPhone: null, providerName: null,
        } : null} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  jest.resetAllMocks();
  getDetail.mockResolvedValue(doc);
  getOverview.mockResolvedValue({ data: emptyOverview } as Awaited<ReturnType<typeof serviceRecordsApi.getClientOverview>>);
});

it("keeps a paused uncached linked service-record header loading", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(detailKey, doc);
  let unmount: (() => void) | undefined;
  try {
    onlineManager.setOnline(false);
    const view = setup(true, true, client);
    unmount = view.unmount;
    const { container } = view;
    await waitFor(() => expect(client.getQueryState(serviceRecordKeys.clientOverview(1))).toMatchObject({
      status: "pending", fetchStatus: "paused", data: undefined,
    }));
    const header = container.querySelector('[data-component="desktop_contracts_detail_content_document_header-card"]');
    expect(header?.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    expect(screen.queryByText(emptyText, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getOverview).not.toHaveBeenCalled();
  } finally {
    unmount?.();
    onlineManager.setOnline(true);
    client.clear();
  }
});

it("keeps cached service-record header visible during a paused refetch", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(detailKey, doc);
  client.setQueryData(serviceRecordKeys.clientOverview(1), cachedOverview);
  let unmount: (() => void) | undefined;
  try {
    onlineManager.setOnline(false);
    const view = setup(true, true, client);
    unmount = view.unmount;
    const { container } = view;
    await waitFor(() => expect(client.getQueryState(serviceRecordKeys.clientOverview(1))?.fetchStatus).toBe("paused"));
    expect(screen.getByText("캐시 산모")).toBeInTheDocument();
    const header = container.querySelector('[data-component="desktop_contracts_detail_content_document_header-card"]');
    expect(header?.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  } finally {
    unmount?.();
    onlineManager.setOnline(true);
    client.clear();
  }
});

it("retains the list document on detail failure and retries that request", async () => {
  getDetail.mockRejectedValueOnce(new Error("detail failed"));
  setup();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  expect(alert).toHaveAttribute("data-size", "inline");
  expect(screen.getAllByText(doc.document_name).length).toBeGreaterThan(0);
  fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(getDetail).toHaveBeenCalledTimes(2));
  expect(getDetail).toHaveBeenLastCalledWith(doc.id);
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("retains cached detail during a failed refetch and disables its inline retry in flight", async () => {
  const { client, container } = setup();
  await waitFor(() => expect(client.getQueryState(detailKey)?.status).toBe("success"));
  const cached = { ...doc, document_name: "저장된 상세 문서" };
  act(() => client.setQueryData(detailKey, cached));
  getDetail.mockRejectedValueOnce(new Error("refresh failed"));
  await act(async () => { await client.refetchQueries({ queryKey: detailKey }); });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  expect(screen.getAllByText(cached.document_name).length).toBeGreaterThan(0);
  const card = container.querySelector('[data-component="desktop_contracts_detail_content_document_contract-card"]');
  expect(card).toHaveTextContent(cached.document_name);
  let resolve!: (value: EformsignDocument) => void;
  getDetail.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeDisabled());
  expect(screen.getAllByText(cached.document_name).length).toBeGreaterThan(0);
  expect(card).toHaveTextContent(cached.document_name);
  await act(async () => { resolve(cached); });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("replaces failed uncached service-record header with retry, then accepts successful empty", async () => {
  getOverview.mockRejectedValueOnce(new Error("header failed"));
  setup(true);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("제공기록지 기본정보를 불러오지 못했습니다");
  expect(alert).toHaveAttribute("data-size", "inline");
  expect(screen.queryByText(emptyText, { exact: false })).not.toBeInTheDocument();
  fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(2));
  expect(getOverview).toHaveBeenLastCalledWith(1);
  expect(await screen.findByText(emptyText, { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps disabled unlinked service-record header genuinely empty without a request or alert", async () => {
  const { client } = setup(true, false);
  await waitFor(() => expect(client.getQueryState(detailKey)?.status).toBe("success"));
  expect(await screen.findByText(emptyText, { exact: false })).toBeInTheDocument();
  expect(getOverview).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("retains cached header with a notice immediately above it and an in-flight disabled retry", async () => {
  getOverview.mockResolvedValueOnce({ data: cachedOverview } as Awaited<ReturnType<typeof serviceRecordsApi.getClientOverview>>);
  const { client, container } = setup(true);
  expect(await screen.findByText("캐시 산모")).toBeInTheDocument();
  getOverview.mockRejectedValueOnce(new Error("refresh failed"));
  await act(async () => { await client.refetchQueries({ queryKey: serviceRecordKeys.clientOverview(1) }); });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  expect(alert).toHaveAttribute("data-size", "inline");
  const header = container.querySelector('[data-component="desktop_contracts_detail_content_document_header-card"]');
  expect(alert.nextElementSibling).toBe(header);
  expect(screen.getByText("캐시 산모")).toBeInTheDocument();
  expect(screen.queryByText(emptyText, { exact: false })).not.toBeInTheDocument();
  let resolve!: (value: Awaited<ReturnType<typeof serviceRecordsApi.getClientOverview>>) => void;
  getOverview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeDisabled());
  expect(screen.getByText("캐시 산모")).toBeInTheDocument();
  await act(async () => { resolve({ data: cachedOverview } as Awaited<ReturnType<typeof serviceRecordsApi.getClientOverview>>); });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("keeps a cached header visible even while the document detail is still loading", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(serviceRecordKeys.clientOverview(1), cachedOverview);
  let resolve!: (value: EformsignDocument) => void;
  getDetail.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  getOverview.mockRejectedValueOnce(new Error("header refresh failed"));
  setup(true, true, client);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  expect(screen.getByText("캐시 산모")).toBeInTheDocument();
  expect(screen.queryByText(emptyText, { exact: false })).not.toBeInTheDocument();
  await act(async () => { resolve(doc); });
});

it("keeps the existing initial loading skeleton until a successful empty header arrives", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof serviceRecordsApi.getClientOverview>>) => void;
  getOverview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { client, container } = setup(true);
  await waitFor(() => expect(client.getQueryState(detailKey)?.status).toBe("success"));
  expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  expect(screen.queryByText(emptyText, { exact: false })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => { resolve({ data: emptyOverview } as Awaited<ReturnType<typeof serviceRecordsApi.getClientOverview>>); });
  expect(await screen.findByText(emptyText, { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
