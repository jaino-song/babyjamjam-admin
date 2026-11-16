import { fireEvent, render, screen } from "@testing-library/react";

import type { Document } from "@/hooks/use-documents";
import { AddCategoryModal } from "./add-category-modal";
import { DocumentEditModal } from "./document-edit-modal";
import { DocumentDropzone } from "./document-dropzone";
import DocumentPreviewModal from "./document-preview-modal";

jest.mock("@/hooks/use-document-categories", () => ({ useDocumentCategories: () => ({ data: [] }) }));
jest.mock("@/hooks/useAuthenticatedFileUrl", () => ({ useAuthenticatedFileUrl: () => ({ url: null }) }));

const doc: Document = {
  id: "qa-doc", name: "QA-문서", categoryId: "contract", tags: [], mimeType: "application/pdf",
  fileSize: 100, storagePath: "qa/document.pdf", uploadedBy: "QA", createdAt: "2026-11-17T00:00:00Z",
  updatedAt: "2026-11-17T00:00:00Z", visibilityScope: "branch", canManage: true,
};

function expectBusy(label: string, idleLabel: string) {
  const button = screen.getByRole("button", { name: label });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  const idle = button.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent(idleLabel);
  expect(button.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
  expect(screen.getByText(label)).toHaveClass("sr-only");
  return button;
}

it("uses a spinner and accessible label while adding a category", () => {
  const onAdd = jest.fn();
  render(<AddCategoryModal data-component="mobile_documents_add-category" open onClose={jest.fn()} onAdd={onAdd} existingColors={[]} isLoading />);
  fireEvent.click(expectBusy("추가 중", "추가"));
  expect(onAdd).not.toHaveBeenCalled();
});

it("uses a spinner while saving document edits and blocks duplicate saves", () => {
  const onSave = jest.fn();
  render(<DocumentEditModal data-component="mobile_documents_edit" open onClose={jest.fn()} doc={doc} onSave={onSave} isLoading />);
  fireEvent.click(expectBusy("저장 중", "저장"));
  expect(onSave).not.toHaveBeenCalled();
});

it.each(["application/pdf", "image/png"])("names the preview loading state for %s without visible loading text", (mimeType) => {
  render(<DocumentPreviewModal data-component="mobile_documents_preview" open onClose={jest.fn()} doc={{ ...doc, mimeType }} categories={[]} />);
  const status = screen.getByRole("status", { name: "파일을 불러오는 중" });
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("파일을 불러오는 중")).toHaveClass("sr-only");
});

it("keeps the upload filename and percentage while showing only spinners for the generic busy label", () => {
  const onUpload = jest.fn();
  const { container, rerender } = render(<DocumentDropzone data-component="mobile_documents_upload" onUpload={onUpload} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["%PDF"], "QA-document.pdf", { type: "application/pdf" })] },
  });
  rerender(<DocumentDropzone data-component="mobile_documents_upload" onUpload={onUpload} isLoading uploadProgress={37} />);
  expect(screen.getByText("QA-document.pdf")).toBeInTheDocument();
  expect(screen.getByText("37%")).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "업로드 중" })).toHaveAttribute("data-source-component", "LoadingState");
  const button = screen.getByRole("button", { name: "업로드 중" });
  expect(button).toBeDisabled();
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("문서 업로드");
  fireEvent.click(button);
  expect(onUpload).not.toHaveBeenCalled();
  for (const label of screen.getAllByText("업로드 중")) expect(label).toHaveClass("sr-only");
});
