import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES } from "@babyjamjam/shared/file-storage";
import { useDocumentUploadCapabilities, useUploadDocument } from "@/hooks/use-documents";
import { FileUploadScreen } from "./file-upload-screen";

jest.mock("@/hooks/use-documents", () => ({ useDocumentUploadCapabilities: jest.fn(), useUploadDocument: jest.fn() }));
jest.mock("@/hooks/use-document-categories", () => ({
  useDocumentCategories: () => ({ data: [{ id: "contract", label: "계약서" }] }),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/use-navigation-pending", () => ({ useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

const mockCapabilities = useDocumentUploadCapabilities as jest.Mock;
const mockUpload = useUploadDocument as jest.Mock;
const ownerCapabilities = { ...DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES, canChooseVisibilityScope: true };
const upload = jest.fn();

function selectFile(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["%PDF-1.4"], "contract.pdf", { type: "application/pdf" })] },
  });
}

describe("FileUploadScreen visibility", () => {
  beforeEach(() => {
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
    expect(screen.getByRole("status")).toBeInTheDocument();
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

  it.each(["branch", "all_branches"] as const)("requires a choice, sends %s and resets after success", async (scope) => {
    const { container } = render(<FileUploadScreen />);
    expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
    selectFile(container);
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: scope === "branch" ? "현재 지점" : "전 지점" }));
    expect(screen.getByText(scope === "branch" ? "현재 지점에서만 볼 수 있습니다." : "모든 지점에서 볼 수 있습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "업로드 완료" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ visibilityScope: scope })));
    await waitFor(() => expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true));
  });

  it("shows branch-only notice and sends branch for non-owners", async () => {
    mockCapabilities.mockReturnValue({ data: DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES, isError: false, isPending: false });
    const { container } = render(<FileUploadScreen />);
    expect(screen.getByText("이 파일은 현재 지점에서만 볼 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    selectFile(container);
    fireEvent.click(screen.getByRole("button", { name: "업로드 완료" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ visibilityScope: "branch" })));
  });

  it("blocks a ready form when permissions fail and keeps the choice after an upload failure", async () => {
    upload.mockRejectedValue(new Error("upload failed"));
    const { container, rerender } = render(<FileUploadScreen />);
    selectFile(container);
    fireEvent.click(screen.getByRole("radio", { name: "전 지점" }));
    mockCapabilities.mockReturnValue({ data: ownerCapabilities, isError: true, isPending: false, refetch: jest.fn() });
    rerender(<FileUploadScreen />);
    expect(screen.getByRole("button", { name: "업로드 완료" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "업로드 완료" }));
    expect(upload).not.toHaveBeenCalled();
    mockCapabilities.mockReturnValue({ data: ownerCapabilities, isError: false, isPending: false });
    rerender(<FileUploadScreen />);
    fireEvent.click(screen.getByRole("button", { name: "업로드 완료" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("radio", { name: "전 지점" })).toHaveAttribute("aria-checked", "true");
  });
});
