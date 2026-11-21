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

  it.each([{}, "A".repeat(65), "lower_case", "", "UPPER-WITH-DASH", "CODE\n"])(
    "omits a problem code that is not a short uppercase code: %p", (code) => {
      const error = axiosShapedError();
      const summary = summarizeErrorForLog({ ...error, response: { status: 403, data: { code } } });
      expect(summary).toEqual({ name: "AxiosError", code: "ERR_BAD_REQUEST", status: 403 });
    },
  );

  it("accepts a code at the 64 character limit", () => {
    const summary = summarizeErrorForLog({ isAxiosError: true, response: { data: { code: "A".repeat(64) } } });
    expect(summary).toEqual({ name: "AxiosError", problemCode: "A".repeat(64) });
  });

  it("returns only an Error name and message truncated to 200 characters", () => {
    expect(summarizeErrorForLog(new TypeError("x".repeat(201)))).toEqual({
      name: "TypeError", message: "x".repeat(200),
    });
  });

  it("does not copy an Error's cause or enumerable request and response properties", () => {
    const cause = axiosShapedError();
    const error = Object.assign(new Error("m", { cause }), { config: cause.config, response: cause.response });
    expect(summarizeErrorForLog(error)).toEqual({ name: "Error", message: "m" });
  });

  it("omits SyntaxError messages because they may quote the parsed input", () => {
    expect(summarizeErrorForLog(new SyntaxError('Unexpected token in "body-secret"'))).toEqual({ name: "SyntaxError" });
  });

  it.each(["body-secret", { body: "body-secret" }, undefined, null])( "does not serialize a non-Error: %p", (value) => {
    expect(summarizeErrorForLog(value)).toEqual({ name: "NonError" });
  });

  it("keeps safe Axios fields even when a response getter throws", () => {
    const error = {
      isAxiosError: true,
      name: "AxiosError",
      code: "ECONNABORTED",
      get response() { throw new Error("getter-secret"); },
    };
    expect(() => summarizeErrorForLog(error)).not.toThrow();
    expect(summarizeErrorForLog(error)).toEqual({ name: "AxiosError", code: "ECONNABORTED" });
  });

  it("does not throw for hostile proxies or frozen errors", () => {
    const proxy = new Proxy({}, {
      get() { throw new Error("get-secret"); },
      getPrototypeOf() { throw new Error("prototype-secret"); },
    });
    expect(() => summarizeErrorForLog(proxy)).not.toThrow();
    expect(summarizeErrorForLog(proxy)).toEqual({ name: "NonError" });
    expect(summarizeErrorForLog(Object.freeze(new Error("f")))).toEqual({ name: "Error", message: "f" });
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
    expect(summarizeErrorForLog(error)).toEqual({ name: "Error" });
  });
});
