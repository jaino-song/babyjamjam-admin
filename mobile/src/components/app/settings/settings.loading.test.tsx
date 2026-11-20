import { act, fireEvent, render, screen } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { ImageDropzone } from "./ImageDropzone";
import { NotificationTestSection } from "./NotificationTestSection";
import { VoucherPriceUploadForm } from "./VoucherPriceUploadForm";

const mockParseImage = jest.fn();
const mockBulkUpdate = jest.fn();
let mockUpdating = false;
jest.mock("@/hooks/useVoucherPriceImageParsing", () => ({
  useParseVoucherImage: () => ({ mutateAsync: mockParseImage, isPending: false, isError: false, reset: jest.fn() }),
  useBulkUpdateVoucherPrices: () => ({ mutateAsync: mockBulkUpdate, isPending: mockUpdating, isError: false, reset: jest.fn() }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdating = false;
});

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

it("shows a named spinner while updating the parsed voucher prices and prevents a second update", async () => {
  const items = [{ type: "가형", duration: 10, fullPrice: "100", grant: "60", actualPrice: "40" }];
  mockParseImage.mockResolvedValueOnce({ parsedData: items, warnings: [], hasValidationWarnings: false });
  let finish!: (value: { updated: number[]; created: number[]; errors: string[] }) => void;
  mockBulkUpdate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { container, rerender } = render(<VoucherPriceUploadForm initialYear={2026} />);
  const file = new File(["QA-image"], "QA-voucher.png", { type: "image/png" });
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  });
  expect(mockParseImage).toHaveBeenCalledWith(file);
  fireEvent.click(screen.getByRole("button", { name: "2026년 요금표 업데이트" }));
  mockUpdating = true;
  rerender(<VoucherPriceUploadForm initialYear={2026} />);
  const button = screen.getByRole("button", { name: "업데이트 중" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  const idle = button.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent("2026년 요금표 업데이트");
  expect(button.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("업데이트 중")).toHaveClass("sr-only");
  fireEvent.click(button);
  expect(mockBulkUpdate).toHaveBeenCalledTimes(1);
  expect(mockBulkUpdate).toHaveBeenCalledWith({ items, year: 2026 });
  await act(async () => { finish({ updated: [1], created: [], errors: [] }); });
  expect(screen.queryByRole("button", { name: "업데이트 중" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "업데이트 완료!" })).toBeInTheDocument();
});
