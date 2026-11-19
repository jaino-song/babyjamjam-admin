import { fireEvent, render, screen } from "@testing-library/react";
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

describe("FileUploadScreen busy feedback", () => {
  beforeEach(() => {
    upload.mockReset();
    mockCategories.mockReturnValue({ data: [{ id: "contract", label: "계약서" }], isSuccess: true });
    mockUpload.mockReturnValue({ mutateAsync: upload, isPending: false });
    mockCapabilities.mockReturnValue({ data: ownerCapabilities, isPending: false, isError: false });
  });

  it("preserves file progress and the idle action while busy, then restores the ready state", () => {
    const { container, rerender } = render(<FileUploadScreen />);
    selectFile(container);
    expect(screen.getByText("업로드 준비됨")).toBeInTheDocument();
    mockUpload.mockReturnValue({ mutateAsync: upload, isPending: true });
    rerender(<FileUploadScreen />);
    const button = screen.getByRole("button", { name: "업로드 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("relative");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    const idle = button.querySelector('[data-slot="button-idle"]');
    expect(idle).toHaveAttribute("aria-hidden", "true");
    expect(idle).toHaveClass("contents", "invisible");
    expect(idle).toHaveTextContent("업로드 완료");
    expect(button.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
    expect(screen.getByRole("status", { name: "업로드 중" })).toHaveAttribute("data-source-component", "LoadingState");
    expect(screen.getByText("contract.pdf")).toBeInTheDocument();
    expect(screen.getByText(/· 0%/)).toBeInTheDocument();
    expect(screen.queryByText("업로드 준비됨")).not.toBeInTheDocument();
    for (const label of screen.getAllByText("업로드 중")) expect(label).toHaveClass("sr-only");
    fireEvent.click(button);
    expect(upload).not.toHaveBeenCalled();
    mockUpload.mockReturnValue({ mutateAsync: upload, isPending: false });
    rerender(<FileUploadScreen />);
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeEnabled();
    expect(screen.getByText("업로드 준비됨")).toBeInTheDocument();
  });

  it("keeps chip removal available through its named touch target", () => {
    const { container } = render(<FileUploadScreen />);
    selectFile(container);
    const input = screen.getByPlaceholderText("태그 추가...");
    fireEvent.change(input, { target: { value: "QA-tag" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const remove = screen.getByRole("button", { name: "QA-tag 태그 삭제" });
    expect(remove).toHaveAttribute("data-slot", "tag-chip-x");
    fireEvent.click(remove);
    expect(screen.queryByRole("button", { name: "QA-tag 태그 삭제" })).not.toBeInTheDocument();
  });
});
