/* eslint-disable @next/next/no-img-element */

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DocumentPreviewModal from "../document-preview-modal";
import type { Document } from "@/hooks/use-documents";
import type { DocumentCategory } from "@/hooks/use-document-categories";

interface MockPdfDocumentProps {
  children: ReactNode;
  onLoadSuccess?: ({ numPages }: { numPages: number }) => void;
}

interface MockPdfPageProps {
  pageNumber: number;
  width: number;
}

type MockNextImageProps = ComponentPropsWithoutRef<"img"> & {
  unoptimized?: boolean;
};

jest.mock("@/lib/pdf-config", () => ({}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: MockNextImageProps) => {
    const { unoptimized, alt, ...imgProps } = props;
    void unoptimized;

    return <img {...imgProps} alt={alt ?? ""} />;
  },
}));

jest.mock("react-pdf", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    Document: ({ children, onLoadSuccess }: MockPdfDocumentProps) => {
      React.useEffect(() => {
        onLoadSuccess?.({ numPages: 2 });
      }, [onLoadSuccess]);

      return <div data-testid="pdf-document">{children}</div>;
    },
    Page: ({ pageNumber, width }: MockPdfPageProps) => (
      <div data-testid={`pdf-page-${pageNumber}`} data-width={width}>
        Page {pageNumber}
      </div>
    ),
  };
});

const categories: DocumentCategory[] = [
  {
    id: "contracts",
    value: "contracts",
    label: "계약서",
    color: "#1d4ed8",
    isCustom: false,
    createdAt: "2026-01-29T00:00:00.000Z",
  },
];

const baseDocument: Document = {
  id: "doc-1",
  name: "업무위탁계약서",
  description: "테스트 문서",
  categoryId: "contracts",
  tags: ["계약"],
  mimeType: "application/pdf",
  fileSize: 62361,
  storagePath: "/contracts/doc-1.pdf",
  uploadedBy: "tester",
  createdAt: "2026-01-29T00:00:00.000Z",
  updatedAt: "2026-01-29T00:00:00.000Z",
};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
});

describe("DocumentPreviewModal", () => {
  it("renders a zoom slider for pdf previews and updates the page width", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
      />
    );

    const slider = screen.getByLabelText("PDF 미리보기 확대/축소");
    expect(slider).toHaveValue("100");
    expect(screen.getByText("100%")).toBeInTheDocument();

    await screen.findByTestId("pdf-page-1");
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "320");

    fireEvent.change(slider, { target: { value: "150" } });

    await waitFor(() => {
      expect(screen.getByText("150%")).toBeInTheDocument();
      expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "480");
    });
  });

  it("uses the same zoom slider pattern for image previews", () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={{
          ...baseDocument,
          id: "img-1",
          name: "현장사진.jpg",
          mimeType: "image/jpeg",
        }}
        categories={categories}
      />
    );

    const slider = screen.getByLabelText("이미지 미리보기 확대/축소");
    const image = screen.getByAltText("현장사진.jpg");

    expect(slider).toHaveValue("100");
    expect(image).toHaveStyle({ transform: "scale(1)" });

    fireEvent.change(slider, { target: { value: "125" } });

    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(image).toHaveStyle({ transform: "scale(1.25)" });
  });
});
