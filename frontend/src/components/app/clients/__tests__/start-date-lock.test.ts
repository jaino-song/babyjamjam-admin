import { createProblemDetails } from "@babyjamjam/shared";

import { getStartDateLock } from "../start-date-lock";

const problem = createProblemDetails({ code: "SERVICE_RECORD_START_DATE_LOCKED", requestId: "req-lock-helper" });
const responseError = (startDateLock: unknown, status = 409) => ({
  response: { status, data: { ...problem, startDateLock } },
});

describe("getStartDateLock", () => {
  it.each([
    { serviceStarted: true, recordedSessionCount: 0 },
    { serviceStarted: true, recordedSessionCount: 3 },
    { serviceStarted: false, recordedSessionCount: 2 },
  ])("reads the validated lock %j", (lock) => {
    expect(getStartDateLock(responseError(lock))).toEqual(lock);
  });

  it("returns only whitelisted fields", () => {
    expect(getStartDateLock(responseError({ serviceStarted: true, recordedSessionCount: 3, secret: "dropped" })))
      .toEqual({ serviceStarted: true, recordedSessionCount: 3 });
  });

  it("does not use an extension belonging to another code", () => {
    expect(getStartDateLock({
      response: {
        status: 409,
        data: {
          ...createProblemDetails({ code: "SERVICE_RECORD_FINALIZED", requestId: "req-finalized" }),
          startDateLock: { serviceStarted: true, recordedSessionCount: 3 },
        },
      },
    })).toBeNull();
  });

  it("requires HTTP 409", () => {
    expect(getStartDateLock(responseError({ serviceStarted: true, recordedSessionCount: 3 }, 400))).toBeNull();
  });

  it.each([
    undefined, null, {}, [], "invalid",
    { serviceStarted: "true", recordedSessionCount: 3 },
    { serviceStarted: true },
    { recordedSessionCount: 3 },
    ...[-1, 1.5, 10001, NaN, Infinity, "3", null].map((recordedSessionCount) => ({
      serviceStarted: true, recordedSessionCount,
    })),
  ])("rejects a missing or malformed extension %j", (lock) => {
    expect(getStartDateLock(responseError(lock))).toBeNull();
  });

  it.each([null, undefined, {}, new Error("network"), { response: { status: 409, data: {} } }])(
    "ignores an unrecognized error %j", (error) => {
      expect(getStartDateLock(error)).toBeNull();
    },
  );
});
