import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  RECEIPT_BRANCH_HEADER,
  type StandaloneReceiptRequest,
} from "@babyjamjam/shared";

import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { clientKeys } from "@/features/clients/hooks/keys";

import { useSendClientReceipt } from "./use-send-client-receipt";

const mockToast = jest.fn();
const mockFetch = jest.fn<Promise<Response>, [unknown, RequestInit?]>();
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));


const A = "2026-11-20";
const B = "2026-11-21";
const CLIENT_ID = 117;
const BRANCH = "qa-a";
const OTHER_BRANCH = "qa-b";
const SAVED_REQUEST_ID = "a9011111-b222-4333-9444-555555555555";

let queryClient: QueryClient;
let invalidate: jest.SpyInstance;
const originalFetch = globalThis.fetch;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setBranch(branchId: string) {
  document.cookie = `selected_branch_id=${branchId}; path=/`;
  window.dispatchEvent(new Event("focus"));
}

function reply(status: number, data: unknown): Response {
  return { status, json: async () => data } as Response;
}

function accepted(): Response {
  return reply(200, { queued: true, jobId: "job-1" });
}

function request(index: number): StandaloneReceiptRequest {
  return JSON.parse(String(mockFetch.mock.calls[index][1]?.body));
}

function requestStorageKey(date: string): string {
  return `standalone-receipt:${JSON.stringify([BRANCH, CLIENT_ID, date])}`;
}

function deferredReply() {
  let resolve!: (value: Response) => void;
  mockFetch.mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; }));
  return resolve;
}

function setup(savedDate: string | null = null) {
  const hook = renderHook(
    ({ id, branchId, date }: { id: number; branchId: string; date: string | null }) =>
      useSendClientReceipt(branchId, id, date),
    { wrapper, initialProps: { id: CLIENT_ID, branchId: BRANCH, date: savedDate } },
  );
  act(() => { hook.result.current.open(); });
  return hook;
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = jest.spyOn(queryClient, "invalidateQueries");
  mockToast.mockClear();
  mockFetch.mockReset().mockResolvedValue(accepted());
  globalThis.fetch = mockFetch;
  window.sessionStorage.clear();
  setBranch(BRANCH);

});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.cookie = "selected_branch_id=; max-age=0; path=/";
  queryClient.clear();
});

it("opens blank and dismisses without a write, UUID, or cache invalidation", () => {
  const { result } = setup();
  expect(result.current.dialog?.date).toBe("");
  act(() => result.current.dialog?.dismiss());
  expect(result.current.dialog).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(window.sessionStorage.length).toBe(0);
  expect(invalidate).not.toHaveBeenCalled();
});

it.each(["", "2026-02", "2026-02-30", "2026-13-01"])("blocks invalid dates (%s) even if submit is called", async (date) => {
  const { result } = setup(A);
  act(() => result.current.dialog?.editDate(date));
  expect(result.current.dialog?.canSubmit).toBe(false);
  await act(async () => result.current.dialog?.submit());
  expect(mockFetch).not.toHaveBeenCalled();
});

it("keeps the edited B date through an asynchronous detail refresh and queues it once", async () => {
  const { result, rerender } = setup(A);
  expect(result.current.dialog?.date).toBe(A);
  act(() => result.current.dialog?.editDate("20261121"));
  rerender({ id: CLIENT_ID, branchId: BRANCH, date: "2026-11-19" });
  expect(result.current.dialog?.date).toBe(B);
  const resolve = deferredReply();
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.dialog?.submit();
    void result.current.dialog?.submit();
    result.current.dialog?.dismiss();
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith("/api/receipt-links/standalone", expect.objectContaining({
    method: "POST",
    headers: { "Content-Type": "application/json", [RECEIPT_BRANCH_HEADER]: BRANCH },
  }));
  expect(request(0)).toEqual({
    clientId: CLIENT_ID, copaymentReceivedDate: B,
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
  });
  expect(result.current.dialog?.isPending).toBe(true);
  expect(invalidate).not.toHaveBeenCalled();

  await act(async () => { resolve(accepted()); await pending; });
  expect(result.current.dialog).toBeNull();
  expect(mockToast).toHaveBeenCalledWith({ variant: "success", title: "영수증 발송을 요청했습니다." });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.upcoming() });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.clientHistory(CLIENT_ID) });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: clientKeys.detail(CLIENT_ID, BRANCH), exact: true, refetchType: "active" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: clientKeys.allClients(BRANCH), exact: true, refetchType: "active" });
});

it("fills a pristine blank field on detail load but keeps an edited or cleared value", async () => {
  const { result, rerender } = setup();
  expect(result.current.dialog?.date).toBe("");
  rerender({ id: CLIENT_ID, branchId: BRANCH, date: A });
  await waitFor(() => expect(result.current.dialog?.date).toBe(A));
  act(() => result.current.dialog?.editDate(""));
  rerender({ id: CLIENT_ID, branchId: BRANCH, date: "2026-11-19" });
  expect(result.current.dialog?.date).toBe("");
  expect(result.current.dialog?.canSubmit).toBe(false);
});

