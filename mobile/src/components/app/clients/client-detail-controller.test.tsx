import { act, renderHook, waitFor } from "@testing-library/react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Client } from "@/lib/client/types";
import { fetchClient, useClient, useDeleteClient } from "@/hooks/useClients";
import { useClientDetailController } from "./client-detail-controller";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/useClients", () => ({
  clientQueryKeys: {
    all: ["clients"],
    lists: () => ["clients", "list"],
    details: () => ["clients", "detail"],
    detail: (id: number) => ["clients", "detail", id],
  },
  fetchClient: jest.fn(),
  useClient: jest.fn(),
  useDeleteClient: jest.fn(),
  approveScheduleChange: jest.fn(),
  rejectScheduleChange: jest.fn(),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [] }),
}));

jest.mock("@/hooks/useClientMessageHistory", () => ({
  useClientMessageHistory: () => ({
    notificationLogs: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("@/stores/form-store", () => ({
  useFormStore: (selector: (state: { prefillFromContract: jest.Mock }) => unknown) =>
    selector({ prefillFromContract: jest.fn() }),
}));

jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
  MobileTwoButtonModal: () => null,
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/hooks/use-send-client-receipt", () => ({
  useSendClientReceipt: () => ({ isSending: false, sendReceipt: jest.fn() }),
}));

jest.mock("@/hooks/useServiceRecords", () => ({
  applyServiceScheduleChange: jest.fn(),
  fetchClientServiceRecords: jest.fn(),
  previewServiceScheduleChange: jest.fn(),
  resetServiceRecordLink: jest.fn(),
  useClientServiceRecords: () => ({ data: undefined, isError: false, isLoading: false }),
}));

jest.mock("@/components/app/clients/client-detail", () => ({
  ClientDetailContent: () => null,
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn() },
}));

const mockedFetchClient = jest.mocked(fetchClient);
const mockedUseClient = jest.mocked(useClient);
const mockedUseDeleteClient = jest.mocked(useDeleteClient);

function makeClient(id: number): Client {
  return {
    id,
    name: `고객 ${id}`,
    birthday: null,
    dueDate: null,
    birthDate: null,
    address: null,
    phone: null,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "active",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function hasDataComponent(node: ReactNode, expected: string): boolean {
  return Children.toArray(node).some((child) => {
    if (!isValidElement(child)) return false;
    return (child.props as { "data-component"?: string })["data-component"] === expected
      || hasDataComponent((child.props as { children?: ReactNode }).children, expected);
  });
}

function getClientDetailProps(node: ReactNode): {
  onDelete: (id: number) => void;
  onClientUpdated: (client: Client) => void;
} | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as {
      onDelete?: (id: number) => void;
      onClientUpdated?: (client: Client) => void;
      children?: ReactNode;
    };
    if (props.onDelete && props.onClientUpdated) {
      return {
        onDelete: props.onDelete,
        onClientUpdated: props.onClientUpdated,
      };
    }
    const nested = getClientDetailProps(props.children);
    if (nested) return nested;
  }
  return null;
}

describe("useClientDetailController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchClient.mockResolvedValue(makeClient(1));
    mockedUseClient.mockReturnValue({ data: undefined } as ReturnType<typeof useClient>);
    mockedUseDeleteClient.mockReturnValue({
      isPending: false,
      mutateAsync: jest.fn(),
    } as unknown as ReturnType<typeof useDeleteClient>);
  });

  it("does not let a stale fresh response for a previous selection replace the current client", async () => {
    let resolveA!: (client: Client) => void;
    let resolveB!: (client: Client) => void;
    mockedFetchClient.mockImplementation((id) => new Promise<Client>((resolve) => {
      if (id === 1) resolveA = resolve;
      else resolveB = resolve;
    }));
    const clientA = makeClient(1);
    const clientB = makeClient(2);
    const { result, rerender } = renderHook(
      ({ client }: { client: Client | null }) => useClientDetailController({
        client,
        dataComponent: "mobile_clients_detail-sheet_detail",
      }),
      { initialProps: { client: clientA }, wrapper: createWrapper() },
    );

    rerender({ client: clientB });
    await act(async () => {
      resolveA({ ...clientA, name: "오래된 고객" });
      await Promise.resolve();
    });
    expect(result.current.detailClient?.id).toBe(2);

    await act(async () => {
      resolveB({ ...clientB, name: "최신 고객" });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.detailClient?.name).toBe("최신 고객"));
  });

  it("preserves the selected tab when a same-client fresh response completes", async () => {
    const client = makeClient(1);
    let resolveFresh!: (next: Client) => void;
    mockedFetchClient.mockImplementation(() => new Promise<Client>((resolve) => {
      resolveFresh = resolve;
    }));
    const { result } = renderHook(
      () => useClientDetailController({ client, dataComponent: "mobile_clients_detail-sheet_detail" }),
      { wrapper: createWrapper() },
    );

    act(() => result.current.setDetailSheetTab("contracts"));
    await act(async () => {
      resolveFresh({ ...client, name: "새 이름" });
      await Promise.resolve();
    });

    expect(result.current.detailSheetTab).toBe("contracts");
    expect(result.current.detailClient?.name).toBe("새 이름");
  });

  it("closes the caller-owned detail after a successful delete", async () => {
    const client = makeClient(1);
    const onClientDeleted = jest.fn();
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockedUseDeleteClient.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useDeleteClient>);
    const { result } = renderHook(
      () => useClientDetailController({
        client,
        dataComponent: "mobile_clients_detail-sheet_detail",
        onClientDeleted,
      }),
      { wrapper: createWrapper() },
    );

    const clientDetailProps = getClientDetailProps(result.current.detail);
    expect(clientDetailProps).not.toBeNull();
    act(() => clientDetailProps?.onDelete(client.id));
    const deleteModal = result.current.deleteModal as ReactElement<{
      description: string;
      onConfirm: () => Promise<void>;
    }>;
    expect(deleteModal.props.description).toBe("정말로 이 고객을 삭제하시겠습니까?");

    await act(async () => {
      await deleteModal.props.onConfirm();
    });

    expect(mutateAsync).toHaveBeenCalledWith(client.id);
    expect(onClientDeleted).toHaveBeenCalledWith(client.id);
    expect(result.current.detailClient).toBeNull();
  });

  it("keeps the detail open when delete fails", async () => {
    const client = makeClient(1);
    const onClientDeleted = jest.fn();
    const mutateAsync = jest.fn().mockRejectedValue(new Error("delete failed"));
    mockedUseDeleteClient.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useDeleteClient>);
    const { result } = renderHook(
      () => useClientDetailController({
        client,
        dataComponent: "mobile_clients_detail-sheet_detail",
        onClientDeleted,
      }),
      { wrapper: createWrapper() },
    );

    const clientDetailProps = getClientDetailProps(result.current.detail);
    act(() => clientDetailProps?.onDelete(client.id));
    const deleteModal = result.current.deleteModal as ReactElement<{ onConfirm: () => Promise<void> }>;
    await act(async () => {
      await deleteModal.props.onConfirm();
    });

    expect(onClientDeleted).not.toHaveBeenCalled();
    expect(result.current.detailClient?.id).toBe(client.id);
  });

  it("clears an old URL-selected client and exposes a retryable error for the new identity", async () => {
    const requests = new Map<number, {
      resolve: (client: Client) => void;
      reject: (error: Error) => void;
    }>();
    mockedFetchClient.mockImplementation((id) => new Promise<Client>((resolve, reject) => {
      requests.set(id, { resolve, reject });
    }));
    const dataComponent = "mobile_clients_detail-sheet_detail";
    const { result, rerender } = renderHook(
      ({ clientId }: { clientId: number }) => useClientDetailController({
        client: null,
        clientId,
        dataComponent,
      }),
      { initialProps: { clientId: 1 }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(requests.has(1)).toBe(true));
    rerender({ clientId: 2 });
    await waitFor(() => expect(requests.has(2)).toBe(true));
    await waitFor(() => expect(result.current.detailClient).toBeNull());
    expect(result.current.isDetailRefreshing).toBe(true);
    expect(hasDataComponent(result.current.detail, `${dataComponent}_fresh-loading`)).toBe(true);

    await act(async () => {
      requests.get(2)?.reject(new Error("not found"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.detailRefreshError).toBe(true));
    expect(result.current.detailClient).toBeNull();
    expect(hasDataComponent(result.current.detail, `${dataComponent}_fresh-error`)).toBe(true);

    await act(async () => {
      requests.get(1)?.resolve(makeClient(1));
      await Promise.resolve();
    });
    expect(result.current.detailClient).toBeNull();
  });

  it("does not let a pending fresh response overwrite an edited client", async () => {
    let resolveFresh!: (client: Client) => void;
    mockedFetchClient.mockImplementation(() => new Promise<Client>((resolve) => {
      resolveFresh = resolve;
    }));
    const client = makeClient(1);
    const { result } = renderHook(
      () => useClientDetailController({ client, dataComponent: "mobile_clients_detail-sheet_detail" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(resolveFresh).toBeDefined());
    const clientDetailProps = getClientDetailProps(result.current.detail);
    expect(clientDetailProps).not.toBeNull();
    act(() => clientDetailProps?.onClientUpdated({ ...client, name: "편집된 고객" }));
    expect(result.current.detailClient?.name).toBe("편집된 고객");
    expect(result.current.isDetailRefreshing).toBe(false);

    await act(async () => {
      resolveFresh({ ...client, name: "오래된 새로고침 응답" });
      await Promise.resolve();
    });
    expect(result.current.detailClient?.name).toBe("편집된 고객");
  });
});
