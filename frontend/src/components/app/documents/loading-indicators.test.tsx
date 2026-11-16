import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES } from "@babyjamjam/shared/file-storage";
import { DocumentDropzone } from "./document-dropzone";
import { AddCategoryModal } from "./add-category-modal";
import { ImageDropzone } from "../settings/ImageDropzone";

jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/use-document-categories", () => ({
  useDocumentCategories: () => ({ data: [{ id: "contract", label: "계약서" }], isSuccess: true }),
}));

describe("document loading indicators", () => {
  it("keeps the file and percentage while hiding generic upload text and preserving icon hit areas", () => {
    const props = { onUpload: jest.fn(), capabilities: DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES };
    const { container, rerender } = render(<DocumentDropzone {...props} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["%PDF-1.4"], "QA-contract.pdf", { type: "application/pdf" })] },
    });
    // The remove-file action is the icon button in the upload form.
    const remove = container.querySelector('[data-size="icon"]')!;
    expect(remove).toHaveClass("h-[calc(32px*var(--glint-ui-scale,1))]", "after:h-[calc(44px*var(--glint-ui-scale,1))]");
    expect(remove).not.toHaveClass("h-10", "w-10");

    rerender(<DocumentDropzone {...props} isLoading uploadProgress={42} />);
    expect(screen.getByText("QA-contract.pdf")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "업로드 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    const idle = button.querySelector('[data-slot="button-idle"]')!;
    expect(idle).toHaveAttribute("aria-hidden", "true");
    expect(idle).toHaveClass("contents", "invisible");
    expect(within(screen.getByRole("status", { name: "업로드 중" })).getByText("업로드 중")).toHaveClass("sr-only");
    expect(remove).toBeDisabled();

    rerender(<DocumentDropzone {...props} />);
    expect(screen.getByRole("button", { name: "문서 업로드" })).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("status", { name: "업로드 중" })).not.toBeInTheDocument();
  });

  it("uses a Spinner for category creation without changing the idle action", () => {
    const props = { open: true, onClose: jest.fn(), onAdd: jest.fn(), existingColors: [] };
    const { rerender } = render(<AddCategoryModal {...props} isLoading />);
    const button = screen.getByRole("button", { name: "추가 중" });
    expect(button).toBeDisabled();
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(within(button).getByText("추가 중")).toHaveClass("sr-only");
    rerender(<AddCategoryModal {...props} />);
    expect(screen.getByRole("button", { name: "추가" })).not.toHaveAttribute("data-loading");
  });

  it("announces image analysis through an inline status while rendering only a Spinner", () => {
    render(<ImageDropzone onFileSelect={jest.fn()} isLoading />);
    const status = screen.getByRole("status", { name: "이미지 분석 중" });
    expect(status.tagName).toBe("SPAN");
    expect(within(status).getByText("이미지 분석 중")).toHaveClass("sr-only");
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  });
});
