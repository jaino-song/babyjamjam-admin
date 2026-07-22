import {
  getApiErrorMessage,
  getClientConflictPayload,
  getConflictPayload,
} from "./api-error-message";

describe("getApiErrorMessage", () => {
  it("should read a backend message from an Axios response", () => {
    expect(getApiErrorMessage({
      response: { data: { message: "백엔드 안내" } },
    }, "기본 안내")).toBe("백엔드 안내");
  });

  it("should read a legacy BFF error from an Axios response", () => {
    expect(getApiErrorMessage({
      response: { data: { error: "BFF 안내" } },
    }, "기본 안내")).toBe("BFF 안내");
  });

  it("should use the fallback for unsafe payloads", () => {
    expect(getApiErrorMessage({
      response: { data: { message: ["내부", "상세"] } },
    }, "기본 안내")).toBe("기본 안내");
  });

  it("should preserve only safe duplicate-client conflict fields", () => {
    expect(getClientConflictPayload({
      response: {
        status: 409,
        data: {
          message: "같은 전화번호의 고객이 있습니다.",
          clientId: 73,
          internal: "discarded",
        },
      },
    })).toEqual({
      message: "같은 전화번호의 고객이 있습니다.",
      clientId: 73,
    });
  });

  it("should prefer the backend business message over the HTTP error name", () => {
    expect(getConflictPayload({
      response: {
        status: 409,
        data: {
          message: "진행 중인 배정이 있는 직원은 삭제할 수 없습니다.",
          error: "Conflict",
        },
      },
    })).toEqual({
      message: "진행 중인 배정이 있는 직원은 삭제할 수 없습니다.",
    });
  });
});
