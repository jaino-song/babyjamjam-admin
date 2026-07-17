import { getClientDetailSubtitle } from "../ClientDetailPanel";

describe("getClientDetailSubtitle", () => {
  it("hides the empty service duration marker for pre-booking clients", () => {
    expect(getClientDetailSubtitle({
      type: null,
      duration: null,
      serviceStatus: "pre_booking",
    })).toBe("일반");
  });

  it("keeps the service duration when it is available", () => {
    expect(getClientDetailSubtitle({
      type: "A가1형",
      duration: 10,
      serviceStatus: "waiting",
    })).toBe("A가1형 · 10일");
  });
});
