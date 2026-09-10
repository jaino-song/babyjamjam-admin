import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SystemTemplate } from "../types";
import { useUpdateSystemTemplate } from "../hooks";
import { SystemTemplateEditor } from "./system-template-editor";

const mockToast = jest.fn();
const mockMutateAsync = jest.fn();

jest.mock("../hooks", () => ({
  useUpdateSystemTemplate: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function buildTemplate(overrides: Partial<SystemTemplate> = {}): SystemTemplate {
  return {
    id: "system-template-1",
    templateKey: "GREETING",
    name: "인사(소개)",
    description: "초기 문의 안내",
    content: "안녕하세요 {{name}}",
    requiredVariables: [],
    customVariables: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const contentPlaceholder = "템플릿 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다.";

beforeEach(() => {
  jest.clearAllMocks();
  mockMutateAsync.mockResolvedValue(undefined);
  jest.mocked(useUpdateSystemTemplate).mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  } as never);
});

describe("SystemTemplateEditor", () => {
  it("reports unsaved content changes through the optional preview callback", () => {
    const onPreviewMessageChange = jest.fn();

    render(
      <SystemTemplateEditor
        template={buildTemplate()}
        onPreviewMessageChange={onPreviewMessageChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(contentPlaceholder), {
      target: { value: "미리보기에 표시할 본문" },
    });

    expect(onPreviewMessageChange).toHaveBeenCalledTimes(1);
    expect(onPreviewMessageChange).toHaveBeenLastCalledWith("미리보기에 표시할 본문");
  });

  it("syncs pristine editor state from refreshed detail props and disables Save", async () => {
    const onPreviewMessageChange = jest.fn();
    const { rerender } = render(
      <SystemTemplateEditor
        template={buildTemplate()}
        onPreviewMessageChange={onPreviewMessageChange}
      />,
    );

    rerender(
      <SystemTemplateEditor
        template={buildTemplate({
          content: "서버에서 새로 받은 본문",
          customVariables: [{ key: "client", label: "고객명", required: true }],
        })}
        onPreviewMessageChange={onPreviewMessageChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(contentPlaceholder)).toHaveValue("서버에서 새로 받은 본문");
    });
    expect(onPreviewMessageChange).toHaveBeenLastCalledWith("서버에서 새로 받은 본문");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("preserves a dirty draft when refreshed detail props change", async () => {
    const initialTemplate = buildTemplate();
    const { rerender } = render(<SystemTemplateEditor template={initialTemplate} />);

    fireEvent.change(screen.getByPlaceholderText(contentPlaceholder), {
      target: { value: "사용자가 계속 편집 중인 본문" },
    });

    rerender(
      <SystemTemplateEditor
        template={buildTemplate({
          content: "백그라운드에서 갱신된 본문",
          customVariables: [{ key: "client", label: "고객명", required: true }],
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(contentPlaceholder)).toHaveValue("사용자가 계속 편집 중인 본문");
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        key: "GREETING",
        content: "사용자가 계속 편집 중인 본문",
        customVariables: [{ key: "client", label: "고객명", required: true }],
      });
    });
  });
});
