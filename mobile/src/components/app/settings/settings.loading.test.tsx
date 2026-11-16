import { act, fireEvent, render, screen } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { ImageDropzone } from "./ImageDropzone";
import { NotificationTestSection } from "./NotificationTestSection";

jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));

it("shows the image analysis label only to assistive technology", () => {
  render(<ImageDropzone data-component="mobile_settings_voucher-upload_image" onFileSelect={jest.fn()} isLoading />);
  const status = screen.getByRole("status", { name: "이미지 분석 중" });
  expect(status.tagName).toBe("SPAN");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("이미지 분석 중")).toHaveClass("sr-only");
});

it("keeps the notification button width content while hiding it during a pending send", async () => {
  let finish!: (value: { data: { sent: number; failed: number } }) => void;
  jest.mocked(api.post).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<NotificationTestSection />);
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  const button = screen.getByRole("button", { name: "전송 중" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  const idle = button.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent("테스트 알림 보내기");
  expect(button.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
  expect(screen.getByText("전송 중")).toHaveClass("sr-only");
  fireEvent.click(button);
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ data: { sent: 1, failed: 0 } }); });
  expect(screen.getByRole("button", { name: "테스트 알림 보내기" })).toBeEnabled();
});
