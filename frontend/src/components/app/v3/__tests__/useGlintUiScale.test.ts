import { getGlintUiScaleForViewport } from "../useGlintUiScale";

describe("Glint UI Scale", () => {
  it.each([[390, 844], [390, 400], [767, 844]])(
    "keeps handset text at full size for %sx%s",
    (width, height) => {
      expect(getGlintUiScaleForViewport(width, height)).toBe(1);
    },
  );

  it.each([[768, 844], [844, 390], [1024, 600]])(
    "keeps narrow or short desktop shells above the minimum scale for %sx%s",
    (width, height) => {
      expect(getGlintUiScaleForViewport(width, height)).toBe(0.67);
    },
  );

  it("uses the shared desktop viewport ratio and multiplier", () => {
    expect(getGlintUiScaleForViewport(1920, 1080)).toBe(1.1);
    expect(getGlintUiScaleForViewport(1170, 964)).toBe(0.6703);
  });
});
