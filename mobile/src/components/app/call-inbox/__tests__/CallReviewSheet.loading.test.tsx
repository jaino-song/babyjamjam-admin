import { render, screen } from "@testing-library/react";

import { CallReviewSheet } from "../CallReviewSheet";

let mockType = "NEW_CLIENT";
let mockConfirmPending = true;
const mockMutate = jest.fn();

jest.mock("@/hooks/useCallInbox", () => ({
  useClientDraft: () => ({
    data: {
      id: "QA-draft", type: mockType, status: "PENDING", clientId: 523,
      proposals: [{ field: "name", value: "QA-고객", confidence: "high", evidence: "" }],
      callRecord: { recordedAt: "2026-11-16T00:00:00Z", transcript: [] },
    },
  }),
  useConfirmDraft: () => ({ isPending: mockConfirmPending, mutateAsync: mockMutate }),
  useDiscardDraft: () => ({ isPending: false, mutateAsync: jest.fn() }),
  usePatchDraft: () => ({ isPending: false, mutate: jest.fn(), mutateAsync: jest.fn() }),
}));
jest.mock("@/components/app/clients/ClientAutocomplete", () => ({ ClientAutocomplete: () => null }));
jest.mock("@/hooks/use-toast", () => ({ toast: jest.fn() }));

describe("CallReviewSheet busy actions", () => {
  it.each([
    ["NEW_CLIENT", "등록 중", "고객 등록"],
    ["CLIENT_UPDATE", "적용 중", "변경 적용 (1건)"],
  ])("keeps the %s idle label while showing a centred Spinner", (type, busyLabel, idleLabel) => {
    mockType = type;
    mockConfirmPending = true;
    const { rerender } = render(<CallReviewSheet draftId="QA-draft" onClose={jest.fn()} />);
    const busy = screen.getByRole("button", { name: busyLabel });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(busy.querySelector('[data-slot="button-idle"]')).toHaveTextContent(idleLabel);
    expect(busy.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).toBeInTheDocument();
    mockConfirmPending = false;
    rerender(<CallReviewSheet draftId="QA-draft" onClose={jest.fn()} />);
    expect(screen.getByRole("button", { name: idleLabel })).toHaveAttribute("aria-busy", "false");
  });
});
