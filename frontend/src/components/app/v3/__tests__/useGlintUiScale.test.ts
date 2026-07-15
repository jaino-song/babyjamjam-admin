import { getGlintUiScaleForViewport } from "../useGlintUiScale";

describe("Glint UI Scale", () => {
  it("uses the shared desktop viewport ratio and multiplier", () => {
    expect(getGlintUiScaleForViewport(1920, 1080)).toBe(1.1);
    expect(getGlintUiScaleForViewport(1170, 964)).toBe(0.6703);
  });
});
