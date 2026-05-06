/* eslint-disable @next/next/no-img-element */

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DocumentPreviewModal from "../document-preview-modal";
import { getDownloadFileName, getPreviewKind } from "../document-preview-utils";
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

const mockRhwpInit = jest.fn(() => Promise.resolve({}));
const mockHwpFree = jest.fn();
const mockRenderPageSvg = jest.fn((pageNumber: number) => (
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><text>HWP page ${pageNumber + 1}</text></svg>`
));
const mockPageCount = jest.fn(() => 2);

jest.mock("@/lib/pdf-config", () => ({}));

jest.mock("@rhwp/core", () => ({
  __esModule: true,
  default: mockRhwpInit,
  HwpDocument: jest.fn().mockImplementation(() => ({
    free: mockHwpFree,
    pageCount: mockPageCount,
    renderPageSvg: mockRenderPageSvg,
  })),
}));

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

function dispatchPinchWheel(target: Element, deltaY: number) {
  return fireEvent(
    target,
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY,
    })
  );
}

let blobUrlIndex = 0;
const originalFetch = global.fetch;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

beforeAll(() => {
  global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn(() => {
      blobUrlIndex += 1;
      return `blob:mock-hwp-${blobUrlIndex}`;
    }),
  });

  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn(),
  });
});

beforeEach(() => {
  blobUrlIndex = 0;
  jest.clearAllMocks();
});

afterAll(() => {
  global.fetch = originalFetch;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
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

  it("updates PDF zoom from trackpad pinch wheel events", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
      />
    );

    await screen.findByTestId("pdf-page-1");

    const previewCanvas = document.querySelector('[data-component="document-preview-canvas"]');
    expect(previewCanvas).not.toBeNull();
    if (!previewCanvas) {
      throw new Error("document preview canvas was not rendered");
    }

    const previewDialog = document.querySelector('[data-component="contracts-document-preview"]');
    expect(previewDialog).not.toBeNull();
    if (!previewDialog) {
      throw new Error("document preview dialog was not rendered");
    }

    dispatchPinchWheel(previewDialog, -40);
    expect(screen.getByLabelText("PDF 미리보기 확대/축소")).toHaveValue("100");

    dispatchPinchWheel(previewCanvas, -40);

    await waitFor(() => {
      expect(screen.getByLabelText("PDF 미리보기 확대/축소")).toHaveValue("105");
      expect(screen.getByText("105%")).toBeInTheDocument();
      expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "336");
    });

    dispatchPinchWheel(previewCanvas, 40);

    await waitFor(() => {
      expect(screen.getByLabelText("PDF 미리보기 확대/축소")).toHaveValue("100");
      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "320");
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

  it("renders a Hangul document preview from an HWP storage extension", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={{
          ...baseDocument,
          id: "hwp-1",
          name: "산후도우미신청서",
          mimeType: "application/octet-stream",
          storagePath: "/documents/hwp-1.hwp",
        }}
        categories={categories}
      />
    );

    expect(screen.getByText("hwp")).toBeInTheDocument();

    const slider = screen.getByLabelText("한글 문서 미리보기 확대/축소");
    expect(slider).toHaveValue("100");

    const firstHwpPage = await screen.findByTestId("hwp-page-1");
    expect(firstHwpPage).toBeInTheDocument();
    expect(firstHwpPage).not.toHaveClass("rounded-[20px]");
    expect(screen.getByAltText("산후도우미신청서 1페이지")).toHaveAttribute("src", "blob:mock-hwp-1");
    expect(screen.queryByText("인쇄")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockRhwpInit).toHaveBeenCalledWith({ module_or_path: "/vendor/rhwp/rhwp_bg.wasm" });
      expect(global.fetch).toHaveBeenCalledWith("/api/file-storage/files/hwp-1/download");
      expect(mockRenderPageSvg).toHaveBeenCalledTimes(2);
    });
  });

  it("detects Hangul preview and download extensions from stored paths", () => {
    const hwpDoc = {
      ...baseDocument,
      name: "신청서",
      mimeType: "application/octet-stream",
      storagePath: "/documents/source.hwp",
    };
    const hwpxDoc = {
      ...baseDocument,
      name: "신청서",
      mimeType: "application/octet-stream",
      storagePath: "/documents/source.hwpx",
    };

    expect(getPreviewKind(hwpDoc)).toBe("hwp");
    expect(getDownloadFileName(hwpDoc)).toBe("신청서.hwp");
    expect(getPreviewKind(hwpxDoc)).toBe("hwp");
    expect(getDownloadFileName(hwpxDoc)).toBe("신청서.hwpx");
  });
});