it.each(["network", "5xx", "malformed acceptance", "unknown response"])(
  "keeps the same request UUID through an ambiguous %s and reopen",
  async (failure) => {
    if (failure === "network") mockFetch.mockRejectedValueOnce(new Error("connection closed"));
    if (failure === "5xx") mockFetch.mockResolvedValueOnce(reply(503, {}));
    if (failure === "malformed acceptance") mockFetch.mockResolvedValueOnce(reply(200, { queued: true }));
    if (failure === "unknown response") mockFetch.mockResolvedValueOnce(reply(201, { jobId: "job-1", queued: true }));
    const { result } = setup(A);
    await act(async () => result.current.dialog?.submit());
    const firstRequest = request(0);
    expect(result.current.dialog?.error).toBe("발송 접수 여부를 확인하지 못했어요. 다시 시도해 주세요.");
    expect(result.current.dialog?.isPending).toBe(false);
    expect(mockToast).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(requestStorageKey(A))).toBe(firstRequest.requestId);

    act(() => result.current.dialog?.dismiss());
    act(() => result.current.open());
    await act(async () => result.current.dialog?.submit());
    expect(request(1)).toEqual(firstRequest);
    expect(window.sessionStorage.getItem(requestStorageKey(A))).toBeNull();
  },
);

it("uses the session UUID after reload and creates a fresh UUID for a deliberate repeat", async () => {
  window.sessionStorage.setItem(requestStorageKey(A), SAVED_REQUEST_ID);
  const { result } = setup(A);
  await act(async () => result.current.dialog?.submit());
  expect(request(0).requestId).toBe(SAVED_REQUEST_ID);
  act(() => result.current.open());
  await act(async () => result.current.dialog?.submit());
  expect(request(1)).toEqual({ ...request(0), requestId: expect.not.stringMatching(SAVED_REQUEST_ID) });
});

it("keeps the UUID after a timeout and waits for an explicit retry", async () => {
  jest.useFakeTimers();
  try {
    mockFetch.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const { result } = setup(A);
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.dialog?.submit(); });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
      await pending;
    });

    expect(result.current.dialog?.error).toBe("발송 접수 여부를 확인하지 못했어요. 다시 시도해 주세요.");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => result.current.dialog?.submit());
    expect(request(1)).toEqual(request(0));
  } finally {
    jest.useRealTimers();
  }
});

it("uses a different request UUID when changing the date after a lost response", async () => {
  mockFetch.mockRejectedValueOnce(new Error("connection closed"));
  const { result } = setup(A);
  await act(async () => result.current.dialog?.submit());
  act(() => result.current.dialog?.editDate(B));
  await act(async () => result.current.dialog?.submit());
  expect(request(1)).toEqual({ ...request(0), copaymentReceivedDate: B, requestId: expect.not.stringMatching(request(0).requestId) });
  expect(window.sessionStorage.getItem(requestStorageKey(A))).toBe(request(0).requestId);
  act(() => result.current.open());
  await act(async () => result.current.dialog?.submit()); // Resolve the earlier unknown request as well.
});

it.each([
  [400, "INVALID_RECEIVED_DATE"],
  [400, "MISSING_RECEIPT_FIELDS"],
  [403, "ACCESS_DENIED"],
  [404, "RESOURCE_NOT_FOUND"],
  [409, "REQUEST_ID_CONFLICT"],
])("shows the %s %s refusal without marking it accepted", async (status, code) => {
  const detail = "영수증 발송 정보를 확인해 주세요.";
  mockFetch.mockResolvedValueOnce(reply(status, { code, detail }));
  const { result } = setup(B);

  await act(async () => result.current.dialog?.submit());
  expect(result.current.dialog?.error).toBe(detail);
  expect(window.sessionStorage.getItem(requestStorageKey(B))).toBeNull();
  expect(invalidate).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
});

it("discards a stale draft on customer switch, even if returning to the original customer", async () => {
  const { result, rerender } = setup(A);
  const staleSubmit = result.current.dialog?.submit;
  rerender({ id: CLIENT_ID + 1, branchId: BRANCH, date: null });
  expect(result.current.dialog).toBeNull();
  await act(async () => staleSubmit?.());
  rerender({ id: CLIENT_ID, branchId: BRANCH, date: A });
  expect(result.current.dialog).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});

it("refreshes the submitted client after navigation while keeping the new client's modal and toast untouched", async () => {
  const { result, rerender } = setup(A);
  const resolve = deferredReply();
  let pending: Promise<void> | undefined;
  act(() => { pending = result.current.dialog?.submit(); });
  rerender({ id: CLIENT_ID + 1, branchId: BRANCH, date: null });
  act(() => result.current.open());
  act(() => result.current.dialog?.editDate(B));

  await act(async () => { resolve(accepted()); await pending; });
  expect(result.current.dialog?.date).toBe(B);
  expect(mockToast).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.clientHistory(CLIENT_ID) });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: messageTriggerKeys.clientHistory(CLIENT_ID + 1) });
});

it("only marks the submitted branch's scoped queries stale if acceptance arrives after a branch switch", async () => {
  const { result, rerender } = setup(A);
  const resolve = deferredReply();
  let pending: Promise<void> | undefined;
  act(() => { pending = result.current.dialog?.submit(); });
  act(() => setBranch(OTHER_BRANCH));
  rerender({ id: CLIENT_ID, branchId: OTHER_BRANCH, date: B });
  expect(result.current.dialog).toBeNull();

  await act(async () => { resolve(accepted()); await pending; });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: clientKeys.detail(CLIENT_ID, BRANCH), exact: true, refetchType: "none" });
  expect(invalidate.mock.calls.every(([filters]) => JSON.stringify(filters.queryKey).includes(BRANCH))).toBe(true);
  expect(mockToast).not.toHaveBeenCalled();
});
