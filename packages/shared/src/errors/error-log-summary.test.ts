import { summarizeErrorForLog } from "./error-log-summary";

function axiosShapedError() {
  return {
    isAxiosError: true,
    name: "AxiosError",
    code: "ERR_BAD_REQUEST",
    message: "https://example.test/?token=message-secret",
    config: {
      data: '{"password":"P@ss-secret"}',
      headers: { Authorization: "Bearer tok-secret" },
      url: "/auth/verify?token=v-secret",
    },
    response: {
      status: 403,
      data: { code: "PENDING_APPROVAL", message: "m-secret", email: "e@secret.test" },
    },
    request: { body: "request-secret" },
  };
}

describe("summarizeErrorForLog", () => {
  it("keeps only the allowed Axios fields, without request or response secrets", () => {
    const summary = summarizeErrorForLog(axiosShapedError());
    expect(summary).toEqual({
      name: "AxiosError", code: "ERR_BAD_REQUEST", status: 403, problemCode: "PENDING_APPROVAL",
    });
    const serialized = JSON.stringify(summary);
    for (const secret of ["P@ss-secret", "tok-secret", "v-secret", "m-secret", "e@secret.test", "request-secret", "message-secret"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("uses the Axios summary for an Axios-shaped Error instance, omitting its message", () => {
    const error = Object.assign(new Error(), axiosShapedError());
    expect(error).toBeInstanceOf(Error);

    expect(summarizeErrorForLog(error)).toEqual({
      name: "AxiosError", code: "ERR_BAD_REQUEST", status: 403, problemCode: "PENDING_APPROVAL",
    });
  });

  it.each([{}, "A".repeat(64), "lower_case", "", "FORGED_UPPERCASE_SENTINEL", "constructor", "__proto__"])(
    "omits a code outside the problem catalog: %p", (code) => {
      const error = axiosShapedError();
      const summary = summarizeErrorForLog({ ...error, response: { status: 403, data: { code } } });
      expect(summary).toEqual({ name: "AxiosError", code: "ERR_BAD_REQUEST", status: 403 });
    },
  );

  it("drops forged names and codes even when they resemble enums", () => {
    const name = "FORGED_ERROR_NAME";
    const code = "FORGED_TRANSPORT_CODE";
    const problemCode = "FORGED_PROBLEM_CODE";
    expect(summarizeErrorForLog(Object.assign(new Error("message-sentinel"), { name, code, problemCode })))
      .toEqual({ name: "Error" });
    expect(summarizeErrorForLog({ ...axiosShapedError(), name, code, response: { data: { code: problemCode } } }))
      .toEqual({ name: "AxiosError" });
  });

  it.each([99, 600, 403.5, Infinity, NaN, "403", null])("drops invalid HTTP status %p", status => {
    expect(summarizeErrorForLog({ isAxiosError: true, response: { status } })).toEqual({ name: "AxiosError" });
  });

  it.each([100, 599])("keeps valid boundary HTTP status %p", status => {
    expect(summarizeErrorForLog({ isAxiosError: true, response: { status } })).toEqual({ name: "AxiosError", status });
  });

  it("does not copy an Error's message, stack, cause, request or response", () => {
    const cause = axiosShapedError();
    const error = Object.assign(new TypeError("arbitrary-message-sentinel", { cause }), {
      request: cause.request, config: cause.config, response: cause.response,
    });
    expect(summarizeErrorForLog(error)).toEqual({ name: "TypeError" });
  });

  it("omits SyntaxError messages because they may quote the parsed input", () => {
    expect(summarizeErrorForLog(new SyntaxError('Unexpected token in "body-secret"'))).toEqual({ name: "SyntaxError" });
  });

  it.each(["body-secret", { body: "body-secret" }, undefined, null])( "does not serialize a non-Error: %p", (value) => {
    expect(summarizeErrorForLog(value)).toEqual({ name: "NonError" });
  });

  it("returns the fallback when an Axios metadata getter throws", () => {
    const error = {
      isAxiosError: true,
      name: "AxiosError",
      code: "ECONNABORTED",
      get response() { throw new Error("getter-secret"); },
    };
    expect(() => summarizeErrorForLog(error)).not.toThrow();
    expect(summarizeErrorForLog(error)).toEqual({ name: "NonError" });
  });

  it("does not throw for hostile proxies or frozen errors", () => {
    const proxy = new Proxy({}, {
      get() { throw new Error("get-secret"); },
      getPrototypeOf() { throw new Error("prototype-secret"); },
    });
    expect(() => summarizeErrorForLog(proxy)).not.toThrow();
    expect(summarizeErrorForLog(proxy)).toEqual({ name: "NonError" });
    expect(summarizeErrorForLog(Object.freeze(new Error("f")))).toEqual({ name: "Error" });
  });

  it("never reads a message or stack accessor", () => {
    const getter = jest.fn(() => { throw new Error("getter-sentinel"); });
    const error = Object.defineProperties(new Error(), {
      message: { get: getter },
      stack: { get: getter },
    });
    expect(summarizeErrorForLog(error)).toEqual({ name: "Error" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not return non-primitive field values or invoke their serialization", () => {
    const unsafe = { toJSON() { throw new Error("serialization-secret"); } };
    expect(summarizeErrorForLog({ isAxiosError: true, name: unsafe, code: unsafe, response: { status: unsafe, data: { code: unsafe } } }))
      .toEqual({ name: "AxiosError" });
    const error = Object.defineProperties(new Error(), {
      name: { get() { throw new Error("name-secret"); } },
      message: { get() { throw new Error("message-secret"); } },
    });
    expect(() => summarizeErrorForLog(error)).not.toThrow();
    expect(summarizeErrorForLog(error)).toEqual({ name: "NonError" });
  });
});
