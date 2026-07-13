import { isProviderReviewWorkflowStep } from "../review-step";

describe("isProviderReviewWorkflowStep", () => {
  it("does not treat a user participant step as provider review even when recipient_type is internal upstream", () => {
    expect(
      isProviderReviewWorkflowStep({
        step_type: "05",
        step_name: "이용자",
      }),
    ).toBe(false);
  });

  it("treats explicit provider review steps as provider review", () => {
    expect(
      isProviderReviewWorkflowStep({
        step_type: "06",
        step_name: "제공기관 검토",
      }),
    ).toBe(true);
  });

  it("treats provider confirmation labels as provider review even when eformsign reuses participant step type", () => {
    expect(
      isProviderReviewWorkflowStep({
        step_type: "05",
        step_name: "제공기관 확인",
      }),
    ).toBe(true);
  });

  it("does not treat provider drafting labels as provider review", () => {
    expect(
      isProviderReviewWorkflowStep({
        step_type: "00",
        step_name: "제공기관 작성",
      }),
    ).toBe(false);
  });
});
