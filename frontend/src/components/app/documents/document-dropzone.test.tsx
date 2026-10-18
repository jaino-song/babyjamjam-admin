import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES } from "@babyjamjam/shared/file-storage";
import { DocumentDropzone } from "./document-dropzone";

jest.mock("@/hooks/use-document-categories", () => ({
  useDocumentCategories: () => ({ data: [{ id: "contract", label: "계약서" }] }),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/components/ui/title-select-molecule", () => ({
  TitleSelectMolecule: ({ onValueChange, value }: { onValueChange: (value: string) => void; value: string }) => (
    <select aria-label="카테고리" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">선택</option><option value="contract">계약서</option>
    </select>
  ),
}));

const ownerCapabilities = { ...DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES, canChooseVisibilityScope: true };

function selectFile(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["%PDF-1.4"], "contract.pdf", { type: "application/pdf" })] },
  });
  fireEvent.change(screen.getByLabelText("카테고리"), { target: { value: "contract" } });
}

describe("DocumentDropzone visibility", () => {
  it("blocks loading without guessing a branch notice", () => {
    const { container } = render(<DocumentDropzone onUpload={jest.fn()} />);
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
    expect(screen.queryByText(/현재 지점/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("blocks errors even with stale capabilities and retries", () => {
    const retry = jest.fn();
    const { container } = render(<DocumentDropzone onUpload={jest.fn()} capabilities={ownerCapabilities}
      capabilitiesError onRetryCapabilities={retry} />);
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
    expect(screen.getByText("불러오지 못했습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(["branch", "all_branches"] as const)("requires a choice, sends %s and resets after success", async (scope) => {
    const upload = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<DocumentDropzone onUpload={upload} capabilities={ownerCapabilities} />);
    expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
    selectFile(container);
    expect(screen.getByRole("button", { name: "문서 업로드" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: scope === "branch" ? "현재 지점" : "전 지점" }));
    expect(screen.getByText(scope === "branch" ? "현재 지점에서만 볼 수 있습니다." : "모든 지점에서 볼 수 있습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "문서 업로드" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ visibilityScope: scope })));
    await waitFor(() => expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true));
    expect(screen.getByRole("button", { name: "문서 업로드" })).toBeDisabled();
  });

  it("shows branch-only notice and sends branch for non-owners", async () => {
    const upload = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<DocumentDropzone onUpload={upload} capabilities={DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES} />);
    expect(screen.getByText("이 파일은 현재 지점에서만 볼 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    selectFile(container);
    fireEvent.click(screen.getByRole("button", { name: "문서 업로드" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ visibilityScope: "branch" })));
  });

  it("updates the second notice with the chosen scope", () => {
    render(<DocumentDropzone onUpload={jest.fn()} capabilities={ownerCapabilities} />);
    expect(screen.queryByText("오너 업로드 · 모든 지점에 공개")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "전 지점" }));
    expect(screen.getByText("오너 업로드 · 모든 지점에 공개")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "현재 지점" }));
    expect(screen.getByText("현재 지점에만 공개")).toBeInTheDocument();
    expect(screen.queryByText("오너 업로드 · 모든 지점에 공개")).not.toBeInTheDocument();
  });

  it("blocks a ready form when permissions fail and keeps the choice after an upload failure", async () => {
    const upload = jest.fn().mockRejectedValue(new Error("upload failed"));
    const { container, rerender } = render(<DocumentDropzone onUpload={upload} capabilities={ownerCapabilities} />);
    selectFile(container);
    fireEvent.click(screen.getByRole("radio", { name: "전 지점" }));
    rerender(<DocumentDropzone onUpload={upload} capabilities={ownerCapabilities} capabilitiesError />);
    expect(screen.getByRole("button", { name: "문서 업로드" })).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(upload).not.toHaveBeenCalled();
    rerender(<DocumentDropzone onUpload={upload} capabilities={ownerCapabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "문서 업로드" }));
    await waitFor(() => expect(screen.getByText("문서를 업로드하지 못했어요")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "전 지점" })).toHaveAttribute("aria-checked", "true");
  });
});
