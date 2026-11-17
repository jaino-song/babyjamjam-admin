import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { SystemTemplate } from "../../types";
import { SystemTemplateEditor } from "../system-template-editor";
import { VersionHistory } from "../VersionHistory";

let mockSaving = false;
let mockRestoring = false;
let mockResetting = false;
let mockVersionsLoading = false;
const mockSave = jest.fn();
const mockRestore = jest.fn();
const mockReset = jest.fn();

jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/services/system-template.service", () => ({
  systemTemplateService: { getVersionContent: () => new Promise(() => {}) },
}));
jest.mock("../../hooks", () => ({
  useUpdateSystemTemplate: () => ({ isPending: mockSaving, mutateAsync: mockSave }),
  useRollbackTemplate: () => ({ isPending: mockRestoring, mutateAsync: mockRestore }),
  useResetTemplate: () => ({ isPending: mockResetting, mutateAsync: mockReset }),
  useTemplateVersions: () => ({ isLoading: mockVersionsLoading, data: [{ versionNumber: 1, createdAt: "2026-11-01T00:00:00Z", createdBy: null }] }),
  systemTemplateKeys: { versionDetail: (key: string, version: number) => [key, version] },
}));

const template: SystemTemplate = {
  id: "qa-template", templateKey: "SERVICE_INFO", name: "QA 템플릿", description: "",
  content: "QA 내용", requiredVariables: [],
  customVariables: [{ key: "qa_name", label: "QA 이름", required: true }],
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
};

beforeEach(() => {
  mockSaving = false;
  mockRestoring = false;
  mockResetting = false;
  mockVersionsLoading = false;
  jest.clearAllMocks();
});

it("hides the idle save label and centers a spinner while saving", () => {
  mockSaving = true;
  render(<SystemTemplateEditor template={template} />);
  const button = screen.getByRole("button", { name: "저장 중" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
});

it("keeps a small chip icon with a 44px touch area and removes the chosen variable", () => {
  render(<SystemTemplateEditor template={template} />);
  const button = screen.getByRole("button", { name: "QA 이름 변수 삭제" });
  expect(button).toHaveClass("relative", "after:h-11", "after:w-11");
  expect(button.querySelector("svg")).toHaveClass("h-3", "w-3");
  fireEvent.click(button);
  expect(screen.queryByText("QA 이름 (qa_name)")).not.toBeInTheDocument();
});

function mountHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><VersionHistory templateKey="SERVICE_INFO" /></QueryClientProvider>);
  return { ...view, client, refresh: () => view.rerender(<QueryClientProvider client={client}><VersionHistory templateKey="SERVICE_INFO" /></QueryClientProvider>) };
}

it.each(["rollback", "reset"])("shows only a spinner in the pending %s confirmation", (operation) => {
  const view = mountHistory();
  fireEvent.click(screen.getByRole("button", { name: "버전 기록" }));
  fireEvent.click(screen.getByRole("button", { name: operation === "rollback" ? "이 버전으로 복원" : "기본값으로 초기화" }));
  mockRestoring = operation === "rollback";
  mockResetting = operation === "reset";
  view.refresh();
  const button = screen.getByRole("button", { name: operation === "rollback" ? "복원 중" : "초기화 중" });
  expect(button).toBeDisabled();
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  view.unmount();
  view.client.clear();
});

it("names the history loading status without rendering a visible loading label", () => {
  mockVersionsLoading = true;
  const view = mountHistory();
  fireEvent.click(screen.getByRole("button", { name: "버전 기록" }));
  const status = screen.getByRole("status", { name: "버전 기록을 불러오는 중" });
  expect(within(status).getByText("버전 기록을 불러오는 중")).toHaveClass("sr-only");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  view.unmount();
  view.client.clear();
});

it("names the preview loading status", () => {
  const view = mountHistory();
  fireEvent.click(screen.getByRole("button", { name: "버전 기록" }));
  fireEvent.click(screen.getByRole("button", { name: "미리보기" }));
  const status = screen.getByRole("status", { name: "버전 내용을 불러오는 중" });
  expect(within(status).getByText("버전 내용을 불러오는 중")).toHaveClass("sr-only");
  expect(status.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
  view.unmount();
  view.client.clear();
});
