import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES } from "@babyjamjam/shared/file-storage";
import { useDocumentUploadCapabilities, useUploadDocument } from "@/hooks/use-documents";
import { useDocumentCategories } from "@/hooks/use-document-categories";
import { FileUploadScreen } from "./file-upload-screen";

jest.mock("@/hooks/use-documents", () => ({ useDocumentUploadCapabilities: jest.fn(), useUploadDocument: jest.fn() }));
jest.mock("@/hooks/use-document-categories", () => ({
  useDocumentCategories: jest.fn(),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/use-navigation-pending", () => ({ useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

const mockCapabilities = useDocumentUploadCapabilities as jest.Mock;
const mockUpload = useUploadDocument as jest.Mock;
const mockCategories = useDocumentCategories as jest.Mock;
const ownerCapabilities = { ...DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES, canChooseVisibilityScope: true };
const upload = jest.fn();

function selectFile(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["%PDF-1.4"], "contract.pdf", { type: "application/pdf" })] },
  });
}

describe("FileUploadScreen", () => {
  beforeEach(() => {
    mockCategories.mockReturnValue({ data: [{ id: "contract", label: "계약서" }], isSuccess: true });
    upload.mockReset().mockResolvedValue({ id: "doc-1" });
    mockUpload.mockReturnValue({ mutateAsync: upload, isPending: false });
    mockCapabilities.mockReturnValue({ data: ownerCapabilities, isPending: false, isError: false, refetch: jest.fn() });
  });

  it("blocks loading without guessing a branch notice", () => {
    mockCapabilities.mockReturnValue({ data: undefined, isPending: true, isError: false });
    const { container } = render(<FileUploadScreen />);
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeDisabled();
    expect(screen.queryByText(/현재 지점/)).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "업로드 설정 불러오는 중" })).toBeInTheDocument();
  });

  it("blocks errors even with stale capabilities and retries", () => {
    const refetch = jest.fn();
    mockCapabilities.mockReturnValue({ data: ownerCapabilities, isPending: false, isError: true, refetch });
    const { container } = render(<FileUploadScreen />);
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeDisabled();
    expect(screen.getByText("불러오지 못했습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("has no visibility picker and sends branch (scope capability: %s)", async (canChooseVisibilityScope) => {
    mockCapabilities.mockReturnValue({ data: { ...ownerCapabilities, canChooseVisibilityScope }, isPending: false, isError: false });
    const { container } = render(<FileUploadScreen />);
    expect(screen.queryByRole("radiogroup", { name: "파일 공개 범위" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/현재 지점|전 지점|모든 지점/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="visibility-notice"]')).toBeNull();
    selectFile(container);
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "업로드 완료" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ visibilityScope: "branch" })));
  });

  it.each([
    { isLoading: true },
    { isLoading: false, isPaused: true },
  ])("shows category loading, not an empty state: %j", (state) => {
    mockCategories.mockReturnValue({ data: undefined, ...state });
    render(<FileUploadScreen />);
    expect(screen.getByRole("status", { name: "카테고리 불러오는 중" })).toBeInTheDocument();
    expect(screen.queryByText("업로드하려면 먼저 파일 카테고리를 등록해 주세요.")).not.toBeInTheDocument();
  });

  it("shows the empty state only after a successful empty load", () => {
    mockCategories.mockReturnValue({ data: [], isSuccess: true });
    const { container } = render(<FileUploadScreen />);
    expect(screen.getByText("업로드하려면 먼저 파일 카테고리를 등록해 주세요.")).toBeInTheDocument();
    selectFile(container);
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeDisabled();
  });

  it("shows category errors with retry and blocks stale-category submission", () => {
    const refetch = jest.fn();
    mockCategories.mockReturnValue({ data: [{ id: "contract", label: "계약서" }], isError: true, refetch });
    const { container } = render(<FileUploadScreen />);
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText("업로드하려면 먼저 파일 카테고리를 등록해 주세요.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    selectFile(container);
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeDisabled();
  });

  it("blocks a ready form when settings fail and retains the branch payload after an upload failure", async () => {
    upload.mockRejectedValue(new Error("upload failed"));
    const { container, rerender } = render(<FileUploadScreen />);
    selectFile(container);
    mockCapabilities.mockReturnValue({ data: ownerCapabilities, isError: true, isPending: false, refetch: jest.fn() });
    rerender(<FileUploadScreen />);
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "업로드 완료" }));
    expect(upload).not.toHaveBeenCalled();
    mockCapabilities.mockReturnValue({ data: ownerCapabilities, isError: false, isPending: false });
    rerender(<FileUploadScreen />);
    fireEvent.click(screen.getByRole("button", { name: "업로드 완료" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ visibilityScope: "branch" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("keeps back, cancel and file selection locked while uploading", () => {
    mockUpload.mockReturnValue({ mutateAsync: upload, isPending: true });
    const { container } = render(<FileUploadScreen />);
    expect(screen.getByRole("button", { name: "파일" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
    selectFile(container);
    expect(screen.getByText("탭하여 파일 업로드")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows the tap-to-upload title without a dropzone subtitle", () => {
    const { container } = render(<FileUploadScreen />);
    expect(screen.getByText("탭하여 파일 업로드")).toBeInTheDocument();
    expect(screen.queryByText("파일을 선택하거나 끌어다 놓으세요")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="empty-subtitle"]')).toBeNull();
    expect(screen.queryByText(/최대 .*파일 1개/)).not.toBeInTheDocument();
  });

  it.each([
    ["contract", "계약서", "file-pen-line"],
    ["invoice", "청구서", "receipt-text"],
    ["receipt", "영수증", "receipt"],
    ["report", "보고서", "file-chart-column"],
    ["certificate", "증명서", "badge-check"],
    ["form", "양식", "clipboard-list"],
    ["notice", "안내문", "megaphone"],
    ["employee-contract", "제공인력 계약서", "file-user"],
  ])("maps category %s by stable key and falls back to label", (value, label, icon) => {
    mockCategories.mockReturnValue({ data: [
      { id: "stable", value, label: "이름 변경" },
      { id: "label", value: "custom", label },
    ], isSuccess: true });
    render(<FileUploadScreen />);
    for (const name of ["이름 변경", label]) {
      expect(screen.getByRole("button", { name }).querySelector(`svg.lucide-${icon}`)).not.toBeNull();
    }
  });

  it("prefers the stable key over a different known label", () => {
    mockCategories.mockReturnValue({ data: [{ id: "stable", value: "invoice", label: "계약서" }], isSuccess: true });
    render(<FileUploadScreen />);
    expect(screen.getByRole("button", { name: "계약서" }).querySelector("svg.lucide-receipt-text")).not.toBeNull();
  });

  it.each([
    ["사진", "image"], ["정산", "file-spreadsheet"], ["문서", "file-text"], ["기타", "file"],
  ])("keeps the existing fallback icon for %s", (label, icon) => {
    mockCategories.mockReturnValue({ data: [{ id: "custom", value: "custom", label }], isSuccess: true });
    render(<FileUploadScreen />);
    expect(screen.getByRole("button", { name: label }).querySelector(`svg.lucide-${icon}`)).not.toBeNull();
  });

  it("moves the selected chip class and icon treatment with the selection", () => {
    mockCategories.mockReturnValue({ data: [
      { id: "contract", value: "contract", label: "계약서" },
      { id: "invoice", value: "invoice", label: "청구서" },
    ], isSuccess: true });
    render(<FileUploadScreen />);
    const contract = screen.getByRole("button", { name: "계약서" });
    const invoice = screen.getByRole("button", { name: "청구서" });
    expect(contract).toHaveClass("categoryChip", "selected");
    expect(invoice).not.toHaveClass("selected");
    expect(contract).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(invoice);
    expect(invoice).toHaveClass("selected");
    expect(invoice).toHaveAttribute("aria-pressed", "true");
    expect(contract).not.toHaveClass("selected");
    expect(contract).toHaveAttribute("aria-pressed", "false");
  });

});

it("uses shared pill footer actions and exact thirds after the gap", () => {
  const { container } = render(<FileUploadScreen />);
  const cancel = screen.getByRole("button", { name: "취소" });
  const submit = screen.getByRole("button", { name: "업로드 완료" });
  expect(cancel.parentElement?.children).toHaveLength(2);
  expect(cancel.nextElementSibling).toBe(submit);
  for (const [button, suffix] of [[cancel, "cancel"], [submit, "submit"]] as const) {
    expect(button).toHaveClass("h-10", "rounded-full");
    expect(button).toHaveAttribute("data-component", `mobile_files-upload_screen_root_actions_${suffix}`);
    expect(button).toHaveAttribute("data-slot", "button");
  }
  const css = readFileSync(path.join(__dirname, "file-upload-screen.module.css"), "utf8");
  expect(css).toMatch(/\.uploadActions \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\);/);
  expect(css).toMatch(/\.tagInputWrap \{[^}]*min-height: 44px;[^}]*border-radius: 12px;[^}]*background: white;/);
  expect(css).toMatch(/\.tagInput \{[^}]*font-size: 16px;/);
  expect(container.querySelector('[data-slot="tag-input-wrap"]')).toContainElement(screen.getByPlaceholderText("태그 추가..."));
});
