import { act, renderHook, waitFor } from "@testing-library/react";

import type {
  EformsignContractClientCandidateResponse,
  EformsignDocClientSummary,
  EformsignDocument,
} from "@babyjamjam/shared/types/eformsign";

import { useClientDialogStore } from "@/stores/client-dialog-store";

import { useContractClientRegistration } from "../useContractClientRegistration";

const mockGetDocumentClientCandidate = jest.fn();
const mockPush = jest.fn();
const mockToast = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/services/api", () => ({
  eformsignApi: {
    getDocumentClientCandidate: (...args: unknown[]) => mockGetDocumentClientCandidate(...args),
  },
}));

const document = { id: "doc-1" } as EformsignDocument;
const candidate: EformsignContractClientCandidateResponse = {
  documentId: "doc-1",
  extracted: true,
  name: "홍길동",
  phone: "010-1234-5678",
  address: "인천시",
  birthday: "900101",
  dueDate: "2026-09-01",
  startDate: "2026-09-10",
  endDate: "2026-09-24",
  primaryEmployeeId: 17,
  secondaryEmployeeId: 23,
  type: "A형",
  duration: 15,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
};

const linkedMetadata = {
  documentId: "doc-1",
  clientId: 41,
  clientName: "홍길동",
  clientPhone: "010-1234-5678",
  providerName: null,
} satisfies EformsignDocClientSummary;

describe("useContractClientRegistration", () => {
  beforeEach(() => {
    mockGetDocumentClientCandidate.mockReset();
    mockPush.mockReset();
    mockToast.mockReset();
    act(() => useClientDialogStore.getState().reset());
  });

  it("fetches the candidate, stores the mapped prefill, and navigates once", async () => {
    mockGetDocumentClientCandidate.mockResolvedValue(candidate);
    const { result } = renderHook(() => useContractClientRegistration());

    await act(async () => {
      await result.current.handleOpenClientFromContract(document);
    });

    expect(mockGetDocumentClientCandidate).toHaveBeenCalledWith("doc-1");
    expect(useClientDialogStore.getState().prefillClient).toMatchObject({
      name: "홍길동",
      primaryEmployeeId: 17,
      secondaryEmployeeId: 23,
      fullPrice: "1000000",
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/clients/new");
    expect(result.current.isClientRegistrationPending).toBe(false);
  });

  it("ignores a repeated press while the first candidate request is pending", async () => {
    let resolveCandidate!: (value: EformsignContractClientCandidateResponse) => void;
    mockGetDocumentClientCandidate.mockReturnValue(
      new Promise<EformsignContractClientCandidateResponse>((resolve) => {
        resolveCandidate = resolve;
      }),
    );
    const { result } = renderHook(() => useContractClientRegistration());

    let firstRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.handleOpenClientFromContract(document);
    });
    await waitFor(() => expect(result.current.isClientRegistrationPending).toBe(true));

    await act(async () => {
      await result.current.handleOpenClientFromContract(document);
    });
    expect(mockGetDocumentClientCandidate).toHaveBeenCalledTimes(1);

    resolveCandidate(candidate);
    await act(async () => {
      await firstRequest;
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("clears stale prefill, shows a safe toast, and falls back to manual registration", async () => {
    act(() => {
      useClientDialogStore.setState({
        prefillName: "오래된 이름",
        prefillClient: { name: "오래된 이름", phone: "010-0000-0000" },
      });
    });
    mockGetDocumentClientCandidate.mockRejectedValue(new Error("upstream details"));
    const { result } = renderHook(() => useContractClientRegistration());

    await act(async () => {
      await result.current.handleOpenClientFromContract(document);
    });

    expect(useClientDialogStore.getState().prefillName).toBe("");
    expect(useClientDialogStore.getState().prefillClient).toBeNull();
    expect(mockToast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "계약 정보를 불러오지 못했어요",
      description: "고객 정보를 직접 입력해 주세요",
    });
    expect(mockPush).toHaveBeenCalledWith("/clients/new");
  });

  it("bypasses the candidate request for an existing client and opens edit", async () => {
    act(() => {
      useClientDialogStore.setState({
        prefillName: "오래된 이름",
        prefillClient: { name: "오래된 이름" },
      });
    });
    const { result } = renderHook(() => useContractClientRegistration());

    await act(async () => {
      await result.current.handleOpenClientFromContract(document, linkedMetadata);
    });

    expect(mockGetDocumentClientCandidate).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/clients/new?clientId=41");
    expect(useClientDialogStore.getState().prefillName).toBe("");
    expect(useClientDialogStore.getState().prefillClient).toBeNull();
  });

  it("invalidates a pending create when an existing-client edit takes over", async () => {
    let resolveCandidate!: (value: EformsignContractClientCandidateResponse) => void;
    mockGetDocumentClientCandidate.mockReturnValue(
      new Promise<EformsignContractClientCandidateResponse>((resolve) => {
        resolveCandidate = resolve;
      }),
    );
    const { result } = renderHook(() => useContractClientRegistration());

    let pendingRequest!: Promise<void>;
    act(() => {
      pendingRequest = result.current.handleOpenClientFromContract(document);
    });
    await waitFor(() => expect(result.current.isClientRegistrationPending).toBe(true));

    await act(async () => {
      await result.current.handleOpenClientFromContract(document, linkedMetadata);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/clients/new?clientId=41");

    resolveCandidate(candidate);
    await act(async () => {
      await pendingRequest;
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(useClientDialogStore.getState().prefillClient).toBeNull();
  });

  it("does not navigate when a candidate resolves after the hook unmounts", async () => {
    let resolveCandidate!: (value: EformsignContractClientCandidateResponse) => void;
    mockGetDocumentClientCandidate.mockReturnValue(
      new Promise<EformsignContractClientCandidateResponse>((resolve) => {
        resolveCandidate = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useContractClientRegistration());

    let pendingRequest!: Promise<void>;
    act(() => {
      pendingRequest = result.current.handleOpenClientFromContract(document);
    });
    await waitFor(() => expect(result.current.isClientRegistrationPending).toBe(true));
    unmount();

    resolveCandidate(candidate);
    await pendingRequest;
    expect(mockPush).not.toHaveBeenCalled();
    expect(useClientDialogStore.getState().prefillClient).toBeNull();
  });
});
