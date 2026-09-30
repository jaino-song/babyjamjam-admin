import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { notificationSendApi } from "@/services/api";

import { SendNotificationSection } from "../SendNotificationSection";

const mockToast = jest.fn();

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/services/api", () => ({
  notificationSendApi: {
    listRecipients: jest.fn(),
    send: jest.fn(),
    broadcast: jest.fn(),
  },
  // Real implementation (not a mock): it only inspects the error shape, so
  // exercising the actual axios-code check is more honest than stubbing it.
  isNotificationSendTimeout: (error: unknown) =>
    Boolean(error)
    && typeof error === "object"
    && (error as { isAxiosError?: boolean }).isAxiosError === true
    && ((error as { code?: string }).code === "ECONNABORTED"
      || (error as { code?: string }).code === "ETIMEDOUT"),
}));

// The recipient picker is a Radix Select; no existing test in this repo drives
// one directly (see (protected)/messages/page.test.tsx), because jsdom needs
// pointer-capture/scrollIntoView polyfills it doesn't have. Follow that same
// repo convention: replace it with a plain button-per-option.
jest.mock("@/components/ui/select", () => {
  const SelectChangeContext = createContext<(value: string) => void>(() => {});

  function Select({
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) {
    return <SelectChangeContext.Provider value={onValueChange}>{children}</SelectChangeContext.Provider>;
  }
  function SelectTrigger({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  function SelectContent({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  function SelectValue() {
    return null;
  }
  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    const onValueChange = useContext(SelectChangeContext);
    return (
      <button type="button" onClick={() => onValueChange(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

const mockedListRecipients = notificationSendApi.listRecipients as jest.Mock;
const mockedSend = notificationSendApi.send as jest.Mock;
const mockedBroadcast = notificationSendApi.broadcast as jest.Mock;

const RECIPIENTS = [
  { id: "user-1", name: "박서연" },
  { id: "user-2", name: "김민준" },
];

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <SendNotificationSection branchId="branch-1" />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

const RECIPIENTS_QUERY_KEY = ["settings", "notification-recipients", "branch-1"] as const;

async function fillTitleAndBody(title: string, body: string) {
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("내용"), { target: { value: body } });
}

function submitForm() {
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
}

describe("SendNotificationSection", () => {
  beforeAll(() => {
    // RadioGroup/Dialog primitives measure themselves via ResizeObserver,
    // which jsdom doesn't implement (repo convention: see
    // EmployeeAutocomplete.test.tsx, ContractCreationForm.*.test.tsx).
    class ResizeObserverMock {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    }
    global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows a loading skeleton while recipients are loading", () => {
    mockedListRecipients.mockReturnValue(new Promise(() => {}));

    const { container } = renderSection();

    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it("shows an error message when recipients fail to load", async () => {
    mockedListRecipients.mockRejectedValue(new Error("network error"));

    renderSection();

    expect(await screen.findByText("받는 사람 목록을 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("shows an empty state when the branch has no recipients", async () => {
    mockedListRecipients.mockResolvedValue([]);

    renderSection();

    expect(
      await screen.findByText("이 지점에는 알림을 받을 직원이 없습니다."),
    ).toBeInTheDocument();
  });

  describe("with recipients loaded", () => {
    beforeEach(() => {
      mockedListRecipients.mockResolvedValue(RECIPIENTS);
    });

    it("keeps send disabled until both title and body are non-whitespace", async () => {
      renderSection();
      await screen.findByLabelText("제목");

      expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();

      fireEvent.change(screen.getByLabelText("제목"), { target: { value: "제목" } });
      expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();

      fireEvent.change(screen.getByLabelText("내용"), { target: { value: "   " } });
      expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();

      fireEvent.change(screen.getByLabelText("내용"), { target: { value: "내용" } });
      expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();

      fireEvent.change(screen.getByLabelText("제목"), { target: { value: "   " } });
      expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    });

    it("in one-person mode, keeps send disabled until a recipient is chosen", async () => {
      renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      await fillTitleAndBody("제목", "내용");

      expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();

      fireEvent.click(await screen.findByText("박서연"));

      expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    });

    it("shows title and body counters that respect maxLength", async () => {
      renderSection();
      await screen.findByLabelText("제목");

      expect(screen.getByText("0/100")).toBeInTheDocument();
      expect(screen.getByText("0/500")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("제목"), { target: { value: "안녕" } });
      fireEvent.change(screen.getByLabelText("내용"), { target: { value: "내용입니다" } });

      expect(screen.getByText("2/100")).toBeInTheDocument();
      expect(screen.getByText("5/500")).toBeInTheDocument();

      expect(screen.getByLabelText("제목")).toHaveAttribute("maxLength", "100");
      expect(screen.getByLabelText("내용")).toHaveAttribute("maxLength", "500");
    });

    it("shows a one-person confirm description and sends only on approval", async () => {
      mockedSend.mockResolvedValue(undefined);
      renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      fireEvent.click(await screen.findByText("박서연"));
      await fillTitleAndBody("제목", "내용");

      submitForm();

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("알림을 보낼까요?")).toBeInTheDocument();
      expect(
        within(dialog).getByText('박서연님에게 "제목" 알림을 보냅니다.'),
      ).toBeInTheDocument();

      expect(mockedSend).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockedSend).toHaveBeenCalledWith("user-1", { title: "제목", body: "내용" });
      });
    });

    it("shows a branch confirm description with the recipient count", async () => {
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText('지점 전체 2명에게 "공지" 알림을 보냅니다.'),
      ).toBeInTheDocument();
    });

    it("closing the confirm dialog sends nothing", async () => {
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("제목", "내용");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(mockedSend).not.toHaveBeenCalled();
      expect(mockedBroadcast).not.toHaveBeenCalled();
    });

    it("trims whitespace before sending, on approval in one-person mode", async () => {
      mockedSend.mockResolvedValue(undefined);
      renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      fireEvent.click(await screen.findByText("박서연"));
      await fillTitleAndBody("  제목  ", "  내용  ");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockedSend).toHaveBeenCalledWith("user-1", { title: "제목", body: "내용" });
      });
    });

    it("shows a success toast and clears the draft after a one-person send", async () => {
      mockedSend.mockResolvedValue(undefined);
      renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      fireEvent.click(await screen.findByText("박서연"));
      await fillTitleAndBody("제목", "내용");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          variant: "success",
          description: "박서연님에게 알림을 보냈어요",
        });
      });
      expect(screen.getByLabelText("제목")).toHaveValue("");
      expect(screen.getByLabelText("내용")).toHaveValue("");
    });

    it("shows a broadcast success toast with the sent count and clears the draft", async () => {
      mockedBroadcast.mockResolvedValue({ sent: 2, failed: 0 });
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          variant: "success",
          description: "2명에게 알림을 보냈어요",
        });
      });
      expect(screen.getByLabelText("제목")).toHaveValue("");
    });

    it("shows a destructive toast with sent/failed counts on partial failure and keeps the draft", async () => {
      mockedBroadcast.mockResolvedValue({ sent: 1, failed: 1 });
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          variant: "destructive",
          description: "1명에게 알림을 만들었고 1명은 실패했어요",
        });
      });
      expect(screen.getByLabelText("제목")).toHaveValue("공지");
      expect(screen.getByLabelText("내용")).toHaveValue("본문");
    });

    it("shows an error toast and keeps the draft when the send fails", async () => {
      mockedBroadcast.mockRejectedValue(new Error("network error"));
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          variant: "destructive",
          description: "알림을 보내지 못했어요",
        });
      });
      expect(screen.getByLabelText("제목")).toHaveValue("공지");
      expect(screen.getByLabelText("내용")).toHaveValue("본문");
    });

    it("guards against a double-click on approve firing two sends", async () => {
      // Never resolves: the assertion only needs the guard's synchronous
      // ref check, not a completed mutation.
      mockedSend.mockImplementation(() => new Promise<void>(() => {}));
      renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      fireEvent.click(await screen.findByText("박서연"));
      await fillTitleAndBody("제목", "내용");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      const approveButton = within(dialog).getByRole("button", { name: "보내기" });
      // Two synchronous clicks, with no await between them: react-query's
      // isPending flip is notified asynchronously, so it isn't necessarily
      // visible to a second click fired in the same tick. Only the ref
      // guard in the approve handler — set synchronously before mutate() —
      // can stop this from sending twice.
      fireEvent.click(approveButton);
      fireEvent.click(approveButton);

      await waitFor(() => expect(mockedSend).toHaveBeenCalled());
      expect(mockedSend).toHaveBeenCalledTimes(1);
    });

    it("closes the confirm modal and blocks approval if the chosen recipient drops out of a refetch", async () => {
      const { queryClient } = renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      fireEvent.click(await screen.findByText("박서연"));
      await fillTitleAndBody("제목", "내용");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "보내기" })).toBeEnabled();

      // Simulate a background refetch whose result no longer includes the
      // selected recipient (e.g. they were removed from the branch).
      act(() => {
        queryClient.setQueryData(RECIPIENTS_QUERY_KEY, [{ id: "user-2", name: "김민준" }]);
      });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(mockedSend).not.toHaveBeenCalled();
    });

    it("uses the recipient name captured at submit time for the success toast, even if the list changes before the send resolves", async () => {
      let resolveSend: () => void = () => {};
      mockedSend.mockImplementation(
        () => new Promise<void>((resolve) => { resolveSend = resolve; }),
      );
      const { queryClient } = renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      fireEvent.click(await screen.findByText("박서연"));
      await fillTitleAndBody("제목", "내용");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      // Wait for the in-flight send() call before mutating the cache and
      // resolving: react-query invokes the mutationFn a tick after mutate(),
      // so resolveSend() must not race ahead of the mock actually being
      // called (it would still be the pre-call no-op stub otherwise).
      await waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(1));

      // The recipient list changes while the send is still in flight — live
      // state can no longer resolve "user-1" to a name.
      act(() => {
        queryClient.setQueryData(RECIPIENTS_QUERY_KEY, [{ id: "user-2", name: "김민준" }]);
      });

      resolveSend();

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          variant: "success",
          description: "박서연님에게 알림을 보냈어요",
        });
      });
    });

    it("shows a destructive toast and keeps the draft when a broadcast reaches nobody", async () => {
      mockedBroadcast.mockResolvedValue({ sent: 0, failed: 0 });
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          variant: "destructive",
          description: "알림을 보내지 못했어요",
        });
      });
      expect(screen.getByLabelText("제목")).toHaveValue("공지");
      expect(screen.getByLabelText("내용")).toHaveValue("본문");
    });

    it("shows the timeout-specific message and keeps the draft when the send times out", async () => {
      const timeoutError = Object.assign(new Error("timeout of 120000ms exceeded"), {
        isAxiosError: true,
        code: "ECONNABORTED",
      });
      mockedBroadcast.mockRejectedValue(timeoutError);
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          variant: "destructive",
          description:
            "전송 결과를 확인하지 못했어요. 직원 알림함에서 확인한 뒤 필요할 때만 다시 보내 주세요",
        });
      });
      expect(screen.getByLabelText("제목")).toHaveValue("공지");
      expect(screen.getByLabelText("내용")).toHaveValue("본문");
    });

    it("closes the confirm modal after a failed send", async () => {
      mockedBroadcast.mockRejectedValue(new Error("network error"));
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("resets the recipient selection (not just title/body) after a successful one-person send", async () => {
      mockedSend.mockResolvedValue(undefined);
      renderSection();
      await screen.findByLabelText("제목");

      fireEvent.click(screen.getByRole("radio", { name: /직원 1명/ }));
      fireEvent.click(await screen.findByText("박서연"));
      await fillTitleAndBody("제목", "내용");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      // Still in one-person mode: refilling title/body without reselecting a
      // recipient must stay blocked, proving clearDraft() reset recipientId.
      await fillTitleAndBody("다음 공지", "다음 내용");
      expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    });

    it("disables the confirm approve button while a send is pending", async () => {
      let resolveBroadcast: (value: { sent: number; failed: number }) => void = () => {};
      mockedBroadcast.mockImplementation(
        () => new Promise((resolve) => { resolveBroadcast = resolve; }),
      );
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

      await waitFor(() => {
        expect(within(dialog).getByRole("button", { name: "보내는 중..." })).toBeDisabled();
      });

      resolveBroadcast({ sent: 2, failed: 0 });
    });

    it("associates the recipient radio group with its label and the counters with their inputs", async () => {
      renderSection();
      await screen.findByLabelText("제목");

      expect(screen.getByText("받는 사람")).toHaveAttribute(
        "id",
        "send-notification-recipient-label",
      );
      expect(screen.getByRole("radiogroup")).toHaveAttribute(
        "aria-labelledby",
        "send-notification-recipient-label",
      );
      expect(screen.getByLabelText("제목")).toHaveAttribute(
        "aria-describedby",
        "send-notification-title-counter",
      );
      expect(screen.getByLabelText("내용")).toHaveAttribute(
        "aria-describedby",
        "send-notification-body-counter",
      );
    });

    it("passes the confirm modal's name via the canonical data-component prop", async () => {
      renderSection();
      await screen.findByLabelText("제목");

      await fillTitleAndBody("공지", "본문");
      submitForm();

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveAttribute(
        "data-component",
        "desktop_settings_sections_send-notification_confirm",
      );
    });
  });
});
