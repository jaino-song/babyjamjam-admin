import { inspect } from "node:util";
import { renderHook } from "@testing-library/react";

import type { EformSignDocument, EformsignDocumentOption } from "@/lib/eformsign/types";

import { useEformsign } from "../useEformsign";

describe("useEformsign SDK callbacks", () => {
  const originalSdk = Object.getOwnPropertyDescriptor(window, "EformSignDocument");

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSdk) Object.defineProperty(window, "EformSignDocument", originalSdk);
    else Reflect.deleteProperty(window, "EformSignDocument");
  });

  it("forwards the original eligible responses without logging SDK data", () => {
    const registerDocument = jest.fn<void, Parameters<EformSignDocument["document"]>>();
    const open = jest.fn();
    window.EformSignDocument = class FakeEformSignDocument implements EformSignDocument {
      document = registerDocument;
      open = open;
    };

    const { result } = renderHook(() => useEformsign());
    expect(result.current.isLoaded).toBe(true);

    const options: EformsignDocumentOption = { company: { id: "test-company" }, mode: { type: "01" } };
    const iframeId = "test-iframe";
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const onAction = jest.fn();
    result.current.openDocument(options, iframeId, { onSuccess, onError, onAction });

    expect(registerDocument).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    const [sdkOptions, sdkIframeId, success, error, action] = registerDocument.mock.calls[0];
    expect(sdkOptions).toBe(options);
    expect(sdkIframeId).toBe(iframeId);
    if (!success || !error || !action) throw new Error("Expected all three SDK callbacks");

    const consoleSpies = (["log", "error", "warn", "info", "debug", "dir", "table", "trace"] as const)
      .map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
    const extra = { nested: { value: "synthetic-sdk-unknown-field" } };
    const accepted = { code: "-1", field_values: { field: "synthetic-sdk-success-payload" }, extra };
    const rejected = { code: "synthetic-sdk-rejected-code", document_id: "synthetic-sdk-rejected-document", extra };
    const failure = { code: "synthetic-sdk-error-code", message: "synthetic-sdk-error-message", extra };
    const event = { type: "synthetic-sdk-action-type", data: { nested: "synthetic-sdk-action-data" }, extra };

    success(rejected);
    expect(onSuccess).not.toHaveBeenCalled();
    success(accepted);
    error(failure);
    action(event);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toBe(accepted);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(failure);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).toBe(event);

    const sentinels = [
      accepted.code, accepted.field_values.field, rejected.code, rejected.document_id,
      failure.code, failure.message, event.type, event.data.nested, extra.nested.value,
    ];
    for (const spy of consoleSpies) {
      for (const args of spy.mock.calls) {
        const logged = inspect(args, { depth: null });
        for (const sentinel of sentinels) expect(logged).not.toContain(sentinel);
      }
    }
  });
});
