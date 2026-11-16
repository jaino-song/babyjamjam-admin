import type { ComponentPropsWithoutRef } from "react";
import { act, render, screen } from "@testing-library/react";

import { SharedDocumentPreviewDialog } from "../shared-document-preview-dialog";

jest.mock("@/lib/pdf-config", () => ({}));
jest.mock("react-pdf", () => ({ Document: () => null, Page: () => null }));
jest.mock("../hwp-document-preview", () => ({ HwpDocumentPreview: () => null }));
jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ unoptimized, alt, ...props }: ComponentPropsWithoutRef<"img"> & { unoptimized?: boolean }) => {
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={alt} />;
  },
}));

it("uses a single live region for availability checks and image loading", async () => {
  const originalFetch = global.fetch;
  let resolveAvailability!: (response: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>((resolve) => { resolveAvailability = resolve; }));
  const view = render(<SharedDocumentPreviewDialog open onClose={jest.fn()} title="QA-미리보기"
    srDescription="QA-문서 미리보기" metaItems={[]} previewKind="image" previewUrl="/qa-preview.png"
    data-component="desktop_documents_tests_preview" />);
  try {
    const checking = screen.getByRole("status", { name: "미리보기 파일을 확인하는 중입니다" });
    expect(checking.parentElement?.closest('[aria-live], [role="status"]')).toBeNull();

    await act(async () => { resolveAvailability({ ok: true, status: 200 } as Response); });

    const loading = screen.getByRole("status", { name: "이미지를 불러오는 중입니다" });
    expect(loading.parentElement?.closest('[aria-live], [role="status"]')).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  } finally {
    view.unmount();
    global.fetch = originalFetch;
  }
});
