import { fireEvent, render, screen } from "@testing-library/react";

import { TemplateList } from "./template-list";

const mockPush = jest.fn();
const mockRefetch = jest.fn();
let mockQuery: {
  data?: Array<{ id: string; name: string; content: string; updatedAt: string }>;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  isFetching?: boolean;
} = {};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({
    ...mockQuery,
    refetch: mockRefetch,
  }),
}));

const template = {
  id: "template-1",
  name: "안내 템플릿",
  content: "안내 내용",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

describe("TemplateList query states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = { data: [template], isLoading: false, isError: false };
  });

  it("shows an initial read failure instead of the empty state", () => {
    mockQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("server detail must not be shown"),
    };

    render(<TemplateList />);

    expect(screen.getByText("템플릿을 불러오지 못했어요")).toBeInTheDocument();
    expect(screen.queryByText("데이터가 없습니다.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("retains stale rows and shows a retry warning after a refresh failure", () => {
    mockQuery = {
      data: [template],
      isLoading: false,
      isError: true,
      error: new Error("server detail must not be shown"),
    };

    render(<TemplateList />);

    expect(screen.getByText("안내 템플릿")).toBeInTheDocument();
    expect(screen.getByText("템플릿을 새로 불러오지 못했어요")).toBeInTheDocument();
  });

  it("keeps a valid empty list as the normal empty state", () => {
    mockQuery = { data: [], isLoading: false, isError: false };

    render(<TemplateList />);

    expect(screen.getByText("데이터가 없습니다.")).toBeInTheDocument();
  });
});
