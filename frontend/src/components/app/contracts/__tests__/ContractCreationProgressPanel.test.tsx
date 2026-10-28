import { render, screen, within } from "@testing-library/react";

import type {
  HeadlessProgressState,
  HeadlessProgressStep,
} from "@/components/app/eformsign/HeadlessProgressStepper";
import { ContractCreationProgressPanel } from "../ContractCreationProgressPanel";

const STEPS: readonly HeadlessProgressStep[] = [
  { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
  { key: "info-inserted", label: "이용자 정보 입력 완료", errorLabel: "이용자 정보 입력 실패" },
  { key: "creating", label: "전자문서 생성 중", errorLabel: "전자문서 생성 실패" },
  { key: "sent", label: "전자문서 전송 완료", errorLabel: "전자문서 전송 실패" },
];

const stepState = (key: string) =>
  screen.getByTestId(`contract-creation-progress-step-${key}`).getAttribute("data-state");

const TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

function renderPanel(
  progress: HeadlessProgressState,
  props: Partial<React.ComponentProps<typeof ContractCreationProgressPanel>> = {},
) {
  return render(
    <ContractCreationProgressPanel
      steps={STEPS}
      progress={progress}
      recipientName="김철수"
      recipientPhone="01012345678"
      errorHint="수동으로 입력해 주세요"
      {...props}
    />,
  );
}

describe("ContractCreationProgressPanel", () => {
  it("renders nothing when there is no current step", () => {
    const { container } = renderPanel({ step: null, completed: false, failed: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the step is not part of the step list", () => {
    const { container } = renderPanel({ step: "creating", completed: false, failed: false }, {
      steps: STEPS.filter((item) => item.key !== "creating"),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("marks earlier rows done, the current row active and later rows pending", () => {
    renderPanel({ step: "creating", completed: false, failed: false });

    expect(screen.getByTestId("contract-creation-progress-stepper")).toHaveAttribute(
      "aria-label",
      "전자계약서 생성 진행 상태",
    );
    expect(stepState("client-started")).toBe("done");
    expect(stepState("info-inserted")).toBe("done");
    expect(stepState("creating")).toBe("active");
    expect(stepState("sent")).toBe("pending");
    expect(screen.getByTestId("contract-creation-progress-spinner-creating")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-creation-progress-spinner-sent")).not.toBeInTheDocument();
    expect(screen.getByText("처리 중")).toBeInTheDocument();
  });

  it.each([
    ["client-started", "전자문서 클라이언트 연결 중"],
    ["info-inserted", "이용자 정보를 입력하고 있어요"],
    ["creating", "전자문서를 생성하고 있어요"],
    ["sent", "김철수님께 전송하고 있어요"],
  ] as const)("titles the %s step as %s", (step, title) => {
    renderPanel({ step, completed: false, failed: false });
    expect(screen.getByText(title)).toHaveAttribute("aria-live", "polite");
  });

  it("falls back to a generic recipient in the sending title", () => {
    renderPanel(
      { step: "sent", completed: false, failed: false },
      { recipientName: undefined },
    );
    expect(screen.getByText("이용자에게 전송하고 있어요")).toBeInTheDocument();
  });

  it("marks every row done and shows the completed title when finished", () => {
    renderPanel({ step: "sent", completed: true, failed: false });

    STEPS.forEach((item) => expect(stepState(item.key)).toBe("done"));
    expect(screen.getAllByText("전자문서 전송 완료").length).toBeGreaterThan(0);
    expect(screen.getByText("전자문서 전송 완료", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("처리 중")).not.toBeInTheDocument();
  });

  it("shows the error row, its label and the hint when a step fails", () => {
    renderPanel({ step: "creating", completed: false, failed: true });

    expect(stepState("info-inserted")).toBe("done");
    expect(stepState("creating")).toBe("error");
    expect(stepState("sent")).toBe("pending");
    expect(screen.getByTestId("contract-creation-progress-error-creating")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-creation-progress-spinner-creating")).not.toBeInTheDocument();
    expect(screen.getByText("전자문서 생성 실패", { selector: "p" })).toBeInTheDocument();
    // hint replaces the recipient line in the hero and also sits under the failed row
    expect(screen.getAllByText("수동으로 입력해 주세요")).toHaveLength(2);
    expect(screen.queryByText(/김철수님 ·/)).not.toBeInTheDocument();
  });

  it("shows a completion time only for done rows", () => {
    renderPanel({ step: "creating", completed: false, failed: false });

    const timeFor = (key: string) =>
      within(screen.getByTestId(`contract-creation-progress-step-${key}`)).queryByText(TIME_PATTERN);

    expect(timeFor("client-started")).toBeInTheDocument();
    expect(timeFor("info-inserted")).toBeInTheDocument();
    expect(timeFor("creating")).not.toBeInTheDocument();
    expect(timeFor("sent")).not.toBeInTheDocument();
  });

  it("keeps the time stamped for a row once it was recorded", () => {
    const { rerender } = renderPanel({ step: "info-inserted", completed: false, failed: false });
    const firstTime = within(screen.getByTestId("contract-creation-progress-step-client-started"))
      .getByText(TIME_PATTERN).textContent;

    rerender(
      <ContractCreationProgressPanel
        steps={STEPS}
        progress={{ step: "creating", completed: false, failed: false }}
        recipientName="김철수"
        recipientPhone="01012345678"
      />,
    );

    expect(
      within(screen.getByTestId("contract-creation-progress-step-client-started")).getByText(TIME_PATTERN)
        .textContent,
    ).toBe(firstTime);
    expect(
      within(screen.getByTestId("contract-creation-progress-step-info-inserted")).getByText(TIME_PATTERN),
    ).toBeInTheDocument();
  });

  it("formats the recipient line with the formatted phone number", () => {
    renderPanel({ step: "creating", completed: false, failed: false });
    expect(screen.getByText("김철수님 · 010-1234-5678")).toBeInTheDocument();
  });

  it("omits missing recipient parts and the whole line when both are missing", () => {
    const { rerender } = renderPanel(
      { step: "creating", completed: false, failed: false },
      { recipientPhone: undefined },
    );
    expect(screen.getByText("김철수님")).toBeInTheDocument();

    rerender(
      <ContractCreationProgressPanel
        steps={STEPS}
        progress={{ step: "creating", completed: false, failed: false }}
        recipientPhone="01012345678"
      />,
    );
    expect(screen.getByText("010-1234-5678")).toBeInTheDocument();

    rerender(
      <ContractCreationProgressPanel
        steps={STEPS}
        progress={{ step: "creating", completed: false, failed: false }}
      />,
    );
    expect(
      document.querySelector('[data-component="desktop_contracts_creation-progress_panel_hero_subtitle"]'),
    ).toBeNull();
  });

  describe("completion timestamps across runs", () => {
    const at = (h: number, m: number, s: number) => new Date(2026, 0, 1, h, m, s);
    const timeOf = (key: string) =>
      within(screen.getByTestId(`contract-creation-progress-step-${key}`)).queryByText(TIME_PATTERN)
        ?.textContent;
    const panel = (progress: HeadlessProgressState) => (
      <ContractCreationProgressPanel steps={STEPS} progress={progress} />
    );

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(at(0, 0, 0));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("keeps earlier stamps unchanged during normal forward progress", () => {
      const { rerender } = render(panel({ step: "info-inserted", completed: false, failed: false }));
      expect(timeOf("client-started")).toBe("00:00:00");

      jest.setSystemTime(at(0, 0, 30));
      rerender(panel({ step: "creating", completed: false, failed: false }));
      expect(timeOf("client-started")).toBe("00:00:00");
      expect(timeOf("info-inserted")).toBe("00:00:30");

      jest.setSystemTime(at(0, 1, 0));
      rerender(panel({ step: "sent", completed: true, failed: false }));
      expect(timeOf("client-started")).toBe("00:00:00");
      expect(timeOf("info-inserted")).toBe("00:00:30");
      expect(timeOf("creating")).toBe("00:01:00");
      expect(timeOf("sent")).toBe("00:01:00");
    });

    it("restamps when a failed run restarts at an earlier step without a null render", () => {
      const { rerender } = render(panel({ step: "creating", completed: false, failed: true }));
      expect(timeOf("client-started")).toBe("00:00:00");

      jest.setSystemTime(at(0, 1, 0));
      rerender(panel({ step: "client-started", completed: false, failed: false }));
      rerender(panel({ step: "info-inserted", completed: false, failed: false }));

      expect(timeOf("client-started")).toBe("00:01:00");
    });

    it("restamps when the failed step itself is retried at the same position", () => {
      const { rerender } = render(panel({ step: "client-started", completed: false, failed: true }));

      jest.setSystemTime(at(0, 1, 0));
      rerender(panel({ step: "client-started", completed: false, failed: false }));
      jest.setSystemTime(at(0, 2, 0));
      rerender(panel({ step: "info-inserted", completed: false, failed: false }));

      expect(timeOf("client-started")).toBe("00:02:00");
    });

    it("clears stamps when the step returns to null", () => {
      const { rerender } = render(panel({ step: "creating", completed: false, failed: false }));
      rerender(panel({ step: null, completed: false, failed: false }));

      jest.setSystemTime(at(0, 1, 0));
      rerender(panel({ step: "info-inserted", completed: false, failed: false }));
      expect(timeOf("client-started")).toBe("00:01:00");
    });
  });
});
