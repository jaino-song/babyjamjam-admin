import { act, createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SystemTemplate } from "../types";
import { useUpdateSystemTemplate } from "../hooks";
import { SystemTemplateEditor } from "./system-template-editor";
import type { SystemTemplateEditorHandle } from "./system-template-editor";

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

function getContentField() {
  return screen.getByRole("textbox", { name: "템플릿 내용" });
}

function readContent() {
  const clone = getContentField().cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-variable-key]").forEach((node) => {
    node.replaceWith(document.createTextNode(`{{${node.getAttribute("data-variable-key")}}}`));
  });
  clone.querySelectorAll("br").forEach((node) => {
    node.replaceWith(document.createTextNode(node.classList.contains("ProseMirror-trailingBreak") ? "" : "\n"));
  });
  return clone.textContent;
}

function replaceContent(value: string) {
  const field = getContentField();
  act(() => {
    field.focus();
    fireEvent.keyDown(field, { key: "a", code: "KeyA", ctrlKey: true });
    fireEvent.paste(field, { clipboardData: { getData: () => value } });
  });
}

const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const originalRangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

beforeAll(() => {
  // jsdom has selection ranges but no layout geometry. Tiptap requests these
  // only to scroll the focused selection; layout is checked in a real browser.
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => document.createElement("span").getBoundingClientRect(),
  });
});

afterAll(() => {
  for (const [name, descriptor] of [
    ["getClientRects", originalRangeRects],
    ["getBoundingClientRect", originalRangeBounds],
  ] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else Reflect.deleteProperty(Range.prototype, name);
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  document.cookie = "selected_branch_id=branch-test; path=/";
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

    replaceContent("미리보기에 표시할 본문");

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
      expect(readContent()).toBe("서버에서 새로 받은 본문");
    });
    expect(onPreviewMessageChange).toHaveBeenLastCalledWith("서버에서 새로 받은 본문");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("accepts a detail payload without customVariables without entering a render loop", async () => {
    render(<SystemTemplateEditor template={buildTemplate({ customVariables: undefined })} />);

    await waitFor(() => expect(readContent()).toBe("안녕하세요 {{name}}"));
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("preserves a dirty draft when refreshed detail props change", async () => {
    const initialTemplate = buildTemplate();
    const { rerender } = render(<SystemTemplateEditor template={initialTemplate} />);

    replaceContent("사용자가 계속 편집 중인 본문");

    rerender(
      <SystemTemplateEditor
        template={buildTemplate({
          content: "백그라운드에서 갱신된 본문",
          customVariables: [{ key: "client", label: "고객명", required: true }],
        })}
      />,
    );

    await waitFor(() => {
      expect(readContent()).toBe("사용자가 계속 편집 중인 본문");
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

  it("uses the shared editor for a branch scope and captures its branch identity", async () => {
    render(
      <SystemTemplateEditor
        template={buildTemplate()}
        scope="branch"
        branchId="branch-test"
        dataComponent="desktop_messages_templates_editor"
      />,
    );

    expect(
      screen.getByText(
        "이 템플릿을 처음 저장하면 지점의 모든 템플릿이 현재 기본값으로 고정됩니다. 이후 오너가 기본값을 바꿔도 이 지점에는 자동으로 적용되지 않습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-component="desktop_messages_templates_editor_content-input"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

    replaceContent("지점 전용 본문");
    fireEvent.click(
      document.querySelector('[data-component="desktop_messages_templates_editor_save-button"]') as HTMLElement,
    );

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        key: "GREETING",
        content: "지점 전용 본문",
        customVariables: [],
        scope: "branch",
        branchId: "branch-test",
      });
    });
  });

  it("resets a dirty draft to the rollback response before refetch completes", async () => {
    const editorRef = createRef<SystemTemplateEditorHandle>();
    render(<SystemTemplateEditor ref={editorRef} template={buildTemplate()} />);

    replaceContent("저장 전 초안");

    await act(async () => {
      editorRef.current?.reset({
        content: "복원된 버전 본문",
        customVariables: [],
      });
    });

    expect(readContent()).toBe("복원된 버전 본문");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("names and focuses the visible editor without a hidden input mirror", async () => {
    render(<SystemTemplateEditor template={buildTemplate()} />);

    const field = getContentField();
    expect(field).toHaveAttribute("contenteditable", "true");
    expect(field).toHaveAttribute("aria-multiline", "true");
    expect(document.querySelector("textarea")).toBeNull();
    fireEvent.click(screen.getByText("템플릿 내용", { exact: true }));

    await waitFor(() => expect(field).toHaveFocus());
  });

  it("locks the real editor and insertion buttons while saving, then unlocks them", async () => {
    const template = buildTemplate({
      requiredVariables: [{ key: "name", label: "이름", type: "string", required: true }],
    });
    const onPreviewMessageChange = jest.fn();
    const { rerender } = render(
      <SystemTemplateEditor template={template} onPreviewMessageChange={onPreviewMessageChange} />,
    );
    replaceContent("저장할 본문 {{name}}");
    await waitFor(() => expect(readContent()).toBe("저장할 본문 {{name}}"));
    const changeCount = onPreviewMessageChange.mock.calls.length;

    jest.mocked(useUpdateSystemTemplate).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: true,
    } as never);
    rerender(<SystemTemplateEditor template={template} onPreviewMessageChange={onPreviewMessageChange} />);

    expect(getContentField()).toHaveAttribute("contenteditable", "false");
    const insertButton = screen.getByRole("button", { name: "* 이름" });
    expect(insertButton).toBeDisabled();
    fireEvent.paste(getContentField(), { clipboardData: { getData: () => "유실될 입력" } });
    fireEvent.click(insertButton);
    expect(readContent()).toBe("저장할 본문 {{name}}");
    expect(onPreviewMessageChange).toHaveBeenCalledTimes(changeCount);

    jest.mocked(useUpdateSystemTemplate).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as never);
    rerender(<SystemTemplateEditor template={template} onPreviewMessageChange={onPreviewMessageChange} />);
    expect(getContentField()).toHaveAttribute("contenteditable", "true");
    expect(insertButton).toBeEnabled();
    replaceContent("저장 후 다시 편집한 본문 {{name}}");
    await waitFor(() => expect(readContent()).toBe("저장 후 다시 편집한 본문 {{name}}"));
  });
});
