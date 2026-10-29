import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

import { toast, useToast } from "@/hooks/use-toast";

import { ToastAction, Toaster } from "./toaster";

afterEach(async () => {
  // The toast store is module-level; empty it so tests do not see each other.
  jest.useRealTimers();
  const { result, unmount } = renderHook(() => useToast());
  act(() => result.current.dismiss());
  await waitFor(() => expect(result.current.toasts).toHaveLength(0));
  unmount();
});

describe("Toaster", () => {
  it("renders an existing toast and dismisses it through its close action", async () => {
    render(<Toaster />);

    act(() => {
      toast({
        description: "저장되었습니다.",
        title: "테스트 알림",
      });
    });

    expect(await screen.findByText("테스트 알림")).toBeInTheDocument();
    expect(screen.getByText("저장되었습니다.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-component",
      "mobile_shell_toaster",
    );

    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));

    await waitFor(() => {
      expect(screen.queryByText("테스트 알림")).not.toBeInTheDocument();
    });
  });

  it("renders every variant on the same dark surface", async () => {
    render(<Toaster />);

    for (const variant of ["default", "success", "destructive"] as const) {
      act(() => {
        toast({ title: `알림-${variant}`, variant });
      });
      const title = await screen.findByText(`알림-${variant}`);
      const surface = title.closest('[data-component="mobile_shell_toaster_toast"]');
      expect(surface).toHaveAttribute("data-variant", variant);
      expect(surface).toHaveClass("bg-v3-dark", "text-white");
    }
  });

  it("shows a leading icon for success and destructive only", async () => {
    const { container } = render(<Toaster />);
    const icon = () => container.querySelector('[data-slot="toast-icon"]');

    act(() => {
      toast({ title: "기본", variant: "default" });
    });
    await screen.findByText("기본");
    expect(icon()).toBeNull();

    act(() => {
      toast({ title: "성공", variant: "success" });
    });
    await screen.findByText("성공");
    expect(icon()).toHaveClass("bg-green-500");
    expect(icon()?.querySelector("svg")).not.toBeNull();

    act(() => {
      toast({ title: "실패", variant: "destructive" });
    });
    await screen.findByText("실패");
    expect(icon()).toHaveClass("bg-red-500");
    expect(icon()).toHaveTextContent("!");
  });

  it("exposes title, description and close as slots", async () => {
    const { container } = render(<Toaster />);

    act(() => {
      toast({ title: "제목", description: "설명" });
    });
    await screen.findByText("제목");

    expect(container.querySelector('[data-slot="toast-title"]')).toHaveTextContent("제목");
    expect(container.querySelector('[data-slot="toast-description"]')).toHaveTextContent("설명");
    expect(container.querySelector('[data-slot="toast-close"]')).toHaveAccessibleName("알림 닫기");
  });

  it("renders the action, runs its onClick and dismisses the toast", async () => {
    const onClick = jest.fn();
    render(<Toaster />);

    act(() => {
      toast({
        title: "1회차 수정이 저장됐어요",
        variant: "success",
        action: <ToastAction onClick={onClick}>기록 보기</ToastAction>,
      });
    });

    const action = await screen.findByRole("button", { name: "기록 보기" });
    expect(action).toHaveAttribute("data-slot", "toast-action");
    expect(action).toHaveClass("min-h-11", "min-w-11");

    fireEvent.click(action);

    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText("1회차 수정이 저장됐어요")).not.toBeInTheDocument();
    });
  });
});

describe("toast timing", () => {
  it("auto-dismisses a plain toast after 3000 ms", () => {
    jest.useFakeTimers();
    render(<Toaster />);

    act(() => {
      toast({ title: "일반 알림" });
    });
    expect(screen.getByText("일반 알림")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2999);
    });
    expect(screen.getByText("일반 알림").closest("[data-component]")).not.toHaveClass("animate-out");

    act(() => {
      jest.advanceTimersByTime(1);
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByText("일반 알림")).not.toBeInTheDocument();
  });

  it("keeps a toast that carries an action for 5000 ms", () => {
    jest.useFakeTimers();
    render(<Toaster />);

    act(() => {
      toast({ title: "액션 알림", action: <ToastAction>보기</ToastAction> });
    });

    act(() => {
      jest.advanceTimersByTime(4999);
    });
    expect(screen.getByText("액션 알림").closest("[data-component]")).not.toHaveClass("animate-out");

    act(() => {
      jest.advanceTimersByTime(1);
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByText("액션 알림")).not.toBeInTheDocument();
  });
});
