import {
  RESEND_UNCERTAIN_MAX_AGE_MS,
  clearResendUncertain,
  isResendUncertain,
  markResendUncertain,
  resendUncertainStorageKey,
} from "@/features/document-jobs/resend-uncertain-storage";

describe("resend-uncertain-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  it("keys markers by the lowercase job id", () => {
    expect(resendUncertainStorageKey("AbC-1")).toBe("bjj:eformsign-resend-uncertain:abc-1");
  });

  it("is not uncertain without a marker", () => {
    expect(isResendUncertain("job-1")).toBe(false);
  });

  it("remembers a marker regardless of id casing", () => {
    markResendUncertain("job-1");

    expect(isResendUncertain("JOB-1")).toBe(true);
    expect(isResendUncertain("job-2")).toBe(false);
  });

  it("clears a marker", () => {
    markResendUncertain("job-1");
    clearResendUncertain("JOB-1");

    expect(isResendUncertain("job-1")).toBe(false);
    expect(window.localStorage.getItem(resendUncertainStorageKey("job-1"))).toBeNull();
  });

  it("ignores and removes a marker older than eight days, and keeps one just inside", () => {
    const now = 1_800_000_000_000;
    markResendUncertain("old", now - RESEND_UNCERTAIN_MAX_AGE_MS - 1);
    markResendUncertain("fresh", now - RESEND_UNCERTAIN_MAX_AGE_MS + 1);

    expect(isResendUncertain("old", now)).toBe(false);
    expect(window.localStorage.getItem(resendUncertainStorageKey("old"))).toBeNull();
    expect(isResendUncertain("fresh", now)).toBe(true);
  });

  it("fails closed when storage cannot be read or the value is unreadable", () => {
    window.localStorage.setItem(resendUncertainStorageKey("garbled"), "not-a-time");
    expect(isResendUncertain("garbled")).toBe(true);

    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isResendUncertain("job-1")).toBe(true);
  });

  it("never throws when storage cannot be written or cleared", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => markResendUncertain("job-1")).not.toThrow();
    expect(() => clearResendUncertain("job-1")).not.toThrow();
  });
});
