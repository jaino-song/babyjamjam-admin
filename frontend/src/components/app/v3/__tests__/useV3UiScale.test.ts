import { getV3UiScaleForViewport } from "../useV3UiScale";

describe("getV3UiScaleForViewport", () => {
  it("uses the shared desktop viewport ratio and multiplier", () => {
    expect(getV3UiScaleForViewport(1920, 1080)).toBe(1.1);
    expect(getV3UiScaleForViewport(1170, 964)).toBe(0.6703);
  });
});
